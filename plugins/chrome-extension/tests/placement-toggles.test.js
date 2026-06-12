/**
 * Placement kill switches — resolveWithPlacement opts.
 *
 * The Excel task pane exposes ON/OFF toggles for number and glossary
 * substitution (default ON) so a misbehaving placement can be disabled
 * in the field without an update. These tests pin down:
 *   - defaults (no opts / empty opts) behave exactly as before
 *   - numbers:false skips number substitution, leaving the TM target
 *   - glossary:false skips glossary substitution and leaves the diffs
 *     uncovered (the card degrades to a plain fuzzy match)
 *   - the toggles are independent
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../felix-engine.js');
const { resolveWithPlacement, makeCmp } = engine;

function gloss(pairs) {
  return pairs.map(([term, translation]) => ({
    term, translation, cmp: makeCmp(term),
  }));
}

// Number-diff row: query changes 3 → 5 against the TM pair.
const NUM = {
  query: '敵3体に攻撃',
  source: '敵5体に攻撃',
  target: 'Attacks 5 enemies',
};

// Glossary-diff row: ATK ↔ MAG, both sides registered.
const GLOSS = {
  query: 'ATKに基づきダメージ',
  source: 'MAGに基づきダメージ',
  target: 'Deals damage based on MAG',
  glossary: gloss([['ATK', 'ATK'], ['MAG', 'MAG']]),
};

test('defaults: number placement applies with no opts argument', () => {
  const r = resolveWithPlacement(NUM.query, NUM.source, NUM.target, [], []);
  assert.equal(r.target, 'Attacks 3 enemies');
  assert.ok(r.placements.includes('数値'));
});

test('defaults: empty opts object behaves like all-on', () => {
  const r = resolveWithPlacement(NUM.query, NUM.source, NUM.target, [], [], {});
  assert.equal(r.target, 'Attacks 3 enemies');
  assert.ok(r.placements.includes('数値'));
});

test('numbers:false leaves the TM target untouched', () => {
  const r = resolveWithPlacement(NUM.query, NUM.source, NUM.target, [], [], { numbers: false });
  assert.equal(r.target, NUM.target);
  assert.ok(!r.placements.includes('数値'));
});

test('glossary:false skips glossary substitution and keeps the diff uncovered', () => {
  const on = resolveWithPlacement(GLOSS.query, GLOSS.source, GLOSS.target, GLOSS.glossary, []);
  assert.ok(on.placements.includes('用語'));
  assert.match(on.target, /ATK/);

  const off = resolveWithPlacement(GLOSS.query, GLOSS.source, GLOSS.target, GLOSS.glossary, [], { glossary: false });
  assert.equal(off.target, GLOSS.target);
  assert.ok(!off.placements.includes('用語'));
  assert.equal(off.covered, false);
  assert.ok(off.uncovered.length >= 1);
});

test('toggles are independent: numbers can place while glossary is off', () => {
  const query = '敵3体にATKダメージ';
  const source = '敵5体にMAGダメージ';
  const target = 'Deals MAG damage to 5 enemies';
  const glossary = gloss([['ATK', 'ATK'], ['MAG', 'MAG']]);

  const r = resolveWithPlacement(query, source, target, glossary, [], { glossary: false });
  assert.ok(r.placements.includes('数値'));
  assert.ok(!r.placements.includes('用語'));
  assert.match(r.target, /3/);
  assert.match(r.target, /MAG/); // glossary substitution did NOT run
});
