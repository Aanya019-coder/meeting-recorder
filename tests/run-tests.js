/**
 * tests/run-tests.js
 * Automated test suite for Precedent's core modules and meeting pipeline.
 */

const assert = require('assert');

// 1. Load modules
const HashingVectorizer = require('../lib/hashing-vectorizer.js');
const DateParser = require('../lib/date-parser.js');
const CommitmentExtractor = require('../lib/commitment-extractor.js');
const DecisionExtractor = require('../lib/decision-extractor.js');
const AttendeeMatcher = require('../lib/attendee-matcher.js');

let passedCount = 0;
let totalCount = 0;
const testQueue = [];

function test(name, fn) {
  testQueue.push({ name, fn });
}

console.log('=== Running Precedent Unit Tests ===\n');

// -------------------------------------------------------------
// DateParser Tests
// -------------------------------------------------------------
console.log('--- DateParser ---');

test('resolves "by Friday" relative to reference date', () => {
  const ref = new Date('2026-09-18T10:00:00Z'); // A Friday
  const res = DateParser.resolveDueDate('I will send the slides by Friday', ref);
  assert(res, 'Expected a date resolution');
  assert.strictEqual(res.label, 'this coming friday');
  assert.strictEqual(res.confidence, 'medium');
});

test('resolves "EOD" / "end of day"', () => {
  const ref = new Date('2026-09-18T10:00:00Z');
  const res = DateParser.resolveDueDate('Let me wrap that up by EOD', ref);
  assert(res, 'Expected date resolution for EOD');
  assert.strictEqual(res.label, 'today');
});

test('resolves "next week"', () => {
  const ref = new Date('2026-09-18T10:00:00Z');
  const res = DateParser.resolveDueDate('We will check in next week', ref);
  assert(res, 'Expected date resolution for next week');
  assert.strictEqual(res.label, 'next week');
});

test('returns null when no date phrase is present', () => {
  const res = DateParser.resolveDueDate('I will refactor this function');
  assert.strictEqual(res, null);
});

// -------------------------------------------------------------
// CommitmentExtractor Tests
// -------------------------------------------------------------
console.log('\n--- CommitmentExtractor ---');

test('extracts first-person promise with due date', () => {
  const line = {
    speaker: 'Maya',
    text: "I'll finalize the roadmap by Monday",
    timestamp: Date.now()
  };
  const results = CommitmentExtractor.extractFromLine(line);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].owner, 'Maya');
  assert(results[0].task.includes('finalize the roadmap'));
  assert(results[0].dueDate !== null);
});

test('extracts third-person named assignment', () => {
  const line = {
    speaker: 'Alice',
    text: 'David will prepare the release notes by tomorrow',
    timestamp: Date.now()
  };
  const results = CommitmentExtractor.extractFromLine(line);
  assert(results.length >= 1);
  const found = results.find((r) => r.owner === 'David');
  assert(found, 'Expected David as owner');
  assert(found.task.includes('prepare the release notes'));
});

test('extracts direct ask pattern', () => {
  const line = {
    speaker: 'Bob',
    text: 'Can you send the contract over by EOD?',
    timestamp: Date.now()
  };
  const results = CommitmentExtractor.extractFromLine(line);
  assert(results.length >= 1);
  assert(results[0].task.includes('send the contract'));
});

test('filters out weak verbs (think, feel, know, see)', () => {
  const line = {
    speaker: 'Charlie',
    text: "I'll think about that later",
    timestamp: Date.now()
  };
  const results = CommitmentExtractor.extractFromLine(line);
  assert.strictEqual(results.length, 0, 'Weak verbs should be rejected');
});

// -------------------------------------------------------------
// DecisionExtractor Tests
// -------------------------------------------------------------
console.log('\n--- DecisionExtractor ---');

test('extracts "we have decided to" pattern', () => {
  const line = {
    speaker: 'Elena',
    text: 'So we have decided to launch the beta in October.',
    timestamp: Date.now()
  };
  const res = DecisionExtractor.extractFromLine(line);
  assert(res, 'Expected decision extraction');
  assert.strictEqual(res.summary, 'launch the beta in October');
  assert.strictEqual(res.speaker, 'Elena');
});

test('extracts "let\'s go with" pattern', () => {
  const line = {
    speaker: 'Liam',
    text: "Let's go with the blue navigation theme.",
    timestamp: Date.now()
  };
  const res = DecisionExtractor.extractFromLine(line);
  assert(res, 'Expected decision extraction');
  assert.strictEqual(res.summary, 'the blue navigation theme');
});

test('extracts "we agreed to" and "we settled on" patterns', () => {
  const line1 = { speaker: 'Zoe', text: 'So we agreed to migrate to Postgres next month.' };
  const res1 = DecisionExtractor.extractFromLine(line1);
  assert(res1, 'Expected decision extraction for agreed');
  assert.strictEqual(res1.summary, 'migrate to Postgres next month');

  const line2 = { speaker: 'Sam', text: "We've settled on three tiers for pricing." };
  const res2 = DecisionExtractor.extractFromLine(line2);
  assert(res2, 'Expected decision extraction for settled on');
  assert.strictEqual(res2.summary, 'three tiers for pricing');
});

test('ignores non-decision sentences', () => {
  const line = {
    speaker: 'Jordan',
    text: 'What do you think about doing a coffee break soon?'
  };
  const res = DecisionExtractor.extractFromLine(line);
  assert.strictEqual(res, null);
});

// -------------------------------------------------------------
// HashingVectorizer & Déjà Vu Tests
// -------------------------------------------------------------
console.log('\n--- HashingVectorizer & Déjà Vu ---');

test('generates normalized 512-dim vector', () => {
  const vec = HashingVectorizer.vectorize('migration to PostgreSQL database');
  assert.strictEqual(vec.length, 512);
  // Check L2 norm is approximately 1.0
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  assert(Math.abs(Math.sqrt(sumSq) - 1.0) < 0.01, 'Vector must be normalized to unit length');
});

test('scores high similarity on related topics and low on unrelated', () => {
  const v1 = HashingVectorizer.vectorize('pricing tiers and enterprise subscription model');
  const v2 = HashingVectorizer.vectorize('discussion about enterprise pricing tiers and customer subscription');
  const v3 = HashingVectorizer.vectorize('fixing CSS styles on the mobile navigation dropdown menu');

  const simRelated = HashingVectorizer.cosineSimilarity(v1, v2);
  const simUnrelated = HashingVectorizer.cosineSimilarity(v1, v3);

  assert(simRelated > 0.45, `Expected high similarity, got ${simRelated}`);
  assert(simUnrelated < 0.20, `Expected low similarity, got ${simUnrelated}`);
});

test('findDejaVu finds matches above threshold', () => {
  const pastVec = HashingVectorizer.vectorize('switch our cloud hosting from AWS to Google Cloud');
  const pastDecisions = [
    {
      id: 'd-1',
      summary: 'switch cloud hosting from AWS to Google Cloud',
      vector: HashingVectorizer.toPlainArray(pastVec),
      meetingTitle: 'Infrastructure sync',
      meetingDate: Date.now() - 7 * 86400000
    }
  ];

  const transcriptChunk = 'Are we still considering whether to switch cloud hosting from AWS to Google Cloud this quarter?';
  const matches = DecisionExtractor.findDejaVu(transcriptChunk, pastDecisions, 0.40);
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].decision.id, 'd-1');
  assert(matches[0].similarity > 0.45);
});

// -------------------------------------------------------------
// AttendeeMatcher Tests
// -------------------------------------------------------------
console.log('\n--- AttendeeMatcher ---');

test('normalizes attendee names properly', () => {
  assert.strictEqual(AttendeeMatcher.normalizeName('  Alice Smith (she/her) '), 'alice smith');
  assert.strictEqual(AttendeeMatcher.normalizeName('Bob Jones - Guest'), 'bob jones');
});

test('deduplicates attendee list', () => {
  const raw = ['Alice Smith', 'alice smith', 'Bob Jones', 'Alice Smith (Host)'];
  const deduped = AttendeeMatcher.dedupeAttendees(raw);
  assert.strictEqual(deduped.length, 2);
  assert(deduped.includes('Alice Smith'));
  assert(deduped.includes('Bob Jones'));
});

test('detects attendee overlap across meetings', () => {
  const list1 = ['Alice Smith', 'Bob Jones', 'Carol White'];
  const list2 = ['bob jones', 'David Miller'];
  const list3 = ['Eve Adams', 'Frank Wright'];

  assert.strictEqual(AttendeeMatcher.hasOverlap(list1, list2), true);
  assert.strictEqual(AttendeeMatcher.hasOverlap(list1, list3), false);
});

// -------------------------------------------------------------
// MOMGenerator Tests
// -------------------------------------------------------------
console.log('\n--- MOMGenerator ---');

const MOMGenerator = require('../lib/mom-generator.js');

test('generates structured Markdown MOM with all sections', () => {
  const meetingData = {
    title: 'Design Sprint Review',
    startTime: new Date('2026-09-18T10:00:00Z').getTime(),
    endTime: new Date('2026-09-18T10:45:00Z').getTime(),
    platform: 'meet',
    attendees: ['Alice', 'Bob'],
    commitments: [
      { owner: 'Alice', task: 'send revised Figma mockups by Monday', dueLabel: 'Monday', resolved: false }
    ],
    decisions: [
      { summary: 'use high-contrast palette for buttons', speaker: 'Bob' }
    ],
    transcript: [
      { speaker: 'Alice', text: 'Good morning everyone.', timestamp: 1789800000000 },
      { speaker: 'Bob', text: "Let's go with the high-contrast palette.", timestamp: 1789800010000 }
    ]
  };

  const md = MOMGenerator.toMarkdown(meetingData);
  assert(md.includes('# Minutes of Meeting: Design Sprint Review'));
  assert(md.includes('## Executive Summary'));
  assert(md.includes('## Key Decisions Settled'));
  assert(md.includes('use high-contrast palette for buttons'));
  assert(md.includes('## Action Items & Commitments'));
  assert(md.includes('send revised Figma mockups'));
  assert(md.includes('## Full Transcript Log'));
});

test('generates clean PlainText MOM', () => {
  const meetingData = {
    title: 'Quick Sync',
    startTime: Date.now(),
    endTime: Date.now() + 900000,
    platform: 'teams',
    attendees: ['Sarah'],
    commitments: [],
    decisions: [{ summary: 'keep current sprint goals', speaker: 'Sarah' }]
  };
  const txt = MOMGenerator.toPlainText(meetingData);
  assert(txt.includes('MINUTES OF MEETING: QUICK SYNC'));
  assert(txt.includes('keep current sprint goals'));
});

// -------------------------------------------------------------
// Supabase Auth Tests
// -------------------------------------------------------------
console.log('\n--- Supabase Auth ---');

const Supabase = require('../lib/supabase.js');

test('Supabase client initializes with default methods', () => {
  assert(typeof Supabase.getConfig === 'function');
  assert(typeof Supabase.saveConfig === 'function');
  assert(typeof Supabase.signUp === 'function');
  assert(typeof Supabase.signInWithPassword === 'function');
  assert(typeof Supabase.signInWithOtp === 'function');
  assert(typeof Supabase.signOut === 'function');
  assert(typeof Supabase.getSession === 'function');
  assert(typeof Supabase.getUser === 'function');
});

test('Supabase client handles empty config gracefully without throwing', async () => {
  const cfg = await Supabase.getConfig();
  assert(typeof cfg === 'object');
  assert(cfg.url !== undefined);
  assert(cfg.anonKey !== undefined);

  // Signing in without configured URL returns clean error object
  const loginRes = await Supabase.signInWithPassword({ email: 'test@example.com', password: 'secret' });
  assert.strictEqual(loginRes.ok, false);
  assert(loginRes.error.includes('Supabase URL and Anon Key are not configured'));
});

(async () => {
  for (const t of testQueue) {
    totalCount++;
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ✗ ${t.name}`);
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`\n=== Results: ${passedCount}/${totalCount} tests passed ===`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
})();
