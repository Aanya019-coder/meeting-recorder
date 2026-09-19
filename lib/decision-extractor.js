/**
 * decision-extractor.js
 * Two jobs:
 *   1. Detect sentences that sound like a settled decision ("let's go with
 *      X", "we've decided", "final call is").
 *   2. Given a rolling window of recent transcript text, check it against
 *      previously stored decisions (via HashingVectorizer cosine similarity)
 *      and flag likely re-litigation — the "déjà vu" feature.
 * Nothing here calls a network API; all comparison happens against the
 * local IndexedDB decision store passed in by the caller.
 */
(function (global) {
  function getHashingVectorizer() {
    return (
      (global.Precedent && global.Precedent.HashingVectorizer) ||
      (typeof require !== 'undefined' ? require('./hashing-vectorizer.js') : null)
    );
  }

  const DECISION_PATTERNS = [
    /\blet'?s go with\s+([a-z][^.!?]{2,140})/i,
    /\bwe'?ve decided(?:\s+to)?\s+([a-z][^.!?]{2,140})/i,
    /\bwe have decided(?:\s+to)?\s+([a-z][^.!?]{2,140})/i,
    /\bwe decided(?:\s+to)?\s+([a-z][^.!?]{2,140})/i,
    /\bwe'?re going with\s+([a-z][^.!?]{2,140})/i,
    /\bfinal (?:call|decision) is\s+([a-z][^.!?]{2,140})/i,
    /\b(?:the|our) decision is\s+([a-z][^.!?]{2,140})/i,
    /\bdecision:\s*([a-z][^.!?]{2,140})/i,
    /\bwe'?ll go with\s+([a-z][^.!?]{2,140})/i,
    /\b(?:we )?agreed (?:on|to|that)\s+([a-z][^.!?]{2,140})/i,
    /\bagreed[,:]?\s+([a-z][^.!?]{2,140})/i,
    /\bwe'?ve agreed(?:\s+on|\s+to)?\s+([a-z][^.!?]{2,140})/i,
    /\b(?:we'?ve|we) settled on\s+([a-z][^.!?]{2,140})/i,
    /\bso we'?re doing\s+([a-z][^.!?]{2,140})/i
  ];

  function cleanFragment(fragment) {
    return fragment.replace(/\s+/g, ' ').replace(/[,;:]\s*$/, '').trim();
  }

  /**
   * @param {{speaker: string, text: string, timestamp: number}} line
   * @returns {{summary: string, sourceText: string, speaker: string} | null}
   */
  function extractFromLine(line) {
    const text = String(line.text || '');
    if (text.trim().length < 8) return null;

    for (const pattern of DECISION_PATTERNS) {
      const m = text.match(pattern);
      if (m) {
        const fragment = cleanFragment(m[m.length - 1]);
        if (fragment.length > 4) {
          return { summary: fragment, sourceText: text, speaker: line.speaker || 'Someone' };
        }
      }
    }
    return null;
  }

  const DEFAULT_SIMILARITY_THRESHOLD = 0.42;

  /**
   * Compare a rolling chunk of the live transcript against stored past
   * decisions and flag likely redundant discussion.
   *
   * @param {string} chunkText - recent transcript window (last ~45-90s)
   * @param {Array<{id: string, summary: string, vector: number[], meetingTitle: string, meetingDate: number}>} pastDecisions
   * @param {number} [threshold]
   * @returns {Array<{decision: object, similarity: number}>} sorted, best match first
   */
  function findDejaVu(chunkText, pastDecisions, threshold = DEFAULT_SIMILARITY_THRESHOLD) {
    if (!chunkText || !pastDecisions || pastDecisions.length === 0) return [];
    const HashingVectorizer = getHashingVectorizer();
    if (!HashingVectorizer) return [];

    const queryVec = HashingVectorizer.vectorize(chunkText);
    const matches = [];

    for (const decision of pastDecisions) {
      const decisionVec = Array.isArray(decision.vector)
        ? HashingVectorizer.fromPlainArray(decision.vector)
        : decision.vector;
      const sim = HashingVectorizer.cosineSimilarity(queryVec, decisionVec);
      if (sim >= threshold) {
        matches.push({ decision, similarity: sim });
      }
    }

    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, 3);
  }

  const DecisionExtractor = { extractFromLine, findDejaVu, DEFAULT_SIMILARITY_THRESHOLD };

  global.Precedent = global.Precedent || {};
  global.Precedent.DecisionExtractor = DecisionExtractor;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DecisionExtractor;
  }
})(typeof self !== 'undefined' ? self : this);
