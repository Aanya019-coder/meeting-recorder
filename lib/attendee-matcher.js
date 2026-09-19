/**
 * attendee-matcher.js
 * Meeting platforms render participant names inconsistently — "Aanya
 * Sharma", "Aanya Sharma (Guest)", "aanya.sharma@iilm.ac.in", "Aanya S.".
 * This normalizes names well enough to match the same person across
 * meetings for the "open commitments with these attendees" primer,
 * without needing an account system or contacts API.
 */
(function (global) {
  function normalizeName(raw) {
    return String(raw || '')
      .replace(/\(.*?\)/g, '')       // strip "(Guest)", "(You)", "(Host)"
      .replace(/\s*[-–—]\s*(guest|host|external|you)\b/i, '') // strip "- Guest", "- Host"
      .replace(/@.*/, '')            // strip email domain if a name field is an email
      .replace(/[._]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function firstNameOf(normalized) {
    return normalized.split(' ')[0] || '';
  }

  /**
   * Loose match: same normalized string, or same first name + same first
   * letter of a second token (handles "Aanya Sharma" vs "Aanya S.").
   */
  function isSamePerson(nameA, nameB) {
    const a = normalizeName(nameA);
    const b = normalizeName(nameB);
    if (!a || !b) return false;
    if (a === b) return true;

    const aParts = a.split(' ');
    const bParts = b.split(' ');
    if (aParts[0] === bParts[0] && aParts[0].length > 2) {
      const aLast = aParts[1] ? aParts[1][0] : '';
      const bLast = bParts[1] ? bParts[1][0] : '';
      if (!aLast || !bLast || aLast === bLast) return true;
    }
    return false;
  }

  function dedupeAttendees(names) {
    const out = [];
    for (const name of names) {
      if (!name || !name.trim()) continue;
      if (!out.some((existing) => isSamePerson(existing, name))) {
        out.push(name.trim());
      }
    }
    return out;
  }

  /**
   * @param {string[]} currentAttendees
   * @param {string[]} pastAttendees
   * @returns {boolean} true if at least one overlapping person
   */
  function hasOverlap(currentAttendees, pastAttendees) {
    return currentAttendees.some((a) => pastAttendees.some((b) => isSamePerson(a, b)));
  }

  const AttendeeMatcher = { normalizeName, isSamePerson, dedupeAttendees, hasOverlap };

  global.Precedent = global.Precedent || {};
  global.Precedent.AttendeeMatcher = AttendeeMatcher;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AttendeeMatcher;
  }
})(typeof self !== 'undefined' ? self : this);
