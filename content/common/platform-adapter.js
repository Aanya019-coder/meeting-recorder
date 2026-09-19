/**
 * platform-adapter.js
 * The logic that's identical across Meet/Zoom/Teams once you have a
 * stream of {speaker, text, timestamp} lines: buffer a rolling transcript
 * window, run it through the commitment/decision extractors, check new
 * decisions against the primer's past-decision set for déjà vu, and
 * manage the meeting lifecycle (start -> attendees settle -> end ->
 * confirm-and-save). Each platform file only supplies DOM access; this
 * file supplies the behavior, so all three platforms behave identically
 * to the user.
 */
(function (global) {
  const HashingVectorizer = global.Precedent.HashingVectorizer;
  const CommitmentExtractor = global.Precedent.CommitmentExtractor;
  const DecisionExtractor = global.Precedent.DecisionExtractor;
  const AttendeeMatcher = global.Precedent.AttendeeMatcher;
  const createCaptionObserver = global.Precedent.createCaptionObserver;
  const createOverlay = global.Precedent.createOverlay;

  const ATTENDEE_SETTLE_DELAY_MS = 8000;
  const ROLLING_WINDOW_MS = 75 * 1000;
  const DEJA_VU_COOLDOWN_MS = 90 * 1000; // don't re-flag the same topic every tick

  function sendToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'no response' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function init(adapterConfig) {
    let settings = null;
    let overlay = null;
    let meetingId = null;
    let attendees = [];
    let attendeesSettled = false;
    let pastDecisions = []; // from primer, cached for the whole call
    let recentLines = []; // rolling window for deja-vu scanning
    let sessionCommitments = [];
    let sessionDecisions = [];
    let lastDejaVuFlagAt = new Map(); // decisionId -> timestamp, avoids repeat toasts
    let captionsEverSeen = false;
    let noCaptionsTimer = null;
    let observerHandle = null;
    let hasSavedSession = false;

    function platformEnabled() {
      if (!settings) return true;
      return settings.platforms && settings.platforms[adapterConfig.platform] !== false;
    }

    function pruneRollingWindow(now) {
      recentLines = recentLines.filter((l) => now - l.timestamp < ROLLING_WINDOW_MS);
    }

    function checkDejaVu(now) {
      pruneRollingWindow(now);
      if (recentLines.length === 0 || pastDecisions.length === 0) return;
      const chunkText = recentLines.map((l) => l.text).join(' ');
      const threshold = (settings && settings.similarityThreshold) || DecisionExtractor.DEFAULT_SIMILARITY_THRESHOLD;
      const matches = DecisionExtractor.findDejaVu(chunkText, pastDecisions, threshold);
      for (const match of matches) {
        const lastFlagged = lastDejaVuFlagAt.get(match.decision.id) || 0;
        if (now - lastFlagged > DEJA_VU_COOLDOWN_MS) {
          lastDejaVuFlagAt.set(match.decision.id, now);
          overlay.showDejaVuToast(match);
        }
      }
    }

    let autoSaveTimeout = null;
    function scheduleIncrementalSave() {
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => {
        if (!meetingId || hasSavedSession) return;
        const commitments = buildCommitmentsPayload();
        const decisions = buildDecisionsPayload();
        sendToBackground({
          type: 'MEETING_SESSION_AUTOSAVE',
          meetingId,
          commitments,
          decisions
        });
      }, 1500);
    }

    function handleFinalLine(line) {
      if (!captionsEverSeen) {
        captionsEverSeen = true;
        if (noCaptionsTimer) {
          clearTimeout(noCaptionsTimer);
          noCaptionsTimer = null;
        }
      }
      overlay.setStatus('listening');
      recentLines.push(line);
      checkDejaVu(Date.now());

      let updated = false;
      const commitments = CommitmentExtractor.extractFromLine(line);
      for (const c of commitments) {
        c.id = c.id || `${meetingId || 'm'}-c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        sessionCommitments.push(c);
        updated = true;
      }

      const decision = DecisionExtractor.extractFromLine(line);
      if (decision) {
        const vector = HashingVectorizer.toPlainArray(HashingVectorizer.vectorize(decision.summary + ' ' + decision.sourceText));
        const decisionId = `${meetingId || 'm'}-d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        sessionDecisions.push({ ...decision, id: decisionId, vector, timestamp: line.timestamp });
        updated = true;
      }

      if (updated && overlay) {
        overlay.updateLiveItems({
          commitments: sessionCommitments,
          decisions: sessionDecisions
        });
        scheduleIncrementalSave();
      }
    }

    async function settleAttendees() {
      if (attendeesSettled) return;
      const names = adapterConfig.getParticipantNames ? adapterConfig.getParticipantNames() : [];
      const deduped = AttendeeMatcher.dedupeAttendees(names);
      if (deduped.length === 0) return;
      attendeesSettled = true;
      attendees = deduped;

      const res = await sendToBackground({
        type: 'ATTENDEES_DETECTED',
        meetingId,
        attendees
      });
      if (res.ok && res.primer) {
        pastDecisions = res.primer.pastDecisions || [];
        overlay.renderPrimer({
          openCommitments: res.primer.openCommitments || [],
          relatedDecisions: pastDecisions,
          attendees
        });
      }
    }

    function buildCommitmentsPayload() {
      const title = adapterConfig.getMeetingTitle ? adapterConfig.getMeetingTitle() : document.title;
      return sessionCommitments.map((c) => ({
        id: c.id,
        owner: c.owner,
        task: c.task,
        dueDate: c.dueDate ? (c.dueDate instanceof Date ? c.dueDate.getTime() : c.dueDate) : null,
        dueLabel: c.dueLabel,
        sourceText: c.sourceText,
        meetingTitle: title,
        attendees
      }));
    }

    function buildDecisionsPayload() {
      const title = adapterConfig.getMeetingTitle ? adapterConfig.getMeetingTitle() : document.title;
      return sessionDecisions.map((d) => ({
        id: d.id,
        summary: d.summary,
        sourceText: d.sourceText,
        speaker: d.speaker,
        vector: d.vector,
        meetingDate: d.timestamp || Date.now(),
        meetingTitle: title,
        attendees
      }));
    }

    async function saveSession() {
      if (!meetingId || hasSavedSession) return { ok: true };
      hasSavedSession = true;
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      const commitments = buildCommitmentsPayload();
      const decisions = buildDecisionsPayload();
      if (commitments.length === 0 && decisions.length === 0) {
        return sendToBackground({ type: 'MEETING_ENDED_DISCARD', meetingId });
      }
      return sendToBackground({
        type: 'MEETING_ENDED_SAVE',
        meetingId,
        commitments,
        decisions
      });
    }

    async function discardSession() {
      if (!meetingId) return;
      hasSavedSession = true;
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      sessionCommitments = [];
      sessionDecisions = [];
      return sendToBackground({ type: 'MEETING_ENDED_DISCARD', meetingId });
    }

    function promptWrapUp() {
      if (!overlay) return;
      overlay.renderEndSummary(
        { newCommitments: sessionCommitments, newDecisions: sessionDecisions },
        {
          onConfirm: async () => {
            await saveSession();
            overlay.showSavedConfirmation();
          },
          onDiscard: () => {
            discardSession();
          }
        }
      );
    }

    async function startMeeting() {
      settings = (await sendToBackground({ type: 'GET_SETTINGS' })).settings;
      if (!platformEnabled()) return;

      overlay = createOverlay();
      overlay.setStatus('idle');
      overlay.setOnWrapUp(promptWrapUp);

      const title = adapterConfig.getMeetingTitle ? adapterConfig.getMeetingTitle() : document.title;
      const res = await sendToBackground({ type: 'MEETING_STARTED', platform: adapterConfig.platform, title });
      if (!res.ok) return;
      meetingId = res.meetingId;

      setTimeout(settleAttendees, ATTENDEE_SETTLE_DELAY_MS);
      const settleRetry = setInterval(() => {
        if (attendeesSettled) {
          clearInterval(settleRetry);
        } else {
          settleAttendees();
        }
      }, ATTENDEE_SETTLE_DELAY_MS);

      noCaptionsTimer = setTimeout(() => {
        if (!captionsEverSeen && overlay) {
          overlay.setStatus('no-captions');
        }
      }, 15000);

      observerHandle = createCaptionObserver(
        {
          getContainer: adapterConfig.getCaptionsContainer,
          getLineElements: adapterConfig.getCaptionRows,
          getSpeaker: (rowEl) => adapterConfig.extractSpeakerAndText(rowEl).speaker,
          getText: (rowEl) => adapterConfig.extractSpeakerAndText(rowEl).text,
          getLineKey: adapterConfig.rowKey
        },
        handleFinalLine
      );
      observerHandle.start();

      // Reliable exit handling: auto-save on tab close / navigate away
      const onExit = () => {
        if (!hasSavedSession && (sessionCommitments.length > 0 || sessionDecisions.length > 0)) {
          saveSession();
        }
      };
      window.addEventListener('beforeunload', onExit);
      window.addEventListener('pagehide', onExit);

      // Allow popup or external commands to query meeting status or request wrap-up
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'GET_MEETING_STATUS') {
          sendResponse({
            ok: true,
            active: !!meetingId,
            meetingId,
            title: adapterConfig.getMeetingTitle ? adapterConfig.getMeetingTitle() : document.title,
            commitmentsCount: sessionCommitments.length,
            decisionsCount: sessionDecisions.length,
            captionsActive: captionsEverSeen
          });
          return true;
        }
        if (msg.type === 'WRAP_UP_MEETING') {
          saveSession().then((res) => sendResponse(res || { ok: true }));
          return true;
        }
      });
    }

    startMeeting();
  }

  global.Precedent = global.Precedent || {};
  global.Precedent.PlatformAdapter = { init };
})(typeof window !== 'undefined' ? window : this);
