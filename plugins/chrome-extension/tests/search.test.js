/**
 * Unit tests for the TM search / glossary / storage surface.
 *
 *   search              — fuzzy match against tmData.source
 *   reverseSearch       — fuzzy match against tmData.target
 *   concordanceSearch   — substring match in source OR target
 *   glossarySearch      — exact substring match of glossary terms
 *   addEntry            — dedup-aware TM insert
 *   addGlossaryEntry    — dedup-aware glossary insert
 *   parseA1             — A1 cell-ref parser
 *
 * The scenario tests in cell-write-scenarios.test.js exercise these
 * indirectly through end-to-end pipelines, so a regression in any of
 * them only surfaces as a wrong cell three layers away. Pin the
 * contract here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const FelixEngine = require('../felix-engine.js');
const {
  search, reverseSearch, concordanceSearch, glossarySearch,
  addEntry, addGlossaryEntry, parseA1, makeCmp,
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

// -------------------- search --------------------

test('search: empty / null inputs → empty array', () => {
  assert.deepEqual(search('', tm(['a', 'b']), 0.5), []);
  assert.deepEqual(search('hello', null, 0.5), []);
  assert.deepEqual(search('hello', [], 0.5), []);
});

test('search: exact match → score 1, returns the row', () => {
  const r = search('hello', tm(['hello', 'こんにちは']), 0.5);
  assert.equal(r.length, 1);
  assert.equal(r[0].score, 1);
  assert.equal(r[0].source, 'hello');
  assert.equal(r[0].target, 'こんにちは');
  assert.equal(r[0].tmIdx, 0);
});

test('search: width / case / kana folding via makeCmp', () => {
  // Query is full-width + uppercase; entry is half-width + lowercase.
  // makeCmp folds both to the same form → exact (score 1).
  const r = search('ＨＥＬＬＯ', tm(['hello', 'こんにちは']), 0.9);
  assert.equal(r.length, 1);
  assert.equal(r[0].score, 1);
});

test('search: candidates below minScore are filtered out', () => {
  // "abc" vs "xyz" — no shared chars, score 0.
  const r = search('abc', tm(['xyz', 'unrelated']), 0.5);
  assert.deepEqual(r, []);
});

test('search: results sorted by score descending', () => {
  // "hello world" vs candidates of varying similarity.
  const r = search('hello world', tm(
    ['totally different', 'a'],   // low / 0
    ['hello world', 'b'],         // 1.0 (exact)
    ['hello earth', 'c'],         // partial (~0.7)
  ), 0.3);
  // Exact match must come first.
  assert.equal(r[0].source, 'hello world');
  assert.equal(r[0].score, 1);
  // Unrelated entry got pre-filtered by bag/length, so we expect 1 or 2 hits.
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i].score <= r[i - 1].score, `score not descending at idx ${i}`);
  }
});

test('search: ties broken by refcount descending', () => {
  // Two identical-source entries with different refcounts. (Real
  // tmData wouldn't have dupes — but the tie-break exists for cmp-
  // equal sources written from different contexts.)
  const data = tm(['hello', 'A'], ['hello', 'B']);
  data[0].refcount = 0;
  data[1].refcount = 5;
  const r = search('hello', data, 0.5);
  assert.equal(r.length, 2);
  assert.equal(r[0].target, 'B', 'higher refcount should win the tie');
});

test('search: caps results at 20', () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(['hello', `t${i}`]);
  const r = search('hello', tm(...many), 0.5);
  assert.equal(r.length, 20);
});

test('search: uses pre-computed entry.cmp when available (avoids re-running makeCmp)', () => {
  // Mutate cmp to a value that does NOT equal makeCmp(source). If the
  // cached cmp is consulted, the search should match against THAT
  // form, not against re-normalized source. Here we make cmp differ
  // so an exact-on-source query doesn't score 1 — proves the cache
  // path is honored.
  const data = [{ source: 'hello', target: 'こんにちは', cmp: 'jello' }];
  const r = search('hello', data, 0.5);
  // 'hello' vs cached 'jello': edit distance 1, score 0.8 → matches at 0.5.
  assert.equal(r.length, 1);
  assert.equal(r[0].score, 0.8);
});

// -------------------- reverseSearch --------------------

test('reverseSearch: matches against target text, not source', () => {
  const r = reverseSearch('こんにちは', tm(['hello', 'こんにちは'], ['world', '世界']), 0.5);
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'hello');
  assert.equal(r[0].target, 'こんにちは');
});

test('reverseSearch: empty / null inputs → empty array', () => {
  assert.deepEqual(reverseSearch('', tm(['a', 'b']), 0.5), []);
  assert.deepEqual(reverseSearch('hi', [], 0.5), []);
});

test('reverseSearch: results sorted by score descending', () => {
  const r = reverseSearch('世界の中', tm(
    ['hello', 'unrelated'],
    ['world', '世界の中'],       // exact
    ['globe', '世界の外'],       // partial
  ), 0.3);
  assert.ok(r.length >= 1);
  assert.equal(r[0].target, '世界の中');
  assert.equal(r[0].score, 1);
});

test('reverseSearch: caches targetCmp', () => {
  const data = [{ source: 'hello', target: '世界', targetCmp: makeCmp('日本') }];
  // Cached targetCmp is "日本" (very different from "世界").
  // Querying "日本" should match (against the cache), not "世界".
  const r = reverseSearch('日本', data, 0.5);
  assert.equal(r.length, 1);
  assert.equal(r[0].score, 1);
});

// -------------------- concordanceSearch --------------------

test('concordanceSearch: empty / null inputs → empty array', () => {
  assert.deepEqual(concordanceSearch('', tm(['a', 'b']), 50), []);
  assert.deepEqual(concordanceSearch('hi', [], 50), []);
});

test('concordanceSearch: substring hit on source side', () => {
  const r = concordanceSearch('cat', tm(['the cat sat', 'a'], ['unrelated', 'b']), 50);
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'the cat sat');
  assert.equal(r[0].matchField, 'source');
});

test('concordanceSearch: substring hit on target side', () => {
  const r = concordanceSearch('猫', tm(['cat', '猫がいる'], ['dog', '犬']), 50);
  assert.equal(r.length, 1);
  assert.equal(r[0].matchField, 'target');
});

test('concordanceSearch: case-insensitive (ASCII)', () => {
  const r = concordanceSearch('CAT', tm(['the cat sat', 'a']), 50);
  assert.equal(r.length, 1);
});

test('concordanceSearch: maxResults caps the hit list', () => {
  const many = [];
  for (let i = 0; i < 100; i++) many.push(['the cat sat', `t${i}`]);
  const r = concordanceSearch('cat', tm(...many), 5);
  assert.equal(r.length, 5);
});

test('concordanceSearch: useRegex=true compiles the query as RegExp', () => {
  const r = concordanceSearch('c.t', tm(['cat', 'a'], ['cot', 'b'], ['dog', 'c']), 50, true);
  assert.equal(r.length, 2, 'cat and cot match c.t');
});

test('concordanceSearch: useRegex=true with invalid pattern returns empty (no throw)', () => {
  const r = concordanceSearch('[unclosed', tm(['cat', 'a']), 50, true);
  assert.deepEqual(r, []);
});

// -------------------- glossarySearch --------------------

test('glossarySearch: empty / null inputs → empty array', () => {
  assert.deepEqual(glossarySearch('', gloss(['hi', 'やあ']), 0.9), []);
  assert.deepEqual(glossarySearch('hello', [], 0.9), []);
});

test('glossarySearch: exact substring of term inside query → score 1', () => {
  const r = glossarySearch('the cat sat', gloss(['cat', '猫']), 0.9);
  assert.equal(r.length, 1);
  assert.equal(r[0].term, 'cat');
  assert.equal(r[0].score, 1);
});

test('glossarySearch: longest term first (greedy matching contract)', () => {
  const r = glossarySearch('attack damage up', gloss(
    ['up', 'アップ'],
    ['attack damage up', '攻撃ダメージアップ'],
    ['damage', 'ダメージ'],
  ), 0.9);
  assert.equal(r[0].term, 'attack damage up', 'longest first');
  assert.ok(r.length >= 2);
  assert.equal(r[1].term, 'damage', 'next longest');
});

test('glossarySearch: width / kana folding via makeCmp', () => {
  // Query has full-width digits, glossary term has half-width.
  const r = glossarySearch('ATK１２３％', gloss(['atk123%', 'ATK']), 0.9);
  assert.equal(r.length, 1);
});

test('glossarySearch: term not found in query → not returned', () => {
  const r = glossarySearch('hello world', gloss(['cat', '猫'], ['dog', '犬']), 0.9);
  assert.deepEqual(r, []);
});

// -------------------- addEntry --------------------

test('addEntry: new pair → "added", appended with cmp/targetCmp/refcount', () => {
  const data = [];
  const r = addEntry(data, 'hello', 'こんにちは');
  assert.equal(r, 'added');
  assert.equal(data.length, 1);
  assert.equal(data[0].source, 'hello');
  assert.equal(data[0].target, 'こんにちは');
  assert.equal(data[0].cmp, makeCmp('hello'));
  assert.equal(data[0].targetCmp, makeCmp('こんにちは'));
  assert.equal(data[0].refcount, 0);
});

test('addEntry: duplicate (same cmp source + cmp target) → "refcount", increments', () => {
  const data = [];
  addEntry(data, 'hello', 'こんにちは');
  const r = addEntry(data, 'hello', 'こんにちは');
  assert.equal(r, 'refcount');
  assert.equal(data.length, 1, 'no new row appended');
  assert.equal(data[0].refcount, 1);
});

test('addEntry: dedup honors normalization (full-width / case treated equal)', () => {
  const data = [];
  addEntry(data, 'hello', 'こんにちは');
  const r = addEntry(data, 'ＨＥＬＬＯ', 'こんにちは');
  assert.equal(r, 'refcount');
  assert.equal(data.length, 1);
});

test('addEntry: same source different target → both kept (not a dup)', () => {
  const data = [];
  addEntry(data, 'hello', 'こんにちは');
  const r = addEntry(data, 'hello', 'やあ');
  assert.equal(r, 'added');
  assert.equal(data.length, 2);
});

test('addEntry: stores context when given, defaults to empty string', () => {
  const data = [];
  addEntry(data, 'hello', 'こんにちは', 'greeting');
  assert.equal(data[0].context, 'greeting');
  addEntry(data, 'world', '世界');
  assert.equal(data[1].context, '');
});

// -------------------- addGlossaryEntry --------------------

test('addGlossaryEntry: new pair → "added", stores cmp/translationCmp', () => {
  const data = [];
  const r = addGlossaryEntry(data, 'cat', '猫');
  assert.equal(r, 'added');
  assert.equal(data.length, 1);
  assert.equal(data[0].cmp, makeCmp('cat'));
  assert.equal(data[0].translationCmp, makeCmp('猫'));
  assert.equal(data[0].notes, '');
});

test('addGlossaryEntry: duplicate (same cmp term + cmp translation) → "exists"', () => {
  const data = [];
  addGlossaryEntry(data, 'cat', '猫');
  const r = addGlossaryEntry(data, 'CAT', '猫');
  assert.equal(r, 'exists');
  assert.equal(data.length, 1);
});

test('addGlossaryEntry: same term different translation → both kept', () => {
  const data = [];
  addGlossaryEntry(data, 'attack', '攻撃');
  const r = addGlossaryEntry(data, 'attack', 'アタック');
  assert.equal(r, 'added');
  assert.equal(data.length, 2);
});

test('addGlossaryEntry: stores notes when given, defaults to empty string', () => {
  const data = [];
  addGlossaryEntry(data, 'cat', '猫', 'animal');
  assert.equal(data[0].notes, 'animal');
});

// -------------------- TM metadata extensions --------------------

test('addEntry: opts object form sets reliability / validated / createdBy', () => {
  const data = [];
  addEntry(data, 'hello', 'こんにちは', {
    context: 'greeting',
    createdBy: 'alice',
    reliability: 5,
    validated: true,
  });
  assert.equal(data[0].context, 'greeting');
  assert.equal(data[0].createdBy, 'alice');
  assert.equal(data[0].reliability, 5);
  assert.equal(data[0].validated, true);
});

test('addEntry: defaults — reliability 0, validated false, createdBy empty', () => {
  const data = [];
  addEntry(data, 'hi', 'やあ');
  assert.equal(data[0].reliability, 0);
  assert.equal(data[0].validated, false);
  assert.equal(data[0].createdBy, '');
  assert.equal(data[0].modifiedBy, '');
});

test('addEntry: created and modified default to now (Date)', () => {
  const before = Date.now();
  const data = [];
  addEntry(data, 'hi', 'やあ');
  const after = Date.now();
  assert.ok(data[0].created instanceof Date);
  assert.ok(data[0].modified instanceof Date);
  assert.ok(data[0].created.getTime() >= before && data[0].created.getTime() <= after);
});

test('addEntry: explicit Date opts respected (no overwrite with now)', () => {
  const ts = new Date('2024-01-15T08:30:00Z');
  const data = [];
  addEntry(data, 'hi', 'やあ', { created: ts, modified: ts });
  assert.equal(data[0].created.toISOString(), ts.toISOString());
  assert.equal(data[0].modified.toISOString(), ts.toISOString());
});

test('addEntry: refcount path bumps modified timestamp', async () => {
  const data = [];
  addEntry(data, 'hi', 'やあ', { modified: new Date('2020-01-01T00:00:00Z') });
  const before = data[0].modified.getTime();
  // Sleep a tick to ensure clock advances on fast machines.
  await new Promise(r => setTimeout(r, 5));
  const r = addEntry(data, 'hi', 'やあ');
  assert.equal(r, 'refcount');
  assert.equal(data[0].refcount, 1);
  assert.ok(data[0].modified.getTime() > before, 'modified bumped on refcount');
});

test('addEntry: refcount path with opts.modifiedBy updates that too', () => {
  const data = [];
  addEntry(data, 'hi', 'やあ', { modifiedBy: 'alice' });
  addEntry(data, 'hi', 'やあ', { modifiedBy: 'bob' });
  assert.equal(data[0].modifiedBy, 'bob', 'last writer wins on refcount');
});

test('addEntry: legacy string-as-context still works (backward compat)', () => {
  const data = [];
  addEntry(data, 'hi', 'やあ', 'a context string');
  assert.equal(data[0].context, 'a context string');
  // Defaults still applied:
  assert.equal(data[0].reliability, 0);
  assert.equal(data[0].validated, false);
});

test('addGlossaryEntry: opts object form sets metadata fields', () => {
  const data = [];
  addGlossaryEntry(data, 'cat', '猫', {
    notes: 'animal',
    reliability: 9,
    validated: true,
    createdBy: 'alice',
  });
  assert.equal(data[0].notes, 'animal');
  assert.equal(data[0].reliability, 9);
  assert.equal(data[0].validated, true);
  assert.equal(data[0].createdBy, 'alice');
});

test('addGlossaryEntry: legacy string-as-notes still works (backward compat)', () => {
  const data = [];
  addGlossaryEntry(data, 'cat', '猫', 'a note string');
  assert.equal(data[0].notes, 'a note string');
});

test('addGlossaryEntry: created and modified default to now', () => {
  const data = [];
  addGlossaryEntry(data, 'cat', '猫');
  assert.ok(data[0].created instanceof Date);
  assert.ok(data[0].modified instanceof Date);
});

// -------------------- parseA1 --------------------

test('parseA1: single cell A2 → col=A, row=2, no col2/row2', () => {
  assert.deepEqual(parseA1('A2'), { col: 'A', row: 2, col2: undefined, row2: undefined });
});

test('parseA1: range B5:B10 → col2/row2 set', () => {
  assert.deepEqual(parseA1('B5:B10'), { col: 'B', row: 5, col2: 'B', row2: 10 });
});

test('parseA1: column-only range A:A → row/row2 undefined', () => {
  assert.deepEqual(parseA1('A:A'), { col: 'A', row: undefined, col2: 'A', row2: undefined });
});

test('parseA1: open-ended range A2:A → row2 undefined', () => {
  assert.deepEqual(parseA1('A2:A'), { col: 'A', row: 2, col2: 'A', row2: undefined });
});

test('parseA1: lowercase column letters get uppercased', () => {
  assert.equal(parseA1('a2').col, 'A');
  assert.equal(parseA1('a2:b5').col2, 'B');
});

test('parseA1: multi-letter columns (AA, AZ) work', () => {
  assert.deepEqual(parseA1('AA10'), { col: 'AA', row: 10, col2: undefined, row2: undefined });
});

test('parseA1: invalid / non-string input → null', () => {
  assert.equal(parseA1(''), null);
  assert.equal(parseA1(null), null);
  assert.equal(parseA1(undefined), null);
  assert.equal(parseA1(123), null);
  assert.equal(parseA1('not a ref'), null);
  assert.equal(parseA1('123'), null, 'pure digits is not a valid A1 ref');
});
