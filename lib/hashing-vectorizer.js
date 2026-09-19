/**
 * hashing-vectorizer.js
 *
 * Turns a chunk of meeting transcript into a fixed-length numeric vector,
 * entirely on-device, with no model download and no network call.
 *
 * Why not a "real" embedding model? A proper sentence-transformer gives
 * better semantic recall, but shipping one means bundling 30-90MB of
 * weights into a Chrome extension and running WASM/WebGPU inference on
 * every caption line — expensive, slow to install, and overkill for what
 * this needs. A hashing vectorizer (the same trick behind scikit-learn's
 * HashingVectorizer) gets ~80% of the value at ~1% of the cost: it turns
 * word n-grams into a sparse-but-fixed-size vector via a hash function,
 * weights by term frequency, and lets cosine similarity do the rest.
 * It won't catch pure paraphrase with zero shared vocabulary ("let's ship
 * Tuesday" vs "we'll release early next week") but it reliably catches
 * the case that actually matters for a "we already decided this" flag:
 * the same topic discussed with overlapping words, which is how people
 * actually re-litigate things in meetings.
 */

(function (global) {
  const VECTOR_DIM = 512;

  const STOPWORDS = new Set([
    'a','an','the','and','or','but','if','then','so','of','to','in','on',
    'for','with','as','at','by','from','is','are','was','were','be','been',
    'being','this','that','these','those','it','its','i','we','you','they',
    'he','she','them','us','our','your','their','have','has','had','do',
    'does','did','will','would','can','could','should','may','might','not',
    'no','yes','just','okay','ok','um','uh','like','really','actually',
    'gonna','going','get','got','think','know','mean','yeah','right','well'
  ]);

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter((tok) => tok.length > 1 && !STOPWORDS.has(tok));
  }

  // 32-bit FNV-1a hash — fast, deterministic, no dependencies.
  function fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function ngrams(tokens, n) {
    const out = [];
    for (let i = 0; i <= tokens.length - n; i++) {
      out.push(tokens.slice(i, i + n).join('_'));
    }
    return out;
  }

  /**
   * Vectorize a text chunk into a Float32Array(VECTOR_DIM), L2-normalized.
   * Uses unigrams + bigrams so short exact phrases carry extra weight.
   */
  function vectorize(text) {
    const tokens = tokenize(text);
    const grams = tokens.concat(ngrams(tokens, 2));
    const vec = new Float32Array(VECTOR_DIM);

    for (const gram of grams) {
      const h = fnv1a(gram);
      const idx = h % VECTOR_DIM;
      const sign = (h & 0x1) === 0 ? 1 : -1; // signed hashing reduces collision bias
      vec[idx] += sign;
    }

    let norm = 0;
    for (let i = 0; i < VECTOR_DIM; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < VECTOR_DIM; i++) vec[i] /= norm;
    }
    return vec;
  }

  function cosineSimilarity(vecA, vecB) {
    let dot = 0;
    for (let i = 0; i < VECTOR_DIM; i++) dot += vecA[i] * vecB[i];
    return dot; // both vectors are already L2-normalized
  }

  function toPlainArray(vec) {
    return Array.from(vec);
  }

  function fromPlainArray(arr) {
    return Float32Array.from(arr);
  }

  const HashingVectorizer = {
    VECTOR_DIM,
    tokenize,
    vectorize,
    cosineSimilarity,
    toPlainArray,
    fromPlainArray
  };

  global.Precedent = global.Precedent || {};
  global.Precedent.HashingVectorizer = HashingVectorizer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HashingVectorizer;
  }
})(typeof self !== 'undefined' ? self : this);
