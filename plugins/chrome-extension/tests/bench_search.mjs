/**
 * Search benchmark — synthetic TM of 10k rows, 100 queries.
 * Run: node tests/bench_search.mjs
 *
 * Not a unit test — kept out of `tests/*.test.js` so npm test stays
 * fast. Numbers are wall-clock on the developer machine.
 */

import FelixEngine from '../felix-engine.js';
const { addEntry, search, makeCmp } = FelixEngine;

// Reproducible PRNG (mulberry32) so benchmark runs are comparable.
function rng(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pull from a small charset that mixes ASCII + CJK so cmpLen folding
// is exercised but pairs share enough bytes to actually score.
const POOL = 'abcdefghijklmnopqrstuvwxyz0123456789 ' +
             '光属性闇属性ダメージ攻撃力防御力魔力素早さHP MP ATK DEF MATK MIND ';
function randomSegment(rand, minLen, maxLen) {
  const len = minLen + Math.floor(rand() * (maxLen - minLen + 1));
  let s = '';
  for (let i = 0; i < len; i++) s += POOL[Math.floor(rand() * POOL.length)];
  return s;
}

function buildTm(rand, n, minLen, maxLen) {
  const tm = [];
  for (let i = 0; i < n; i++) {
    addEntry(tm, randomSegment(rand, minLen, maxLen), randomSegment(rand, minLen, maxLen));
  }
  return tm;
}

function buildQueries(rand, n, minLen, maxLen) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(randomSegment(rand, minLen, maxLen));
  return out;
}

function bench(label, fn) {
  // Warm up V8.
  for (let i = 0; i < 3; i++) fn();
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  console.log(label.padEnd(40), (t1 - t0).toFixed(1) + ' ms  ', result);
}

const SEED = 42;
const TM_SIZE = 10_000;
const QUERY_COUNT = 100;

const buildRand = rng(SEED);
const queryRand = rng(SEED + 1);

console.log(`Building TM (${TM_SIZE} entries)...`);
const tm = buildTm(buildRand, TM_SIZE, 30, 80);
console.log(`Building queries (${QUERY_COUNT})...`);
const queries = buildQueries(queryRand, QUERY_COUNT, 30, 80);

// "Templated" TM — lots of near-matches that exercise the DP hot path.
// Each query has a near-twin in the TM with 1-3 char edits, so the
// edit-distance pre-filter actually fires often instead of bailing
// early on bag distance.
function buildNearMatchScenario(rand, queryCount, copiesPerQuery, editsPerCopy) {
  const queries = [];
  const tm = [];
  for (let q = 0; q < queryCount; q++) {
    const base = randomSegment(rand, 40, 60);
    queries.push(base);
    tm.push({ source: base, target: 'tgt-' + q, cmp: makeCmp(base) });
    for (let c = 0; c < copiesPerQuery; c++) {
      let mut = base;
      for (let e = 0; e < editsPerCopy; e++) {
        const i = Math.floor(rand() * mut.length);
        const ch = POOL[Math.floor(rand() * POOL.length)];
        // 50/50 substitute vs insert
        mut = rand() < 0.5
          ? mut.slice(0, i) + ch + mut.slice(i + 1)
          : mut.slice(0, i) + ch + mut.slice(i);
      }
      tm.push({ source: mut, target: 'tgt-' + q + '-' + c, cmp: makeCmp(mut) });
    }
  }
  return { tm, queries };
}

console.log(`Building near-match scenario (1000 queries × 10 near-twins each)...`);
const nearScenario = buildNearMatchScenario(rng(SEED + 2), 1000, 10, 2);
console.log(`  → TM: ${nearScenario.tm.length}, queries: ${nearScenario.queries.length}`);

console.log('\n--- random TM ' + TM_SIZE + ' × ' + QUERY_COUNT + ' queries (mostly dissimilar) ---');
for (const minScore of [0.5, 0.7, 0.9]) {
  bench(`search minScore=${minScore}`, () => {
    let total = 0;
    for (const q of queries) total += search(q, tm, minScore).length;
    return `total hits=${total}`;
  });
}

console.log('\n--- near-match TM ' + nearScenario.tm.length + ' × ' + nearScenario.queries.length + ' queries (most pairs ARE matches) ---');
for (const minScore of [0.5, 0.7, 0.9]) {
  bench(`search minScore=${minScore}`, () => {
    let total = 0;
    for (const q of nearScenario.queries) total += search(q, nearScenario.tm, minScore).length;
    return `total hits=${total}`;
  });
}
