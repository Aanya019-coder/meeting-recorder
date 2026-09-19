/**
 * teams.js
 * Same caveat as zoom.js: Teams web captions ("live captions") render
 * inside a panel Microsoft updates independently of any versioned API.
 * We anchor on the documented-ish `data-tid="closed-caption*"` pattern
 * Teams has used historically, with an ARIA-region fallback identical in
 * spirit to the Zoom adapter. Verify against your own tenant's Teams
 * before publishing an update — see README.
 */
(function () {
  const P = window.Precedent;

  function getCaptionsContainer() {
    return (
      document.querySelector('[data-tid="closed-captions-renderer"]') ||
      document.querySelector('[data-tid*="caption" i]') ||
      document.querySelector('[aria-label*="live caption" i]') ||
      document.querySelector('[role="log"][aria-live]')
    );
  }

  function getCaptionRows(container) {
    const rows = Array.from(
      container.querySelectorAll('[data-tid="closed-caption-text"], [class*="caption-line" i], [class*="chat-message-content" i]')
    );
    if (rows.length > 0) return rows;
    // Fallback: treat leaf-most text divs as rows, same approach as Meet.
    return Array.from(container.querySelectorAll('div')).filter((elDiv) => {
      const text = (elDiv.textContent || '').trim();
      if (text.length < 4) return false;
      const nested = Array.from(elDiv.querySelectorAll('div')).some(
        (c) => (c.textContent || '').trim().length > 3
      );
      return !nested;
    });
  }

  function rowKey(rowEl) {
    if (!rowEl.dataset.pcKey) {
      rowEl.dataset.pcKey = 'teams-row-' + Math.random().toString(36).slice(2, 10);
    }
    return rowEl.dataset.pcKey;
  }

  function extractSpeakerAndText(rowEl) {
    const speakerEl = rowEl.querySelector('[data-tid="author"], [class*="author" i], [class*="display-name" i]');
    const speaker = speakerEl ? (speakerEl.textContent || '').trim() : '';
    let text = (rowEl.textContent || '').trim();
    if (speaker && text.startsWith(speaker)) {
      text = text.slice(speaker.length).trim();
    }
    return { speaker: speaker || 'Unknown speaker', text };
  }

  function getParticipantNames() {
    const names = new Set();
    document.querySelectorAll('[data-tid="roster-participant-name"], [class*="roster" i] [class*="name" i]').forEach((elNode) => {
      const text = (elNode.textContent || '').trim();
      if (text && text.length < 60) names.add(text.replace(/\(.*?\)/g, '').trim());
    });
    return Array.from(names).filter(Boolean);
  }

  function getMeetingTitle() {
    return document.title.replace(/\s*\|\s*Microsoft Teams.*/i, '').trim() || 'Teams meeting';
  }

  function isTeamsCall() {
    const path = window.location.pathname;
    if (/^\/(?:settings|account|login|signup)/i.test(path)) return false;
    const href = window.location.href;
    return (
      /meet|call|calling|launcher/i.test(href) ||
      !!document.querySelector(
        '[data-tid*="call" i], [data-tid*="meet" i], [aria-label*="call" i], [data-tid="closed-captions-renderer"], [aria-label*="Leave" i], [aria-label*="hang up" i]'
      )
    );
  }

  let initialized = false;
  function tryInit() {
    if (initialized) return true;
    if (!isTeamsCall()) return false;
    initialized = true;
    P.PlatformAdapter.init({
      platform: 'teams',
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
