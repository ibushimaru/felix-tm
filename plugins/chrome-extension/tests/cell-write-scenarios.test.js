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

function runPipeline({ query, tmData, glossaryData = [], rulesData = [], minScore = 0.5 }) {
  const matches = search(query, tmData, minScore);
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
  // With glossary-aware DP, both the CRT pair AND the ランダム4体/全体
  // pair now align as single lexical diffs. Per-diff glossary fires for
  // each, so the row is fully covered: CRT → 爆擊傷害, 全體 → 隨機4敵人.
  assert.ok(r.resolved.placements.includes('用語'));
  assert.ok(r.resolved.target.includes('爆擊傷害'));
  assert.ok(!r.resolved.target.includes('CRT'));
  assert.ok(r.resolved.target.includes('隨機4敵人'));
  // `/全體/` (the slot-path segment) was the one occurrence in target
  // corresponding to the 全体 source diff — it's been replaced. The
  // standalone 全體 inside `我方全體的` stays because it's a match region
  // (both sides have 全体 there), not a diff.
  assert.ok(r.resolved.target.includes('/隨機4敵人/'));
  assert.ok(r.resolved.target.includes('我方全體的'));
  assert.equal(r.resolved.covered, true);
  assert.equal(r.unverifiedRanges.length, 0, 'fully covered row: no unverified ranges');
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
// Scenario 5a — DP previously fragmented `中確率 ↔ 低確率` into `{中 ↔ 低}`
// because char-level DP matched `確率` on both sides. With
// glossary-aware tokenization the DP sees both as atoms and per-diff
// glossary fires, so the TM.target's 低機率 gets swapped for 中機率
// instead of silently staying behind.
// =========================================================================
test('scenario: 中確率 vs 低確率 — glossary-aware DP restores the lexical boundary', () => {
  const q = '対象に中確率で暗闇を付与し、クリティカルダメージを20%UPする';
  const sSrc = '対象に低確率で暗闇を付与し、クリティカルダメージを15%UPする';
  const sTgt = '低機率對目標賦予幽暗，暴擊傷害提升15%';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['中確率', '中機率'],
      ['低確率', '低機率'],
      ['クリティカルダメージ', '暴擊傷害'],
    ]),
  });

  log('top match', { source: r.top.source, score: r.top.score });
  log('resolved', {
    placements: r.resolved.placements, covered: r.resolved.covered,
    target: r.resolved.target,
    uncovered: r.resolved.uncovered.map(u => ({ q: u.qText, s: u.sText })),
  });

  assert.equal(r.resolved.covered, true);
  assert.ok(r.resolved.target.includes('中機率'));
  assert.ok(!r.resolved.target.includes('低機率'));
  assert.ok(r.resolved.target.includes('提升20%'));
});

// =========================================================================
// Scenario 5b — JP-EN: a multi-word glossary atom (`critical damage`)
// aligned against its English counterpart (`magic damage`). Char-level
// DP would match the shared word `damage` and split the diff into
// `{critical ↔ magic}`, which is not in glossary. Glossary-aware tokens
// keep the multi-word entries intact.
// =========================================================================
test('scenario: critical damage vs magic damage (word-mode, multi-word atoms)', () => {
  const q = 'deal critical damage to ENEMY';
  const sSrc = 'deal magic damage to HERO';
  const sTgt = 'HEROに魔法ダメージを与える';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['critical damage', 'クリティカルダメージ'],
      ['magic damage', '魔法ダメージ'],
      ['ENEMY', 'ENEMY'],
      ['HERO', 'HERO'],
    ]),
  });

  log('top match', { source: r.top.source, score: r.top.score });
  log('resolved', {
    placements: r.resolved.placements, covered: r.resolved.covered,
    target: r.resolved.target,
    uncovered: r.resolved.uncovered.map(u => ({ q: u.qText, s: u.sText })),
  });

  assert.equal(r.resolved.covered, true);
  assert.ok(r.resolved.target.includes('クリティカルダメージ'));
  assert.ok(!r.resolved.target.includes('魔法ダメージ'));
  assert.ok(r.resolved.target.includes('ENEMYに'));
  assert.ok(!r.resolved.target.includes('HEROに'));
});

// =========================================================================
// Scenario 5c — `HERO ↔ ENEMY` used to split into `{H ↔ EN}` and
// `{RO ↔ MY}` because DP matched the coincidental `E` and `O`.
// Glossary atoms keep the whole word as one diff.
// =========================================================================
test('scenario: HERO vs ENEMY — no more coincidental-char fragmentation', () => {
  const q = 'HEROに50ダメージを与える';
  const sSrc = 'ENEMYに100ダメージを与える';
  const sTgt = '對 ENEMY 造成 100 點傷害';

  // In this project HERO/ENEMY are kept untranslated on purpose — the
  // glossary just declares them as atoms so the DP doesn't shred them.
  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['HERO', 'HERO'],
      ['ENEMY', 'ENEMY'],
    ]),
    minScore: 0.3,
  });

  log('top match', { source: r.top.source, score: r.top.score });
  log('resolved', {
    placements: r.resolved.placements, covered: r.resolved.covered,
    target: r.resolved.target,
    uncovered: r.resolved.uncovered.map(u => ({ q: u.qText, s: u.sText })),
  });

  assert.equal(r.resolved.covered, true);
  assert.ok(r.resolved.target.includes('HERO'));
  assert.ok(!r.resolved.target.includes('ENEMY'));
  assert.ok(r.resolved.target.includes('50'));
  assert.ok(!r.resolved.target.includes('100'));
});

// =========================================================================
// Scenario 5e — glossary atom immediately adjacent to a differing digit
// run on both sides. Before the run-boundary flush, DP merged the
// atom-sub with the digit-sub into one diff ({MATK1, ATK2}), and
// both glossary lookup and number placement lost the slot. The sub-to-
// sub type-boundary flush splits them: {MATK, ATK} goes through
// glossary; {1, 2} becomes a filtered pure-numeric diff that
// numberPlacement handles positionally.
// =========================================================================
test('scenario: MATK vs ATK with adjacent digits — atoms no longer swallow the digit', () => {
  const q = '{attackType.1}/{attackRange}/単体/{category} MATK100%のダメージを与え、2ターンの間、MINDを5%UPする';
  const sSrc = '{attackType.1}/{attackRange}/単体/{category} ATK200%のダメージを与え、3ターンの間、CRTを45%UPする';
  const sTgt = '{attackType.1}/{attackRange}/單體/{category} 造成ATK200%傷害，在3回合內，CRT提升45%';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['MATK', 'MATK'],
      ['ATK', 'ATK'],
      ['MIND', 'MIND'],
      ['CRT', 'CRT'],
    ]),
  });
  log('resolved', { placements: r.resolved.placements, covered: r.resolved.covered, target: r.resolved.target });
  log('uncovered', r.resolved.uncovered.map(u => ({ q: u.qText, s: u.sText, qReg: u.qRegistered, sReg: u.sRegistered })));

  // ATK → MATK via per-diff glossary, CRT → MIND via per-diff glossary.
  assert.ok(r.resolved.placements.includes('用語'));
  assert.ok(r.resolved.target.includes('造成MATK'));
  assert.ok(!r.resolved.target.match(/造成ATK[^M]/));
  // Numbers all aligned: 200→100, 3→2, 45→5.
  assert.ok(r.resolved.placements.includes('数値'));
  assert.ok(r.resolved.target.includes('MATK100%'));
  assert.ok(r.resolved.target.includes('在2回合內'));
  assert.ok(r.resolved.target.includes('提升5%'));
  assert.ok(!r.resolved.target.includes('200'));
  assert.ok(!r.resolved.target.includes('45'));
  assert.equal(r.resolved.covered, true);
});

// =========================================================================
// Scenario 5d — digit-variant phrase (`2ターンの間 ↔ 3ターンの間`) must
// NOT become a glossary-uncovered diff just because a glossary atom
// tokenized the one side. Number placement is still the right tool for
// the numeric slot; the digit-strip filter keeps the diff out of the
// non-numeric list so numberPlacement can align positions.
// =========================================================================
test('scenario: digit-variant phrase stays with number placement', () => {
  const q = '2ターンの間、攻撃力UP';
  const sSrc = '3ターンの間、攻撃力UP';
  const sTgt = '3回合內，ATK UP';
  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([['2ターンの間', '2回合內']]),
  });
  log('resolved', { placements: r.resolved.placements, target: r.resolved.target });

  assert.equal(r.resolved.covered, true);
  assert.ok(r.resolved.placements.includes('数値'));
  assert.ok(r.resolved.target.includes('2回合內'));
  assert.ok(!r.resolved.target.includes('3回合內'));
});

// =========================================================================
// Scenario 5f — the ATK360% case. The merged diff contains a glossary
// atom pair (20%UP ↔ ダメージカット20%) buried in a long surrounding
// non-atom substitution, and the source side also contains a red-herring
// atom (全体) that has no counterpart on the query side. DP's min-cost
// path walked around the atoms via common surrounding chars, so neither
// the atom-atom sub nor the tie-break gave us the split. The atom-pair
// post-processor recovers it by pairing via shared-char similarity —
// 20%UP shares `2 0 %` with ダメージカット20% but nothing with 全体.
// With the pair split out, per-diff glossary fires; with the target-side
// mask tied to that sEntry.translation, numberPlacement aligns the
// remaining digits and ATK260% flips to ATK360%.
// =========================================================================
test('scenario: ATK360% — atom pair buried in long diff, red-herring atom on one side', () => {
  const q = '{attackType.1}/全体/{category} ATK360%のダメージを与え、2ターンの間、光属性の味方の斧槌ダメージを20%UPし、応戦(2回)を付与する';
  const sSrc = '{attackType.1}/全体/{category} ATK260%のダメージを与え、2ターンの間、味方全体にダメージカット20%を付与し、土属性の味方に応戦(2回)を付与する';
  const sTgt = '{attackType.1}/全體/{category} 造成ATK260%傷害，在2回合內，賦予我方全體傷害減免20%，賦予土屬性我方應戰（2次）';

  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['全体', '全體'],
      ['20%UP', '提升20%'],
      ['ダメージカット20%', '傷害減免20%'],
      ['応戦(2回)', '應戰（2次）'],
      ['2ターンの間', '在2回合內'],
    ]),
  });

  log('resolved', { placements: r.resolved.placements, target: r.resolved.target });
  log('uncovered', r.resolved.uncovered.map(u => ({ q: u.qText, s: u.sText })));

  // numberPlacement must fire: the target-side mask for the paired
  // atom's translation releases the target-side `20` so q/s/t counts
  // line up for positional substitution.
  assert.ok(r.resolved.placements.includes('数値'));
  assert.ok(r.resolved.target.includes('造成ATK360%'));
  assert.ok(!r.resolved.target.includes('造成ATK260%'));
  // per-diff glossary must fire for the paired atoms.
  assert.ok(r.resolved.placements.includes('用語'));
  assert.ok(r.resolved.target.includes('提升20%'));
  // The red-herring atom (全体) must NOT pair with 20%UP — otherwise
  // the target's `/全體/` slot path would have flipped to `/提升20%/`.
  assert.ok(r.resolved.target.includes('/全體/'));
});

// =========================================================================
// Scenario 5g — DP aligns `20%UP` and `付与` as atom-atom sub because
// both are registered, but `付与` ALSO appears in the query (in the
// unrelated `応戦(2回)を付与する` tail). Per-diff glossary used to fire
// on this spurious pairing and rewrite the target's first `賦予` to
// `提升20%`, producing garbled output. The spurious-pair guard skips
// substitution when the two terms share no chars AND one of them is
// present on the other side of the row — i.e., the atom isn't
// genuinely cross-side differential, DP just couldn't pair it locally.
// =========================================================================
test('scenario: spurious DP atom pair — 20%UP ↔ 付与 rejected when 付与 also in query', () => {
  const q = '{attackType.1}/全体/{category} ATK360%のダメージを与え、2ターンの間、光属性の味方の斧槌ダメージを20%UPし、応戦(2回)を付与する';
  const sSrc = '{attackType.1}/全体/{category} ATK260%のダメージを与え、2ターンの間、味方全体にダメージカット20%を付与し、土属性の味方に応戦(2回)を付与する';
  const sTgt = '{attackType.1}/全體/{category} 造成ATK260%傷害，在2回合內，賦予我方全體傷害減免20%，賦予土屬性我方應戰（2次）';

  // Glossary as the translator might actually have it: 20%UP and 付与 are
  // both registered, but ダメージカット20% is NOT. The DP aligns
  // 20%UP ↔ 付与 because they're both atoms; without the guard, target
  // would gain a stray `提升20%` before `我方全體傷害減免20%`.
  const r = runPipeline({
    query: q,
    tmData: tm([[sSrc, sTgt]]),
    glossaryData: gloss([
      ['20%UP', '提升20%'],
      ['付与', '賦予'],
      ['応戦(2回)', '應戰（2次）'],
      ['2ターンの間', '在2回合內'],
      ['全体', '全體'],
      ['光属性', '光屬性'],
      ['土属性', '土屬性'],
      ['味方', '我方'],
    ]),
  });

  log('resolved', { placements: r.resolved.placements, target: r.resolved.target });

  // The spurious pair must NOT have fired — target stays untouched by
  // glossary substitution. Number placement also fails honestly
  // (count mismatch), so `数値` shouldn't be on the badge either.
  assert.ok(!r.resolved.placements.includes('用語'));
  assert.ok(r.resolved.target === sTgt, 'target should equal TM.target unchanged');
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
