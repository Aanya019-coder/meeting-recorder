/**
 * service-worker.js
 * Central hub: owns the IndexedDB connection, settings storage, and badge
 * state. Content scripts never touch storage directly — they message this
 * worker — so there's one writer and no cross-tab version races. Live
 * transcript processing (regex extraction, similarity scoring) happens in
 * the content script itself for latency; this worker's job is persistence
 * and answering "what do we already know" queries.
 */
importScripts(
  '../lib/hashing-vectorizer.js',
  '../lib/attendee-matcher.js',
  '../lib/mom-generator.js',
  '../lib/google-drive.js',
  '../lib/supabase.js',
  '../lib/db.js'
);

const DB = self.Precedent.DB;
const AttendeeMatcher = self.Precedent.AttendeeMatcher;
const MOMGenerator = self.Precedent.MOMGenerator;
const GoogleDrive = self.Precedent.GoogleDrive;
const Supabase = self.Precedent.Supabase;

const DEFAULT_SETTINGS = {
  platforms: { meet: true, zoom: true, teams: true },
  similarityThreshold: 0.42,
  retentionDays: 180,
  overlayEnabled: true,
  googleDriveAutoSync: false
};

function getSettings() {
  return chrome.storage.local.get('settings').then((res) => ({
    ...DEFAULT_SETTINGS,
    ...(res.settings || {})
  }));
}

function setSettings(partial) {
  return getSettings().then((current) => {
    const next = { ...current, ...partial };
    return chrome.storage.local.set({ settings: next }).then(() => next);
  });
}

function buildPrimer(currentAttendees) {
  return Promise.all([DB.getOpenCommitments(), DB.getAllDecisions()]).then(
    ([commitments, decisions]) => {
      const relevantCommitments = commitments.filter((c) =>
        AttendeeMatcher.hasOverlap(currentAttendees, c.attendees || [])
      );
      const relevantDecisions = decisions.filter((d) =>
        AttendeeMatcher.hasOverlap(currentAttendees, d.attendees || [])
      );
      relevantCommitments.sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity));
      relevantDecisions.sort((a, b) => b.meetingDate - a.meetingDate);
      return {
        openCommitments: relevantCommitments.slice(0, 20),
        pastDecisions: relevantDecisions.slice(0, 100) // capped set sent to content script for local similarity scoring
      };
    }
  );
}

function updateBadge(tabId, text, color) {
  if (!tabId) return;
  chrome.action.setBadgeText({ tabId, text: text || '' });
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;

  (async () => {
    try {
      switch (message.type) {
        case 'GET_SETTINGS': {
          const settings = await getSettings();
          sendResponse({ ok: true, settings });
          break;
        }

        case 'SET_SETTINGS': {
          const settings = await setSettings(message.settings || {});
          sendResponse({ ok: true, settings });
          break;
        }

        case 'MEETING_STARTED': {
          const meeting = await DB.addMeeting({
            platform: message.platform,
            title: message.title,
            startTime: Date.now(),
            attendees: message.attendees || []
          });
          updateBadge(tabId, '\u25CF', '#2F6B5E');
          sendResponse({ ok: true, meetingId: meeting.id });
          break;
        }

        case 'ATTENDEES_DETECTED': {
          const meetings = await DB.getAllMeetings();
          const meeting = meetings.find((m) => m.id === message.meetingId);
          if (meeting) {
            meeting.attendees = AttendeeMatcher.dedupeAttendees(message.attendees || []);
            await DB.addMeeting(meeting); // put() upserts by id
          }
          const primer = await buildPrimer(message.attendees || []);
          sendResponse({ ok: true, primer });
          break;
        }

        case 'MEETING_SESSION_AUTOSAVE': {
          if (message.meetingId) {
            await DB.updateMeetingEndTime(message.meetingId, Date.now());
            for (const c of message.commitments || []) {
              await DB.addCommitment({ ...c, meetingId: message.meetingId });
            }
            for (const d of message.decisions || []) {
              await DB.addDecision({ ...d, meetingId: message.meetingId });
            }
            if (message.transcripts && message.transcripts.length > 0) {
              await DB.appendTranscriptLines(message.meetingId, message.transcripts);
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case 'MEETING_ENDED_SAVE': {
          await DB.updateMeetingEndTime(message.meetingId, Date.now());
          for (const c of message.commitments || []) {
            await DB.addCommitment({ ...c, meetingId: message.meetingId });
          }
          for (const d of message.decisions || []) {
            await DB.addDecision({ ...d, meetingId: message.meetingId });
          }
          if (message.transcripts && message.transcripts.length > 0) {
            await DB.appendTranscriptLines(message.meetingId, message.transcripts);
          }
          updateBadge(tabId, '', null);

          // Auto-sync to Google Drive if enabled in settings
          let driveSync = null;
          const settings = await getSettings();
          if (settings.googleDriveAutoSync) {
            try {
              const driveStatus = await GoogleDrive.getStatus();
              if (driveStatus.connected) {
                const meeting = (await DB.getAllMeetings()).find((m) => m.id === message.meetingId);
                const allCommitments = (await DB.getAll('commitments')).filter((c) => c.meetingId === message.meetingId);
                const allDecisions = (await DB.getAllDecisions()).filter((d) => d.meetingId === message.meetingId);
                const transcript = await DB.getTranscript(message.meetingId);
                const momData = {
                  title: (meeting && meeting.title) || 'Meeting',
                  startTime: (meeting && meeting.startTime) || Date.now(),
                  endTime: Date.now(),
                  platform: (meeting && meeting.platform) || 'call',
                  attendees: (meeting && meeting.attendees) || [],
                  commitments: allCommitments,
                  decisions: allDecisions,
                  transcript
                };
                const markdownMOM = MOMGenerator.toMarkdown(momData);
                const rawTranscript = transcript.map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.speaker}: ${l.text}`).join('\n');
                driveSync = await GoogleDrive.syncMeetingToDrive({
                  meetingTitle: momData.title,
                  startTime: momData.startTime,
                  markdownMOM,
                  rawTranscript
                });
              }
            } catch (err) {
              console.warn('Auto-sync to Google Drive failed:', err);
            }
          }

          sendResponse({ ok: true, driveSync });
          break;
        }

        case 'MEETING_ENDED_DISCARD': {
          if (message.meetingId) {
            await DB.deleteMeetingData(message.meetingId);
          }
          updateBadge(tabId, '', null);
          sendResponse({ ok: true });
          break;
        }

        case 'GENERATE_MOM': {
          const meeting = (await DB.getAllMeetings()).find((m) => m.id === message.meetingId);
          const allCommitments = (await DB.getAll('commitments')).filter((c) => c.meetingId === message.meetingId);
          const allDecisions = (await DB.getAllDecisions()).filter((d) => d.meetingId === message.meetingId);
          const transcript = await DB.getTranscript(message.meetingId);
          const momData = {
            title: (meeting && meeting.title) || message.meetingTitle || 'Meeting',
            startTime: (meeting && meeting.startTime) || message.startTime || Date.now(),
            endTime: (meeting && meeting.endTime) || Date.now(),
            platform: (meeting && meeting.platform) || 'call',
            attendees: (meeting && meeting.attendees) || message.attendees || [],
            commitments: allCommitments.length > 0 ? allCommitments : (message.commitments || []),
            decisions: allDecisions.length > 0 ? allDecisions : (message.decisions || []),
            transcript: transcript.length > 0 ? transcript : (message.transcript || [])
          };
          const markdown = MOMGenerator.toMarkdown(momData);
          const plainText = MOMGenerator.toPlainText(momData);
          sendResponse({ ok: true, markdown, plainText, momData });
          break;
        }

        case 'SUPABASE_GET_CONFIG': {
          const config = await Supabase.getConfig();
          sendResponse({ ok: true, config });
          break;
        }

        case 'SUPABASE_SAVE_CONFIG': {
          await Supabase.saveConfig({ url: message.url, anonKey: message.anonKey });
          sendResponse({ ok: true });
          break;
        }

        case 'SUPABASE_GET_SESSION': {
          const session = await Supabase.getSession();
          sendResponse({ ok: true, session });
          break;
        }

        case 'SUPABASE_GET_USER': {
          const user = await Supabase.getUser();
          sendResponse({ ok: true, user });
          break;
        }

        case 'SUPABASE_SIGN_IN': {
          const res = await Supabase.signInWithPassword({ email: message.email, password: message.password });
          sendResponse(res);
          break;
        }

        case 'SUPABASE_SIGN_UP': {
          const res = await Supabase.signUp({ email: message.email, password: message.password });
          sendResponse(res);
          break;
        }

        case 'SUPABASE_SIGN_IN_OTP': {
          const res = await Supabase.signInWithOtp({ email: message.email });
          sendResponse(res);
          break;
        }

        case 'SUPABASE_SIGN_OUT': {
          const res = await Supabase.signOut();
          sendResponse(res);
          break;
        }

        case 'DRIVE_STATUS': {
          const status = await GoogleDrive.getStatus();
          sendResponse({ ok: true, status });
          break;
        }

        case 'DRIVE_AUTH': {
          const token = await GoogleDrive.getToken(true);
          const status = await GoogleDrive.getStatus();
          sendResponse({ ok: !!token, status });
          break;
        }

        case 'DRIVE_DISCONNECT': {
          await GoogleDrive.disconnect();
          sendResponse({ ok: true });
          break;
        }

        case 'SYNC_MEETING_TO_DRIVE': {
          let markdownMOM = message.markdownMOM;
          let rawTranscript = message.rawTranscript;
          if (!markdownMOM && message.meetingId) {
            const meeting = (await DB.getAllMeetings()).find((m) => m.id === message.meetingId);
            const allCommitments = (await DB.getAll('commitments')).filter((c) => c.meetingId === message.meetingId);
            const allDecisions = (await DB.getAllDecisions()).filter((d) => d.meetingId === message.meetingId);
            const transcript = await DB.getTranscript(message.meetingId);
            const momData = {
              title: (meeting && meeting.title) || 'Meeting',
              startTime: (meeting && meeting.startTime) || Date.now(),
              endTime: (meeting && meeting.endTime) || Date.now(),
              platform: (meeting && meeting.platform) || 'call',
              attendees: (meeting && meeting.attendees) || [],
              commitments: allCommitments,
              decisions: allDecisions,
              transcript
            };
            markdownMOM = MOMGenerator.toMarkdown(momData);
            rawTranscript = transcript.map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.speaker}: ${l.text}`).join('\n');
          }
          const syncResult = await GoogleDrive.syncMeetingToDrive({
            meetingTitle: message.meetingTitle || 'Meeting',
            startTime: message.startTime || Date.now(),
            markdownMOM,
            rawTranscript
          });
          sendResponse({ ok: true, result: syncResult });
          break;
        }

        case 'MARK_COMMITMENT_RESOLVED': {
          await DB.markCommitmentResolved(message.commitmentId, message.resolved);
          sendResponse({ ok: true });
          break;
        }

        case 'GET_OPEN_COMMITMENTS': {
          const open = await DB.getOpenCommitments();
          sendResponse({ ok: true, commitments: open });
          break;
        }

        case 'GET_RECENT_MEETINGS': {
          const meetings = await DB.getAllMeetings();
          meetings.sort((a, b) => b.startTime - a.startTime);
          sendResponse({ ok: true, meetings: meetings.slice(0, 25) });
          break;
        }

        case 'EXPORT_DATA': {
          const data = await DB.exportAllData();
          sendResponse({ ok: true, data });
          break;
        }

        case 'CLEAR_ALL_DATA': {
          await DB.clearAllData();
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown message type: ' + message.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();

  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('daily-prune', { periodInMinutes: 60 * 24 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily-prune') {
    getSettings().then((settings) => DB.pruneOlderThan(settings.retentionDays));
  }
});
