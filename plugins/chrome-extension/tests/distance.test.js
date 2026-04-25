/**
 * Unit tests for the pure distance / score primitives.
 *
 * These functions are the bedrock the whole TM stack rests on:
 * fuzzyScore → search → ranking → auto-translate. If any of them drifts
 * silently, the regression-driven scenario tests in the other files
 * will only catch it once it manifests in a specific cell — by which
 * point bisecting back to the math is painful. Pin the math here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const FelixEngine = require('../felix-engine.js');
const { editDistance, bagDistance, edScore, fuzzyScore } = FelixEngine;

// -------------------- editDistance --------------------

test('editDistance: identical strings → 0', () => {
  assert.equal(editDistance('hello', 'hello'), 0);
  assert.equal(editDistance('', ''), 0);
  assert.equal(editDistance('日本語', '日本語'), 0);
});

test('editDistance: one empty side → length of the other', () => {
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('abcd', ''), 4);
});

test('editDistance: single substitution / insertion / deletion', () => {
  assert.equal(editDistance('cat', 'bat'), 1, 'substitution');
  assert.equal(editDistance('cat', 'cats'), 1, 'insertion');
  assert.equal(editDistance('cats', 'cat'), 1, 'deletion');
});

test('editDistance: classic kitten → sitting = 3', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
});

test('editDistance: prefix and suffix trimming preserves correctness', () => {
  // "abXYef" vs "abZWef" — common prefix "ab", suffix "ef", inner "XY" vs "ZW"
  assert.equal(editDistance('abXYef', 'abZWef'), 2);
});

test('editDistance: single-char path (n2 === 1) handles char-in / char-out', () => {
  assert.equal(editDistance('a', 'bac'), 2, 'a appears in bac → distance 2');
  assert.equal(editDistance('a', 'bcd'), 3, 'a not in bcd → distance 3 (full m2)');
});

test('editDistance: maxD early termination returns maxD+1, not the true distance', () => {
  // True distance of "abcdefgh" vs "stuvwxyz" is 8. With maxD=2 the
  // function bails out and returns 3 (maxD + 1) — the caller's signal
  // to stop scoring.
  const d = editDistance('abcdefgh', 'stuvwxyz', 2);
  assert.equal(d, 3);
});

test('editDistance: maxD that exceeds true distance still returns the truth', () => {
  assert.equal(editDistance('cat', 'bat', 5), 1);
});

test('editDistance: CJK characters counted per code point', () => {
  // Each CJK char is one unit; "猫" → "犬" is one substitution.
  assert.equal(editDistance('猫', '犬'), 1);
  assert.equal(editDistance('日本語', '中国語'), 2);
});

// -------------------- bagDistance --------------------

test('bagDistance: identical strings → 0', () => {
  assert.equal(bagDistance('hello', 'hello'), 0);
  assert.equal(bagDistance('', ''), 0);
});

test('bagDistance: anagrams → 0 (positions ignored)', () => {
  assert.equal(bagDistance('listen', 'silent'), 0);
  assert.equal(bagDistance('abc', 'cba'), 0);
});

test('bagDistance: one extra char on one side → 1', () => {
  assert.equal(bagDistance('cat', 'cats'), 1);
  assert.equal(bagDistance('cats', 'cat'), 1);
});

test('bagDistance: completely disjoint sets → length of both', () => {
  // s contributes +3 (a,b,c), t contributes -3 (x,y,z). Total |Δ| = 6.
  assert.equal(bagDistance('abc', 'xyz'), 6);
});

test('bagDistance: substitution shows as 2 (one removed, one added)', () => {
  // "cat" vs "bat": -c +b → 2
  assert.equal(bagDistance('cat', 'bat'), 2);
});

test('bagDistance: never exceeds editDistance × 2 (multiset triangle property)', () => {
  // bagDistance is a fast lower-bound used as a pre-filter for
  // editDistance. It must never reject a row that editDistance would
  // accept — so for any pair, bagDistance ≤ 2 * editDistance.
  const pairs = [
    ['hello', 'world'],
    ['kitten', 'sitting'],
    ['', 'abc'],
    ['translation', 'transformation'],
  ];
  for (const [a, b] of pairs) {
    const bd = bagDistance(a, b);
    const ed = editDistance(a, b);
    assert.ok(bd <= 2 * ed, `bag(${bd}) > 2*edit(${ed}) for "${a}" vs "${b}"`);
  }
});

// -------------------- edScore --------------------

test('edScore: identical strings → 1.0', () => {
  assert.equal(edScore('hello', 'hello'), 1);
  assert.equal(edScore('', ''), 1);
});

test('edScore: one empty side → 0', () => {
  assert.equal(edScore('hello', ''), 0);
  assert.equal(edScore('', 'hello'), 0);
});

test('edScore: single substitution in a 5-char string → 0.8', () => {
  // distance 1, max length 5, score = (5-1)/5 = 0.8
  assert.equal(edScore('hello', 'jello'), 0.8);
});

test('edScore: distance 3 in a 7-char string → ~0.571', () => {
  const s = edScore('kitten', 'sitting');
  // (7 - 3) / 7
  assert.ok(Math.abs(s - (4 / 7)) < 1e-9, `expected ~${4/7}, got ${s}`);
});

test('edScore: minScore early-out returns 0 when too far apart', () => {
  // "abcdefgh" vs "stuvwxyz" — distance 8, max length 8, score 0.
  // With minScore=0.5 the function bails through editDistance(maxD=4),
  // sees d > maxD, and returns 0 explicitly.
  assert.equal(edScore('abcdefgh', 'stuvwxyz', 0.5), 0);
});

test('edScore: minScore tolerated when within budget', () => {
  // "hello" vs "jello": distance 1, max 5, score 0.8 — well above 0.5.
  assert.equal(edScore('hello', 'jello', 0.5), 0.8);
});

// -------------------- fuzzyScore --------------------

test('fuzzyScore: identical → 1, no scoring done', () => {
  assert.equal(fuzzyScore('hello', 'hello', 0.5), 1);
  assert.equal(fuzzyScore('', '', 0.5), 1);
});

test('fuzzyScore: length pre-filter rejects when min/max ratio < minScore', () => {
  // "a" (len 1) vs "abcdefghij" (len 10): min/max = 0.1, below 0.5.
  assert.equal(fuzzyScore('a', 'abcdefghij', 0.5), 0);
});

test('fuzzyScore: bag pre-filter rejects when char overlap too low', () => {
  // Same length, completely disjoint chars → bagDistance = 2*len,
  // (h - bag)/h = -1, well below any positive minScore.
  assert.equal(fuzzyScore('aaaa', 'bbbb', 0.5), 0);
});

test('fuzzyScore: CJK / no-space input routes through edScore (char level)', () => {
  // No spaces, contains CJK → char-level edit distance. Pick a pair
  // that survives the bag pre-filter: "日本語のテスト" vs
  // "中本語のテスト" — bag distance 2 over h=7, (7-2)/7≈0.71 > 0.5.
  // editDistance is 1 → edScore = (7-1)/7 = 6/7.
  const s = fuzzyScore('日本語のテスト', '中本語のテスト', 0.5);
  assert.ok(Math.abs(s - (6 / 7)) < 1e-9, `expected 6/7, got ${s}`);
});

test('fuzzyScore: spaced western input routes through wordScore', () => {
  // Has spaces, no CJK → wordScore tokenizes on whitespace/punctuation.
  // "the cat sat" vs "the dog sat" — bag distance 6 over h=11,
  // (11-6)/11 ≈ 0.454, so use minScore=0.3 to clear the bag pre-filter.
  // wordScore: 3 tokens, one swap (cat→dog completely different) at
  // cost 1, total distance 1 → (3-1)/3 = 2/3.
  const s = fuzzyScore('the cat sat', 'the dog sat', 0.3);
  assert.ok(Math.abs(s - (2 / 3)) < 1e-9, `expected 2/3, got ${s}`);
});

test('fuzzyScore: bag pre-filter is the first hard cutoff (not the post-score check)', () => {
  // "hello" vs "jello" — bag distance 2 over h=5, so bag-pass score
  // is (5-2)/5 = 0.6. edScore would be 0.8, but at minScore > 0.6 the
  // bag pre-filter rejects before edScore is ever called.
  assert.equal(fuzzyScore('hello', 'jello', 0.6), 0.8,
    'bag passes (0.6 == 0.6), edScore returns 0.8');
  assert.equal(fuzzyScore('hello', 'jello', 0.61), 0,
    'bag pre-filter cuts at 0.6, score not even computed');
});

test('fuzzyScore: empty inputs both → length-0 short-circuit returns 1', () => {
  // h === 0 path. Documents the contract; callers should normally
  // refuse to fuzzy-search empty queries upstream.
  assert.equal(fuzzyScore('', '', 0.99), 1);
});
