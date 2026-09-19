/**
 * commitment-extractor.js
 * Heuristic, on-device detection of spoken commitments ("I'll send the deck
 * by Friday") from live captions. No LLM call — this is pattern matching
 * against how people actually phrase promises out loud, plus the date
 * parser for a suggested due date. Every extracted commitment is a
 * *suggestion* surfaced in the overlay for the user to confirm, edit, or
 * dismiss — never silently auto-filed, since regex-based extraction will
 * always have false positives on informal speech.
 */
(function (global) {
  function getDateParser() {
    return (
      (global.Precedent && global.Precedent.DateParser) ||
      (typeof require !== 'undefined' ? require('./date-parser.js') : null)
    );
  }

  // First-person promise patterns: "I'll", "I will", "let me", "I can"
  const FIRST_PERSON_PATTERNS = [
    /\bi'?ll\s+([a-z][^.!?]{2,120})/i,
    /\bi will\s+([a-z][^.!?]{2,120})/i,
    /\bi can\s+([a-z][^.!?]{2,120})/i,
    /\blet me\s+([a-z][^.!?]{2,120})/i,
    /\bi'?m going to\s+([a-z][^.!?]{2,120})/i,
    /\bi'?ve got\s+([a-z][^.!?]{2,120})/i
  ];

  // Third-person assignment patterns: "Sarah will", "can you send"
  const NAMED_ASSIGNMENT_PATTERN = /\b([A-Z][a-z]+)\s+will\s+([a-z][^.!?]{2,120})/;
  const DIRECT_ASK_PATTERN = /\bcan you\s+([a-z][^.!?]{2,120})/i;

  const WEAK_VERBS = new Set(['be', 'think', 'know', 'see', 'feel', 'hope', 'try to think']);

  function cleanFragment(fragment) {
    return fragment
      .replace(/\s+/g, ' ')
      .replace(/[,;:]\s*$/, '')
      .trim();
  }

  function firstVerb(fragment) {
    const m = fragment.trim().match(/^[a-z']+/i);
    return m ? m[0].toLowerCase() : '';
  }

  /**
   * @param {{speaker: string, text: string, timestamp: number}} line
   * @returns {Array<{owner: string, task: string, dueDate: Date|null, dueLabel: string|null, confidence: string, sourceText: string}>}
   */
  function extractFromLine(line) {
    const results = [];
    const text = String(line.text || '');
    const speaker = line.speaker || 'Someone';
    if (text.trim().length < 6) return results;
    const DateParser = getDateParser();

    for (const pattern of FIRST_PERSON_PATTERNS) {
      const m = text.match(pattern);
      if (m) {
        const fragment = cleanFragment(m[1]);
        const verb = firstVerb(fragment);
        if (fragment.length > 3 && !WEAK_VERBS.has(verb)) {
          const due = DateParser ? DateParser.resolveDueDate(text, line.timestamp ? new Date(line.timestamp) : undefined) : null;
          results.push({
            owner: speaker,
            task: fragment,
            dueDate: due ? due.date : null,
            dueLabel: due ? due.label : null,
            confidence: due ? 'medium' : 'low',
            sourceText: text
          });
        }
      }
    }

    const namedMatch = text.match(NAMED_ASSIGNMENT_PATTERN);
    if (namedMatch) {
      const fragment = cleanFragment(namedMatch[2]);
      const verb = firstVerb(fragment);
      if (fragment.length > 3 && !WEAK_VERBS.has(verb)) {
        const due = DateParser ? DateParser.resolveDueDate(text, line.timestamp ? new Date(line.timestamp) : undefined) : null;
        results.push({
          owner: namedMatch[1],
          task: fragment,
          dueDate: due ? due.date : null,
          dueLabel: due ? due.label : null,
          confidence: due ? 'medium' : 'low',
          sourceText: text
        });
      }
    }

    const askMatch = text.match(DIRECT_ASK_PATTERN);
    if (askMatch && !namedMatch) {
      const fragment = cleanFragment(askMatch[1]);
      const verb = firstVerb(fragment);
      if (fragment.length > 3 && !WEAK_VERBS.has(verb)) {
        const due = DateParser ? DateParser.resolveDueDate(text, line.timestamp ? new Date(line.timestamp) : undefined) : null;
        results.push({
          owner: 'unassigned (asked of someone)',
          task: fragment,
          dueDate: due ? due.date : null,
          dueLabel: due ? due.label : null,
          confidence: 'low',
          sourceText: text
        });
      }
    }

    return results;
  }

  const CommitmentExtractor = { extractFromLine };

  global.Precedent = global.Precedent || {};
  global.Precedent.CommitmentExtractor = CommitmentExtractor;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CommitmentExtractor;
  }
})(typeof self !== 'undefined' ? self : this);
