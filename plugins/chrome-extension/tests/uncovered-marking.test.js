/**
 * Uncovered diff marking — two-color UX.
 *
 * A fuzzy match can contain diffs that placement can't resolve. For each
 * uncovered diff pair, the UI needs to distinguish which side of the pair
 * is actually missing from the glossary (red, translator must add) from
 * which side is present but blocked by a missing counterpart (yellow,
 * translator just needs to handle the pair).
 *
 * These tests pin down the resolver's registration flags and the two
 * rendering helpers that consume them.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../felix-engine.js');
const {
  resolveWithPlacement,
  markUncoveredHtml,
  renderQueryCellWithUncovered,
  uncoveredRegionsForText,
  numberPlacement,
  makeCmp,
} = engine;

function gloss(pairs) {
  return pairs.map(([term, translation]) => ({
    term, translation, cmp: makeCmp(term),
  }));
}

const query = 'MATK110%のダメージを与え、味方全体のMINDを5%UPする';
const tmSrc = 'MATK150%のダメージを与え、味方全体の光属性ダメージを35%UPする';
const tmTgt = '造成MATK150%傷害，我方全體的光屬性傷害提升35%';

// --- resolveWithPlacement registration flags ------------------------------

test('both sides missing → uncovered entry marks qRegistered=false sRegistered=false', () => {
  const r = resolveWithPlacement(query, tmSrc, tmTgt, [], []);
  assert.equal(r.covered, false);
  assert.equal(r.uncovered.length, 1);
  const u = r.uncovered[0];
  assert.equal(u.qText, 'MIND');
  assert.equal(u.sText, '光属性ダメージ');
  assert.equal(u.qRegistered, false);
  assert.equal(u.sRegistered, false);
  assert.equal(query.substring(u.qStart, u.qEnd), 'MIND');
  assert.equal(tmSrc.substring(u.sStart, u.sEnd), '光属性ダメージ');
});

test('only MIND registered → qRegistered=true sRegistered=false', () => {
  const g = gloss([['MIND', 'MIND']]);
  const r = resolveWithPlacement(query, tmSrc, tmTgt, g, []);
  assert.equal(r.covered, false);
  const u = r.uncovered[0];
  assert.equal(u.qText, 'MIND');
  assert.equal(u.sText, '光属性ダメージ');
  assert.equal(u.qRegistered, true);
  assert.equal(u.sRegistered, false);
});

test('only 光属性ダメージ registered → qRegistered=false sRegistered=true', () => {
  const g = gloss([['光属性ダメージ', '光屬性傷害']]);
  const r = resolveWithPlacement(query, tmSrc, tmTgt, g, []);
  assert.equal(r.covered, false);
  const u = r.uncovered[0];
  assert.equal(u.qText, 'MIND');
  assert.equal(u.sText, '光属性ダメージ');
  assert.equal(u.qRegistered, false);
  assert.equal(u.sRegistered, true);
});

test('both sides registered and target substitution succeeds → covered, no uncovered', () => {
  const g = gloss([['MIND', 'MIND'], ['光属性ダメージ', '光屬性傷害']]);
  const r = resolveWithPlacement(query, tmSrc, tmTgt, g, []);
  assert.equal(r.covered, true);
  assert.equal(r.uncovered.length, 0);
  assert.ok(r.placements.includes('用語'));
  assert.ok(r.target.includes('MIND'));
  assert.ok(!r.target.includes('光屬性傷害'));
});

test('both sides registered but target does not contain sEntry.translation → still uncovered, both true', () => {
  // sEntry.translation is 'ZZZ' but target has '光屬性傷害'
  const g = gloss([['MIND', 'MIND'], ['光属性ダメージ', 'ZZZ']]);
  const r = resolveWithPlacement(query, tmSrc, tmTgt, g, []);
  assert.equal(r.covered, false);
  const u = r.uncovered[0];
  assert.equal(u.qText, 'MIND');
  assert.equal(u.sText, '光属性ダメージ');
  assert.equal(u.qRegistered, true);
  assert.equal(u.sRegistered, true);
});

// --- uncoveredRegionsForText ----------------------------------------------
// Helper to build a position-bearing uncovered entry from the real resolver,
// so tests exercise the same shape the UI receives at runtime.
function uncoveredOf(g) {
  return resolveWithPlacement(query, tmSrc, tmTgt, g, []).uncovered;
}

test('uncoveredRegionsForText: query side uses qRegistered class and DP position', () => {
  const uncovered = uncoveredOf(gloss([['MIND', 'MIND']]));  // qRegistered=true
  const regs = uncoveredRegionsForText(query, uncovered, 'q');
  assert.equal(regs.length, 1);
  assert.equal(query.substring(regs[0].start, regs[0].end), 'MIND');
  assert.equal(regs[0].cls, 'diff-uncovered-present');
});

test('uncoveredRegionsForText: source side uses sRegistered class and DP position', () => {
  const uncovered = uncoveredOf(gloss([['MIND', 'MIND']]));  // sRegistered=false
  const regs = uncoveredRegionsForText(tmSrc, uncovered, 's');
  assert.equal(regs.length, 1);
  assert.equal(tmSrc.substring(regs[0].start, regs[0].end), '光属性ダメージ');
  assert.equal(regs[0].cls, 'diff-uncovered-missing');
});

test('uncoveredRegionsForText: position-specific — a sText that also appears in matched context is NOT double-painted', () => {
  // Construct a case where the diff's sText also appears in the common
  // (matched) part of the sentence. indexOf-based marking would have
  // painted both occurrences; position-based marking should only paint
  // the one that actually corresponds to the diff.
  const q = 'AAA XX YYY BBB';
  const s = 'AAA ZZ YYY BBB';  // 'XX' ↔ 'ZZ'
  const t = 'T';
  const r = resolveWithPlacement(q, s, t, [], []);
  // The diff may be XX ↔ ZZ (sText='ZZ')
  const zzUnc = r.uncovered.find(u => u.sText === 'ZZ');
  assert.ok(zzUnc, 'expected an uncovered diff with sText=ZZ');
  const regs = uncoveredRegionsForText(s, [zzUnc], 's');
  assert.equal(regs.length, 1);
  assert.equal(s.substring(regs[0].start, regs[0].end), 'ZZ');
});

// --- direction-axis: add vs remove ----------------------------------------
// After the translator clicks a TM match, the placed target needs
// post-edit. The action depends on which side the diff is on:
//   q-side ins/del  = cell has it, TM doesn't → must ADD to placement
//                     → underline dashed (additive cue)
//   s-side ins/del  = TM has it, cell doesn't → must REMOVE from placement
//                     → strikethrough (subtractive cue)
//   sub             = swap, no special decoration

test('uncoveredRegionsForText: sub diff (both sides non-empty) — neither add nor remove class', () => {
  const uncovered = uncoveredOf([]);  // MIND ↔ 光属性ダメージ — sub diff
  const qRegs = uncoveredRegionsForText(query, uncovered, 'q');
  assert.equal(qRegs.length, 1);
  assert.ok(!qRegs[0].cls.includes('diff-uncovered-add'));
  assert.ok(!qRegs[0].cls.includes('diff-uncovered-remove'));
  const sRegs = uncoveredRegionsForText(tmSrc, uncovered, 's');
  assert.equal(sRegs.length, 1);
  assert.ok(!sRegs[0].cls.includes('diff-uncovered-add'));
  assert.ok(!sRegs[0].cls.includes('diff-uncovered-remove'));
});

test('uncoveredRegionsForText: TM has extra content (qText empty) → s side gets remove (strikethrough)', () => {
  // After-rotation form: leading shared 与え、 stays out, trailing 、 enters the diff.
  const q = '与え、UPする';
  const s = '与え、自身の神絆ゲージを1%UPし、UPする';
  const r = resolveWithPlacement(q, s, 'X', [], []);
  const ins = r.uncovered.find(u => !u.qText && u.sText);
  assert.ok(ins, 'expected a TM-only insertion diff');
  const regs = uncoveredRegionsForText(s, [ins], 's');
  assert.equal(regs.length, 1);
  assert.ok(regs[0].cls.includes('diff-uncovered-remove'),
    `expected remove class on s side, got: ${regs[0].cls}`);
  assert.ok(!regs[0].cls.includes('diff-uncovered-add'));
});

test('uncoveredRegionsForText: cell has extra content (sText empty) → q side gets add (underline)', () => {
  // Cell has extra `土属性の味方に` that's not in TM source.
  const q = '与え、UPし、土属性の味方に応戦する';
  const s = '与え、UPし、応戦する';
  const r = resolveWithPlacement(q, s, 'X', [], []);
  const del = r.uncovered.find(u => u.qText && !u.sText);
  assert.ok(del, 'expected a cell-only deletion diff');
  const regs = uncoveredRegionsForText(q, [del], 'q');
  assert.equal(regs.length, 1);
  assert.ok(regs[0].cls.includes('diff-uncovered-add'),
    `expected add class on q side, got: ${regs[0].cls}`);
  assert.ok(!regs[0].cls.includes('diff-uncovered-remove'));
});

// --- rotateBoundaryDiff ---------------------------------------------------
// When DP is free to place a pure insertion at either end of a run of
// common chars, rotate forward so the leading char of the diff becomes
// part of the shared prefix. Concretely: when source has `与え、…し、` and
// query has `与え、`, the diff should be `自身…し、` (trailing comma in
// the diff), not `、自身…し` (leading comma in the diff).

test('rotateBoundaryDiff: pure insertion with duplicated boundary char rotates forward', () => {
  const q = '与え、UPする';
  const s = '与え、自身の神絆ゲージを1%UPし、UPする';
  const diffs = engine.nonNumericDiffs(q, s, []);
  const ins = diffs.find(d => !d.qText && d.sText);
  assert.ok(ins, 'expected a pure-insertion diff');
  // After rotation: the diff text should NOT begin with 、 — that comma
  // belongs to the shared prefix `与え、`.
  assert.ok(!ins.sText.startsWith('、'),
    `diff still starts with leading 、: ${ins.sText}`);
  assert.ok(ins.sText.includes('自身の神絆ゲージ'));
  // And the diff position in source should map back to the same text.
  assert.equal(s.substring(ins.sStart, ins.sEnd), ins.sText);
});

test('rotateBoundaryDiff: substitution diff is NOT rotated (positions unchanged)', () => {
  // MIND ↔ 光属性ダメージ — both sides non-empty, rotation rules out subs.
  const diffs = engine.nonNumericDiffs(query, tmSrc, []);
  const sub = diffs.find(d => d.qText && d.sText);
  assert.ok(sub);
  assert.equal(sub.qText, 'MIND');
  assert.equal(sub.sText, '光属性ダメージ');
  assert.equal(query.substring(sub.qStart, sub.qEnd), 'MIND');
  assert.equal(tmSrc.substring(sub.sStart, sub.sEnd), '光属性ダメージ');
});

// --- markUncoveredHtml -----------------------------------------------------

test('markUncoveredHtml: wraps sText in red when sRegistered=false', () => {
  const uncovered = uncoveredOf(gloss([['MIND', 'MIND']]));
  const html = markUncoveredHtml(tmSrc, uncovered, 's');
  assert.ok(html.includes('<span class="diff-uncovered-missing">光属性ダメージ</span>'));
});

test('markUncoveredHtml: wraps qText in yellow when qRegistered=true', () => {
  const uncovered = uncoveredOf(gloss([['MIND', 'MIND']]));
  const html = markUncoveredHtml(query, uncovered, 'q');
  assert.ok(html.includes('<span class="diff-uncovered-present">MIND</span>'));
});

test('markUncoveredHtml: no uncovered → returns escaped plain text', () => {
  assert.equal(markUncoveredHtml('foo<bar>', [], 'q'), 'foo&lt;bar&gt;');
});

// --- renderQueryCellWithUncovered -----------------------------------------

test('renderQueryCellWithUncovered: glossary underline + uncovered yellow on MIND', () => {
  const glossHits = [{ term: 'MIND', translation: 'MIND', cmp: makeCmp('MIND') }];
  const uncovered = uncoveredOf(gloss([['MIND', 'MIND']]));
  const html = renderQueryCellWithUncovered(query, glossHits, uncovered);
  assert.ok(html, 'expected non-null output');
  assert.ok(html.includes('<span class="diff-uncovered-present">'));
  assert.ok(html.includes('<span class="gloss_match"'));
  const mindMatches = html.match(/MIND/g) || [];
  assert.ok(mindMatches.length >= 1);
});

test('renderQueryCellWithUncovered: no glossary and no uncovered → null (fallback to plain)', () => {
  const out = renderQueryCellWithUncovered('ordinary text', [], []);
  assert.equal(out, null);
});

test('renderQueryCellWithUncovered: uncovered without glossary → red span only', () => {
  const uncovered = uncoveredOf([]);  // neither side registered
  const html = renderQueryCellWithUncovered(query, [], uncovered);
  assert.ok(html);
  assert.ok(html.includes('<span class="diff-uncovered-missing">MIND</span>'));
  assert.ok(!html.includes('gloss_match'));
});

// --- numberPlacement: diff-region masking ---------------------------------
// A digit sitting inside a non-numeric diff (e.g. the 4 in `ランダム4体`
// that aligned against `全体`) is part of the lexical substitution, not an
// independent numeric slot. numberPlacement masks those ranges using
// nonNumericDiffs' char positions so query vs source number counts stay
// aligned and placement can still run on the real numeric slots.

test('numberPlacement: digit inside a non-numeric diff no longer breaks count match', () => {
  const q = '/ランダム4体/ ATK130%を5%UP';
  const s = '/全体/ ATK150%を15%UP';
  const t = '/全體/ 造成ATK150%提升15%';
  const r = numberPlacement(q, s, t);
  assert.equal(r.placed, true, 'diff-region masking should bring counts into line');
  assert.ok(r.target.includes('ATK130%'));
  assert.ok(r.target.includes('提升5%'));
});

test('numberPlacement: still fails honestly when diff-region masking cannot reconcile counts', () => {
  // Extra stray number on the query side that isn't inside any diff
  // (query has truly different slot count). Placement must refuse rather
  // than silently do the wrong thing.
  const q = '100 and 200 and 300';
  const s = '50 and 60';
  const t = 'x and y';
  const r = numberPlacement(q, s, t);
  assert.equal(r.placed, false);
});

test('numberPlacement: the screenshot case — ランダム4体 vs 全体 with full sentence context', () => {
  const q = '{attackType.1}/ランダム4体/{category} ATK130%のダメージを与え、2ターンの間、味方全体のクリティカルダメージを10%UPする';
  const s = '{attackType.1}/全体/{category} ATK150%のダメージを与え、3ターンの間、味方全体のCRTを15%UPする';
  const t = '{attackType.1}/全體/{category} 造成ATK150%傷害，在3回合內，我方全體的CRT提升15%';
  const r = numberPlacement(q, s, t);
  assert.equal(r.placed, true);
  assert.ok(r.target.includes('ATK130%'), 'ATK150% should have been placed to ATK130%');
  assert.ok(r.target.includes('在2回合內'), '3 should have been placed to 2');
  assert.ok(r.target.includes('提升10%'), '15% should have been placed to 10%');
  assert.ok(!r.target.includes('150'));
});
