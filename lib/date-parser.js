/**
 * date-parser.js
 * Resolves the loose, spoken-language due dates people actually say in
 * meetings ("by Friday", "end of week", "tomorrow", "in two weeks") into
 * a real Date, relative to when the sentence was spoken. Intentionally
 * simple — this is a heuristic aid for a suggested due date, not a
 * calendar-grade NLP date parser, and the UI always lets the user edit it.
 */
(function (global) {
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  function startOfDay(d) {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  }

  function addDays(d, n) {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  function nextWeekday(from, targetDow, { includeToday = false } = {}) {
    const fromDow = from.getDay();
    let delta = targetDow - fromDow;
    if (delta < 0 || (delta === 0 && !includeToday)) delta += 7;
    return addDays(from, delta);
  }

  /**
   * @param {string} text - a sentence or phrase possibly containing a due date
   * @param {Date} [spokenAt] - when the sentence was said (defaults to now)
   * @returns {{ date: Date, label: string, confidence: 'high'|'medium'|'low' } | null}
   */
  function resolveDueDate(text, spokenAt) {
    const now = spokenAt ? new Date(spokenAt) : new Date();
    const lower = String(text || '').toLowerCase();

    if (/\btomorrow\b/.test(lower)) {
      return { date: startOfDay(addDays(now, 1)), label: 'tomorrow', confidence: 'high' };
    }
    if (/\btoday\b|\beod\b|\bend of day\b/.test(lower)) {
      return { date: startOfDay(now), label: 'today', confidence: 'high' };
    }
    if (/\bend of (this )?week\b|\beow\b/.test(lower)) {
      return { date: nextWeekday(now, 5, { includeToday: true }), label: 'end of this week', confidence: 'medium' };
    }
    if (/\bnext week\b/.test(lower)) {
      return { date: startOfDay(addDays(now, 7)), label: 'next week', confidence: 'low' };
    }
    if (/\bend of (the )?month\b|\beom\b/.test(lower)) {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { date: startOfDay(d), label: 'end of month', confidence: 'medium' };
    }

    const inNMatch = lower.match(/\bin (a|one|two|three|four|five|1|2|3|4|5) (day|days|week|weeks)\b/);
    if (inNMatch) {
      const numWord = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
      const n = numWord[inNMatch[1]] || parseInt(inNMatch[1], 10) || 1;
      const unit = inNMatch[2].startsWith('week') ? 7 : 1;
      return { date: startOfDay(addDays(now, n * unit)), label: inNMatch[0], confidence: 'medium' };
    }

    for (let i = 0; i < WEEKDAYS.length; i++) {
      const day = WEEKDAYS[i];
      if (new RegExp(`\\bby ${day}\\b|\\bon ${day}\\b|\\b${day}\\b`).test(lower)) {
        const includeToday = false;
        return { date: nextWeekday(now, i, { includeToday }), label: `this coming ${day}`, confidence: 'medium' };
      }
    }

    // "before/by the next meeting" — no fixed calendar date; flagged for the
    // caller to resolve against the recurring series if one exists.
    if (/\bnext meeting\b|\bnext (call|sync|standup|check-?in)\b/.test(lower)) {
      return { date: null, label: 'before the next meeting', confidence: 'low' };
    }

    return null;
  }

  const DateParser = { resolveDueDate };

  global.Precedent = global.Precedent || {};
  global.Precedent.DateParser = DateParser;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DateParser;
  }
})(typeof self !== 'undefined' ? self : this);
