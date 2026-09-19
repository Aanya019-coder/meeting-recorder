/**
 * meet.js
 * Google Meet-specific wiring. Uses the ARIA captions region as the
 * primary anchor ([role="region"][aria-label="Captions"]) since it's
 * documented as more stable than Meet's obfuscated class names, which
 * rotate on ~every deploy. Row-level speaker/text splitting still relies
 * on structural heuristics because Meet doesn't expose speaker name in a
 * stable attribute. If Google reshapes the captions panel, this is the
 * one file that needs updating — see README "Maintaining selectors".
 */
(function () {
  const P = window.Precedent;

  function getCaptionsContainer() {
    return (
      document.querySelector('[role="region"][aria-label="Captions"]') ||
      document.querySelector('[role="region"][aria-label*="caption" i]') ||
      document.querySelector('[jsname][aria-live="polite"]')
    );
  }

  function getCaptionRows(container) {
    // Each caption entry in Meet is typically a direct-ish child block
    // containing an avatar image and a text block. We treat any element
    // with a meaningful text length and no nested caption rows as a "row".
    const candidates = Array.from(container.querySelectorAll('div'));
    return candidates.filter((elDiv) => {
      const text = elDiv.textContent || '';
      if (text.trim().length < 4) return false;
      // Skip containers that themselves contain another equally-sized text
      // block (i.e. skip ancestors, keep leaf-ish rows).
      const childDivsWithText = Array.from(elDiv.querySelectorAll('div')).filter(
        (c) => (c.textContent || '').trim().length > 3
      );
      return childDivsWithText.length === 0;
    });
  }

  function rowKey(rowEl) {
    if (!rowEl.dataset.pcKey) {
      rowEl.dataset.pcKey = 'meet-row-' + Math.random().toString(36).slice(2, 10);
    }
    return rowEl.dataset.pcKey;
  }

  function extractSpeakerAndText(rowEl) {
    // Check rowEl itself, its parent container, or preceding siblings for avatar/name
    let speaker = '';
    const parentRow = rowEl.closest('[role="region"] > div') || rowEl.parentElement;
    const contextEl = parentRow || rowEl;

    const img = contextEl.querySelector('img[alt]');
    if (img && img.alt) {
      speaker = img.alt.trim();
    }

    if (!speaker && parentRow) {
      const speakerEl = parentRow.querySelector('[jsname], [class*="name" i], [class*="speaker" i], b, strong');
      if (speakerEl && speakerEl !== rowEl && !rowEl.contains(speakerEl)) {
        const t = (speakerEl.textContent || '').trim();
        if (t.length > 1 && t.length <= 40 && !/[.!?]$/.test(t)) {
          speaker = t;
        }
      }
    }

    if (!speaker && rowEl.previousElementSibling) {
      let prev = rowEl.previousElementSibling;
      while (prev && !speaker) {
        const prevImg = prev.querySelector('img[alt]');
        if (prevImg && prevImg.alt) {
          speaker = prevImg.alt.trim();
          break;
        }
        const prevSpeakerEl = prev.querySelector('[jsname], [class*="name" i], [class*="speaker" i], b, strong');
        if (prevSpeakerEl) {
          const t = (prevSpeakerEl.textContent || '').trim();
          if (t.length > 1 && t.length <= 40 && !/[.!?]$/.test(t)) {
            speaker = t;
            break;
          }
        }
        prev = prev.previousElementSibling;
      }
    }

    const fullText = (rowEl.textContent || '').trim();
    let text = fullText;
    if (speaker && fullText.startsWith(speaker)) {
      text = fullText.slice(speaker.length).trim();
    }
    if (!speaker) {
      const lines = fullText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length > 1 && lines[0].length <= 30 && !/[.!?]$/.test(lines[0])) {
        speaker = lines[0];
        text = lines.slice(1).join(' ');
      }
    }
    return { speaker: speaker || 'Unknown speaker', text: text || fullText };
  }

  function getParticipantNames() {
    // The people panel isn't always open, so this best-effort scrapes
    // whatever participant chips/avatars are currently rendered (self view
    // tile names, "People" panel list items). Safe to return a partial
    // list — the primer just uses whatever it has.
    const names = new Set();
    document.querySelectorAll('[data-participant-id] [data-self-name], [data-participant-id]').forEach((elNode) => {
      const label = elNode.getAttribute('data-self-name') || elNode.getAttribute('aria-label');
      if (label) names.add(label.replace(/\(.*?\)/g, '').trim());
    });
    // Fallback: list items inside a people/participants panel
    document.querySelectorAll('[role="list"] [role="listitem"]').forEach((li) => {
      const text = (li.textContent || '').trim();
      if (text && text.length < 60) names.add(text.replace(/\(.*?\)/g, '').trim());
    });
    return Array.from(names).filter(Boolean);
  }

  function getMeetingTitle() {
    return document.title.replace(/\s*-\s*Google Meet.*/i, '').trim() || 'Google Meet call';
  }

  function isMeetCall() {
    const path = window.location.pathname;
    if (/^\/(?:landing|about|terms|support|_)/i.test(path)) return false;
    return /\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(path) || /^\/[a-z0-9_-]{3,}-[a-z0-9_-]{3,}/i.test(path);
  }

  let initialized = false;
  function tryInit() {
    if (initialized) return true;
    if (!isMeetCall()) return false;
    initialized = true;
    P.PlatformAdapter.init({
      platform: 'meet',
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
    }, 1500);

    window.addEventListener('popstate', () => tryInit());

    const origPush = history.pushState;
    if (origPush) {
      history.pushState = function () {
        const res = origPush.apply(this, arguments);
        tryInit();
        return res;
      };
    }
    const origReplace = history.replaceState;
    if (origReplace) {
      history.replaceState = function () {
        const res = origReplace.apply(this, arguments);
        tryInit();
        return res;
      };
    }
  }
})();
