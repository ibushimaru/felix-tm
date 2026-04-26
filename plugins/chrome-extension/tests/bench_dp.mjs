/**
 * Side-by-side benchmark of the banded editDistance vs the previous
 * naive single-row DP. Same inputs go through both, so the speedup
 * (or lack thereof) is directly attributable to the band trick.
 *
 * Run: node tests/bench_dp.mjs
 */

import FelixEngine from '../felix-engine.js';
const { editDistance: editDistanceBanded } = FelixEngine;

// Original naive single-row DP (pre-banded reference). Identical
// algorithm to the one this commit replaced, kept here so the
// comparison is self-contained.
function editDistanceNaive(src, tgt, maxD) {
  let n = src.length, m = tgt.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let p = 0;
  while (p < n && p < m && src[p] === tgt[p]) p++;
  let sx = 0;
  while (sx < n - p && sx < m - p && src[n - 1 - sx] === tgt[m - 1 - sx]) sx++;
  const s = src.substring(p, n - sx), t = tgt.substring(p, m - sx);
  const n2 = s.length, m2 = t.length;
  if (n2 === 0) return m2;
  if (m2 === 0) return n2;
  if (n2 === 1) return t.indexOf(s[0]) >= 0 ? m2 - 1 : m2;
  if (m2 === 1) return s.indexOf(t[0]) >= 0 ? n2 - 1 : n2;
  const [rows, cols] = n2 > m2 ? [t, s] : [s, t];
  const rl = rows.length, cl = cols.length;
  if (maxD === undefined) maxD = cl;
  const row = new Array(rl + 1);
  for (let i = 0; i <= rl; i++) row[i] = i;
  for (let j = 1; j <= cl; j++) {
    let prev = row[0]; row[0] = j; let rm = j;
    const cc = cols[j - 1];
    for (let i = 1; i <= rl; i++) {
      const tmp = row[i];
      row[i] = Math.min(row[i] + 1, row[i - 1] + 1, prev + (rows[i - 1] === cc ? 0 : 1));
      prev = tmp;
      if (row[i] < rm) rm = row[i];
    }
    if (rm > maxD) return maxD + 1;
  }
  return row[rl];
}

function rng(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = 'abcdefghijklmnopqrstuvwxyz0123456789 光属性闇属性ダメージATK MATK MIND ';
function randStr(rand, minLen, maxLen) {
  const len = minLen + Math.floor(rand() * (maxLen - minLen + 1));
  let s = '';
  for (let i = 0; i < len; i++) s += POOL[Math.floor(rand() * POOL.length)];
  return s;
}

// Build pairs that ARE near-matches (small edit distance) — that's
// where the band trick actually saves cells. Random dissimilar pairs
// trigger the early-termination path in either implementation.
function buildNearPairs(rand, count, baseLen, edits) {
  const pairs = [];
  for (let i = 0; i < count; i++) {
    const a = randStr(rand, baseLen - 5, baseLen + 5);
    let b = a;
    for (let e = 0; e < edits; e++) {
      const idx = Math.floor(rand() * b.length);
      const ch = POOL[Math.floor(rand() * POOL.length)];
      b = rand() < 0.5
        ? b.slice(0, idx) + ch + b.slice(idx + 1)   // sub
        : b.slice(0, idx) + ch + b.slice(idx);      // insert
    }
    pairs.push([a, b]);
  }
  return pairs;
}

function bench(label, pairs, maxD, fn) {
  // Warm up.
  for (let i = 0; i < 2; i++) for (const [a, b] of pairs) fn(a, b, maxD);
  const t0 = performance.now();
  let sink = 0;
  for (const [a, b] of pairs) sink ^= fn(a, b, maxD);
  const t1 = performance.now();
  console.log(label.padEnd(34), (t1 - t0).toFixed(1).padStart(8) + ' ms', '  sink=' + sink);
}

function check(pairs, maxD) {
  // Sanity: every pair must produce identical results from both impls.
  for (const [a, b] of pairs) {
    const n = editDistanceNaive(a, b, maxD);
    const k = editDistanceBanded(a, b, maxD);
    // Both cap at maxD+1 when distance exceeds maxD; treat them
    // as equivalent if both > maxD.
    if (n !== k && !(n > maxD && k > maxD)) {
      console.error(`MISMATCH a=${JSON.stringify(a)} b=${JSON.stringify(b)} maxD=${maxD} naive=${n} banded=${k}`);
      return false;
    }
  }
  return true;
}

const SCENARIOS = [
  { label: '50-char near-match (1 edit)',  baseLen: 50,  edits: 1, count: 5000 },
  { label: '50-char near-match (5 edits)', baseLen: 50,  edits: 5, count: 5000 },
  { label: '100-char near-match (1 edit)', baseLen: 100, edits: 1, count: 5000 },
  { label: '100-char near-match (10 edits)', baseLen: 100, edits: 10, count: 5000 },
  { label: '200-char near-match (5 edits)', baseLen: 200, edits: 5, count: 2000 },
];

const MIN_SCORES = [0.5, 0.7, 0.9];

for (const sc of SCENARIOS) {
  const rand = rng(42);
  const pairs = buildNearPairs(rand, sc.count, sc.baseLen, sc.edits);
  console.log('\n--- ' + sc.label + ' (' + sc.count + ' pairs) ---');
  for (const ms of MIN_SCORES) {
    const maxD = sc.baseLen - Math.floor(sc.baseLen * ms);
    if (!check(pairs.slice(0, 50), maxD)) {
      console.log('  EQUIVALENCE CHECK FAILED — skipping this minScore');
      continue;
    }
    bench(`  minScore=${ms} (maxD=${maxD}) naive `, pairs, maxD, editDistanceNaive);
    bench(`  minScore=${ms} (maxD=${maxD}) banded`, pairs, maxD, editDistanceBanded);
  }
}
