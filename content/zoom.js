/**
 * zoom.js
 * Zoom's web client caption markup isn't documented publicly and shifts
 * across releases, so this deliberately does NOT hardcode a specific
 * obfuscated class name (those go stale fast and fail silently). Instead
 * it searches for the live-region pattern Zoom's captions use structurally
 * (an aria-live region whose content updates as someone speaks) and scores
 * candidates by how caption-like their content is. This is more robust to
 * minor markup changes but may need a one-line selector tweak after a
 * Zoom release — see README "Maintaining selectors" for how to find the
 * new one in ~2 minutes via DevTools.
 */
(function () {
  const P = window.Precedent;

  function scoreCandidateRegion(elNode) {
    const text = (elNode.textContent || '').trim();
    if (text.length < 4 || text.length > 400) return 0;
    let score = 0;
    const ariaLabel = (elNode.getAttribute('aria-label') || '').toLowerCase();
    const idOrClass = (elNode.id + ' ' + elNode.className).toLowerCase();
    if (/caption|subtitle|transcript/.test(ariaLabel)) score += 5;
    if (/caption|subtitle|cc-lip|live-transcription/.test(idOrClass)) score += 3;
    if (elNode.getAttribute('aria-live')) score += 2;
    return score;
  }

  function getCaptionsContainer() {
    const explicit =
      document.getElementById('live-transcription-subtitle') ||
      document.querySelector('.live-transcription-container') ||
      document.querySelector('[class*="cc-lip" i]');
    if (explicit) return explicit;

    const liveRegions = Array.from(document.querySelectorAll('[aria-live], [role="log"], [class*="caption" i], [class*="transcript" i]'));
    let best = null;
    let bestScore = 0;
    for (const region of liveRegions) {
      const score = scoreCandidateRegion(region);
      if (score > bestScore) {
        best = region;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function getCaptionRows(container) {
    const text = (container.textContent || '').trim();
    if (!text) return [];
    // Zoom typically renders the current caption line as a single block
    // rather than a scrolling list of rows (unlike Meet). Treat the
    // container itself as the one "row" and let the caption-observer's
    // debounce handle finalization as the block's text stops changing.
    if (!container.dataset.pcKey) {
      container.dataset.pcKey = 'zoom-row-' + Math.random().toString(36).slice(2, 10);
    }
    return [container];
  }

  function rowKey(rowEl) {
    return rowEl.dataset.pcKey;
  }

  function extractSpeakerAndText(rowEl) {
    const fullText = (rowEl.textContent || '').trim();
    // Zoom commonly formats as "Name: message"
    const colonIdx = fullText.indexOf(':');
    if (colonIdx > 0 && colonIdx < 40) {
      return {
        speaker: fullText.slice(0, colonIdx).trim(),
        text: fullText.slice(colonIdx + 1).trim()
      };
    }
    return { speaker: 'Unknown speaker', text: fullText };
  }

  function getParticipantNames() {
    const names = new Set();
    document.querySelectorAll('[class*="participants-item" i], [class*="participant-item" i]').forEach((elNode) => {
      const text = (elNode.textContent || '').trim();
      if (text && text.length < 60) names.add(text.replace(/\(.*?\)/g, '').trim());
    });
    document.querySelectorAll('[class*="video-avatar" i] [class*="name" i]').forEach((elNode) => {
      const text = (elNode.textContent || '').trim();
      if (text && text.length < 60) names.add(text);
    });
    return Array.from(names).filter(Boolean);
  }

  function getMeetingTitle() {
    return document.title.replace(/\s*-\s*Zoom.*/i, '').trim() || 'Zoom meeting';
  }

  function isZoomCall() {
    const path = window.location.pathname;
    // Exclude non-call paths
    if (/^\/(?:signin|signup|profile|meeting|settings|download|test)/i.test(path)) return false;
    const isCallPath = /^\/(?:wc|j|s)\//i.test(path);
    // Check if in call path or if in-meeting DOM elements exist
    return (
      isCallPath ||
      !!document.querySelector('#wc-container, [class*="meeting" i], [aria-label*="meeting" i], [aria-label*="mute" i], [aria-label*="leave" i], canvas')
    );
  }

  let initialized = false;
  function tryInit() {
    if (initialized) return true;
    if (!isZoomCall()) return false;
    initialized = true;
    P.PlatformAdapter.init({
      platform: 'zoom',
      getCaptionsContainer,
      getCaptionRows,
      rowKey,
      extractSpeakerAndText,
      getParticipantNames,
      getMeetingTitle
    });
    return true;
  }

  if (!tryInit()) {
    const checkInterval = setInterval(() => {
      if (tryInit()) clearInterval(checkInterval);
    }, 2000);
    window.addEventListener('popstate', () => tryInit());
  }
})();
