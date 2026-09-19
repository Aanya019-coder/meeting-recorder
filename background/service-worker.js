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
  '../lib/db.js'
);

const DB = self.Precedent.DB;
const AttendeeMatcher = self.Precedent.AttendeeMatcher;

const DEFAULT_SETTINGS = {
  platforms: { meet: true, zoom: true, teams: true },
  similarityThreshold: 0.42,
  retentionDays: 180,
  overlayEnabled: true
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
          updateBadge(tabId, '', null);
          sendResponse({ ok: true });
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
