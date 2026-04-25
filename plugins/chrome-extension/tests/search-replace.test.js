/**
 * Tagged Search / Replace (Felix Manual Ch.4.5).
 *
 * Three functions:
 *   parseQuery(expr)       — tokenize a search string into tag/value/regex
 *   searchAndReplace(tm, expr)  — find matching records (read-only)
 *   applyReplace(tm, from, to)  — mutate matching fields in place
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseQuery, searchAndReplace, applyReplace, makeCmp,
} = require('../felix-engine.js');

function rec(extras) {
  return Object.assign({
    source: '', target: '', context: '',
    createdBy: '', modifiedBy: '',
    refcount: 0, reliability: 0, validated: false,
    created: null, modified: null,
    cmp: '', targetCmp: '',
  }, extras || {});
}

// -------------------- parseQuery --------------------

test('parseQuery: bare text → no tag, value carries through', () => {
  assert.deepEqual(parseQuery('hello'), {
    tag: null, field: null, value: 'hello', regex: false, fieldStar: false,
  });
});

test('parseQuery: source: tag binds to source field', () => {
  const q = parseQuery('source:cat');
  assert.equal(q.tag, 'source');
  assert.equal(q.field, 'source');
  assert.equal(q.value, 'cat');
});

test('parseQuery: trans: tag aliases to target field', () => {
  const q = parseQuery('trans:foo');
  assert.equal(q.tag, 'trans');
  assert.equal(q.field, 'target');
});

test('parseQuery: target: tag also maps to target field', () => {
  assert.equal(parseQuery('target:foo').field, 'target');
});

test('parseQuery: regex: tag does NOT bind to a field', () => {
  const q = parseQuery('regex:foo\\d+');
  assert.equal(q.tag, 'regex');
  assert.equal(q.field, null);
  assert.equal(q.regex, true);
  assert.equal(q.value, 'foo\\d+');
});

test('parseQuery: <field>:* sets fieldStar flag', () => {
  const q = parseQuery('source:*');
  assert.equal(q.fieldStar, true);
  assert.equal(q.field, 'source');
  assert.equal(q.value, '');
});

test('parseQuery: unknown tag is treated as plain text', () => {
  // Felix does not document a "foo:" tag; we treat the whole string
  // as a literal search rather than guessing.
  const q = parseQuery('unknownTag:value');
  assert.equal(q.tag, null);
  assert.equal(q.value, 'unknownTag:value');
});

test('parseQuery: empty input → safe defaults', () => {
  const q = parseQuery('');
  assert.equal(q.tag, null);
  assert.equal(q.value, '');
});

// -------------------- searchAndReplace (read-only find) --------------------

test('searchAndReplace: bare text finds across source/target/context', () => {
  const tm = [
    rec({ source: 'the cat sat', target: 'a' }),
    rec({ source: 'unrelated', target: '猫がいる' }),
    rec({ source: 'unrelated', target: 'no cat here', context: 'about a cat' }),
  ];
  const r = searchAndReplace(tm, 'cat');
  assert.equal(r.length, 2);
  assert.equal(r[0].matchField, 'source');
  assert.equal(r[1].matchField, 'target');
});

test('searchAndReplace: source: tag restricts to source field', () => {
  const tm = [
    rec({ source: 'cat', target: 'cat' }),
    rec({ source: 'dog', target: 'cat' }),
  ];
  const r = searchAndReplace(tm, 'source:cat');
  assert.equal(r.length, 1);
  assert.equal(r[0].matchField, 'source');
});

test('searchAndReplace: trans: tag restricts to target field', () => {
  const tm = [
    rec({ source: 'cat', target: 'a' }),
    rec({ source: 'dog', target: 'cat' }),
  ];
  const r = searchAndReplace(tm, 'trans:cat');
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'dog');
});

test('searchAndReplace: case-insensitive via cmpLen', () => {
  const tm = [rec({ source: 'CAT', target: 'a' })];
  assert.equal(searchAndReplace(tm, 'cat').length, 1);
  assert.equal(searchAndReplace(tm, 'Cat').length, 1);
  assert.equal(searchAndReplace(tm, 'CAT').length, 1);
});

test('searchAndReplace: width-insensitive via cmpLen', () => {
  const tm = [rec({ source: 'ＡＢＣ', target: 'a' })];
  assert.equal(searchAndReplace(tm, 'abc').length, 1);
});

test('searchAndReplace: regex: tag uses RegExp', () => {
  const tm = [
    rec({ source: 'order 123', target: 'a' }),
    rec({ source: 'order abc', target: 'b' }),
  ];
  const r = searchAndReplace(tm, 'regex:order \\d+');
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'order 123');
});

test('searchAndReplace: invalid regex returns empty (no throw)', () => {
  const tm = [rec({ source: 'a' })];
  assert.deepEqual(searchAndReplace(tm, 'regex:[unclosed'), []);
});

test('searchAndReplace: created-by: filters by createdBy field', () => {
  const tm = [
    rec({ source: 'a', createdBy: 'alice' }),
    rec({ source: 'b', createdBy: 'bob' }),
  ];
  const r = searchAndReplace(tm, 'created-by:alice');
  assert.equal(r.length, 1);
  assert.equal(r[0].createdBy, 'alice');
});

test('searchAndReplace: empty / null tm → empty array (no throw)', () => {
  assert.deepEqual(searchAndReplace([], 'x'), []);
  assert.deepEqual(searchAndReplace(null, 'x'), []);
});

// -------------------- applyReplace (mutating) --------------------

test('applyReplace: substring replace across all text fields', () => {
  const tm = [
    rec({ source: 'cat sat', target: 'a cat', context: 'about cats' }),
    rec({ source: 'dog', target: 'inu' }),
  ];
  const r = applyReplace(tm, 'cat', 'feline');
  assert.equal(r.changed, 1, 'one record changed (the dog row had no cat)');
  assert.equal(tm[0].source, 'feline sat');
  assert.equal(tm[0].target, 'a feline');
  assert.equal(tm[0].context, 'about felines');
  assert.equal(tm[1].source, 'dog', 'dog row untouched');
});

test('applyReplace: source: tag only edits source field', () => {
  const tm = [rec({ source: 'cat', target: 'cat', context: 'cat' })];
  applyReplace(tm, 'source:cat', 'dog');
  assert.equal(tm[0].source, 'dog');
  assert.equal(tm[0].target, 'cat');
  assert.equal(tm[0].context, 'cat');
});

test('applyReplace: <field>:* overwrites entire field on every record', () => {
  const tm = [
    rec({ source: 'a', createdBy: 'alice' }),
    rec({ source: 'b', createdBy: 'bob' }),
  ];
  const r = applyReplace(tm, 'created-by:*', 'Ryan');
  assert.equal(r.changed, 2);
  assert.equal(tm[0].createdBy, 'Ryan');
  assert.equal(tm[1].createdBy, 'Ryan');
});

test('applyReplace: case-insensitive substring substitution', () => {
  const tm = [rec({ source: 'CAT and Cat and cat' })];
  applyReplace(tm, 'cat', 'dog');
  assert.equal(tm[0].source, 'dog and dog and dog');
});

test('applyReplace: regex: tag replaces with capture-group syntax', () => {
  const tm = [rec({ source: 'price 1234 yen', target: 'a' })];
  applyReplace(tm, 'regex:(\\d+) yen', '¥$1');
  assert.equal(tm[0].source, 'price ¥1234');
});

test('applyReplace: numeric field-replace coerces value', () => {
  const tm = [
    rec({ source: 'a', refcount: 0 }),
    rec({ source: 'b', refcount: 0 }),
  ];
  applyReplace(tm, 'refcount:*', '5');
  assert.equal(tm[0].refcount, 5);
  assert.equal(tm[1].refcount, 5);
  assert.equal(typeof tm[0].refcount, 'number');
});

test('applyReplace: boolean field-replace coerces "true"/"false"', () => {
  const tm = [rec({ source: 'a', validated: false })];
  applyReplace(tm, 'validated:*', 'true');
  assert.equal(tm[0].validated, true);
  applyReplace(tm, 'validated:*', 'false');
  assert.equal(tm[0].validated, false);
});

test('applyReplace: equality match on numeric field updates only matching records', () => {
  const tm = [
    rec({ source: 'a', reliability: 5 }),
    rec({ source: 'b', reliability: 3 }),
    rec({ source: 'c', reliability: 5 }),
  ];
  const r = applyReplace(tm, 'reliability:5', '0');
  assert.equal(r.changed, 2);
  assert.equal(tm[0].reliability, 0);
  assert.equal(tm[1].reliability, 3, 'unchanged because it was 3, not 5');
  assert.equal(tm[2].reliability, 0);
});

test('applyReplace: text not found → no change reported', () => {
  const tm = [rec({ source: 'cat' })];
  const r = applyReplace(tm, 'horse', 'unicorn');
  assert.equal(r.changed, 0);
  assert.equal(tm[0].source, 'cat');
});

test('applyReplace: empty tm → 0 changed (no throw)', () => {
  assert.deepEqual(applyReplace([], 'x', 'y'), { changed: 0, scannedFields: 0 });
  assert.deepEqual(applyReplace(null, 'x', 'y'), { changed: 0, scannedFields: 0 });
});
