/**
 * Felix TM Engine — Shared fuzzy matching core
 * Used by both content script and side panel.
 */

const FelixEngine = (() => {

  // === Text Normalization ===

  function makeCmp(text) {
    let s = String(text).replace(/<[^>]+>/g, '');
    s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    s = s.replace(/\u3000/g, ' ').toLowerCase();
    s = s.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
    return s.replace(/\s+/g, ' ').trim();
  }

  function containsCJK(text) {
    return /[\u3000-\u9FFF\uF900-\uFAFF]/.test(text);
  }

  // === Levenshtein Edit Distance ===

  function editDistance(src, tgt, maxD) {
    let n = src.length, m = tgt.length;
    if (n === 0) return m; if (m === 0) return n;
    let p = 0;
    while (p < n && p < m && src[p] === tgt[p]) p++;
    let sx = 0;
    while (sx < n - p && sx < m - p && src[n - 1 - sx] === tgt[m - 1 - sx]) sx++;
    const s = src.substring(p, n - sx), t = tgt.substring(p, m - sx);
    const n2 = s.length, m2 = t.length;
    if (n2 === 0) return m2; if (m2 === 0) return n2;
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
        prev = tmp; if (row[i] < rm) rm = row[i];
      }
      if (rm > maxD) return maxD + 1;
    }
    return row[rl];
  }

  function edScore(s, t, ms) {
    if (!s && !t) return 1;
    const h = Math.max(s.length, t.length);
    if (!h) return 1;
    const md = Math.floor(h * (1 - (ms || 0)));
    const d = editDistance(s, t, md);
    return d > md ? 0 : (h - d) / h;
  }

  function bagDistance(s, t) {
    const f = {};
    for (const c of s) f[c] = (f[c] || 0) + 1;
    for (const c of t) f[c] = (f[c] || 0) - 1;
    let d = 0; for (const k in f) d += Math.abs(f[k]);
    return d;
  }

  // === Word-level matching ===

  function tokenize(t) {
    return t.split(/(\s+|[.,;:!?()"'\[\]{}<>])/).filter(x => x && !/^\s+$/.test(x));
  }

  function wordScore(q, s, ms) {
    const qt = tokenize(q), st = tokenize(s);
    if (!qt.length || !st.length) return edScore(q, s, ms);
    const n = qt.length, m = st.length, h = Math.max(n, m);
    const row = new Array(n + 1);
    for (let i = 0; i <= n; i++) row[i] = i;
    for (let j = 1; j <= m; j++) {
      let prev = row[0]; row[0] = j;
      for (let i = 1; i <= n; i++) {
        const cost = 1 - edScore(qt[i - 1], st[j - 1]);
        const tmp = row[i];
        row[i] = Math.min(row[i] + 1, row[i - 1] + 1, prev + cost);
        prev = tmp;
      }
    }
    return Math.max(0, Math.min(1, h > 0 ? (h - row[n]) / h : 1));
  }

  // === Fuzzy Match ===

  function fuzzyScore(qCmp, sCmp, minScore) {
    if (qCmp === sCmp) return 1;
    const ql = qCmp.length, sl = sCmp.length, h = Math.max(ql, sl);
    if (!h) return 1;
    if (Math.min(ql, sl) / h < minScore) return 0;
    if ((h - bagDistance(qCmp, sCmp)) / h < minScore) return 0;
    const score = (containsCJK(qCmp) || qCmp.indexOf(' ') === -1)
      ? edScore(qCmp, sCmp, minScore)
      : wordScore(qCmp, sCmp, minScore);
    return score >= minScore ? score : 0;
  }

  // === TM Search ===

  function search(query, tmData, minScore) {
    if (!query || !tmData || !tmData.length) return [];
    const qCmp = makeCmp(query);
    const matches = [];
    for (const entry of tmData) {
      const sCmp = entry.cmp || makeCmp(entry.source);
      const score = fuzzyScore(qCmp, sCmp, minScore);
      if (score >= minScore) {
        matches.push({ ...entry, score });
      }
    }
    matches.sort((a, b) => b.score - a.score || (b.refcount || 0) - (a.refcount || 0));
    return matches.slice(0, 20);
  }

  function glossarySearch(query, glossaryData) {
    if (!query || !glossaryData || !glossaryData.length) return [];
    const qCmp = makeCmp(query);
    return glossaryData.filter(entry => {
      const tCmp = entry.cmp || makeCmp(entry.term);
      return qCmp.includes(tCmp) || tCmp.includes(qCmp);
    });
  }

  // === Public API ===
  return { makeCmp, search, glossarySearch, fuzzyScore, edScore };
})();

// Make available in different contexts
if (typeof module !== 'undefined') module.exports = FelixEngine;
