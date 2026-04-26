/**
 * Quality Control checks (Felix Manual Ch.4.6.4).
 *
 * qcNumbers / qcAllCaps / qcGlossary each run independently and return
 * a flat issue list. qcCheck is the umbrella that combines them with
 * a `type` discriminator on each issue.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  qcCheck, qcNumbers, qcAllCaps, qcGlossary, makeCmp,
} = require('../felix-engine.js');

function gloss(...pairs) {
  return pairs.map(([term, translation]) => ({
    term, translation, cmp: makeCmp(term),
  }));
}

// -------------------- qcNumbers --------------------

test('qcNumbers: matched numbers → no issues', () => {
  assert.deepEqual(qcNumbers('Deals 15% damage', '15% のダメージ'), []);
});

test('qcNumbers: number missing on target side', () => {
  const r = qcNumbers('Deals 15% damage in 3 turns', 'Deals damage');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.value).sort(), ['15', '3']);
  assert.ok(r.every(x => x.side === 'target'));
});

test('qcNumbers: number extra on target side', () => {
  const r = qcNumbers('Deals damage', 'Deals 15% damage');
  assert.equal(r.length, 1);
  assert.equal(r[0].value, '15');
  assert.equal(r[0].side, 'source');
});

test('qcNumbers: full-width digits fold to half-width before comparison', () => {
  // ３１４ in source, 314 in target — same number, no issue.
  assert.deepEqual(qcNumbers('Number ３１４ here', 'Number 314 here'), []);
});

test('qcNumbers: decimal / thousands kept as one token', () => {
  // 1.5 stays "1.5" not ["1", "5"]; same for 1,000.
  const r = qcNumbers('Version 1.5 ships', 'Version 2.0 ships');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.value).sort(), ['1.5', '2.0']);
});

test('qcNumbers: same number twice — multiset semantics', () => {
  // "5 of 5" must not collapse to a single "5" — preserve count.
  assert.deepEqual(qcNumbers('5 of 5', '5 of 5'), []);
  const r = qcNumbers('5 of 5', '5 of 6');
  assert.equal(r.length, 2);
  // 5 missing on target (one extra in source), 6 extra on target.
  const missing = r.find(x => x.side === 'target');
  const extra = r.find(x => x.side === 'source');
  assert.equal(missing.value, '5');
  assert.equal(extra.value, '6');
});

test('qcNumbers: empty inputs → no issues', () => {
  assert.deepEqual(qcNumbers('', ''), []);
  assert.deepEqual(qcNumbers('hello', ''), []);
  assert.deepEqual(qcNumbers('', 'hello'), []);
});

// -------------------- qcAllCaps --------------------

test('qcAllCaps: all-caps token in source, present in target → no issue', () => {
  assert.deepEqual(qcAllCaps('Press HP button', 'HPボタンを押す'), []);
});

test('qcAllCaps: all-caps missing in target → issue', () => {
  const r = qcAllCaps('Press HP button', 'ボタンを押す');
  assert.equal(r.length, 1);
  assert.equal(r[0].word, 'HP');
});

test('qcAllCaps: multiple all-caps words tracked independently', () => {
  const r = qcAllCaps('MATK and ATK boost', 'ATKを上昇');
  assert.equal(r.length, 1);
  assert.equal(r[0].word, 'MATK');
});

test('qcAllCaps: single-letter capitals are NOT flagged (too noisy)', () => {
  // "A B C" should not each be flagged. The engine requires ≥2 letters.
  assert.deepEqual(qcAllCaps('A B C item', 'アイテム'), []);
});

test('qcAllCaps: alphanumeric tokens like "MP3" are recognized', () => {
  const r = qcAllCaps('Save as MP3 format', 'フォーマットで保存');
  assert.equal(r.length, 1);
  assert.equal(r[0].word, 'MP3');
});

test('qcAllCaps: case-sensitive — lowercase mention in target does NOT count', () => {
  // The whole point of the check: "HP" was meant to be preserved verbatim.
  // If target has "hp" instead, that's the bug we're catching.
  const r = qcAllCaps('Restore HP', 'hpを回復');
  assert.equal(r.length, 1);
  assert.equal(r[0].word, 'HP');
});

test('qcAllCaps: empty source → no issues', () => {
  assert.deepEqual(qcAllCaps('', 'irrelevant'), []);
});

test('qcAllCaps: words registered as a glossary term are skipped (qcGlossary handles them)', () => {
  // DOWN is intentionally translated to 下降 — registering DOWN→下降
  // in the glossary tells qcAllCaps "stop flagging this; the glossary
  // check owns it." Without this pass, the user's only escape from
  // the false positive was disabling the entire CAPS check.
  const r = qcAllCaps(
    'Stat DOWN by 50%',
    'ステータスが50%下降',
    gloss(['DOWN', '下降']),
  );
  assert.deepEqual(r, []);
});

test('qcAllCaps: glossary-registered word with translation NOT in target → still skipped here (qcGlossary will fire)', () => {
  // The CAPS check's job is "did this preserve verbatim?". For
  // glossary-managed words that's the wrong question — qcGlossary
  // is the one that should fire when the translation is missing.
  const r = qcAllCaps(
    'Stat DOWN by 50%',
    'ステータスが50%増加',  // wrong target — but qcAllCaps still steps aside
    gloss(['DOWN', '下降']),
  );
  assert.deepEqual(r, []);
});

// -------------------- qcGlossary --------------------

test('qcGlossary: term in source AND translation in target → no issue', () => {
  const r = qcGlossary(
    '光属性のダメージ',
    'Light element damage',
    gloss(['光属性', 'Light element']),
  );
  assert.deepEqual(r, []);
});

test('qcGlossary: term in source but translation missing in target → issue', () => {
  const r = qcGlossary(
    '光属性のダメージ',
    'Element damage',
    gloss(['光属性', 'Light element']),
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].term, '光属性');
  assert.equal(r[0].translation, 'Light element');
});

test('qcGlossary: glossary term not in source → no issue (vacuous truth)', () => {
  const r = qcGlossary(
    '闇属性のダメージ',
    'Dark damage',
    gloss(['光属性', 'Light']),
  );
  assert.deepEqual(r, []);
});

test('qcGlossary: word-boundary aware — "dark" inside "darken" does not trigger', () => {
  // glossary 闇→Dark, source has "darken" (not 闇), so no term match.
  // This only matters when source has Latin script; for the more common
  // case (JA source / EN target), the source side check is on JA.
  const r = qcGlossary(
    'Darken the area',
    'Lighten the area',
    gloss(['Dark', '暗']),
  );
  assert.deepEqual(r, [], 'glossary "Dark" should not match inside "Darken"');
});

test('qcGlossary: case / width insensitive on both sides', () => {
  // Glossary in Title case, source in lower, target in upper — fold to
  // the same form, no issue.
  assert.deepEqual(qcGlossary(
    'light element power',
    'LIGHT ELEMENT POWER',
    gloss(['Light Element', 'LIGHT ELEMENT']),
  ), []);
});

// -------------------- qcCheck (umbrella) --------------------

test('qcCheck: combines all three checks with a type discriminator', () => {
  const r = qcCheck(
    {
      source: 'Restore HP by 50',
      target: 'HPを回復',
    },
    gloss(['HP', 'HP']),
    { numbers: true, allCaps: true, glossary: true },
  );
  // Number 50 missing on target → 1 number issue
  // HP exists in target → no allcaps issue
  // HP glossary translation also "HP" present → no glossary issue
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'number');
  assert.equal(r[0].value, '50');
});

test('qcCheck: respects opts.numbers / allCaps / glossary toggles', () => {
  const rec = { source: 'Restore HP by 50', target: 'を回復' };
  const all = qcCheck(rec, [], { numbers: true, allCaps: true });
  // Both: 50 missing (number) AND HP missing (allcaps).
  assert.equal(all.length, 2);
  const types = all.map(x => x.type).sort();
  assert.deepEqual(types, ['allcaps', 'number']);

  const numsOnly = qcCheck(rec, [], { numbers: true, allCaps: false, glossary: false });
  assert.equal(numsOnly.length, 1);
  assert.equal(numsOnly[0].type, 'number');

  const capsOnly = qcCheck(rec, [], { numbers: false, allCaps: true, glossary: false });
  assert.equal(capsOnly.length, 1);
  assert.equal(capsOnly[0].type, 'allcaps');
});

test('qcCheck: clean record → empty list', () => {
  const r = qcCheck(
    { source: 'Restore HP by 50', target: 'HPを50回復' },
    gloss(['HP', 'HP']),
  );
  assert.deepEqual(r, []);
});

test('qcCheck: missing record → empty list (no throw)', () => {
  assert.deepEqual(qcCheck(null), []);
  assert.deepEqual(qcCheck(undefined), []);
});

test('qcCheck: omitting opts runs all three checks by default', () => {
  const r = qcCheck(
    { source: 'HP by 50', target: 'を回復' },
    gloss(['HP', 'HP']),
  );
  // Default = all checks on. number 50 missing + glossary HP→HP
  // missing. CAPS would also fire on "HP" but qcAllCaps now defers
  // to glossary when the word is a registered term.
  assert.equal(r.length, 2);
  const types = r.map(x => x.type).sort();
  assert.deepEqual(types, ['glossary', 'number']);
});
