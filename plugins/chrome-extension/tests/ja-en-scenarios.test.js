/**
 * JA source → EN target scenarios.
 *
 * Until now the scenario suite was almost entirely JA→ZH and EN→JA
 * (inventoried at: 1 JA→EN pair across 90+ test pairs, and that one
 * pair used "ZZZ" as the target placeholder). The engine is direction-
 * agnostic in design, but "should work" is not "is verified."
 *
 * This file pins the JA→EN happy paths: fuzzy ranking, number
 * placement on EN target, per-diff glossary substitution from JA term
 * to EN translation, concordance / reverse search across the language
 * boundary, and an end-to-end auto-translate run.
 *
 * Two known bugs surface specifically in JA→EN (or any direction with
 * Latin script targets) — capitalization loss and lack of word-
 * boundary check in substring substitution. Those have their own
 * tests in the bug-fix commits that follow this file.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const FelixEngine = require('../felix-engine.js');
const {
  fuzzyScore, search, reverseSearch, concordanceSearch, glossarySearch,
  resolveWithPlacement, planAutoTranslateToFuzzy,
  makeCmp, addEntry, addGlossaryEntry,
} = FelixEngine;

function tm(...pairs) {
  return pairs.map(([source, target]) => ({
    source, target,
    cmp: makeCmp(source),
    targetCmp: makeCmp(target),
  }));
}
function gloss(...pairs) {
  return pairs.map(([term, translation]) => ({
    term, translation, cmp: makeCmp(term),
  }));
}

// -------------------- fuzzy / search --------------------

test('JA→EN: fuzzyScore on JA pair (target language is irrelevant for scoring)', () => {
  // Scoring compares query to TM source — both JA. The EN target
  // never enters the calculation, so this is just a sanity check
  // that the JA pair scores correctly.
  const s = fuzzyScore(
    makeCmp('光属性のダメージを20%UP'),
    makeCmp('闇属性のダメージを15%UP'),
    0.5,
  );
  // 14 chars each, 3 char diffs (光/闇, 2/1, 0/5) → (14-3)/14 = 11/14
  assert.ok(Math.abs(s - 11 / 14) < 1e-9, `expected 11/14, got ${s}`);
});

test('JA→EN: search returns the row with EN target intact', () => {
  const r = search('光属性のダメージを20%UP', tm(
    ['闇属性のダメージを15%UP', 'Increases Dark damage by 15%'],
    ['全体回復',                 'Heal all allies'],
  ), 0.5);
  assert.equal(r.length, 1);
  assert.equal(r[0].target, 'Increases Dark damage by 15%',
    'EN target carried through unchanged from the row');
});

// -------------------- number placement on EN target --------------------

test('JA→EN: number placement substitutes digits in the EN target', () => {
  const r = resolveWithPlacement(
    'ダメージを30%与える',
    'ダメージを15%与える',
    'Deals 15% damage',
    [],
    [],
  );
  assert.equal(r.target, 'Deals 30% damage');
  assert.deepEqual(r.placements, ['数値']);
  assert.deepEqual(r.uncovered, []);
});

test('JA→EN: multiple number diffs land in matching positions on EN target', () => {
  const r = resolveWithPlacement(
    'ダメージ30%、20ターン継続',
    'ダメージ15%、10ターン継続',
    'Deals 15% damage for 10 turns',
    [],
    [],
  );
  assert.equal(r.target, 'Deals 30% damage for 20 turns');
  assert.deepEqual(r.placements, ['数値']);
});

// -------------------- per-diff glossary (JA term → EN translation) --------------------

test('JA→EN: per-diff glossary swaps the EN translation in target', () => {
  // Diff is 光属性 ↔ 闇属性. Glossary maps both to lowercase EN.
  // Target uses the same lowercase form, so the substring substitution
  // is unambiguous.
  const r = resolveWithPlacement(
    '光属性のダメージを20%UP',
    '闇属性のダメージを15%UP',
    'Increases dark element damage by 15%',
    gloss(['光属性', 'light element'], ['闇属性', 'dark element']),
    [],
  );
  assert.equal(r.target, 'Increases light element damage by 20%');
  assert.deepEqual(r.placements.sort(), ['数値', '用語']);
  assert.deepEqual(r.uncovered, []);
});

test('JA→EN: number + glossary land independently on the same target', () => {
  // Two unrelated diffs: numeric (15→20) and term (闇→光). Both must
  // resolve into the same EN target without stepping on each other.
  const r = resolveWithPlacement(
    '光属性のダメージを20%UP',
    '闇属性のダメージを15%UP',
    'Increases dark damage by 15%',
    gloss(['光属性', 'light'], ['闇属性', 'dark']),
    [],
  );
  assert.equal(r.target, 'Increases light damage by 20%');
});

// -------------------- uncovered diff propagation --------------------

test('JA→EN: empty target with covered diff still reports uncovered (nothing to substitute into)', () => {
  // A new translation row: TM source matches but target is empty.
  // Even if the diff is glossary-covered, there is no EN string for
  // per-diff substitution to land on, so the diff stays uncovered.
  const r = resolveWithPlacement(
    '光属性のダメージを20%UP',
    '闇属性のダメージを20%UP',
    '',
    gloss(['光属性', 'Light'], ['闇属性', 'Dark']),
    [],
  );
  assert.equal(r.target, '');
  assert.equal(r.uncovered.length, 1);
  assert.equal(r.uncovered[0].qText, '光属性');
  assert.equal(r.uncovered[0].sText, '闇属性');
  assert.equal(r.uncovered[0].qRegistered, true);
  assert.equal(r.uncovered[0].sRegistered, true);
});

test('JA→EN: glossary entry missing on one side → uncovered with the right registration flag', () => {
  // Only 光属性 is registered. The diff still surfaces, with the side
  // that has a glossary entry marked qRegistered=true so the UI can
  // colour it differently from the side that has no entry at all.
  const r = resolveWithPlacement(
    '光属性のダメージ',
    '闇属性のダメージ',
    'Dark damage',
    gloss(['光属性', 'Light']),
    [],
  );
  assert.equal(r.uncovered.length, 1);
  assert.equal(r.uncovered[0].qRegistered, true);
  assert.equal(r.uncovered[0].sRegistered, false);
});

// -------------------- search across the language boundary --------------------

test('JA→EN: concordanceSearch finds an EN word inside the EN target', () => {
  const r = concordanceSearch('damage', tm(
    ['光属性のダメージを20%UP',  'Increases Light damage by 20%'],
    ['闇属性のダメージを15%UP',  'Increases Dark damage by 15%'],
    ['全体回復',                  'Heal all allies'],
  ), 50);
  assert.equal(r.length, 2);
  assert.ok(r.every(h => h.matchField === 'target'),
    'matches should be on the target side, not the JA source');
});

test('JA→EN: concordanceSearch finds a JA word inside the JA source', () => {
  const r = concordanceSearch('光', tm(
    ['光属性のダメージ', 'Light element damage'],
    ['闇属性のダメージ', 'Dark element damage'],
    ['光のキャラ',       'Light character'],
  ), 50);
  assert.equal(r.length, 2);
  assert.ok(r.every(h => h.matchField === 'source'));
});

test('JA→EN: reverseSearch ranks rows by EN target similarity', () => {
  const r = reverseSearch('Increases damage by 20%', tm(
    ['光属性のダメージを20%UP', 'Increases Light damage by 20%'],
    ['闇属性のダメージを15%UP', 'Increases Dark damage by 15%'],
  ), 0.5);
  assert.ok(r.length >= 1);
  assert.equal(r[0].target, 'Increases Light damage by 20%',
    'closer EN target ranks first');
  assert.ok(r[0].score >= r[r.length - 1].score, 'sorted by score desc');
});

test('JA→EN: glossarySearch on a JA query returns hits with EN translations', () => {
  const r = glossarySearch('光属性のダメージ', gloss(
    ['光属性', 'Light element'],
    ['ダメージ', 'damage'],
    ['闇属性', 'Dark element'],
  ), 0.9);
  assert.equal(r.length, 2);
  // Longest term first (greedy contract). ダメージ (4) > 光属性 (3).
  assert.equal(r[0].term, 'ダメージ');
  assert.equal(r[0].translation, 'damage');
  assert.equal(r[1].term, '光属性');
  assert.equal(r[1].translation, 'Light element');
});

// -------------------- end-to-end auto-translate (JA→EN) --------------------

test('JA→EN: planAutoTranslateToFuzzy fills covered rows and stops cleanly on a fuzzy-uncovered one', () => {
  const tmData = [];
  addEntry(tmData, '光属性のダメージを20%UP', 'Increases Light damage by 20%');
  addEntry(tmData, '闇属性のダメージを15%UP', 'Increases Dark damage by 15%');
  addEntry(tmData, '全体回復',                 'Heal all allies');

  const glossaryData = [];
  addGlossaryEntry(glossaryData, '光属性', 'Light');
  addGlossaryEntry(glossaryData, '闇属性', 'Dark');

  const newRows = [
    '光属性のダメージを30%UP',  // fuzzy on row 1, number swaps 20→30 → covered
    '全体回復',                   // exact 100% → covered
    '謎の新しい技',              // no match → fuzzy_uncovered or no_match
  ];

  const r = planAutoTranslateToFuzzy({
    startRow: 2,
    srcValues: newRows,
    tgtValues: ['', '', ''],
    tmData,
    glossaryData,
    rulesData: [],
    minScore: 0.5,
  });

  // First two rows should write through. Row 4 should be the stop.
  assert.ok(r.writes.length >= 2, `expected ≥ 2 writes, got ${r.writes.length}`);
  assert.equal(r.writes[0].rowNum, 2);
  assert.equal(r.writes[0].value, 'Increases Light damage by 30%',
    'number placement should swap 20% → 30% in EN target');
  assert.equal(r.writes[0].viaPlacement, true);
  assert.equal(r.writes[1].rowNum, 3);
  assert.equal(r.writes[1].value, 'Heal all allies', 'exact match writes target verbatim');
  assert.ok(r.stopReason === 'no_match' || r.stopReason === 'fuzzy_uncovered',
    `unexpected stopReason: ${r.stopReason}`);
  assert.equal(r.stoppedAt && r.stoppedAt.rowNum, 4);
});
