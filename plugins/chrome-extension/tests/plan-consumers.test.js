/**
 * Integration-ish tests for the plan consumers (buildPlanActions / describePlan).
 * These functions are the ones content.js calls after a planner runs, so
 * they're where planner-contract drift shows up in the real extension.
 *
 * Testing them with synthetic plans lets us catch the class of bug that
 * caused "nothing to write" in production (content.js was reading a field
 * the planner no longer returned) without needing a browser.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildPlanActions, describePlan } = require('../felix-engine.js');

// ---------- buildPlanActions ----------

test('buildPlanActions: no writes → empty updates, landingRow defaults to startRow', () => {
  const r = buildPlanActions(
    { writes: [], stopRow: null, stopReason: 'end_of_batch', stoppedAt: null },
    { tgtCol: 'B', sheetName: 'Sheet1', startRow: 2 },
  );
  assert.deepEqual(r.updates, []);
  assert.deepEqual(r.undoEntries, []);
  assert.equal(r.landingRow, 2);
});

test('buildPlanActions: writes are qualified with the sheet name when given', () => {
  const r = buildPlanActions(
    {
      writes: [
        { rowNum: 5, value: 'hi',   oldValue: '',  viaPlacement: false },
        { rowNum: 6, value: 'bye',  oldValue: 'x', viaPlacement: true  },
      ],
      stopRow: null, stopReason: 'end_of_batch', stoppedAt: null,
    },
    { tgtCol: 'B', sheetName: 'くれさが', startRow: 5 },
  );
  assert.deepEqual(r.updates, [
    { range: "'くれさが'!B5", value: 'hi' },
    { range: "'くれさが'!B6", value: 'bye' },
  ]);
  assert.deepEqual(r.undoEntries, [
    { range: "'くれさが'!B5", oldValue: '' },
    { range: "'くれさが'!B6", oldValue: 'x' },
  ]);
  assert.equal(r.landingRow, 7);  // startRow(5) + writes.length(2)
});

test('buildPlanActions: no sheetName → unqualified ranges', () => {
  const r = buildPlanActions(
    { writes: [{ rowNum: 3, value: 'x', oldValue: '', viaPlacement: false }] },
    { tgtCol: 'B', startRow: 3 },
  );
  assert.equal(r.updates[0].range, 'B3');
});

test('buildPlanActions: stopRow takes priority over post-writes row for landing', () => {
  const r = buildPlanActions(
    {
      writes: [{ rowNum: 10, value: 'a', oldValue: '', viaPlacement: false }],
      stopRow: 11, stopReason: 'fuzzy_uncovered',
      stoppedAt: { rowNum: 11, source: 'x' },
    },
    { tgtCol: 'B', startRow: 10 },
  );
  assert.equal(r.landingRow, 11);
});

test('buildPlanActions: tolerates a plan missing the writes field (regression guard)', () => {
  // Past bug: content.js accessed plan.skipped.length without checking. Now
  // the helper should be robust against partial plans rather than throw.
  const r = buildPlanActions({}, { tgtCol: 'B', startRow: 2 });
  assert.deepEqual(r.updates, []);
  assert.deepEqual(r.undoEntries, []);
  assert.equal(r.landingRow, 2);
});

// ---------- describePlan ----------

test('describePlan: normal completion with writes', () => {
  const { text, ms } = describePlan(
    { writes: [{ rowNum: 2 }, { rowNum: 3 }], stopReason: 'end_of_batch', stoppedAt: null },
    { srcCol: 'A' },
  );
  assert.match(text, /完了/);
  assert.match(text, /2 行/);
  assert.ok(ms >= 2000);
});

test('describePlan: normal completion with no writes', () => {
  const { text } = describePlan(
    { writes: [], stopReason: 'end_of_range', stoppedAt: null },
    { srcCol: 'A' },
  );
  assert.match(text, /挿入なし/);
});

test('describePlan: empty_source shows the row reference', () => {
  const { text } = describePlan(
    { writes: [{ rowNum: 2 }], stopReason: 'empty_source',
      stoppedAt: { rowNum: 3, source: '' } },
    { srcCol: 'A' },
  );
  assert.match(text, /A3/);
  assert.match(text, /完了/);
});

test('describePlan: no_match message highlights threshold (user priority #1)', () => {
  const { text, ms } = describePlan(
    {
      writes: [],
      stopReason: 'no_match',
      stoppedAt: { rowNum: 5, source: 'some text' },
    },
    { srcCol: 'A', minScoreDefault: 0.7 },
  );
  assert.match(text, /A5/);
  assert.match(text, /類似候補なし/);
  assert.match(text, /70%/);       // user wanted the threshold visible
  assert.match(text, /TM/);        // hint at remediation
  assert.ok(ms >= 5000, 'no_match message should display longer');
});

test('describePlan: fuzzy_uncovered lists match score and missing term pairs', () => {
  const { text, ms } = describePlan(
    {
      writes: [{ rowNum: 2 }],
      stopReason: 'fuzzy_uncovered',
      stoppedAt: {
        rowNum: 3, source: '...',
        matchSource: '...', matchScore: 0.85,
        missingTerms: [
          { query: 'MIND',  source: '光属性傷害' },
          { query: 'CRT',   source: '神速' },
        ],
      },
    },
    { srcCol: 'A' },
  );
  assert.match(text, /A3/);
  assert.match(text, /85%/);
  assert.match(text, /MIND/);
  assert.match(text, /光属性傷害/);
  assert.match(text, /CRT/);
  assert.match(text, /神速/);
  // No glossary nag — translators know when a diff is glossary-shaped
  // and when it isn't. Pushing them at glossary indiscriminately is
  // misleading because most diffs aren't glossary candidates.
  assert.doesNotMatch(text, /用語集/);
  assert.ok(ms >= 5000);
});

test('describePlan: fuzzy_uncovered truncates long lists of missing terms', () => {
  const missingTerms = [];
  for (let i = 0; i < 10; i++) missingTerms.push({ query: `Q${i}`, source: `S${i}` });
  const { text } = describePlan(
    {
      writes: [],
      stopReason: 'fuzzy_uncovered',
      stoppedAt: { rowNum: 2, source: 's', matchScore: 0.8, missingTerms },
    },
    { srcCol: 'A' },
  );
  assert.match(text, /他 \d+ 件/);
});

test('describePlan: selection plan with mixed writes + skips reads as one summary', () => {
  const { text, ms } = describePlan(
    {
      writes: [{ rowNum: 2 }, { rowNum: 4 }],
      skippedEmpty: 0,
      skippedFilled: 0,
      skippedNoMatch: [{ rowNum: 3, source: 'unmatched' }],
      skippedFuzzyUncovered: [{ rowNum: 5, source: 'uncov', matchScore: 0.78 }],
      stopReason: 'end_of_range', stoppedAt: null, stopRow: null,
    },
    { srcCol: 'A' },
  );
  assert.match(text, /2 行挿入/);
  assert.match(text, /スキップ 2 行/);
  assert.match(text, /A3/);   // example no-match row
  assert.match(text, /A5/);   // example uncovered row
  assert.match(text, /78%/);  // uncovered row's score
  assert.ok(ms >= 5000, 'mixed report should display longer to be readable');
});

test('describePlan: selection plan with only writes reads like a normal completion', () => {
  const { text } = describePlan(
    {
      writes: [{ rowNum: 2 }, { rowNum: 3 }],
      skippedEmpty: 0, skippedFilled: 0,
      skippedNoMatch: [], skippedFuzzyUncovered: [],
      stopReason: 'end_of_range', stoppedAt: null, stopRow: null,
    },
    { srcCol: 'A' },
  );
  assert.match(text, /完了: 2 行/);
  assert.doesNotMatch(text, /スキップ/);
});

test('describePlan: survives a plan with stopReason but no stoppedAt', () => {
  const { text } = describePlan(
    { writes: [], stopReason: 'fuzzy_uncovered', stoppedAt: null },
    { srcCol: 'A' },
  );
  // Fallback message, not a crash.
  assert.match(text, /停止/);
});
