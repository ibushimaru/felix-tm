/**
 * Scenario tests: take real-ish inputs (query, TM, glossary) and trace
 * the whole pipeline up to the Sheets write payload, asserting on the
 * concrete data at each hop.
 *
 * Each test prints:
 *   - Which TM entry was the top match, and its score
 *   - What resolveWithPlacement did (placements, uncovered, final target)
 *   - What char ranges the UI sends to SHEETS_API_WRITE_FORMATTED
 *   - The assembled textFormatRuns (what actually lands in the cell)
 *
 * When a test fails, the printed trace tells you *why* the payload looks
 * the way it does, without having to rerun the extension in a browser.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../felix-engine.js');
const {
  search,
  resolveWithPlacement,
  findDiffRegions,
  unverifiedRegions,
  buildCellFormatRuns,
  CELL_FMT_PLACED,
  CELL_FMT_UNVERIFIED,
  makeCmp,
} = engine;

function tm(pairs) {
  return pairs.map(([source, target]) => ({ source, target, cmp: makeCmp(source) }));
}
function gloss(pairs) {
  return pairs.map(([term, translation]) => ({ term, translation, cmp: makeCmp(term) }));
}

function runPipeline({ query, tmData, glossaryData = [], rulesData = [] }) {
  const matches = search(query, tmData, 0.5);
  const top = matches[0] || null;
  if (!top) return { matches, top: null };
  const resolved = resolveWithPlacement(query, top.source, top.target, glossaryData, rulesData);
  const placedRegions = findDiffRegions(top.target, resolved.target);
  const placedRanges = placedRegions.map(r => ({ start: r.idx, end: r.idx + r.len }));
  const unverifiedRanges = resolved.uncovered.length > 0
    ? unverifiedRegions(placedRegions, resolved.target.length)
        .map(r => ({ start: r.idx, end: r.idx + r.len }))
    : [];
  const runs = buildCellFormatRuns(resolved.target, placedRanges, unverifiedRanges);
  return { matches, top, resolved, placedRanges, unverifiedRanges, runs };
}

function describeRuns(value, runs) {
  const endIdx = (i) => (i + 1 < runs.length ? runs[i+1].startIndex : value.length);
  return runs.map((r, i) => {
    const text = value.substring(r.startIndex, endIdx(i));
    let kind = 'plain';
    if (r.format === CELL_FMT_PLACED) kind = 'PLACED';
    else if (r.format === CELL_FMT_UNVERIFIED) kind = 'UNVERIFIED';
    else if (r.format && Object.keys(r.format).length) kind = 'other';
    return { start: r.startIndex, text, kind };
  });
}

function log(label, obj) {
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(obj, null, 2));
}

// =========================================================================
// Scenario 1 — screenshot case: ランダム4体 ↔ 全体, both registered, with
// cascading number + glossary placement. This is the case the user has
// been pushing on. Expected behaviour: number placement fires on the
// three numeric slots, per-diff glossary replaces CRT in target, and
// `全體` stays behind as an unverified stretch because the pair
// `ランダム4体 ↔ 全体` survives DP splitting as `ランダム4 ↔ 全` and
// isn't lexical-aware.
// =========================================================================
test('scenario: ランダム4体 row — what actually hits the cell', () => {
  const q = '{attackType.1}/ランダム4体/{category} ATK130%のダメージを与え、2ターンの間、味方全体のクリティカルダメージを10%UPする';
  const sSrc = '{attackType.1}/全体/{category} ATK150%のダメージを与え、3ターンの間、味方全体のCRTを15%UPする';
  const sTgt = '{attackType.1}/全體/{category} 造成ATK150%傷害，在3回合內，我方全體的CRT提升15%';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['ランダム4体', '隨機4敵人'],
      ['全体', '全體'],
      ['クリティカルダメージ', '爆擊傷害'],
      ['CRT', 'CRT'],
      ['MIND', 'MIND'],
    ]),
  });

  log('top match', { source: r.top.source, score: r.top.score });
  log('resolved', {
    placements: r.resolved.placements,
    covered: r.resolved.covered,
    target: r.resolved.target,
    uncovered: r.resolved.uncovered.map(u => ({
      q: u.qText, s: u.sText, qReg: u.qRegistered, sReg: u.sRegistered,
    })),
  });
  log('ranges sent to Sheets', { placedRanges: r.placedRanges, unverifiedRanges: r.unverifiedRanges });
  log('runs rendered in cell', describeRuns(r.resolved.target, r.runs));

  // Numeric placement must have fired on all three positional slots.
  assert.ok(r.resolved.placements.includes('数値'));
  assert.ok(r.resolved.target.includes('ATK130%'));
  assert.ok(r.resolved.target.includes('在2回合內'));
  assert.ok(r.resolved.target.includes('提升10%'));
  // CRT got replaced by 爆擊傷害 (glossary).
  assert.ok(r.resolved.placements.includes('用語'));
  assert.ok(r.resolved.target.includes('爆擊傷害'));
  assert.ok(!r.resolved.target.includes('CRT'));
  // The ランダム4 ↔ 全 diff could NOT be lifted to the lexical term
  // (DP segmentation), so it stays uncovered — the old translation 全體
  // is still present and the cell should carry the unverified signal.
  assert.equal(r.resolved.covered, false);
  assert.ok(r.unverifiedRanges.length > 0, 'uncovered diff should produce unverified ranges');
  // The target string unchanged by any placement still contains 全體.
  assert.ok(r.resolved.target.includes('全體'));
});

// =========================================================================
// Scenario 2 — fully covered (both sides of every diff are in glossary).
// Nothing should be unverified; the cell should be clean except for the
// blue placement ranges.
// =========================================================================
test('scenario: fully covered row — no unverified runs', () => {
  const q = 'MATK110%のダメージを与え、味方全体のMINDを5%UPする';
  const sSrc = 'MATK150%のダメージを与え、味方全体の光属性ダメージを35%UPする';
  const sTgt = '造成MATK150%傷害，我方全體的光屬性傷害提升35%';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['MIND', 'MIND'],
      ['光属性ダメージ', '光屬性傷害'],
    ]),
  });

  log('top match', { source: r.top.source, score: r.top.score });
  log('resolved', {
    placements: r.resolved.placements, covered: r.resolved.covered,
    target: r.resolved.target,
  });
  log('ranges sent to Sheets', { placedRanges: r.placedRanges, unverifiedRanges: r.unverifiedRanges });
  log('runs rendered in cell', describeRuns(r.resolved.target, r.runs));

  assert.equal(r.resolved.covered, true);
  assert.equal(r.unverifiedRanges.length, 0);
  // Runs should contain PLACED sections but zero UNVERIFIED.
  const kinds = describeRuns(r.resolved.target, r.runs).map(x => x.kind);
  assert.ok(kinds.includes('PLACED'));
  assert.ok(!kinds.includes('UNVERIFIED'));
});

// =========================================================================
// Scenario 3 — no glossary at all. Number placement fires (positions
// align), but the non-numeric diff (HERO ↔ ENEMY) is fully uncovered.
// The non-numeric part of the target is therefore unverified.
// =========================================================================
test('scenario: no glossary — numbers placed, lexical diff left unverified', () => {
  const q = 'Deal 100 damage to HERO with MIND 5%';
  const sSrc = 'Deal 50 damage to ENEMY with MIND 5%';
  const sTgt = '對 ENEMY 造成 50 點傷害，MIND 5%';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: [],
  });

  log('top match', { source: r.top.source, score: r.top.score });
  log('resolved', {
    placements: r.resolved.placements, covered: r.resolved.covered,
    target: r.resolved.target,
    uncovered: r.resolved.uncovered.map(u => ({ q: u.qText, s: u.sText })),
  });
  log('ranges sent to Sheets', { placedRanges: r.placedRanges, unverifiedRanges: r.unverifiedRanges });
  log('runs rendered in cell', describeRuns(r.resolved.target, r.runs));

  assert.ok(r.resolved.placements.includes('数値'));
  assert.ok(r.resolved.target.includes('100'));
  assert.ok(!r.resolved.placements.includes('用語'));
  assert.equal(r.resolved.covered, false);
  assert.ok(r.unverifiedRanges.length > 0);
  const placedChars = r.placedRanges.reduce((n, h) => n + (h.end - h.start), 0);
  const unverifiedChars = r.unverifiedRanges.reduce((n, h) => n + (h.end - h.start), 0);
  assert.equal(placedChars + unverifiedChars, r.resolved.target.length,
    'placed + unverified should cover every char when uncovered>0');
});

// =========================================================================
// Scenario 4 — 100% match. No placement at all, no unverified marking.
// The payload should be a single plain run.
// =========================================================================
test('scenario: 100% match — single plain run, nothing marked', () => {
  const q = 'hello world';
  const sSrc = 'hello world';
  const sTgt = 'こんにちは世界';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: [],
  });

  log('top match', { source: r.top.source, score: r.top.score });
  log('resolved', { placements: r.resolved.placements, covered: r.resolved.covered, target: r.resolved.target });
  log('ranges sent to Sheets', { placedRanges: r.placedRanges, unverifiedRanges: r.unverifiedRanges });
  log('runs rendered in cell', describeRuns(r.resolved.target, r.runs));

  assert.equal(r.top.score, 1);
  assert.equal(r.resolved.placements.length, 0);
  assert.equal(r.placedRanges.length, 0);
  assert.equal(r.unverifiedRanges.length, 0);
  // One plain run, index 0.
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].startIndex, 0);
  assert.deepEqual(r.runs[0].format, {});
});

// =========================================================================
// Scenario 5 — overlap between placed and unverified ranges. The
// run-builder must prefer the precise (placed) format on overlap, and
// split the unverified range around it.
// =========================================================================
test('scenario: overlap resolution — placed beats unverified inside it', () => {
  const text = 'ABCDEFGHIJ';
  const placed = [{ start: 3, end: 6 }];        // DEF
  const unverified = [{ start: 0, end: 10 }];    // the whole string

  const runs = buildCellFormatRuns(text, placed, unverified);
  log('runs', describeRuns(text, runs));

  const described = describeRuns(text, runs);
  // Expect 3 runs: unverified ABC, placed DEF, unverified GHIJ
  assert.equal(described.length, 3);
  assert.deepEqual(described[0], { start: 0, text: 'ABC', kind: 'UNVERIFIED' });
  assert.deepEqual(described[1], { start: 3, text: 'DEF', kind: 'PLACED' });
  assert.deepEqual(described[2], { start: 6, text: 'GHIJ', kind: 'UNVERIFIED' });
});

// =========================================================================
// Scenario 6 — multiple disjoint placed regions with unverified between
// them. Ensures runs include the plain head, unverified gap, placed,
// unverified gap, placed, plain tail (when applicable).
// =========================================================================
test('scenario: multiple placements with unverified gaps', () => {
  const text = '0123456789abcdef';
  // Placed at [2,4) and [8,10)
  const placed = [{ start: 2, end: 4 }, { start: 8, end: 10 }];
  // Unverified everything (uncovered > 0 case)
  const unverified = [{ start: 0, end: text.length }];

  const runs = buildCellFormatRuns(text, placed, unverified);
  log('runs', describeRuns(text, runs));

  const described = describeRuns(text, runs);
  const kinds = described.map(x => x.kind);
  assert.ok(kinds.filter(k => k === 'PLACED').length === 2);
  assert.ok(kinds.filter(k => k === 'UNVERIFIED').length === 3); // head, middle gap, tail
  // Verify char integrity: concatenated run text equals the original.
  const concat = described.map(x => x.text).join('');
  assert.equal(concat, text);
});
