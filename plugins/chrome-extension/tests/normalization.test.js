/**
 * Unit tests for the string normalization layer.
 *
 *   cmpLen  — length-preserving 1-to-1 char folds. Used wherever a
 *             position (indexOf / substring / DP alignment) must
 *             remain valid on the original string.
 *   makeCmp — whole-string equality form. Adds tag stripping and
 *             whitespace collapsing (both length-changing).
 *
 * Every fold gets its own test so a regression points straight at the
 * line that broke. Indirect coverage via the placement scenarios is
 * not enough — there it shows up as "wrong cell content" three layers
 * away from the actual fold.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cmpLen, makeCmp, containsCJK } = require('../felix-engine.js');

// -------------------- cmpLen: each fold in isolation --------------------

test('cmpLen: full-width ASCII → half-width', () => {
  assert.equal(cmpLen('ＡＢＣ１２３％'), 'abc123%');
  assert.equal(cmpLen('Ｈｅｌｌｏ'), 'hello');
});

test('cmpLen: ideographic space U+3000 → ASCII space', () => {
  assert.equal(cmpLen('a　b'), 'a b');
  assert.equal(cmpLen('　　'), '  ');
});

test('cmpLen: hiragana → katakana (range U+3041..U+3096 + 0x60)', () => {
  assert.equal(cmpLen('あいうえお'), 'アイウエオ');
  assert.equal(cmpLen('ひらがな'), 'ヒラガナ');
  // Boundary chars
  assert.equal(cmpLen('ぁ'), 'ァ', 'low boundary U+3041');
  assert.equal(cmpLen('ゖ'), 'ヶ', 'high boundary U+3096');
});

test('cmpLen: lowercase ASCII letters', () => {
  assert.equal(cmpLen('Hello WORLD'), 'hello world');
});

test('cmpLen: katakana is left untouched (already in target form)', () => {
  assert.equal(cmpLen('カタカナ'), 'カタカナ');
});

test('cmpLen: kanji and other CJK are not folded', () => {
  assert.equal(cmpLen('日本語'), '日本語');
  assert.equal(cmpLen('東京タワー'), '東京タワー');
});

test('cmpLen: combinations apply in defined order (width → space → kana → case)', () => {
  // Full-width L → l, full-width space → space, hira → kata
  assert.equal(cmpLen('Ｌａｔｉｎ　あ'), 'latin ア');
});

test('cmpLen: result length equals input length (length preservation contract)', () => {
  const samples = [
    'Hello, World!',
    'ＡＢＣ１２３',
    '日本語のテキスト',
    'あいうえお かきくけこ',
    'mixed 全角 with ＡＳＣＩＩ and ひら',
    '',
  ];
  for (const s of samples) {
    const got = cmpLen(s);
    assert.equal([...got].length, [...s].length,
      `cmpLen("${s}") changed code-point length: ${[...s].length} → ${[...got].length}`);
  }
});

test('cmpLen: empty / non-string inputs are coerced safely', () => {
  assert.equal(cmpLen(''), '');
  assert.equal(cmpLen(null), 'null');
  assert.equal(cmpLen(undefined), 'undefined');
  assert.equal(cmpLen(123), '123');
});

test('cmpLen: does NOT strip HTML-like tags (that is makeCmp territory)', () => {
  assert.equal(cmpLen('<b>hi</b>'), '<b>hi</b>');
});

test('cmpLen: does NOT collapse whitespace runs (that is makeCmp territory)', () => {
  assert.equal(cmpLen('a    b'), 'a    b');
  assert.equal(cmpLen('a\t\tb'), 'a\t\tb');
});

// -------------------- makeCmp: equality form --------------------

test('makeCmp: applies all cmpLen folds', () => {
  assert.equal(makeCmp('ＡＢＣ'), 'abc');
  assert.equal(makeCmp('あいう'), 'アイウ');
  assert.equal(makeCmp('Ｈｅｌｌｏ'), 'hello');
});

test('makeCmp: strips HTML-like tags', () => {
  assert.equal(makeCmp('<b>hello</b>'), 'hello');
  assert.equal(makeCmp('a <span class="x">b</span> c'), 'a b c');
});

test('makeCmp: collapses any whitespace run to a single ASCII space', () => {
  assert.equal(makeCmp('a    b'), 'a b');
  assert.equal(makeCmp('a\t\tb'), 'a b');
  assert.equal(makeCmp('a\n\nb'), 'a b');
  assert.equal(makeCmp('a　　b'), 'a b', 'ideographic space normalized then collapsed');
});

test('makeCmp: trims leading and trailing whitespace', () => {
  assert.equal(makeCmp('  hello  '), 'hello');
  assert.equal(makeCmp('\n\thello\n'), 'hello');
});

test('makeCmp: tag strip happens before width / kana folds (so ＜＞ are not stripped)', () => {
  // Full-width <> are kept by the tag strip, then folded to half-width
  // by cmpLen → final form contains literal "<...>".
  assert.equal(makeCmp('＜b＞hi＜/b＞'), '<b>hi</b>',
    'full-width <b> survives tag-strip, then folds to ASCII');
});

test('makeCmp: empty input → empty', () => {
  assert.equal(makeCmp(''), '');
  assert.equal(makeCmp('   '), '');
  assert.equal(makeCmp('<br/>'), '');
});

test('makeCmp: idempotent — applying twice yields the same result', () => {
  const samples = [
    'Hello World',
    '日本語のテキスト',
    'あいう ＡＢＣ',
    '<i>tag</i> and  spaces',
  ];
  for (const s of samples) {
    const once = makeCmp(s);
    const twice = makeCmp(once);
    assert.equal(twice, once, `not idempotent for "${s}": "${once}" → "${twice}"`);
  }
});

// -------------------- containsCJK --------------------

test('containsCJK: kanji / hiragana / katakana / ideographic space all detected', () => {
  assert.equal(containsCJK('日本語'), true);
  assert.equal(containsCJK('ひらがな'), true);
  assert.equal(containsCJK('カタカナ'), true);
  assert.equal(containsCJK('a　b'), true, 'U+3000 ideographic space alone');
});

test('containsCJK: pure ASCII / Latin → false', () => {
  assert.equal(containsCJK('Hello, World!'), false);
  assert.equal(containsCJK('café'), false, 'Latin-1 supplement is not CJK');
  assert.equal(containsCJK(''), false);
});

test('containsCJK: a single CJK char in mixed text is enough', () => {
  assert.equal(containsCJK('Hello 日 World'), true);
});
