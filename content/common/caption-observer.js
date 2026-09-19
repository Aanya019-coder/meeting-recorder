/**
 * caption-observer.js
 * Watches a meeting platform's live-captions DOM and emits finalized
 * {speaker, text, timestamp} lines. This is the single most fragile part
 * of the extension by nature: Meet/Zoom/Teams change their caption markup
 * without notice, and this only works when the user has live captions
 * turned on (required — nothing here touches raw audio). Each platform
 * file passes in a small selector config; if a platform update breaks a
 * selector, only that config needs to change, not the observer logic.
 *
 * Finalization strategy: caption widgets typically update a line's text
 * in place while the speaker is still talking, then either start a new
 * line or the line disappears once finalized. We treat a line as "final"
 * once its text hasn't changed for FINALIZE_DEBOUNCE_MS, or once it's
 * removed from the DOM — whichever comes first. This avoids emitting the
 * same sentence three times as it's typed out live.
 */
(function (global) {
  const FINALIZE_DEBOUNCE_MS = 1200;
  const MIN_LINE_LENGTH = 4;

  /**
   * @param {object} config
   * @param {() => Element|null} config.getContainer - returns the caption panel root, or null if not present yet
   * @param {(container: Element) => Element[]} config.getLineElements - returns current caption line elements
   * @param {(lineEl: Element) => string} config.getSpeaker - extracts speaker name from a line element
   * @param {(lineEl: Element) => string} config.getText - extracts caption text from a line element
   * @param {(lineEl: Element) => string} config.getLineKey - a stable key identifying "the same line slot" across mutations
   * @param {(line: {speaker: string, text: string, timestamp: number}) => void} onFinalLine
   */
  function createCaptionObserver(config, onFinalLine) {
    const pending = new Map(); // lineKey -> { text, speaker, timer, firstSeen }
    let observer = null;
    let pollTimer = null;

    function finalizeLine(key) {
      const entry = pending.get(key);
      if (!entry) return;
      pending.delete(key);
      const text = entry.text.trim();
      if (text.length < MIN_LINE_LENGTH) return;
      onFinalLine({
        speaker: entry.speaker || 'Unknown speaker',
        text,
        timestamp: entry.firstSeen
      });
    }

    function scheduleFinalize(key) {
      const entry = pending.get(key);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => finalizeLine(key), FINALIZE_DEBOUNCE_MS);
    }

    function handleLineElements(lineEls) {
      const seenKeys = new Set();
      for (const lineEl of lineEls) {
        let key, text, speaker;
        try {
          key = config.getLineKey(lineEl);
          text = config.getText(lineEl);
          speaker = config.getSpeaker(lineEl);
        } catch (err) {
          continue; // platform DOM shifted mid-read; skip this tick, don't crash the observer
        }
        if (!key || !text) continue;
        seenKeys.add(key);

        const existing = pending.get(key);
        if (!existing) {
          pending.set(key, { text, speaker, timer: null, firstSeen: Date.now() });
          scheduleFinalize(key);
        } else if (existing.text !== text) {
          existing.text = text;
          existing.speaker = speaker || existing.speaker;
          scheduleFinalize(key); // text still changing -> push the finalize deadline out
        }
      }

      // A line that's no longer rendered has almost certainly finished being spoken.
      for (const key of Array.from(pending.keys())) {
        if (!seenKeys.has(key)) {
          const entry = pending.get(key);
          if (entry && entry.timer) clearTimeout(entry.timer);
          finalizeLine(key);
        }
      }
    }

    let tickScheduled = false;
    let throttleTimeout = null;

    function scheduleTick() {
      if (tickScheduled) return;
      tickScheduled = true;
      throttleTimeout = setTimeout(() => {
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(() => {
            tickScheduled = false;
            tick();
          });
        } else {
          tickScheduled = false;
          tick();
        }
      }, 150);
    }

    function tick() {
      const container = config.getContainer();
      if (!container) return;
      const lineEls = config.getLineElements(container) || [];
      handleLineElements(lineEls);
    }

    function start() {
      // MutationObserver on the document catches captions appearing/updating.
      // We throttle ticks to ~150ms to keep CPU low during heavy call animations.
      observer = new MutationObserver(() => scheduleTick());
      const target = document.body || document.documentElement;
      if (target) {
        observer.observe(target, { childList: true, subtree: true, characterData: true });
      }
      pollTimer = setInterval(tick, 800);
      tick();
    }

    function stop() {
      tickScheduled = false;
      if (throttleTimeout) clearTimeout(throttleTimeout);
      if (observer) observer.disconnect();
      if (pollTimer) clearInterval(pollTimer);
      for (const key of Array.from(pending.keys())) finalizeLine(key);
      pending.clear();
    }

    return { start, stop };
  }

  global.Precedent = global.Precedent || {};
  global.Precedent.createCaptionObserver = createCaptionObserver;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createCaptionObserver;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
