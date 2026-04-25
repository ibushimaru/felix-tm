/**
 * TMX 1.4 import / export.
 *
 * Pins parseTmx and serializeTmx behavior — round-trip integrity,
 * language auto-detection, attribute carry-over, inline-tag stripping
 * inside <seg>, and the XML entity escape/unescape contract.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseTmx, serializeTmx } = require('../felix-engine.js');

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<tmx version="1.4">\n';
const FOOT = '</tmx>\n';

// -------------------- parseTmx --------------------

test('parseTmx: basic two-language TU', () => {
  const xml = HEAD
    + '<header srclang="en" datatype="plaintext"/>\n'
    + '<body>\n'
    + '  <tu>\n'
    + '    <tuv xml:lang="en"><seg>hello</seg></tuv>\n'
    + '    <tuv xml:lang="ja"><seg>こんにちは</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n' + FOOT;

  const r = parseTmx(xml);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].source, 'hello');
  assert.equal(r.records[0].target, 'こんにちは');
  assert.equal(r.sourceLang, 'en');
  assert.equal(r.targetLang, 'ja');
});

test('parseTmx: empty body → no records', () => {
  const xml = HEAD + '<body></body>\n' + FOOT;
  const r = parseTmx(xml);
  assert.deepEqual(r.records, []);
});

test('parseTmx: TU with single TUV is skipped (need a pair)', () => {
  const xml = HEAD + '<body>\n  <tu><tuv xml:lang="en"><seg>orphan</seg></tuv></tu>\n</body>\n' + FOOT;
  const r = parseTmx(xml);
  assert.deepEqual(r.records, []);
});

test('parseTmx: lang auto-detect when no header srclang and no opts', () => {
  const xml = '<?xml version="1.0"?>\n<tmx version="1.4">\n<body>\n'
    + '  <tu>\n'
    + '    <tuv xml:lang="fr"><seg>chat</seg></tuv>\n'
    + '    <tuv xml:lang="de"><seg>Katze</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n</tmx>\n';
  const r = parseTmx(xml);
  assert.equal(r.records.length, 1);
  assert.equal(r.sourceLang, 'fr', 'first lang seen becomes the source default');
  assert.equal(r.targetLang, 'de');
  assert.equal(r.records[0].source, 'chat');
  assert.equal(r.records[0].target, 'Katze');
});

test('parseTmx: explicit opts.sourceLang / opts.targetLang override auto-detect', () => {
  const xml = HEAD
    + '<header srclang="en"/>\n'
    + '<body>\n'
    + '  <tu>\n'
    + '    <tuv xml:lang="en"><seg>hello</seg></tuv>\n'
    + '    <tuv xml:lang="ja"><seg>こんにちは</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml, { sourceLang: 'ja', targetLang: 'en' });
  assert.equal(r.records[0].source, 'こんにちは');
  assert.equal(r.records[0].target, 'hello');
});

test('parseTmx: lang variants — "en" matches "en-US"', () => {
  const xml = HEAD + '<body>\n'
    + '  <tu>\n'
    + '    <tuv xml:lang="en-US"><seg>color</seg></tuv>\n'
    + '    <tuv xml:lang="en-GB"><seg>colour</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml, { sourceLang: 'en' });
  assert.equal(r.records[0].source, 'color', 'first en-* matched as source');
  assert.equal(r.records[0].target, 'colour', 'second en-* picked as target');
});

test('parseTmx: TU attributes carry over (creationdate, changedate, ids, usagecount)', () => {
  const xml = HEAD + '<body>\n'
    + '  <tu creationdate="20250101T120000Z" changedate="20250115T093000Z"'
    + ' creationid="alice" changeid="bob" usagecount="7">\n'
    + '    <tuv xml:lang="en"><seg>hi</seg></tuv>\n'
    + '    <tuv xml:lang="ja"><seg>やあ</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml);
  const rec = r.records[0];
  assert.equal(rec.createdBy, 'alice');
  assert.equal(rec.modifiedBy, 'bob');
  assert.equal(rec.refcount, 7);
  assert.ok(rec.created instanceof Date);
  assert.equal(rec.created.toISOString(), '2025-01-01T12:00:00.000Z');
  assert.equal(rec.modified.toISOString(), '2025-01-15T09:30:00.000Z');
});

test('parseTmx: x-context prop attaches to record.context', () => {
  const xml = HEAD + '<body>\n'
    + '  <tu>\n'
    + '    <prop type="x-context">UI button label</prop>\n'
    + '    <tuv xml:lang="en"><seg>Save</seg></tuv>\n'
    + '    <tuv xml:lang="ja"><seg>保存</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml);
  assert.equal(r.records[0].context, 'UI button label');
});

test('parseTmx: inline tags inside <seg> are stripped to text', () => {
  const xml = HEAD + '<body>\n'
    + '  <tu>\n'
    + '    <tuv xml:lang="en"><seg>Click <bpt i="1">[</bpt>here<ept i="1">]</ept> to <ph>{0}</ph></seg></tuv>\n'
    + '    <tuv xml:lang="ja"><seg><bpt i="1">[</bpt>こちら<ept i="1">]</ept>をクリック</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml);
  assert.equal(r.records[0].source, 'Click [here] to {0}');
  assert.equal(r.records[0].target, '[こちら]をクリック');
});

test('parseTmx: XML entities decoded', () => {
  const xml = HEAD + '<body>\n'
    + '  <tu>\n'
    + '    <tuv xml:lang="en"><seg>A &amp; B &lt;tag&gt;</seg></tuv>\n'
    + '    <tuv xml:lang="ja"><seg>A&amp;B</seg></tuv>\n'
    + '  </tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml);
  assert.equal(r.records[0].source, 'A & B <tag>');
  assert.equal(r.records[0].target, 'A&B');
});

test('parseTmx: multiple TUs all collected in order', () => {
  const xml = HEAD + '<body>\n'
    + '  <tu><tuv xml:lang="en"><seg>one</seg></tuv><tuv xml:lang="ja"><seg>1</seg></tuv></tu>\n'
    + '  <tu><tuv xml:lang="en"><seg>two</seg></tuv><tuv xml:lang="ja"><seg>2</seg></tuv></tu>\n'
    + '  <tu><tuv xml:lang="en"><seg>three</seg></tuv><tuv xml:lang="ja"><seg>3</seg></tuv></tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml);
  assert.equal(r.records.length, 3);
  assert.deepEqual(r.records.map(x => x.source), ['one', 'two', 'three']);
});

test('parseTmx: missing changedate gives null modified, not now', () => {
  const xml = HEAD + '<body>\n'
    + '  <tu><tuv xml:lang="en"><seg>x</seg></tuv><tuv xml:lang="ja"><seg>y</seg></tuv></tu>\n'
    + '</body>\n' + FOOT;
  const r = parseTmx(xml);
  assert.equal(r.records[0].modified, null);
  assert.equal(r.records[0].created, null);
});

// -------------------- serializeTmx --------------------

test('serializeTmx: minimal record set produces valid TMX', () => {
  const xml = serializeTmx(
    [{ source: 'hello', target: 'こんにちは' }],
    { sourceLang: 'en', targetLang: 'ja' },
  );
  assert.ok(xml.startsWith('<?xml version="1.0"'), 'XML decl present');
  assert.ok(xml.includes('<tmx version="1.4">'));
  assert.ok(xml.includes('srclang="EN"'), 'header srclang upper-cased');
  assert.ok(xml.includes('<tuv xml:lang="en"><seg>hello</seg></tuv>'));
  assert.ok(xml.includes('<tuv xml:lang="ja"><seg>こんにちは</seg></tuv>'));
  assert.ok(xml.endsWith('</tmx>\n'));
});

test('serializeTmx: empty record list still produces a valid (empty body) document', () => {
  const xml = serializeTmx([], { sourceLang: 'en', targetLang: 'ja' });
  assert.ok(xml.includes('<body>'));
  assert.ok(xml.includes('</body>'));
  // Round-trip: parseTmx should yield zero records.
  assert.deepEqual(parseTmx(xml).records, []);
});

test('serializeTmx: XML entity escape in seg text', () => {
  const xml = serializeTmx(
    [{ source: 'A & B <tag>', target: 'A&B' }],
    { sourceLang: 'en', targetLang: 'ja' },
  );
  assert.ok(xml.includes('A &amp; B &lt;tag&gt;'));
  assert.ok(xml.includes('A&amp;B'));
});

test('serializeTmx: TU attrs only emitted when present', () => {
  const xml = serializeTmx(
    [{ source: 'x', target: 'y' }],
    { sourceLang: 'en', targetLang: 'ja' },
  );
  // No creationid="" or usagecount="0" noise when fields are absent.
  assert.ok(!xml.includes('creationid='));
  assert.ok(!xml.includes('changeid='));
  assert.ok(!xml.includes('usagecount='));
  assert.ok(!xml.includes('creationdate='));
});

test('serializeTmx: TU attrs emitted when present', () => {
  const xml = serializeTmx([{
    source: 'hi', target: 'やあ',
    createdBy: 'alice', modifiedBy: 'bob', refcount: 5,
    created: new Date(Date.UTC(2025, 0, 1, 12, 0, 0)),
    modified: new Date(Date.UTC(2025, 0, 15, 9, 30, 0)),
  }], { sourceLang: 'en', targetLang: 'ja' });
  assert.ok(xml.includes('creationid="alice"'));
  assert.ok(xml.includes('changeid="bob"'));
  assert.ok(xml.includes('usagecount="5"'));
  assert.ok(xml.includes('creationdate="20250101T120000Z"'));
  assert.ok(xml.includes('changedate="20250115T093000Z"'));
});

test('serializeTmx: context surfaces as <prop type="x-context">', () => {
  const xml = serializeTmx(
    [{ source: 'Save', target: '保存', context: 'UI button label' }],
    { sourceLang: 'en', targetLang: 'ja' },
  );
  assert.ok(xml.includes('<prop type="x-context">UI button label</prop>'));
});

// -------------------- round-trip --------------------

test('round-trip: serialize → parse preserves source / target / context', () => {
  const records = [
    { source: 'hello', target: 'こんにちは', context: 'greeting' },
    { source: 'A & B', target: 'A＆B' },
    { source: 'multi\nline', target: '改行\nあり' },
  ];
  const xml = serializeTmx(records, { sourceLang: 'en', targetLang: 'ja' });
  const r = parseTmx(xml);
  assert.equal(r.records.length, 3);
  for (let i = 0; i < records.length; i++) {
    assert.equal(r.records[i].source, records[i].source, `source idx ${i}`);
    assert.equal(r.records[i].target, records[i].target, `target idx ${i}`);
  }
  assert.equal(r.records[0].context, 'greeting');
});

test('round-trip: serialize → parse preserves audit metadata', () => {
  const created = new Date(Date.UTC(2024, 5, 10, 8, 15, 30));
  const modified = new Date(Date.UTC(2025, 0, 20, 14, 45, 0));
  const records = [{
    source: 'x', target: 'y',
    createdBy: 'alice', modifiedBy: 'bob', refcount: 12,
    created, modified,
  }];
  const xml = serializeTmx(records, { sourceLang: 'en', targetLang: 'ja' });
  const r = parseTmx(xml);
  const rec = r.records[0];
  assert.equal(rec.createdBy, 'alice');
  assert.equal(rec.modifiedBy, 'bob');
  assert.equal(rec.refcount, 12);
  assert.equal(rec.created.toISOString(), created.toISOString());
  assert.equal(rec.modified.toISOString(), modified.toISOString());
});
