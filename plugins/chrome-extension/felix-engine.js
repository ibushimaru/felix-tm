/**
 * Felix TM Engine — Shared fuzzy matching core
 * Used by both content script and side panel.
 */

var FelixEngine = (() => {

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

  // === Glossary Matching (Felix-faithful) ===

  /**
   * subdist_score: fuzzy substring match score.
   * Checks if term appears (fuzzily) within the query text.
   * Returns score (0-1) or 0 if below threshold.
   */
  function subdistScore(queryCmp, termCmp, minScore) {
    if (!queryCmp || !termCmp) return 0;
    // Exact substring check first (fast path)
    if (queryCmp.includes(termCmp)) return 1.0;
    if (termCmp.length > queryCmp.length) return 0;
    // Slide term-sized window over query, find best fuzzy match
    const tLen = termCmp.length;
    const margin = Math.max(1, Math.floor(tLen * 0.3)); // allow window to vary
    let bestScore = 0;
    for (let i = 0; i <= queryCmp.length - tLen + margin; i++) {
      const end = Math.min(i + tLen + margin, queryCmp.length);
      const window = queryCmp.substring(i, end);
      const score = edScore(termCmp, window, minScore);
      if (score > bestScore) bestScore = score;
    }
    return bestScore >= minScore ? bestScore : 0;
  }

  /**
   * Find glossary terms that appear in the query text.
   * Fast path: exact substring match (covers most game translation cases).
   * Slow path: fuzzy subdist only when explicitly requested.
   * Returns matches sorted by longest-term-first (Felix GlossMatchComparator).
   */
  function glossarySearch(query, glossaryData, minScore) {
    if (!query || !glossaryData || !glossaryData.length) return [];
    const qCmp = makeCmp(query);
    const hits = [];
    for (const entry of glossaryData) {
      const tCmp = entry.cmp || makeCmp(entry.term);
      if (qCmp.includes(tCmp)) {
        hits.push({ ...entry, score: 1.0 });
      }
    }
    // Sort: longest term first (greedy matching)
    hits.sort((a, b) => b.term.length - a.term.length);
    return hits;
  }

  /**
   * Mark glossary matches in a source text string.
   * Returns HTML with <span class="gloss_match"> wrapping matched terms.
   * Longest match first, no overlapping.
   */
  /** Build non-overlapping glossary regions for a text. Single source of truth. */
  function glossRegionsForText(text, glossHits) {
    if (!glossHits.length || !text) return [];
    const lower = text.toLowerCase();
    const regions = [];
    for (const g of glossHits) {
      const termLower = g.term.toLowerCase();
      let pos = 0;
      while ((pos = lower.indexOf(termLower, pos)) !== -1) {
        const end = pos + termLower.length;
        const overlaps = regions.some(r => pos < r.end && end > r.start);
        if (!overlaps) regions.push({ start: pos, end, translation: g.translation });
        pos = end;
      }
    }
    regions.sort((a, b) => a.start - b.start);
    return regions;
  }

  function markGlossaryInSource(sourceText, glossHits) {
    const regions = glossRegionsForText(sourceText, glossHits);
    if (!regions.length) return null;
    // Build HTML
    let html = '';
    let cursor = 0;
    for (const r of regions) {
      if (r.start > cursor) html += esc(sourceText.substring(cursor, r.start));
      html += `<span class="gloss_match" data-tip="${esc(r.translation)}">${esc(sourceText.substring(r.start, r.end))}</span>`;
      cursor = r.end;
    }
    if (cursor < sourceText.length) html += esc(sourceText.substring(cursor));
    return html;
  }

  /**
   * Glossary Placement (Felix gloss_placement.cpp port).
   * Given a TM match (source + target) and the query, find the "hole" (differing part),
   * look up glossary translations for both holes, and substitute in the target.
   *
   * Returns { placed: true, target: "modified target" } or { placed: false }.
   */
  function glossaryPlacement(query, tmSource, tmTarget, glossaryData) {
    if (!query || !tmSource || !tmTarget || !glossaryData.length) return { placed: false };
    if (query === tmSource) return { placed: false }; // exact match, no placement needed

    const qCmp = makeCmp(query);
    const sCmp = makeCmp(tmSource);
    if (qCmp === sCmp) return { placed: false };

    // Find the differing segment (hole) between query and TM source
    // Use token-level diff to locate substituted words
    const useChar = containsCJK(query);
    const qTokens = useChar ? Array.from(qCmp) : tokenize(qCmp);
    const sTokens = useChar ? Array.from(sCmp) : tokenize(sCmp);

    // Find common prefix and suffix
    let prefixLen = 0;
    while (prefixLen < qTokens.length && prefixLen < sTokens.length &&
           qTokens[prefixLen] === sTokens[prefixLen]) prefixLen++;
    let suffixLen = 0;
    while (suffixLen < qTokens.length - prefixLen && suffixLen < sTokens.length - prefixLen &&
           qTokens[qTokens.length - 1 - suffixLen] === sTokens[sTokens.length - 1 - suffixLen]) suffixLen++;

    const qHoleTokens = qTokens.slice(prefixLen, qTokens.length - suffixLen);
    const sHoleTokens = sTokens.slice(prefixLen, sTokens.length - suffixLen);
    if (!qHoleTokens.length || !sHoleTokens.length) return { placed: false };

    const sep = useChar ? '' : ' ';
    const qHole = qHoleTokens.join(sep).trim();
    const sHole = sHoleTokens.join(sep).trim();
    if (!qHole || !sHole) return { placed: false };

    // Look up glossary for both holes (exact match only — Felix uses get_perfect_matches)
    let qGlossTrans = null, sGlossTrans = null;
    const qHoleCmp = makeCmp(qHole);
    const sHoleCmp = makeCmp(sHole);
    for (const g of glossaryData) {
      const gCmp = g.cmp || makeCmp(g.term);
      if (!qGlossTrans && gCmp === qHoleCmp) qGlossTrans = g.translation;
      if (!sGlossTrans && gCmp === sHoleCmp) sGlossTrans = g.translation;
    }

    if (!qGlossTrans || !sGlossTrans) return { placed: false };

    // Check that sGlossTrans appears exactly once in tmTarget
    const tgtLower = tmTarget.toLowerCase();
    const sTransLower = sGlossTrans.toLowerCase();
    const idx = tgtLower.indexOf(sTransLower);
    if (idx === -1) return { placed: false };
    // Ensure exactly one occurrence
    if (tgtLower.indexOf(sTransLower, idx + 1) !== -1) return { placed: false };

    // Replace
    const newTarget = tmTarget.substring(0, idx) + qGlossTrans + tmTarget.substring(idx + sGlossTrans.length);
    return { placed: true, target: newTarget, from: sHole, to: qHole };
  }

  // === Diff Highlighting (backtrace from edit distance matrix) ===

  /**
   * Compute word-level diff between query and TM source.
   * Returns HTML strings with colored spans:
   *   green = match, yellow = substitution, red = insertion/deletion
   *
   * For CJK: character-level diff
   * For Western: word-level diff
   */
  function diffHighlight(query, tmSource) {
    if (!query || !tmSource) return { queryHtml: esc(query), sourceHtml: esc(tmSource) };
    if (query === tmSource) return { queryHtml: `<span class="diff-match">${esc(query)}</span>`, sourceHtml: `<span class="diff-match">${esc(tmSource)}</span>` };

    const useChar = containsCJK(query) || query.indexOf(' ') === -1;
    const qTokens = useChar ? Array.from(query) : tokenize(query);
    const sTokens = useChar ? Array.from(tmSource) : tokenize(tmSource);
    const sep = useChar ? '' : ' ';

    // Build full DP matrix for backtrace
    const n = qTokens.length, m = sTokens.length;
    const dp = [];
    for (let i = 0; i <= n; i++) {
      dp[i] = new Array(m + 1);
      dp[i][0] = i;
    }
    for (let j = 0; j <= m; j++) dp[0][j] = j;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = (useChar ? qTokens[i-1] === sTokens[j-1] : qTokens[i-1].toLowerCase() === sTokens[j-1].toLowerCase()) ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i-1][j] + 1,     // delete from query
          dp[i][j-1] + 1,     // insert from source
          dp[i-1][j-1] + cost  // match/substitute
        );
      }
    }

    // Backtrace
    const ops = []; // {type: 'match'|'sub'|'del'|'ins', qTok, sTok}
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const match = useChar ? qTokens[i-1] === sTokens[j-1] : qTokens[i-1].toLowerCase() === sTokens[j-1].toLowerCase();
        if (match && dp[i][j] === dp[i-1][j-1]) {
          ops.unshift({ type: 'match', qTok: qTokens[i-1], sTok: sTokens[j-1] });
          i--; j--; continue;
        }
        if (dp[i][j] === dp[i-1][j-1] + 1) {
          ops.unshift({ type: 'sub', qTok: qTokens[i-1], sTok: sTokens[j-1] });
          i--; j--; continue;
        }
      }
      if (i > 0 && dp[i][j] === dp[i-1][j] + 1) {
        ops.unshift({ type: 'del', qTok: qTokens[i-1], sTok: null });
        i--; continue;
      }
      if (j > 0 && dp[i][j] === dp[i][j-1] + 1) {
        ops.unshift({ type: 'ins', qTok: null, sTok: sTokens[j-1] });
        j--; continue;
      }
      // Fallback
      if (i > 0) { ops.unshift({ type: 'del', qTok: qTokens[--i], sTok: null }); }
      else if (j > 0) { ops.unshift({ type: 'ins', qTok: null, sTok: sTokens[--j] }); }
    }

    // Build HTML
    let qParts = [], sParts = [];

    // Build glossary position map on the query text (same logic as markGlossaryInSource)
    const glossRegions = arguments[2] && arguments[2].length
      ? glossRegionsForText(query, arguments[2])
      : [];

    // Merge consecutive same-type ops to avoid per-character span padding
    const merged = [];
    for (const op of ops) {
      const prev = merged.length ? merged[merged.length - 1] : null;
      if (prev && prev.type === op.type) {
        if (op.qTok) prev.qToks.push(op.qTok);
        if (op.sTok) prev.sToks.push(op.sTok);
      } else {
        merged.push({
          type: op.type,
          qToks: op.qTok ? [op.qTok] : [],
          sToks: op.sTok ? [op.sTok] : [],
        });
      }
    }

    // Expand sub spans to cover full number tokens:
    // If a 'sub' contains digits and is adjacent to 'match' that also contains digits,
    // absorb those digit chars from the match into the sub.
    const isDigit = c => c >= '0' && c <= '9';
    for (let mi = 0; mi < merged.length; mi++) {
      if (merged[mi].type !== 'sub') continue;
      const qText = merged[mi].qToks.join(sep);
      const sText = merged[mi].sToks.join(sep);
      if (!qText.split('').some(isDigit) && !sText.split('').some(isDigit)) continue;
      // Absorb trailing digits from preceding match
      if (mi > 0 && merged[mi - 1].type === 'match') {
        const prev = merged[mi - 1];
        while (prev.qToks.length && isDigit(prev.qToks[prev.qToks.length - 1])) {
          merged[mi].qToks.unshift(prev.qToks.pop());
          if (prev.sToks.length) merged[mi].sToks.unshift(prev.sToks.pop());
        }
        if (!prev.qToks.length && !prev.sToks.length) { merged.splice(mi - 1, 1); mi--; }
      }
      // Absorb leading digits from following match
      if (mi + 1 < merged.length && merged[mi + 1].type === 'match') {
        const next = merged[mi + 1];
        while (next.qToks.length && isDigit(next.qToks[0])) {
          merged[mi].qToks.push(next.qToks.shift());
          if (next.sToks.length) merged[mi].sToks.push(next.sToks.shift());
        }
        if (!next.qToks.length && !next.sToks.length) merged.splice(mi + 1, 1);
      }
    }

    // Build source HTML
    for (const m of merged) {
      const sText = m.sToks.join(sep);
      if (m.type === 'match') sParts.push(`<span class="diff-match">${esc(sText)}</span>`);
      else if (m.type === 'sub') sParts.push(`<span class="diff-sub">${esc(sText)}</span>`);
      else if (m.type === 'ins') sParts.push(`<span class="diff-ins">${esc(sText)}</span>`);
    }

    // Build query HTML: per-character array with diff type, then overlay glossary
    const qCharsTyped = []; // { ch, type }
    for (const m of merged) {
      if (m.type === 'ins') continue;
      for (const tok of m.qToks) {
        for (const ch of tok) qCharsTyped.push({ ch, type: m.type });
      }
    }

    // Generate query HTML with diff spans + glossary wrapping
    let queryHtml = '';
    let curType = null, inGloss = null;
    for (let ci = 0; ci < qCharsTyped.length; ci++) {
      const { ch, type } = qCharsTyped[ci];
      const gRegion = glossRegions.find(r => ci >= r.start && ci < r.end) || null;

      // Glossary boundary change
      if (gRegion !== inGloss) {
        if (curType) { queryHtml += '</span>'; curType = null; }
        if (inGloss) queryHtml += '</span>';
        if (gRegion) queryHtml += `<span class="gloss_match" data-tip="${esc(gRegion.translation)}">`;
        inGloss = gRegion;
      }
      // Diff type change
      if (type !== curType) {
        if (curType) queryHtml += '</span>';
        queryHtml += `<span class="diff-${type}">`;
        curType = type;
      }
      queryHtml += esc(ch);
    }
    if (curType) queryHtml += '</span>';
    if (inGloss) queryHtml += '</span>';

    return {
      queryHtml,
      sourceHtml: sParts.join(sep),
    };
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // === Concordance Search (substring match in source or target) ===

  function concordanceSearch(query, tmData, maxResults, useRegex) {
    if (!query || !tmData || !tmData.length) return [];

    let re = null;
    if (useRegex) {
      try { re = new RegExp(query, 'i'); } catch (_) { return []; }
    }

    const hits = [];
    const qLower = useRegex ? null : query.toLowerCase();
    for (const entry of tmData) {
      const inSource = re ? re.test(entry.source) : entry.source.toLowerCase().includes(qLower);
      const inTarget = re ? re.test(entry.target) : entry.target.toLowerCase().includes(qLower);
      if (inSource || inTarget) {
        hits.push({ ...entry, matchField: inSource ? 'source' : 'target' });
      }
      if (hits.length >= (maxResults || 50)) break;
    }
    return hits;
  }

  // === Reverse Search (search by target text) ===

  function reverseSearch(query, tmData, minScore) {
    if (!query || !tmData || !tmData.length) return [];
    const qCmp = makeCmp(query);
    const matches = [];
    for (const entry of tmData) {
      const tCmp = makeCmp(entry.target);
      const score = fuzzyScore(qCmp, tCmp, minScore);
      if (score >= minScore) {
        matches.push({ ...entry, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 20);
  }

  // === TM Entry Management (dedup + add) ===

  /**
   * Add a source/target pair to tmData with dedup.
   * Returns 'added' if new, 'refcount' if duplicate (refcount incremented).
   */
  function addEntry(tmData, source, target, context) {
    const sCmp = makeCmp(source);
    const tCmp = makeCmp(target);

    for (const entry of tmData) {
      const entrySCmp = entry.cmp || makeCmp(entry.source);
      const entryTCmp = entry.targetCmp || makeCmp(entry.target);
      if (entrySCmp === sCmp && entryTCmp === tCmp) {
        entry.refcount = (entry.refcount || 0) + 1;
        return 'refcount';
      }
    }

    tmData.push({
      source, target, context: context || '',
      cmp: sCmp, targetCmp: tCmp, refcount: 0,
    });
    return 'added';
  }

  /**
   * Number Placement (Felix MatchStringPairing.cpp port).
   * Extracts number tokens from query, source, and target by position order,
   * then substitutes where source and query differ.
   */
  function numberPlacement(query, tmSource, tmTarget) {
    if (!query || !tmSource || !tmTarget) return { placed: false };
    if (query === tmSource) return { placed: false };

    // Normalize full-width digits to half-width
    function narrowNum(s) {
      return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    }

    // Extract all number tokens with their positions: [{ value, index, length }]
    const numRe = /(?:\d+(?:[.,]\d+)*|[０-９]+(?:[．，][０-９]+)*)/g;
    function extractNums(text) {
      const nums = [];
      let m;
      while ((m = numRe.exec(text)) !== null) {
        nums.push({ value: narrowNum(m[0]), index: m.index, length: m[0].length });
      }
      return nums;
    }

    const qNums = extractNums(query);
    const sNums = extractNums(tmSource);
    const tNums = extractNums(tmTarget);

    // Source and query must have the same count of number tokens
    if (!qNums.length || qNums.length !== sNums.length) return { placed: false };
    // Target must have the same count for reliable positional matching
    if (tNums.length !== sNums.length) return { placed: false };

    // Position-based replacement: source[k] ↔ target[k]
    // If source[k] ≠ query[k], replace target[k] with query[k]
    const replacements = [];
    for (let k = 0; k < sNums.length; k++) {
      if (qNums[k].value !== sNums[k].value) {
        replacements.push({
          tgtIdx: tNums[k].index,
          tgtLen: tNums[k].length,
          newValue: qNums[k].value,
        });
      }
    }

    if (!replacements.length) return { placed: false };

    // Apply from end to start so indices stay valid
    replacements.sort((a, b) => b.tgtIdx - a.tgtIdx);
    let result = tmTarget;
    for (const r of replacements) {
      result = result.substring(0, r.tgtIdx) + r.newValue + result.substring(r.tgtIdx + r.tgtLen);
    }

    return { placed: true, target: result };
  }

  /**
   * Rule-based Placement (Felix Rule Manager port).
   * Each rule has a source regex and a target template with \1, \2 backreferences.
   * Algorithm:
   *   1. Apply rule source regex to TM source → get captured groups → build "source replacement"
   *   2. Apply rule source regex to query → get captured groups → build "query replacement"
   *   3. In TM target, find "source replacement" and substitute with "query replacement"
   *
   * Returns { placed: true, target: "modified target" } or { placed: false }.
   */
  function rulePlacement(query, tmSource, tmTarget, rules) {
    if (!query || !tmSource || !tmTarget || !rules || !rules.length) return { placed: false };
    if (query === tmSource) return { placed: false };

    function applyTemplate(template, groups) {
      return template.replace(/\\(\d+)/g, (_, n) => {
        const idx = parseInt(n);
        return idx < groups.length ? groups[idx] : '';
      });
    }

    let result = tmTarget;
    let didPlace = false;

    for (const rule of rules) {
      if (rule.enabled === false) continue;
      let re;
      try { re = new RegExp(rule.sourcePattern); } catch (_) { continue; }

      const sMatch = tmSource.match(re);
      const qMatch = query.match(re);
      if (!sMatch || !qMatch) continue;

      const sReplacement = applyTemplate(rule.targetTemplate, sMatch);
      const qReplacement = applyTemplate(rule.targetTemplate, qMatch);
      if (sReplacement === qReplacement) continue;

      const idx = result.indexOf(sReplacement);
      if (idx === -1) continue;
      // Ensure unique occurrence
      if (result.indexOf(sReplacement, idx + sReplacement.length) !== -1) continue;

      result = result.substring(0, idx) + qReplacement + result.substring(idx + sReplacement.length);
      didPlace = true;
    }

    return didPlace ? { placed: true, target: result } : { placed: false };
  }

  /**
   * Extract non-numeric substitution pairs from query vs source diff.
   * Returns [{ qText, sText }] — parts that changed but aren't numbers.
   * Used to highlight "needs manual fix" in placed targets.
   */
  function nonNumericDiffs(query, tmSource) {
    if (!query || !tmSource || query === tmSource) return [];
    const useChar = containsCJK(query) || query.indexOf(' ') === -1;
    const qTokens = useChar ? Array.from(query) : tokenize(query);
    const sTokens = useChar ? Array.from(tmSource) : tokenize(tmSource);
    const sep = useChar ? '' : ' ';

    const n = qTokens.length, m = sTokens.length;
    const dp = [];
    for (let i = 0; i <= n; i++) { dp[i] = new Array(m + 1); dp[i][0] = i; }
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = (useChar ? qTokens[i-1] === sTokens[j-1] : qTokens[i-1].toLowerCase() === sTokens[j-1].toLowerCase()) ? 0 : 1;
        dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost);
      }
    }

    // Backtrace — collect non-numeric substitution runs.
    //
    // Path tie-breaking: when multiple optimal DP moves are equal in cost,
    // we prefer insert/delete over substitution so that incidentally-common
    // characters (e.g. a Japanese particle「を」sitting between a translated
    // term and a number) can still be recognized as matches. Picking sub
    // first would merge those common chars into the surrounding diff region
    // and hide coverage opportunities — e.g. "MINDを5" vs "CRTを45" would
    // collapse into a single {MINDを, CRTを4} diff that no glossary can
    // resolve, instead of the intended {MIND, CRT} + numeric-only diff.
    const diffs = [];
    let i = n, j = m, curQ = [], curS = [];
    function flush() {
      if (curQ.length && curS.length) {
        const q = curQ.join(sep), s = curS.join(sep);
        // Skip if both are purely numeric
        if (!(/^\d+[.,]?\d*$/.test(q) && /^\d+[.,]?\d*$/.test(s))) {
          diffs.push({ qText: q, sText: s });
        }
      }
      curQ = []; curS = [];
    }
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const match = useChar ? qTokens[i-1] === sTokens[j-1] : qTokens[i-1].toLowerCase() === sTokens[j-1].toLowerCase();
        if (match && dp[i][j] === dp[i-1][j-1]) { flush(); i--; j--; continue; }
      }
      // Prefer insert → delete → sub when tied, to preserve later matches.
      if (j > 0 && dp[i][j] === dp[i][j-1] + 1) { curS.unshift(sTokens[j-1]); j--; continue; }
      if (i > 0 && dp[i][j] === dp[i-1][j] + 1) { curQ.unshift(qTokens[i-1]); i--; continue; }
      if (i > 0 && j > 0 && dp[i][j] === dp[i-1][j-1] + 1) {
        curQ.unshift(qTokens[i-1]); curS.unshift(sTokens[j-1]); i--; j--; continue;
      }
      break;
    }
    flush();
    return diffs;
  }

  // === Auto-Translate planners (pure, no DOM / no I/O) ===
  //
  // The content script handles reading the sheet, writing back, and moving
  // the cursor. These functions take the already-read source/target arrays
  // and decide *what* should happen — nothing more. Keeping them pure makes
  // them trivially unit-testable from Node.
  //
  // Shape contract (shared by both planners):
  //
  //   @typedef {Object} PlanWrite
  //   @property {number}  rowNum
  //   @property {string}  value        — text to write into the target cell
  //   @property {string}  oldValue     — previous target value, for undo
  //   @property {boolean} viaPlacement — true when placement synthesized the value
  //
  //   @typedef {Object} MissingTerm
  //   @property {string} query  — term as it appears in the query
  //   @property {string} source — term as it appears in the TM source
  //
  //   @typedef {Object} StoppedAt
  //   @property {number} rowNum
  //   @property {string} source                  — the row's source text
  //   @property {string} [matchSource]           — best TM candidate's source
  //   @property {number} [matchScore]            — 0..1
  //   @property {MissingTerm[]} [missingTerms]   — for 'fuzzy_uncovered'
  //
  //   @typedef {'empty_source'|'end_of_batch'|'end_of_range'|'no_match'|'fuzzy_uncovered'} StopReason
  //
  //   @typedef {Object} FuzzyPlan
  //   @property {PlanWrite[]} writes
  //   @property {number|null} stopRow
  //   @property {StopReason|null} stopReason
  //   @property {StoppedAt|null} stoppedAt
  //
  //   @typedef {Object} SelectionPlan
  //   @property {number} total
  //   @property {PlanWrite[]} writes
  //   @property {number} skippedEmpty
  //   @property {number} skippedFilled
  //   @property {number|null} stopRow
  //   @property {StopReason|null} stopReason
  //   @property {StoppedAt|null} stoppedAt

  /**
   * Plan writes for Felix's "Auto Translate Selection" over a contiguous
   * row range. Target cells that already contain a translation are
   * preserved. Walks the range in order, writing rows that can be
   * translated unambiguously (100% match OR placement covers every diff),
   * and HARD-STOPS at the first row that can't — returning enough detail
   * in stoppedAt for the caller to tell the user why.
   *
   * @param {object} o
   * @param {number}   o.startRow     first row in the selection (1-based)
   * @param {number}   o.endRow       last row in the selection (inclusive)
   * @param {string[]} o.srcValues    source column values, index 0 = startRow
   * @param {string[]} o.tgtValues    target column values, index 0 = startRow
   * @param {Array}    o.tmData       TM entries
   * @param {Array}    [o.glossaryData] glossary entries (for placement coverage)
   * @param {Array}    [o.rulesData]  rule entries (applied, not counted)
   * @param {number}   [o.minScore=0.7] match threshold
   * @returns {SelectionPlan}
   */
  function planAutoTranslateSelection({ startRow, endRow, srcValues, tgtValues, tmData, glossaryData, rulesData, minScore }) {
    const threshold = typeof minScore === 'number' ? minScore : 0.7;
    const writes = [];
    let skippedEmpty = 0, skippedFilled = 0;
    let stopRow = null, stopReason = null, stoppedAt = null;
    const total = Math.max(0, endRow - startRow + 1);
    for (let i = 0; i < total; i++) {
      const rowNum = startRow + i;
      const src = ((srcValues && srcValues[i]) || '').trim();
      const existing = ((tgtValues && tgtValues[i]) || '').trim();
      // Empty / filled rows are soft skips — they don't block the walk.
      if (!src) { skippedEmpty++; continue; }
      if (existing) { skippedFilled++; continue; }

      const matches = search(src, tmData, threshold);
      if (!matches.length) {
        stopRow = rowNum; stopReason = 'no_match';
        stoppedAt = { rowNum, source: src };
        break;
      }
      const top = matches[0];

      if (top.score >= 1.0) {
        writes.push({ rowNum, value: top.target, oldValue: existing, viaPlacement: false });
        continue;
      }

      const resolved = resolveWithPlacement(src, top.source, top.target, glossaryData, rulesData);
      if (resolved.covered) {
        writes.push({ rowNum, value: resolved.target, oldValue: existing, viaPlacement: true });
        continue;
      }

      stopRow = rowNum; stopReason = 'fuzzy_uncovered';
      stoppedAt = {
        rowNum, source: src,
        matchSource: top.source, matchScore: top.score,
        missingTerms: resolved.uncovered.map(d => ({ query: d.qText, source: d.sText })),
      };
      break;
    }
    if (stopRow == null) stopReason = 'end_of_range';
    return { total, writes, skippedEmpty, skippedFilled, stopRow, stopReason, stoppedAt };
  }

  /**
   * Try to resolve a non-100% match into a writable target by applying all
   * available placements (number / glossary / rule). The result is
   * `covered: true` only when every non-numeric diff between query and TM
   * source was actually handled by one of the placements — otherwise the
   * caller should stop rather than silently insert a partially-correct
   * translation.
   *
   * Numeric diffs are always considered covered (numberPlacement handles
   * them and nonNumericDiffs filters them out in advance). Rule placement
   * is applied but not counted toward coverage — rules can span across
   * multiple diffs in ways that are hard to attribute safely, and we'd
   * rather under-cover (stop) than over-cover (wrong insert).
   */
  function resolveWithPlacement(query, tmSource, tmTarget, glossaryData, rulesData) {
    let target = tmTarget;
    let remaining = nonNumericDiffs(query, tmSource);
    const placements = [];  // collected badges, in application order
    const uncovered = [];   // diffs we couldn't resolve — reported back so
                            // the caller can tell the user what's missing

    // Number placement handles numeric diffs (which nonNumericDiffs already
    // excluded from `remaining`).
    const np = numberPlacement(query, tmSource, target);
    if (np.placed) { target = np.target; placements.push('数値'); }

    // Per-diff glossary coverage. Felix's glossaryPlacement is restricted to
    // a single contiguous hole, so it can't address rows with scattered
    // differences (number + number + term + number). Here we walk each
    // non-numeric diff and check the glossary independently: if both sides
    // of the diff have glossary entries we know how to rewrite the target
    // segment that corresponds to sEntry.translation.
    if (glossaryData && glossaryData.length && remaining.length) {
      const indexByCmp = new Map();
      for (const g of glossaryData) {
        const c = g.cmp || makeCmp(g.term);
        if (!indexByCmp.has(c)) indexByCmp.set(c, g);
      }
      const stillRemaining = [];
      let glossaryApplied = false;
      for (const d of remaining) {
        const qEntry = indexByCmp.get(makeCmp(d.qText));
        const sEntry = indexByCmp.get(makeCmp(d.sText));
        if (!qEntry || !sEntry) { stillRemaining.push(d); continue; }
        // Substitute sEntry.translation → qEntry.translation in target
        // (first occurrence, case-insensitive like glossaryPlacement does).
        const tgtLower = target.toLowerCase();
        const fromLower = sEntry.translation.toLowerCase();
        const idx = tgtLower.indexOf(fromLower);
        if (idx === -1) { stillRemaining.push(d); continue; }
        target = target.substring(0, idx)
               + qEntry.translation
               + target.substring(idx + sEntry.translation.length);
        glossaryApplied = true;
      }
      if (glossaryApplied) placements.push('用語');
      remaining = stillRemaining;
    }

    // Rule placement — applied for completeness but not counted toward
    // coverage because a rule's regex can span multiple diffs in ways that
    // are hard to attribute safely.
    if (rulesData && rulesData.length) {
      const rp = rulePlacement(query, tmSource, target, rulesData);
      if (rp.placed) { target = rp.target; placements.push('ルール'); }
    }

    // Diffs still in `remaining` at this point are what the user needs to
    // address — typically "term missing from glossary" on one or both sides.
    for (const d of remaining) uncovered.push(d);

    return { target, covered: uncovered.length === 0, placements, uncovered };
  }

  /**
   * Plan writes for "Auto Translate" from startRow downward. Writes every
   * row that can be translated unambiguously and STOPS at the first row
   * that can't — returning concrete information about why so the caller
   * can tell the user exactly what to fix before retrying.
   *
   * When stopReason is 'no_match' or 'fuzzy_uncovered', `stoppedAt` carries
   * enough context to explain the problem: the source text, the best TM
   * candidate (if any), and the list of missing glossary term pairs.
   *
   * @returns {FuzzyPlan}
   */
  function planAutoTranslateToFuzzy({ startRow, srcValues, tgtValues, tmData, glossaryData, rulesData, minScore }) {
    const threshold = typeof minScore === 'number' ? minScore : 0.7;
    const writes = [];
    let stopRow = null, stopReason = null, stoppedAt = null;
    const n = (srcValues && srcValues.length) || 0;
    for (let i = 0; i < n; i++) {
      const rowNum = startRow + i;
      const src = ((srcValues && srcValues[i]) || '').trim();
      if (!src) {
        stopRow = rowNum; stopReason = 'empty_source';
        stoppedAt = { rowNum, source: '' };
        break;
      }

      const matches = search(src, tmData, threshold);
      if (!matches.length) {
        stopRow = rowNum; stopReason = 'no_match';
        stoppedAt = { rowNum, source: src };
        break;
      }
      const top = matches[0];

      if (top.score >= 1.0) {
        writes.push({
          rowNum, value: top.target, viaPlacement: false,
          oldValue: ((tgtValues && tgtValues[i]) || '').trim(),
        });
        continue;
      }

      const resolved = resolveWithPlacement(src, top.source, top.target, glossaryData, rulesData);
      if (resolved.covered) {
        writes.push({
          rowNum, value: resolved.target, viaPlacement: true,
          oldValue: ((tgtValues && tgtValues[i]) || '').trim(),
        });
        continue;
      }

      stopRow = rowNum; stopReason = 'fuzzy_uncovered';
      stoppedAt = {
        rowNum, source: src,
        matchSource: top.source, matchScore: top.score,
        missingTerms: resolved.uncovered.map(d => ({ query: d.qText, source: d.sText })),
      };
      break;
    }
    if (stopRow == null && n > 0) stopReason = 'end_of_batch';
    return { writes, stopRow, stopReason, stoppedAt };
  }

  // === Plan consumers (pure helpers used by content.js) ===
  //
  // Keeping the "what do we do with this plan?" logic in felix-engine.js
  // means it's covered by the same Node test suite as the planners. When
  // the planner's return shape changes, tests here (and the IDE's JSDoc
  // checks) will catch any drift instead of waiting for a browser bug.

  /**
   * Build the concrete IO artifacts the content script needs from a plan.
   * Pure — no DOM, no Sheets API, no chrome.runtime access.
   *
   * @param {FuzzyPlan | SelectionPlan} plan
   * @param {object} cfg
   * @param {string} cfg.tgtCol      target column letter (e.g. "B")
   * @param {string} [cfg.sheetName] active sheet name; when present, ranges
   *                                 are qualified as `'sheet'!B5`
   * @param {number} cfg.startRow    first row in the plan's window
   * @returns {{
   *   updates: Array<{ range: string, value: string }>,
   *   undoEntries: Array<{ range: string, oldValue: string }>,
   *   landingRow: number,
   * }}
   */
  function buildPlanActions(plan, cfg) {
    const tgtCol = cfg.tgtCol;
    const qualify = (cell) => cfg.sheetName ? `'${cfg.sheetName}'!${cell}` : cell;
    const writes = (plan && plan.writes) || [];
    const updates = writes.map(w => ({ range: qualify(`${tgtCol}${w.rowNum}`), value: w.value }));
    const undoEntries = writes.map(w => ({ range: qualify(`${tgtCol}${w.rowNum}`), oldValue: w.oldValue }));
    const landingRow = (plan && plan.stopRow) || (cfg.startRow + writes.length);
    return { updates, undoEntries, landingRow };
  }

  /**
   * Turn a plan into a human-readable report + a suggested display duration.
   * Priority (per product design):
   *   1. "類似候補なし（しきい値未満）" — most actionable: add TM entry
   *   2. "X% マッチあり、未対応の差分" — lists missing glossary pairs
   *   3. Normal completion — concise
   *
   * @param {FuzzyPlan | SelectionPlan} plan
   * @param {object} cfg
   * @param {string} cfg.srcCol              source column letter (for row refs)
   * @param {number} [cfg.minScoreDefault=0.7] displayed in the "below threshold" message
   * @returns {{ text: string, ms: number }}
   */
  function describePlan(plan, cfg) {
    const col = cfg.srcCol || 'A';
    const wrote = (plan.writes || []).length;
    const reason = plan.stopReason;
    const at = plan.stoppedAt;

    if (!reason || reason === 'end_of_batch' || reason === 'end_of_range') {
      return {
        text: wrote ? `完了: ${wrote} 行挿入` : '挿入なし（候補や対象がありません）',
        ms: 3000,
      };
    }
    if (reason === 'empty_source') {
      const where = at ? ` (${col}${at.rowNum} でデータ末尾)` : '';
      return { text: `完了: ${wrote} 行挿入${where}`, ms: 3000 };
    }

    if (!at) return { text: `停止: ${reason}`, ms: 4000 };

    const head = wrote
      ? `${col}${at.rowNum} で停止（${wrote} 行挿入済み）`
      : `${col}${at.rowNum} で停止（挿入なし）`;

    if (reason === 'no_match') {
      const minPct = Math.round(((cfg.minScoreDefault ?? 0.7)) * 100);
      return {
        text: `${head}\n類似候補なし（最低マッチ率 ${minPct}% 未満）\nTM に近い原文がないため自動処理できません`,
        ms: 6000,
      };
    }

    if (reason === 'fuzzy_uncovered') {
      const pct = at.matchScore != null ? Math.round(at.matchScore * 100) : '?';
      const lines = [head, `${pct}% マッチあり、未対応の差分:`];
      const terms = at.missingTerms || [];
      const SHOW = 4;
      for (const t of terms.slice(0, SHOW)) {
        lines.push(`  ・「${t.query}」⇔「${t.source}」`);
      }
      if (terms.length > SHOW) lines.push(`  ・他 ${terms.length - SHOW} 件`);
      lines.push('用語集に登録して再実行してください');
      return { text: lines.join('\n'), ms: 8000 };
    }

    return { text: `${head}\n(${reason})`, ms: 4000 };
  }

  // === Public API ===
  return { makeCmp, search, reverseSearch, concordanceSearch, glossarySearch,
           glossaryPlacement, numberPlacement, rulePlacement, nonNumericDiffs,
           markGlossaryInSource, fuzzyScore, edScore, diffHighlight, tokenize,
           containsCJK, addEntry, esc,
           resolveWithPlacement,
           planAutoTranslateSelection, planAutoTranslateToFuzzy,
           buildPlanActions, describePlan };
})();

// Make available in different contexts
if (typeof module !== 'undefined') module.exports = FelixEngine;
