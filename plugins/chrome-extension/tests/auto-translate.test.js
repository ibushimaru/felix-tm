/**
 * Unit tests for the pure Auto Translate planners in felix-engine.js.
 *
 *     cd plugins/chrome-extension && npm test
 *
 * Design under test: planners walk rows in order, write every row they can
 * translate unambiguously (100% match OR placement covers every diff),
 * and HARD-STOP at the first row they can't. Stopping carries enough
 * detail in `stoppedAt` for the caller to tell the user exactly what's
 * wrong — typically "these glossary entries are missing" or "no candidate
 * above the minimum match threshold". Interactive: the user fixes the one
 * reported problem and re-runs.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const FelixEngine = require('../felix-engine.js');
const { planAutoTranslateSelection, planAutoTranslateToFuzzy, resolveWithPlacement } = FelixEngine;

function tm(...pairs) {
  return pairs.map(([source, target]) => ({
    source, target,
    cmp: FelixEngine.makeCmp(source),
  }));
}
function gloss(...pairs) {
  return pairs.map(([term, translation]) => ({
    term, translation, cmp: FelixEngine.makeCmp(term),
  }));
}

// ---------- planAutoTranslateToFuzzy ----------

test('fuzzy: walks through exact matches and stops at end_of_batch', () => {
  const r = planAutoTranslateToFuzzy({
    startRow: 2,
    srcValues: ['hello', 'world'],
    tgtValues: ['', ''],
    tmData: tm(['hello', 'こんにちは'], ['world', '世界']),
  });
  assert.equal(r.writes.length, 2);
  assert.equal(r.stopReason, 'end_of_batch');
  assert.equal(r.stoppedAt, null);
});

test('fuzzy: stops at empty source row', () => {
  const r = planAutoTranslateToFuzzy({
    startRow: 2,
    srcValues: ['hello', '', 'world'],
    tgtValues: ['', '', ''],
    tmData: tm(['hello', 'こんにちは'], ['world', '世界']),
  });
  assert.equal(r.writes.length, 1);
  assert.equal(r.stopRow, 3);
  assert.equal(r.stopReason, 'empty_source');
});

test('fuzzy: stops with `no_match` when nothing clears the threshold', () => {
  const r = planAutoTranslateToFuzzy({
    startRow: 10,
    srcValues: ['hello', 'absolutely unrelated text here'],
    tgtValues: ['', ''],
    tmData: tm(['hello', 'こんにちは']),
  });
  assert.equal(r.writes.length, 1);
  assert.equal(r.stopRow, 11);
  assert.equal(r.stopReason, 'no_match');
  assert.equal(r.stoppedAt.rowNum, 11);
  assert.equal(r.stoppedAt.source, 'absolutely unrelated text here');
  // no match → no candidate, so matchSource/matchScore absent
  assert.equal(r.stoppedAt.matchSource, undefined);
});

test('fuzzy: covered numeric-only diff keeps walking', () => {
  const r = planAutoTranslateToFuzzy({
    startRow: 2,
    srcValues: ['Invested 22 million yen.', 'hello'],
    tgtValues: ['', ''],
    tmData: tm(['Invested 85 million yen.', '8500万円を投資した。'], ['hello', 'こんにちは']),
  });
  assert.equal(r.writes.length, 2);
  assert.equal(r.writes[0].viaPlacement, true);
  assert.match(r.writes[0].value, /22/);
  assert.equal(r.writes[1].viaPlacement, false);
  assert.equal(r.stopReason, 'end_of_batch');
});

test('fuzzy: stops with `fuzzy_uncovered` and reports match score + missing terms', () => {
  const r = planAutoTranslateToFuzzy({
    startRow: 2,
    srcValues: ['The quick brown fox jumps over Unknown'],
    tgtValues: [''],
    tmData: tm(['The quick brown fox jumps over YYY', 'BBB を跳び越える茶色の狐']),
    glossaryData: gloss(['YYY', 'BBB']),
  });
  assert.equal(r.writes.length, 0);
  assert.equal(r.stopReason, 'fuzzy_uncovered');
  assert.equal(r.stoppedAt.rowNum, 2);
  assert.ok(r.stoppedAt.matchScore > 0.7);
  assert.equal(r.stoppedAt.matchSource, 'The quick brown fox jumps over YYY');
  const flat = r.stoppedAt.missingTerms.flatMap(t => [t.query, t.source]);
  assert.ok(flat.includes('Unknown') || flat.includes('YYY'));
});

test('fuzzy: glossary coverage keeps walking, stops at the next problem', () => {
  const r = planAutoTranslateToFuzzy({
    startRow: 2,
    srcValues: [
      'The quick brown fox jumps over ZZZ',     // covered by glossary
      'The quick brown fox jumps over Unknown', // stops here
      'hello',                                   // never reached
    ],
    tgtValues: ['', '', ''],
    tmData: tm(
      ['The quick brown fox jumps over YYY', 'BBB を跳び越える茶色の狐'],
      ['hello', 'こんにちは'],
    ),
    glossaryData: gloss(['YYY', 'BBB'], ['ZZZ', 'CCC']),
  });
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].rowNum, 2);
  assert.equal(r.writes[0].viaPlacement, true);
  assert.equal(r.stopRow, 3);
  assert.equal(r.stopReason, 'fuzzy_uncovered');
});

test('fuzzy: Felix-faithful — overwrites filled targets when a match exists', () => {
  const r = planAutoTranslateToFuzzy({
    startRow: 2,
    srcValues: ['hello'],
    tgtValues: ['previous translation'],
    tmData: tm(['hello', 'new translation']),
  });
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].value, 'new translation');
  assert.equal(r.writes[0].oldValue, 'previous translation');
});

// ---------- planAutoTranslateSelection ----------

test('selection: empty source / filled target are soft-skipped (counts only)', () => {
  const r = planAutoTranslateSelection({
    startRow: 2, endRow: 5,
    srcValues: ['', 'hello', '', 'world'],
    tgtValues: ['', '',      '', 'already done'],
    tmData: tm(['hello', 'こんにちは'], ['world', '世界']),
  });
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].rowNum, 3);
  assert.equal(r.skippedEmpty, 2);
  assert.equal(r.skippedFilled, 1);
  assert.equal(r.stopReason, 'end_of_range');
});

test("selection: stops at first row with no TM candidate above threshold", () => {
  const r = planAutoTranslateSelection({
    startRow: 2, endRow: 4,
    srcValues: ['hello', 'absolutely unrelated text here', 'world'],
    tgtValues: ['', '', ''],
    tmData: tm(['hello', 'こんにちは'], ['world', '世界']),
  });
  assert.equal(r.writes.length, 1);
  assert.equal(r.stopRow, 3);
  assert.equal(r.stopReason, 'no_match');
  assert.equal(r.stoppedAt.source, 'absolutely unrelated text here');
});

test('selection: stops at first uncovered fuzzy row with detail', () => {
  const r = planAutoTranslateSelection({
    startRow: 2, endRow: 2,
    srcValues: ['MATK110%のダメージを与え、2ターンの間、味方全体のMINDを5%UPする'],
    tgtValues: [''],
    tmData: tm([
      'MATK150%のダメージを与え、2ターンの間、味方全体の光属性傷害を35%UPする',
      '造成MATK150%傷害，在2回合內，我方全體的光屬性傷害提升35%',
    ]),
    glossaryData: gloss(['MIND', 'MIND']),  // 光属性傷害 missing
  });
  assert.equal(r.writes.length, 0);
  assert.equal(r.stopReason, 'fuzzy_uncovered');
  assert.ok(r.stoppedAt.matchScore >= 0.7);
  const flat = r.stoppedAt.missingTerms.flatMap(t => [t.query, t.source]);
  assert.ok(flat.includes('MIND') || flat.includes('光属性傷害'));
});

test('selection: fully covered range writes everything and ends with end_of_range', () => {
  const r = planAutoTranslateSelection({
    startRow: 2, endRow: 3,
    srcValues: ['hello', 'world'],
    tgtValues: ['', ''],
    tmData: tm(['hello', 'こんにちは'], ['world', '世界']),
  });
  assert.equal(r.writes.length, 2);
  assert.equal(r.stopReason, 'end_of_range');
  assert.equal(r.stoppedAt, null);
});

// ---------- resolveWithPlacement ----------

test('resolveWithPlacement: returns uncovered diffs so the caller can describe them', () => {
  const r = resolveWithPlacement(
    'Go to Unknown',
    'Go to YYY',
    'Vaya a BBB',
    gloss(['YYY', 'BBB']),
    [],
  );
  assert.equal(r.covered, false);
  assert.ok(r.uncovered.length >= 1);
  const flat = r.uncovered.flatMap(d => [d.qText, d.sText]);
  assert.ok(flat.includes('Unknown'));
});

test('nonNumericDiffs: does not swallow a common particle between text and number diffs', () => {
  // Production regression: query "...MINDを5%UPする" vs TM source
  // "...CRTを45%UPする" used to collapse into a single diff
  //   { qText: "MINDを", sText: "CRTを4" }
  // because the DP backtrace preferred substitution over insert when costs
  // were tied, hiding the common「を」. That single combined diff is never
  // resolvable by glossary (no glossary entry literally says "MINDを"). The
  // correct shape is a clean {MIND, CRT} diff; the '4' insertion belongs
  // to number placement and should not appear in nonNumericDiffs at all.
  const diffs = FelixEngine.nonNumericDiffs(
    '味方全体のMINDを5%UPする',
    '味方全体のCRTを45%UPする',
  );
  assert.equal(diffs.length, 1, 'should produce exactly one non-numeric diff');
  assert.equal(diffs[0].qText, 'MIND');
  assert.equal(diffs[0].sText, 'CRT');
});

test('resolveWithPlacement: the MINDを5 / CRTを45 case is covered by number + glossary', () => {
  // End-to-end check for the same regression: the diff engine now exposes
  // {MIND, CRT} cleanly, so resolveWithPlacement can apply number placement
  // (5 → 5? actually 45→5) AND glossary (MIND/CRT pair) to fully cover.
  const r = resolveWithPlacement(
    '味方全体のMINDを5%UPする',
    '味方全体のCRTを45%UPする',
    '我方全體的CRT提升45%',
    gloss(['MIND', 'MIND'], ['CRT', 'CRT']),
    [],
  );
  assert.equal(r.covered, true);
  assert.match(r.target, /MIND/);
  assert.doesNotMatch(r.target, /CRT/);
});

test('resolveWithPlacement: scattered number + glossary diffs are resolved per-diff', () => {
  const r = resolveWithPlacement(
    'MATK110%のダメージを与え、2ターンの間、味方全体のMINDを5%UPする',
    'MATK150%のダメージを与え、2ターンの間、味方全体の光属性傷害を35%UPする',
    '造成MATK150%傷害，在2回合內，我方全體的光屬性傷害提升35%',
    gloss(['MIND', 'MIND'], ['光属性傷害', '光屬性傷害']),
    [],
  );
  assert.equal(r.covered, true);
  assert.deepEqual(r.placements.sort(), ['数値', '用語']);
  assert.match(r.target, /110/);
  assert.match(r.target, /MIND/);
  assert.doesNotMatch(r.target, /光屬性傷害/);
});
