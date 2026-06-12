/**
 * Felix TM — Excel task pane.
 *
 * Port of the Chrome extension's overlay panel (content.js) and side
 * panel (sidepanel.js) onto Office.js. The matching engine
 * (felix-engine.js) and the IndexedDB layer (db.js) are shared verbatim
 * with the extension — this file is only the Excel glue + UI.
 *
 * What the Office.js API replaces:
 *   - Sheets DOM scraping (formula bar / name box) → getSelectedRange
 *   - Sheets REST API + OAuth                      → Range.values (no auth)
 *   - 200ms polling for selection changes          → DocumentSelectionChanged
 *   - background service worker message routing    → direct function calls
 */

// === State ===
let tmData = [];
let glossaryData = [];
let rulesData = [];
let settings = { sourceCol: 'A', targetCol: 'B', minScore: 0.7, lang: 'en', uiScale: 1 };
let panelMode = 'translate'; // 'translate' | 'review'
let concRegex = false;
// Last selection snapshot: { sheetName, selRef, ref, colLetter, rowNum, value }
let lastSel = null;
let lastQuery = '';
const _undoStack = []; // { sheetName, ref, oldValue } (batch support reserved for Auto Translate)
const UNDO_STACK_MAX = 50;

function pushUndo(entry) {
  _undoStack.push(entry);
  while (_undoStack.length > UNDO_STACK_MAX) _undoStack.shift();
}

// === i18n ===
const I18N = {
  en: {
    // Tabs
    search: 'Search', tm: 'TM', glossary: 'Glossary', settings: 'Settings',
    // Search pane
    activeCell: 'Active Cell', selectCell: 'Select a cell to search TM',
    noMatch: 'No matches',
    used: 'used', registered: 'Registered!', alreadyExists: 'Already exists (+1)',
    srcEmpty: 'Source cell is empty', tgtEmpty: 'Target cell is empty',
    tipUndo: 'Undo the last insert',
    tipSet: "Register the active row's source + target to TM",
    tipModeTranslate: 'Look up target translations from source',
    tipModeReview: 'Look up source from target (reverse / check)',
    tipMinScore: 'Minimum match score for candidates',
    tipConcordance: 'Substring search inside the TM',
    tipRegex: 'Toggle regex mode',
    phConcordance: 'Concordance',
    nothingToUndo: 'Nothing to undo',
    undoSheetMissing: 'Cannot undo — the sheet was removed or renamed',
    writeNeedsSourceOrTarget: 'Click a source or target cell first',
    selectCellFirst: 'Select a cell first',
    emptySourceRow: 'Source row is empty',
    copiedPrefix: 'Copied: ',
    undoRangePrefix: 'Undo: ',
    errorPrefix: 'Error: ',
    searchPrefix: 'Search: ',
    toGlossary: 'To glossary: ',
    toTerm: 'To term: ',
    toTranslation: 'To translation: ',
    invalidRegex: 'Invalid regex',
    excelReadFailed: 'Could not read the worksheet',
    excelWriteFailed: 'Could not write to the worksheet',
    ctxAddTerm: 'Add to glossary as term',
    ctxAddTrans: 'Add to glossary as translation',
    ctxBrowse: 'Search glossary',
    // Management
    register: 'Register', registerToTM: 'Register to TM',
    source: 'Source', target: 'Target',
    import: 'Import', imported: 'Imported',
    browseTM: 'Browse TM', filter: 'Filter...',
    addTerm: 'Add Term', termSrc: 'Term (source)', termTgt: 'Translation',
    add: 'Add', glossAdded: 'Added!', glossExists: 'Already exists',
    dropFile: 'Drop TMX/TSV file', dropGlossFile: 'TSV file drop',
    importFromWb: 'Import from Workbook',
    wbImportDesc: 'Import from the active worksheet. Select a range to auto-fill.',
    glossWbImportDesc: 'Import from the active worksheet (term / translation columns).',
    badRange: 'Invalid range',
    export: 'Export', exportTM: 'Export TM as TSV', exportTMX: 'Export TM as TMX',
    exportGloss: 'Export Glossary as TSV',
    save: 'Save', saved: 'Saved!',
    danger: 'Danger Zone', clearTM: 'Clear TM', clearGloss: 'Clear Glossary',
    confirmClear: 'Delete all entries?', cancel: 'Cancel',
    lblSourceCol: 'Source Column', lblTargetCol: 'Target Column', lblMinScore: 'Default Min Score',
    lblUiScale: 'UI scale',
  },
  ja: {
    // Tabs
    search: '検索', tm: 'TM', glossary: '用語集', settings: '設定',
    // Search pane
    activeCell: 'アクティブセル', selectCell: 'セルを選択するとTM検索します',
    noMatch: 'マッチなし',
    used: '使用', registered: '登録しました', alreadyExists: '既に存在 (+1)',
    srcEmpty: '原文セルが空です', tgtEmpty: '訳文セルが空です',
    tipUndo: '直前の挿入を元に戻す',
    tipSet: '現在行の原文＋訳文を TM に登録',
    tipModeTranslate: '原文を見て訳文候補を探す',
    tipModeReview: '訳文を見て原文候補を探す（逆引き・チェック用）',
    tipMinScore: '候補を出す最低マッチ率',
    tipConcordance: 'TM 内を文字列検索（部分一致）',
    tipRegex: '正規表現モードに切り替え',
    phConcordance: 'コンコーダンス',
    nothingToUndo: '元に戻す操作がありません',
    undoSheetMissing: 'シートが削除または改名されたため、元に戻せません',
    writeNeedsSourceOrTarget: '原文または訳文セルを選択してください',
    selectCellFirst: 'セルを選択してください',
    emptySourceRow: '原文行が空です',
    copiedPrefix: 'コピー: ',
    undoRangePrefix: '元に戻す: ',
    errorPrefix: 'エラー: ',
    searchPrefix: '検索: ',
    toGlossary: '用語集へ: ',
    toTerm: '用語へ: ',
    toTranslation: '訳語へ: ',
    invalidRegex: '無効な正規表現',
    excelReadFailed: 'ワークシートを読み取れませんでした',
    excelWriteFailed: 'ワークシートに書き込めませんでした',
    ctxAddTerm: '用語として用語集へ',
    ctxAddTrans: '訳語として用語集へ',
    ctxBrowse: '用語集で検索',
    // Management
    register: '登録', registerToTM: 'TMに登録',
    source: '原文', target: '訳文',
    import: 'インポート', imported: 'インポート完了',
    browseTM: 'TMブラウズ', filter: 'フィルタ...',
    addTerm: '用語を追加', termSrc: '用語（原文）', termTgt: '訳語',
    add: '追加', glossAdded: '追加しました', glossExists: '既に存在します',
    dropFile: 'TMX/TSVファイルをドロップ', dropGlossFile: 'TSVファイルをドロップ',
    importFromWb: 'ブックからインポート',
    wbImportDesc: '現在のワークシートからインポートします。シート上で範囲を選択すると自動入力されます。',
    glossWbImportDesc: '現在のワークシートからインポート（用語列／訳語列）。',
    badRange: '範囲指定が不正です',
    export: 'エクスポート', exportTM: 'TMをTSVでエクスポート', exportTMX: 'TMをTMXでエクスポート',
    exportGloss: '用語集をTSVでエクスポート',
    save: '保存', saved: '保存しました',
    danger: '危険な操作', clearTM: 'TMを全削除', clearGloss: '用語集を全削除',
    confirmClear: '全エントリを削除しますか？', cancel: 'キャンセル',
    lblSourceCol: '原文列', lblTargetCol: '訳文列', lblMinScore: '最低マッチ率',
    lblUiScale: '表示倍率',
  },
};
function t(key) { return (I18N[settings.lang] && I18N[settings.lang][key]) || I18N.en[key] || key; }

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escA(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escH(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function $(id) { return document.getElementById(id); }

// === Excel helpers ===

function colLetterFromIndex(i) {
  let s = '', n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "'My Sheet'!B5" / "Sheet1!B5" → ["My Sheet", "B5"] */
function splitAddress(address) {
  const i = address.lastIndexOf('!');
  if (i === -1) return ['', address];
  let sheet = address.slice(0, i);
  if (sheet.startsWith("'") && sheet.endsWith("'")) {
    sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }
  return [sheet, address.slice(i + 1)];
}

/** Excel values come back as number/boolean/string; normalize to string. */
function cellText(v) { return v == null ? '' : String(v); }

/** Run an Excel.run batch, returning null (and logging) on failure so
 *  call sites can treat "Excel unavailable / multi-area selection /
 *  deleted sheet" uniformly instead of each wiring its own try/catch. */
async function excelRun(fn) {
  try {
    return await Excel.run(fn);
  } catch (e) {
    console.warn('[FelixTM] Excel.run failed', e);
    return null;
  }
}

async function getSelectionInfo() {
  return excelRun(async (ctx) => {
    const sel = ctx.workbook.getSelectedRange();
    const cell = sel.getCell(0, 0);
    sel.load(['address']);
    cell.load(['address', 'values', 'rowIndex', 'columnIndex']);
    await ctx.sync();
    const [sheetName, selRef] = splitAddress(sel.address);
    const [, ref] = splitAddress(cell.address);
    return {
      sheetName, selRef, ref,
      colLetter: colLetterFromIndex(cell.columnIndex),
      rowNum: cell.rowIndex + 1,
      value: cellText(cell.values[0][0]).trim(),
    };
  });
}

/** Read one cell's display value from a sheet. Returns '' on failure. */
async function readCellValue(sheetName, ref) {
  const v = await excelRun(async (ctx) => {
    const range = ctx.workbook.worksheets.getItem(sheetName).getRange(ref);
    range.load('values');
    await ctx.sync();
    return cellText(range.values[0][0]).trim();
  });
  return v == null ? '' : v;
}

/** Write one cell. Returns true on success. */
async function writeCellValue(sheetName, ref, value) {
  const ok = await excelRun(async (ctx) => {
    ctx.workbook.worksheets.getItem(sheetName).getRange(ref).values = [[value]];
    await ctx.sync();
    return true;
  });
  return !!ok;
}

async function selectCellRef(sheetName, ref) {
  await excelRun(async (ctx) => {
    const range = ctx.workbook.worksheets.getItem(sheetName).getRange(ref);
    range.select();
    await ctx.sync();
  });
}

// === Search routing ===

function isSourceCol(sel) { return sel.colLetter === (settings.sourceCol || 'A').toUpperCase(); }
function isTargetCol(sel) { return sel.colLetter === (settings.targetCol || 'B').toUpperCase(); }

function paintEmpty(msgKey) {
  $('results').innerHTML = `<div class="empty">${esc(t(msgKey))}</div>`;
}

function updateCellPreview(sel) {
  $('cell-value').textContent = sel.value || '—';
  $('cell-ref').textContent = sel.ref ? `(${sel.ref})` : '';
}

/** Decide the search query for the current selection and render.
 *  This replaces content.js's _sourceCache + fetchSourceForRow dance:
 *  the row's counterpart cell is just one local read away. */
async function routeSelection(sel) {
  updateCellPreview(sel);

  const onSource = isSourceCol(sel);
  const onTarget = isTargetCol(sel);
  // Outside the configured source/target pair the cell content has
  // nothing to do with TM lookup — clear instead of painting noise.
  if (!onSource && !onTarget) { lastQuery = ''; paintEmpty('selectCell'); return; }

  if (panelMode === 'review') {
    // Review mode: reverse search using the target-side text.
    let query = sel.value;
    if (onSource) {
      const tgt = await readCellValue(sel.sheetName, (settings.targetCol || 'B') + sel.rowNum);
      query = tgt || sel.value;
    }
    if (!query) { lastQuery = ''; paintEmpty('selectCell'); return; }
    renderSearch(query, true);
    return;
  }

  // Translate mode: forward search. On a target cell, use the same
  // row's source as the query so the panel keeps showing source-side
  // matches as the translator navigates between columns.
  let query = sel.value;
  if (onTarget) {
    query = await readCellValue(sel.sheetName, (settings.sourceCol || 'A') + sel.rowNum);
    if (!query) { lastQuery = ''; paintEmpty('emptySourceRow'); return; }
    // Show the row's source in the preview — that's what we're matching.
    $('cell-value').textContent = query;
  }
  if (!query) { lastQuery = ''; paintEmpty('selectCell'); return; }
  renderSearch(query, false);
}

function rerunSearch() {
  const conc = $('conc-query').value.trim();
  if (conc) { doConcordance(); return; }
  if (lastSel) routeSelection(lastSel);
}

// === Render helpers (ported from content.js) ===

/** Render `placed` as HTML with per-region classes + optional data-tip
 *  attributes. Regions must be non-overlapping; overlaps and malformed
 *  entries are dropped so a bad region can't corrupt the cursor. */
function markRegionsMixed(text, regions) {
  const safe = regions.filter(r =>
    typeof r.idx === 'number' && typeof r.len === 'number' &&
    r.idx >= 0 && r.len > 0 && r.idx + r.len <= text.length);
  if (!safe.length) return esc(text);
  const sorted = [...safe].sort((a, b) => a.idx - b.idx);
  let html = '', cursor = 0;
  for (const r of sorted) {
    if (r.idx < cursor) continue;
    html += esc(text.substring(cursor, r.idx));
    const tip = r.dataTip ? ` title="→ ${escA(r.dataTip)}"` : '';
    html += `<span class="${r.cls}"${tip}>${esc(text.substring(r.idx, r.idx + r.len))}</span>`;
    cursor = r.idx + r.len;
  }
  html += esc(text.substring(cursor));
  return html;
}

function placedHighlightHtml(original, placed, uncoveredCount) {
  const placedRegions = FelixEngine.findDiffRegions(original, placed);
  const regions = placedRegions.map(r => ({ idx: r.idx, len: r.len, cls: 'placed-ins' }));
  if (uncoveredCount > 0) {
    for (const r of FelixEngine.unverifiedRegions(placedRegions, placed.length)) {
      regions.push({ idx: r.idx, len: r.len, cls: 'placed-unverified' });
    }
  }
  return markRegionsMixed(placed, regions);
}

function renderSearch(searchQuery, isReverse) {
  lastQuery = searchQuery;
  const minScore = parseFloat($('min-score').value);

  const t0 = performance.now();
  const matches = isReverse
    ? FelixEngine.reverseSearch(searchQuery, tmData, minScore)
    : FelixEngine.search(searchQuery, tmData, minScore);
  const ms = (performance.now() - t0).toFixed(1);

  // Glossary hits for the query (highlighting + placement). Only keep
  // hits whose term is findable in the original text, not just in makeCmp.
  const glossHitsRaw = glossaryData.length ? FelixEngine.glossarySearch(searchQuery, glossaryData) : [];
  const qLower = searchQuery.toLowerCase();
  const glossHits = glossHitsRaw.filter(g => qLower.includes(g.term.toLowerCase()));

  const el = $('results');
  const onTarget = lastSel && isTargetCol(lastSel);
  const label = isReverse ? '↔ Review' : (onTarget ? '← Source' : '');
  // Any 100% match → skip Placement entirely.
  const has100 = !isReverse && matches.some(m => Math.round(m.score * 100) === 100);

  // Uncovered regions for the top fuzzy match, computed up front so the
  // active-cell preview can paint query-side uncovered colouring; the
  // same resolved object is reused inside the match loop.
  let topResolved = null;
  if (!isReverse && !has100 && matches.length) {
    const top = matches[0];
    if (Math.round(top.score * 100) < 100) {
      topResolved = FelixEngine.resolveWithPlacement(
        searchQuery, top.source, top.target, glossaryData, rulesData);
    }
  }
  const topUncovered = topResolved ? topResolved.uncovered : [];

  // Cell preview: glossary underlines + uncovered colouring on the query
  if (searchQuery) {
    const rendered = FelixEngine.renderQueryCellWithUncovered(searchQuery, glossHits, topUncovered);
    if (rendered) $('cell-value').innerHTML = rendered;
  }

  if (!matches.length) {
    el.innerHTML = `<div class="empty">${t('noMatch')} ${label} (${ms}ms)</div>`;
  } else {
    el.innerHTML = (label ? `<div style="font-size:10px;color:var(--accent);margin-bottom:4px">${label}</div>` : '') +
    matches.map((m, i) => {
      const pct = Math.round(m.score * 100);
      const cls = pct >= 90 ? 'score-high' : pct >= 70 ? 'score-mid' : 'score-low';
      const meta = m.refcount ? `${t('used')} ${m.refcount}x` : '';
      const tmIdx = typeof m.tmIdx === 'number' ? m.tmIdx : tmData.findIndex(e => e.source === m.source && e.target === m.target);

      let srcHtml, memSrcHtml = '', tgtDisplay, insertTarget, placed = false;
      if (isReverse) {
        const diff = pct < 100 ? FelixEngine.diffHighlight(searchQuery, m.target) : null;
        srcHtml = diff ? diff.sourceHtml : esc(m.target);
        tgtDisplay = esc(m.source);
        insertTarget = m.source;
      } else {
        if (pct === 100) {
          srcHtml = esc(m.source);
        } else {
          const diff = FelixEngine.diffHighlight(searchQuery, m.source, glossHits);
          srcHtml = diff ? diff.queryHtml : esc(m.source);
          memSrcHtml = diff ? diff.sourceHtml : esc(m.source);
        }

        insertTarget = m.target;
        tgtDisplay = esc(m.target);
        // Placement: only on the top result, and only if no 100% match —
        // same per-diff resolver as the extension, so what's previewed is
        // exactly what a click would write.
        if (!has100 && i === 0 && pct < 100) {
          const resolved = topResolved || FelixEngine.resolveWithPlacement(
            searchQuery, m.source, m.target, glossaryData, rulesData);
          const placedTarget = resolved.target;
          const badges = resolved.placements;
          if (badges.length) {
            placed = true;
            insertTarget = placedTarget;
            tgtDisplay = placedHighlightHtml(m.target, placedTarget, resolved.uncovered.length)
              + `<span class="placed-badge">${badges.join('+')}置換</span>`;
          }
        }
      }

      // Insert preview on top, reference block (registered memory) below.
      const showRef = pct < 100 && (isReverse ? !!srcHtml : !!memSrcHtml);
      const refSrcHtml = (showRef && !isReverse && i === 0 && topUncovered.length)
        ? FelixEngine.markUncoveredHtml(m.source, topUncovered, 's')
        : esc(m.source);
      let refBlock = '';
      if (showRef) {
        if (isReverse) {
          refBlock = `<div class="match-ref"><div class="ref-row">${srcHtml}</div></div>`;
        } else {
          refBlock = `<div class="match-ref">
            <div class="ref-row">${refSrcHtml}</div>
            ${placed ? `<div class="ref-row">${esc(m.target)}</div>` : ''}
          </div>`;
        }
      }
      return `<div class="match${placed ? ' match-placed' : ''}" data-idx="${i}" data-target="${escA(insertTarget)}" data-tm-idx="${tmIdx}">
        <span class="score ${cls}">${pct}%</span>
        <span style="float:right;display:flex;align-items:center;gap:4px">
          ${i === 0 ? `<span style="font-size:10px;color:var(--faint)">${ms}ms</span>` : ''}
          <span class="btn-del-tm" data-del-idx="${tmIdx}" title="Delete from TM" style="font-size:11px;color:var(--border);cursor:pointer">✕</span>
        </span>
        <div class="match-target">${tgtDisplay}</div>
        ${refBlock}
        ${meta ? `<div class="match-meta">${meta}</div>` : ''}
      </div>`;
    }).join('');

    // Click: left half → insert & next row, right half → insert & edit.
    // The reference block is a read-only lookup area — no insert there.
    const inRef = (target) => target && typeof target.closest === 'function' && !!target.closest('.match-ref');
    el.querySelectorAll('.match').forEach(div => {
      div.addEventListener('mousemove', (e) => {
        if (inRef(e.target)) { div.classList.remove('hover-left', 'hover-right'); return; }
        const rect = div.getBoundingClientRect();
        const isRight = (e.clientX - rect.left) > rect.width / 2;
        div.classList.toggle('hover-left', !isRight);
        div.classList.toggle('hover-right', isRight);
      });
      div.addEventListener('mouseleave', () => div.classList.remove('hover-left', 'hover-right'));
      // Drag-to-select must not be treated as click-to-insert: the placed
      // preview doubles as a thing to copy text from.
      let downX = 0, downY = 0;
      div.addEventListener('mousedown', (e) => { downX = e.clientX; downY = e.clientY; });
      div.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-del-tm')) return;
        if (inRef(e.target)) return;
        if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) return;
        const selText = (window.getSelection() || '').toString().trim();
        if (selText) return;
        const rect = div.getBoundingClientRect();
        const isRight = (e.clientX - rect.left) > rect.width / 2;
        div.classList.add('inserted');
        doGet(div, isRight);
      });
    });

    el.querySelectorAll('.btn-del-tm').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-del-idx'));
        if (idx >= 0 && idx < tmData.length) {
          tmData.splice(idx, 1);
          await saveTM();
        }
      });
    });
  }

  // The engine emits data-tip attributes for its CSS-anchor tooltips
  // (a Chrome-extension affordance). Mirror them onto title so the
  // task pane gets native tooltips on every webview, including ones
  // without CSS Anchor Positioning support.
  document.querySelectorAll('#search [data-tip]').forEach(el => {
    if (!el.title) el.title = el.getAttribute('data-tip');
  });

  // Glossary term click → copy translation to clipboard
  document.querySelectorAll('#search .gloss_match').forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = span.getAttribute('data-tip') || span.getAttribute('title');
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        span.classList.add('gloss-copied');
        showToast(t('copiedPrefix') + text);
        setTimeout(() => span.classList.remove('gloss-copied'), 500);
      }).catch(() => {});
    });
  });

  // Uncovered term click → jump to the Glossary tab with a one-shot
  // intent (red/missing → add form prefilled; amber/registered → filter).
  // No background hop needed here: the management UI lives in this page.
  const bindUncoveredClick = (root) => {
    if (!root) return;
    root.querySelectorAll('.diff-uncovered-missing, .diff-uncovered-present').forEach(span => {
      if (span.dataset.bound === '1') return;
      span.dataset.bound = '1';
      span.style.cursor = 'pointer';
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const term = span.textContent || '';
        if (!term) return;
        const registered = span.classList.contains('diff-uncovered-present');
        applyGlossaryAction({ term, mode: registered ? 'browse' : 'add' });
        showToast((registered ? t('searchPrefix') : t('toGlossary')) + term);
      });
    });
  };
  bindUncoveredClick(el);
  bindUncoveredClick($('cell-value'));
}

// === Concordance ===
function doConcordance() {
  const query = $('conc-query').value.trim();
  if (!query) { if (lastSel) routeSelection(lastSel); return; }

  if (concRegex) {
    try { new RegExp(query, 'i'); } catch (_) { paintEmpty('invalidRegex'); return; }
  }

  const t0 = performance.now();
  const hits = FelixEngine.concordanceSearch(query, tmData, 50, concRegex);
  const ms = (performance.now() - t0).toFixed(1);

  const el = $('results');
  if (!hits.length) {
    el.innerHTML = `<div class="empty">No concordance results (${ms}ms)</div>`;
    return;
  }

  const re = concRegex ? new RegExp(query, 'gi') : null;
  const qLower = concRegex ? null : query.toLowerCase();
  function highlightTerm(text) {
    if (re) {
      let result = '', lastIdx = 0;
      for (const m of text.matchAll(re)) {
        result += esc(text.substring(lastIdx, m.index));
        result += `<span class="conc-highlight">${esc(m[0])}</span>`;
        lastIdx = m.index + m[0].length;
      }
      result += esc(text.substring(lastIdx));
      return result;
    }
    const lower = text.toLowerCase();
    let result = '', cursor = 0, pos;
    while ((pos = lower.indexOf(qLower, cursor)) !== -1) {
      result += esc(text.substring(cursor, pos));
      result += `<span class="conc-highlight">${esc(text.substring(pos, pos + query.length))}</span>`;
      cursor = pos + query.length;
    }
    result += esc(text.substring(cursor));
    return result;
  }

  el.innerHTML = `<div style="font-size:10px;color:var(--accent);margin-bottom:4px">Concordance: ${hits.length} hits (${ms}ms)</div>` +
    hits.map((h, i) => `<div class="match" data-idx="${i}" data-target="${escA(h.target)}">
      <div class="match-source">${highlightTerm(h.source)}</div>
      <div class="match-target">${highlightTerm(h.target)}</div>
    </div>`).join('');

  el.querySelectorAll('.match').forEach(div => {
    div.addEventListener('click', () => writeToTarget(div.getAttribute('data-target'), false));
  });
}

// === Insert / Set / Undo ===

async function doGet(el, editMode) {
  await writeToTarget(el.getAttribute('data-target'), editMode);
}

async function writeToTarget(value, editMode) {
  if (!lastSel) { showToast(t('selectCellFirst'), 0, true); return; }
  // Anchor row only on source/target columns — a stray click while a
  // metadata column is focused must not silently overwrite B<row>.
  if (!isSourceCol(lastSel) && !isTargetCol(lastSel)) {
    showToast(t('writeNeedsSourceOrTarget'), 0, true);
    return;
  }

  const rowNum = lastSel.rowNum;
  const sheetName = lastSel.sheetName;
  const targetRef = (settings.targetCol || 'B') + rowNum;

  const oldValue = await readCellValue(sheetName, targetRef);
  pushUndo({ sheetName, ref: targetRef, oldValue, newValue: value });

  const ok = await writeCellValue(sheetName, targetRef, value);
  if (!ok) {
    // Roll back the optimistic undo entry so a failed write doesn't
    // leave the user one Undo away from "restoring" a value that was
    // never actually written.
    _undoStack.pop();
    showToast(t('excelWriteFailed'), 0, true);
    return;
  }

  // Edit mode → jump to the target cell; otherwise → next row's source.
  await selectCellRef(sheetName, editMode ? targetRef : (settings.sourceCol || 'A') + (rowNum + 1));
}

async function undoLastWrite() {
  const entry = _undoStack.pop();
  if (!entry) { showToast(t('nothingToUndo')); return; }
  if (entry.batch && entry.batch.length) {
    // Reserved for Auto Translate (one undo entry per batch run).
    for (const b of entry.batch) {
      const ok = await writeCellValue(entry.sheetName, b.ref, b.oldValue);
      if (!ok) { showToast(t('undoSheetMissing'), 0, true); return; }
    }
    showToast(t('undoRangePrefix') + entry.batch.length);
  } else {
    const ok = await writeCellValue(entry.sheetName, entry.ref, entry.oldValue);
    if (!ok) {
      _undoStack.push(entry);
      showToast(t('undoSheetMissing'), 0, true);
      return;
    }
    showToast(t('undoRangePrefix') + entry.ref);
  }
  rerunSearch();
}

/** Register the active row's source + target pair to TM. Always reads
 *  both configured columns for the row, regardless of which cell is
 *  selected. */
async function doSet() {
  if (!lastSel) { showToast(t('selectCellFirst'), 0, true); return; }
  const rowNum = lastSel.rowNum;
  const sourceRef = (settings.sourceCol || 'A') + rowNum;
  const targetRef = (settings.targetCol || 'B') + rowNum;

  const [source, target] = await Promise.all([
    readCellValue(lastSel.sheetName, sourceRef),
    readCellValue(lastSel.sheetName, targetRef),
  ]);

  if (!source) { showToast(t('srcEmpty') + ' (' + sourceRef + ')', 0, true); return; }
  if (!target) { showToast(t('tgtEmpty'), 0, true); return; }

  const action = FelixEngine.addEntry(tmData, source, target);
  await saveTM();
  showToast(action === 'refcount' ? t('alreadyExists') : t('registered'));
  renderSearch(source, false);
}

// === Right-click → glossary registration popover ===

function pickContextMenuText(target) {
  const sel = (window.getSelection() || '').toString().trim();
  if (sel) return sel;
  if (!target || typeof target.closest !== 'function') return '';
  const span = target.closest('.gloss_match, .diff-uncovered-missing, .diff-uncovered-present, .placed-ins, .placed-badge');
  if (span && span.textContent) return span.textContent.trim();
  return '';
}

let _ctxMenuAbort = null;
function closeCtxMenu() {
  const existing = $('ctx-menu');
  if (existing) existing.remove();
  if (_ctxMenuAbort) { _ctxMenuAbort.abort(); _ctxMenuAbort = null; }
}

function openCtxMenu(x, y, text) {
  closeCtxMenu();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';

  const label = document.createElement('div');
  label.className = 'ctx-label';
  label.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
  menu.appendChild(label);

  const mkItem = (caption, onPick) => {
    const item = document.createElement('div');
    item.className = 'ctx-item';
    item.textContent = caption;
    item.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onPick();
      closeCtxMenu();
    });
    menu.appendChild(item);
  };
  mkItem(t('ctxAddTerm'), () => {
    applyGlossaryAction({ term: text, mode: 'add', prefillSide: 'term' });
    showToast(t('toTerm') + text);
  });
  mkItem(t('ctxAddTrans'), () => {
    applyGlossaryAction({ term: text, mode: 'add', prefillSide: 'translation' });
    showToast(t('toTranslation') + text);
  });
  mkItem(t('ctxBrowse'), () => {
    applyGlossaryAction({ term: text, mode: 'browse' });
    showToast(t('searchPrefix') + text);
  });

  document.body.appendChild(menu);
  // The menu attaches to body, which sits OUTSIDE the zoomed
  // #zoom-root — so click coordinates (visual px) map 1:1 onto its
  // fixed position, no scale conversion needed.
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) + 'px';

  const abort = new AbortController();
  const dismiss = (ev) => {
    if (ev.type === 'keydown' && ev.key !== 'Escape') return;
    abort.abort();
    closeCtxMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', dismiss, { capture: true, signal: abort.signal });
    document.addEventListener('keydown', dismiss, { capture: true, signal: abort.signal });
  }, 0);
  _ctxMenuAbort = abort;
}

// === Glossary action (tab jump + prefill) ===

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === name));
  if (name === 'tm') renderTMList();
  if (name === 'glossary') renderGlossaryList();
}

function applyGlossaryAction(payload) {
  if (!payload || !payload.term) return;
  switchTab('glossary');
  const termInput = $('gloss-term');
  const transInput = $('gloss-trans');
  const filterInput = $('gloss-filter');
  if (payload.mode === 'browse') {
    if (filterInput) {
      filterInput.value = payload.term;
      renderGlossaryList();
      filterInput.focus();
      filterInput.select();
    }
  } else {
    if (filterInput) filterInput.value = '';
    if (payload.prefillSide === 'translation') {
      transInput.value = payload.term;
      termInput.value = '';
      termInput.focus();
    } else {
      termInput.value = payload.term;
      transInput.value = '';
      transInput.focus();
    }
  }
}

// === Persistence ===

async function saveTM() {
  await tmSaveAll(tmData);
  dataChanged();
}
async function saveGlossary() {
  await glossarySaveAll(glossaryData);
  dataChanged();
}

/** Single-page substitute for the extension's DATA_CHANGED broadcast:
 *  refresh stats, visible lists, and the active search in one go. */
function dataChanged() {
  updateStats();
  renderTMList();
  renderGlossaryList();
  rerunSearch();
}

function updateStats() {
  const parts = [`TM: ${tmData.length}`];
  if (glossaryData.length) parts.push(`Gloss: ${glossaryData.length}`);
  $('stats-badge').textContent = parts.join(' | ');
}

// === TM management (ported from sidepanel.js) ===

async function registerTM() {
  const source = $('reg-source').value.trim();
  const target = $('reg-target').value.trim();
  if (!source || !target) return;
  const action = FelixEngine.addEntry(tmData, source, target);
  await saveTM();
  showToast(action === 'refcount' ? t('alreadyExists') : t('registered'));
  $('reg-target').value = '';
}

/** Parse TSV/CSV text that may have quoted fields with embedded newlines. */
function parseTSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++;
        let field = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else {
            field += text[i++];
          }
        }
        row.push(field);
      } else {
        let field = '';
        while (i < text.length && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
        row.push(field);
      }
      if (i < text.length && text[i] === '\t') { i++; continue; }
      if (i < text.length && text[i] === '\r') i++;
      if (i < text.length && text[i] === '\n') i++;
      break;
    }
    if (row.length > 0 && row.some(f => f.trim())) rows.push(row);
  }
  return rows;
}

function renderTMList() {
  const filter = ($('tm-filter').value || '').toLowerCase();
  const el = $('tm-list');
  let filtered = tmData;
  if (filter) {
    filtered = tmData.filter(e =>
      e.source.toLowerCase().includes(filter) || e.target.toLowerCase().includes(filter));
  }
  const showing = filtered.slice(0, 100);
  $('tm-list-count').textContent = `${showing.length} / ${tmData.length} entries`;

  if (!showing.length) { el.innerHTML = '<div class="empty">No entries</div>'; return; }

  el.innerHTML = showing.map((e) => {
    const ref = e.refcount ? ` <span style="color:var(--faint)">(${e.refcount}x)</span>` : '';
    const idx = tmData.indexOf(e);
    return `<div class="match" style="cursor:default;padding:8px;position:relative" data-tm-idx="${idx}">
      <span style="position:absolute;top:6px;right:8px;display:flex;gap:4px">
        <span style="font-size:13px;color:var(--accent);cursor:pointer" data-tm-edit="${idx}" title="Edit">✎</span>
        <span style="font-size:13px;color:var(--danger-line);cursor:pointer" data-tm-del="${idx}" title="Delete">✕</span>
      </span>
      <div class="match-source">${escH(e.source)}${ref}</div>
      <div class="match-target">${escH(e.target)}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-tm-del]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      tmData.splice(parseInt(btn.getAttribute('data-tm-del')), 1);
      await saveTM();
    });
  });
  el.querySelectorAll('[data-tm-edit]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      editTMEntry(parseInt(btn.getAttribute('data-tm-edit')));
    });
  });
}

function editTMEntry(idx) {
  const entry = tmData[idx];
  if (!entry) return;
  const div = document.querySelector(`[data-tm-idx="${idx}"]`);
  if (!div) return;

  div.innerHTML = `
    <input type="text" value="${escH(entry.source)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="source">
    <input type="text" value="${escH(entry.target)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="target">
    <div style="display:flex;gap:4px">
      <button class="btn btn-primary" style="flex:1;padding:3px 6px;font-size:12px" data-save>OK</button>
      <button class="btn" style="flex:1;padding:3px 6px;font-size:12px" data-cancel>Cancel</button>
    </div>`;

  div.querySelector('[data-save]').addEventListener('click', async () => {
    const newSrc = div.querySelector('[data-field="source"]').value.trim();
    const newTgt = div.querySelector('[data-field="target"]').value.trim();
    if (newSrc && newTgt) {
      entry.source = newSrc;
      entry.target = newTgt;
      entry.cmp = FelixEngine.makeCmp(newSrc);
      entry.targetCmp = FelixEngine.makeCmp(newTgt);
      entry.sourceLen = entry.cmp.length;
      await saveTM();
    } else {
      renderTMList();
    }
  });
  div.querySelector('[data-cancel]').addEventListener('click', () => renderTMList());
}

// === Glossary management ===

async function addGlossary() {
  const term = $('gloss-term').value.trim();
  const trans = $('gloss-trans').value.trim();
  if (!term || !trans) return;
  const action = FelixEngine.addGlossaryEntry(glossaryData, term, trans);
  if (action === 'added') {
    await saveGlossary();
    showToast(t('glossAdded'));
  } else {
    showToast(t('glossExists'));
  }
  $('gloss-term').value = '';
  $('gloss-trans').value = '';
}

function processGlossaryText(text) {
  if (!text || !text.trim()) return;
  const rows = parseTSV(text);
  const startIdx = (rows.length > 0 && rows[0].length >= 1 &&
    /^(term|用語|source|en|src)/i.test(rows[0][0].trim())) ? 1 : 0;
  let added = 0, dup = 0;
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (row.length >= 2 && row[0].trim() && row[1].trim()) {
      const notes = row.length >= 3 ? row[2].trim() : '';
      const action = FelixEngine.addGlossaryEntry(glossaryData, row[0].trim(), row[1].trim(), notes);
      if (action === 'added') added++; else dup++;
    }
  }
  saveGlossary();
  showToast(`${added} added, ${dup} duplicates`);
}

function renderGlossaryList() {
  const filter = ($('gloss-filter').value || '').toLowerCase();
  const el = $('gloss-list');
  let filtered = glossaryData;
  if (filter) {
    filtered = glossaryData.filter(g =>
      g.term.toLowerCase().includes(filter) || g.translation.toLowerCase().includes(filter));
  }
  const showing = filtered.slice(0, 100);
  $('gloss-list-count').textContent = `${showing.length} / ${glossaryData.length} entries`;

  if (!showing.length) { el.innerHTML = '<div class="empty">No glossary entries</div>'; return; }

  el.innerHTML = showing.map((g) => {
    const idx = glossaryData.indexOf(g);
    return `<div class="match" style="cursor:default;padding:8px;position:relative" data-gloss-idx="${idx}">
      <span style="position:absolute;top:6px;right:8px;display:flex;gap:4px">
        <span style="font-size:13px;color:var(--accent);cursor:pointer" data-gloss-edit="${idx}" title="Edit">✎</span>
        <span style="font-size:13px;color:var(--danger-line);cursor:pointer" data-del="${idx}" title="Delete">✕</span>
      </span>
      <div class="match-source">${escH(g.term)}</div>
      <div class="match-target">${escH(g.translation)}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      glossaryData.splice(parseInt(btn.getAttribute('data-del')), 1);
      await saveGlossary();
    });
  });
  el.querySelectorAll('[data-gloss-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editGlossaryEntry(parseInt(btn.getAttribute('data-gloss-edit')));
    });
  });
}

function editGlossaryEntry(idx) {
  const entry = glossaryData[idx];
  if (!entry) return;
  const div = document.querySelector(`[data-gloss-idx="${idx}"]`);
  if (!div) return;

  div.innerHTML = `
    <input type="text" value="${escH(entry.term)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="term">
    <input type="text" value="${escH(entry.translation)}" style="width:100%;margin-bottom:4px;font-size:13px;padding:4px" data-field="translation">
    <div style="display:flex;gap:4px">
      <button class="btn btn-primary" style="flex:1;padding:3px 6px;font-size:12px" data-save>OK</button>
      <button class="btn" style="flex:1;padding:3px 6px;font-size:12px" data-cancel>Cancel</button>
    </div>`;

  div.querySelector('[data-save]').addEventListener('click', async () => {
    const newTerm = div.querySelector('[data-field="term"]').value.trim();
    const newTrans = div.querySelector('[data-field="translation"]').value.trim();
    if (newTerm && newTrans) {
      entry.term = newTerm;
      entry.translation = newTrans;
      entry.cmp = FelixEngine.makeCmp(newTerm);
      await saveGlossary();
    } else {
      renderGlossaryList();
    }
  });
  div.querySelector('[data-cancel]').addEventListener('click', () => renderGlossaryList());
}

// === Workbook import ===

/** "A2:A" / "A2:A500" / "A" / "A2" → { col, startRow, endRow|null }.
 *  Per-column spec: only the first column letter matters. */
function parseColSpec(spec) {
  const m = String(spec || '').trim().match(/^([A-Za-z]{1,3})(\d*)(?::([A-Za-z]{1,3})?(\d*))?$/);
  if (!m) return null;
  return {
    col: m[1].toUpperCase(),
    startRow: m[2] ? parseInt(m[2]) : 1,
    endRow: m[4] ? parseInt(m[4]) : null,
  };
}

/** Read two column ranges from the active worksheet. Open-ended specs
 *  (A2:A) are clamped to the sheet's used range — the Office.js
 *  equivalent of the Sheets API's unbounded-range behaviour. */
async function readWorkbookRange(srcId, tgtId) {
  const src = parseColSpec($(srcId).value || 'A2:A');
  const tgt = parseColSpec($(tgtId).value || 'B2:B');
  if (!src || !tgt) { showToast(t('badRange'), 0, true); return null; }

  const result = await excelRun(async (ctx) => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used = sheet.getUsedRange();
    used.load(['rowIndex', 'rowCount']);
    await ctx.sync();
    const lastRow = used.rowIndex + used.rowCount;

    const mk = (s) => {
      const end = Math.min(s.endRow || lastRow, lastRow);
      if (end < s.startRow) return null;
      return sheet.getRange(`${s.col}${s.startRow}:${s.col}${end}`);
    };
    const sr = mk(src), tr = mk(tgt);
    if (!sr || !tr) return { srcValues: [], tgtValues: [] };
    sr.load('values');
    tr.load('values');
    await ctx.sync();
    return {
      srcValues: sr.values.map(r => cellText(r[0]).trim()),
      tgtValues: tr.values.map(r => cellText(r[0]).trim()),
    };
  });
  if (!result) { showToast(t('excelReadFailed'), 0, true); return null; }
  return result;
}

async function importFromWorkbook() {
  const data = await readWorkbookRange('import-src-range', 'import-tgt-range');
  if (!data) return;
  const len = Math.max(data.srcValues.length, data.tgtValues.length);
  let added = 0, updated = 0, skipped = 0;
  for (let i = 0; i < len; i++) {
    const src = data.srcValues[i] || '';
    const tgt = data.tgtValues[i] || '';
    if (src && tgt) {
      const action = FelixEngine.addEntry(tmData, src, tgt);
      if (action === 'added') added++; else updated++;
    } else { skipped++; }
  }
  await saveTM();
  showToast(`${t('imported')}: ${added} new, ${updated} updated, ${skipped} skipped (${len} rows)`);
}

async function importGlossaryFromWorkbook() {
  const data = await readWorkbookRange('gloss-import-src-range', 'gloss-import-tgt-range');
  if (!data) return;
  const len = Math.max(data.srcValues.length, data.tgtValues.length);
  let added = 0, dup = 0;
  for (let i = 0; i < len; i++) {
    const term = data.srcValues[i] || '';
    const trans = data.tgtValues[i] || '';
    if (term && trans) {
      const action = FelixEngine.addGlossaryEntry(glossaryData, term, trans);
      if (action === 'added') added++; else dup++;
    }
  }
  await saveGlossary();
  showToast(`${added} added, ${dup} duplicates (${len} rows)`);
}

/** Reflect the current worksheet selection into the import range inputs.
 *  Two-column selections split into src/tgt; single column fills src. */
function applySelectionToImportRanges(selRef) {
  const m = selRef.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/i);
  if (!m) return;
  const col1 = m[1].toUpperCase(), row1 = m[2] || '';
  const col2 = m[3] ? m[3].toUpperCase() : col1;
  const row2 = m[4] || '';
  const pairs = [
    ['import-src-range', 'import-tgt-range'],
    ['gloss-import-src-range', 'gloss-import-tgt-range'],
  ];
  for (const [srcId, tgtId] of pairs) {
    if (col1 !== col2) {
      $(srcId).value = `${col1}${row1}:${col1}${row2}`;
      $(tgtId).value = `${col2}${row1}:${col2}${row2}`;
    } else {
      $(srcId).value = selRef;
    }
  }
}

// === File import / export ===

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'tmx') importTMX(text);
    else importTSV(text);
  };
  reader.readAsText(file, 'utf-8');
}

function handleGlossaryFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => processGlossaryText(e.target.result);
  reader.readAsText(file, 'utf-8');
}

function importTMX(xml) {
  let records;
  try {
    ({ records } = FelixEngine.parseTmx(xml));
  } catch (e) {
    showToast('TMX parse failed: ' + (e && e.message || 'malformed XML'), 0, true);
    return;
  }
  if (!records || !records.length) { showToast('No entries found in TMX', 0, true); return; }
  let added = 0, dups = 0;
  for (const r of records) {
    if (!r.source || !r.target) continue;
    const status = FelixEngine.addEntry(tmData, r.source, r.target, {
      context: r.context || '',
      createdBy: r.createdBy || '',
      modifiedBy: r.modifiedBy || '',
      created: r.created || undefined,
      modified: r.modified || undefined,
    });
    if (status === 'added') added++; else dups++;
  }
  saveTM();
  showToast(`Imported ${added} new entries from TMX${dups ? ` (${dups} dups skipped)` : ''}`);
}

function importTSV(text) {
  const rows = parseTSV(text);
  let added = 0;
  const startIdx = (rows.length > 0 && rows[0].length >= 1 && /source/i.test(rows[0][0])) ? 1 : 0;
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (row.length >= 2 && row[0].trim() && row[1].trim()) {
      FelixEngine.addEntry(tmData, row[0].trim(), row[1].trim());
      added++;
    }
  }
  saveTM();
  showToast(`Imported ${added} entries from TSV`);
}

function exportTSV() {
  const lines = ['source\ttarget\tcontext\trefcount'];
  for (const e of tmData) {
    lines.push(`${e.source}\t${e.target}\t${e.context || ''}\t${e.refcount || 0}`);
  }
  downloadText(lines.join('\n'), 'felix-tm-export.tsv');
}

function exportTMX() {
  const xml = FelixEngine.serializeTmx(tmData, {
    sourceLang: (settings.sourceLang || 'en').toLowerCase(),
    targetLang: (settings.targetLang || 'ja').toLowerCase(),
    creationTool: 'Felix TM',
    creationToolVersion: '1.0',
  });
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'felix-tm-export.tmx'; a.click();
  URL.revokeObjectURL(url);
}

function exportGlossaryTSV() {
  const lines = ['term\ttranslation\tnotes'];
  for (const e of glossaryData) {
    lines.push(`${e.term}\t${e.translation}\t${e.notes || ''}`);
  }
  downloadText(lines.join('\n'), 'felix-glossary-export.tsv');
}

function downloadText(text, filename) {
  const blob = new Blob(['\uFEFF' + text], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// === Settings UI ===

/** Pane-wide zoom, adjusted via the −/＋ header buttons in 10% steps.
 *  `zoom` is supported by both webviews Office uses (WebView2 on
 *  Windows, WKWebView on Mac) and by every browser the web version
 *  runs in. Windows panes render notably small at 100%. */
function uiScale() { return parseFloat(settings.uiScale) || 1; }
function applyUiScale() {
  // Zoom only the content wrapper, not body. Zooming body and
  // counter-zooming the header looked right at first but the nested
  // zoom made the header lay out against a doubled width (badge and
  // buttons drifted / got clipped at high scale). With the header
  // outside the zoomed subtree it needs no compensation at all.
  $('zoom-root').style.zoom = String(uiScale());
  $('scale-label').textContent = Math.round(uiScale() * 100) + '%';
}
function nudgeUiScale(step) {
  settings.uiScale = Math.min(2, Math.max(0.7, Math.round((uiScale() + step) * 10) / 10));
  settingsSave(settings);
  applyUiScale();
}

function loadSettingsUI() {
  $('set-lang').value = settings.lang || 'en';
  $('set-source-col').value = settings.sourceCol || 'A';
  $('set-target-col').value = settings.targetCol || 'B';
  $('set-min-score').value = String(settings.minScore || 0.7);
  $('min-score').value = String(settings.minScore || 0.7);
}

async function saveSettingsUI() {
  settings.lang = $('set-lang').value;
  settings.sourceCol = $('set-source-col').value.toUpperCase();
  settings.targetCol = $('set-target-col').value.toUpperCase();
  settings.minScore = parseFloat($('set-min-score').value);
  await settingsSave(settings);
  $('min-score').value = String(settings.minScore);
  applyLang();
  showToast(t('saved'));
  rerunSearch();
}

function inlineConfirm(btnId, message, onConfirm) {
  const btn = $(btnId);
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:4px;align-items:center;width:100%;margin-bottom:' + (btn.style.marginBottom || '0');
  div.innerHTML = `<span style="font-size:12px;color:var(--danger-line);flex:1">${escH(message)}</span>
    <button class="btn btn-danger" style="padding:5px 10px;font-size:12px" data-ok>OK</button>
    <button class="btn" style="padding:5px 10px;font-size:12px" data-cancel>${t('cancel')}</button>`;
  function restore() { div.replaceWith(btn); }
  btn.replaceWith(div);
  div.querySelector('[data-ok]').addEventListener('click', () => { restore(); onConfirm(); });
  div.querySelector('[data-cancel]').addEventListener('click', restore);
}

function clearAllTM() {
  inlineConfirm('btn-clear-tm', t('confirmClear'), async () => {
    tmData = [];
    await saveTM();
    showToast('TM cleared');
  });
}

function clearAllGlossary() {
  inlineConfirm('btn-clear-gloss', t('confirmClear'), async () => {
    glossaryData = [];
    await saveGlossary();
    showToast('Glossary cleared');
  });
}

// === Toast ===

let _toastTimer = null;
function showToast(text, ms, isError) {
  const container = $('global-toast');
  container.querySelector('div').textContent = text;
  container.classList.toggle('toast-error', !!isError);
  container.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { container.style.display = 'none'; }, ms || (isError ? 3500 : 2000));
}

// === i18n application ===

function applyLang() {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const ph = (id, text) => { const el = $(id); if (el) el.placeholder = text; };
  const tip = (id, text) => { const el = $(id); if (el) el.title = text; };

  // Tabs
  set('tab-search', t('search'));
  set('tab-tm', t('tm'));
  set('tab-glossary', t('glossary'));
  set('tab-settings', t('settings'));
  // Search pane
  set('lbl-cell', t('activeCell'));
  set('lbl-empty', t('selectCell'));
  tip('btn-undo', t('tipUndo'));
  tip('btn-set', t('tipSet'));
  tip('mode-translate', t('tipModeTranslate'));
  tip('mode-review', t('tipModeReview'));
  tip('min-score', t('tipMinScore'));
  tip('conc-query', t('tipConcordance'));
  tip('btn-regex', t('tipRegex'));
  ph('conc-query', t('phConcordance'));
  // TM
  set('h-register', t('registerToTM'));
  set('btn-register', t('register'));
  ph('reg-source', t('source'));
  ph('reg-target', t('target'));
  set('h-build', t('import'));
  set('p-wb-import-desc', t('wbImportDesc'));
  set('btn-import-wb', t('importFromWb'));
  set('drop-text', t('dropFile'));
  set('h-browse-tm', t('browseTM'));
  ph('tm-filter', t('filter'));
  set('h-export', t('export'));
  set('btn-export-tm', t('exportTM'));
  set('btn-export-tmx', t('exportTMX'));
  // Glossary
  set('h-add-term', t('addTerm'));
  ph('gloss-term', t('termSrc'));
  ph('gloss-trans', t('termTgt'));
  set('btn-add-gloss', t('add'));
  set('h-gloss-import', t('import'));
  set('p-gloss-wb-desc', t('glossWbImportDesc'));
  set('btn-import-gloss-wb', t('importFromWb'));
  set('gloss-drop-text', t('dropGlossFile'));
  set('h-browse-gloss', t('browse'));
  ph('gloss-filter', t('filter'));
  set('h-gloss-export', t('export'));
  set('btn-export-gloss', t('exportGloss'));
  // Settings
  set('h-settings', t('settings'));
  tip('btn-scale-down', t('lblUiScale'));
  tip('btn-scale-up', t('lblUiScale'));
  set('btn-save-settings', t('save'));
  set('h-danger', t('danger'));
  set('btn-clear-tm', t('clearTM'));
  set('btn-clear-gloss', t('clearGloss'));
}

// === Selection change plumbing ===

// DocumentSelectionChanged can fire in bursts while the user drags a
// selection; debounce so we read the final state once.
let _selTimer = null;
function scheduleSelectionCheck() {
  clearTimeout(_selTimer);
  _selTimer = setTimeout(onSelectionChanged, 120);
}

async function onSelectionChanged() {
  const sel = await getSelectionInfo();
  if (!sel) return; // multi-area selection or transient Excel error
  const unchanged = lastSel && lastSel.sheetName === sel.sheetName &&
    lastSel.ref === sel.ref && lastSel.value === sel.value;
  lastSel = sel;
  applySelectionToImportRanges(sel.selRef);
  if (unchanged) return;
  // Concordance input overrides cell-driven search while non-empty.
  if ($('conc-query').value.trim()) { updateCellPreview(sel); return; }
  await routeSelection(sel);
}

// === Init ===

async function init(hasExcel) {
  settings = Object.assign(settings, await settingsGet().catch(() => ({})));
  tmData = await tmGetAll().catch(() => []) || [];
  glossaryData = await glossaryGetAll().catch(() => []) || [];
  rulesData = await rulesGetAll().catch(() => []) || [];

  updateStats();
  applyLang();
  applyUiScale();
  loadSettingsUI();
  renderTMList();
  renderGlossaryList();

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.panel));
  });

  // Search pane controls
  $('btn-undo').addEventListener('click', () => undoLastWrite());
  $('btn-set').addEventListener('click', () => doSet());
  $('min-score').addEventListener('change', () => {
    settings.minScore = parseFloat($('min-score').value);
    settingsSave(settings);
    $('set-min-score').value = String(settings.minScore);
    rerunSearch();
  });
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panelMode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('mode-active'));
      btn.classList.add('mode-active');
      rerunSearch();
    });
  });
  $('btn-regex').addEventListener('click', (e) => {
    concRegex = !concRegex;
    e.target.classList.toggle('active', concRegex);
  });
  let _concTimer = null;
  $('conc-query').addEventListener('input', () => {
    clearTimeout(_concTimer);
    _concTimer = setTimeout(() => doConcordance(), 150);
  });
  // Right-click inside the search pane → glossary registration popover.
  $('search').addEventListener('contextmenu', (e) => {
    const text = pickContextMenuText(e.target);
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    openCtxMenu(e.clientX, e.clientY, text);
  });

  // TM management
  $('btn-register').addEventListener('click', () => registerTM());
  $('btn-import-wb').addEventListener('click', () => importFromWorkbook());
  $('tm-filter').addEventListener('input', () => renderTMList());
  $('btn-export-tm').addEventListener('click', () => exportTSV());
  $('btn-export-tmx').addEventListener('click', () => exportTMX());

  // Glossary management
  $('btn-add-gloss').addEventListener('click', () => addGlossary());
  $('btn-import-gloss-wb').addEventListener('click', () => importGlossaryFromWorkbook());
  $('gloss-filter').addEventListener('input', () => renderGlossaryList());
  $('btn-export-gloss').addEventListener('click', () => exportGlossaryTSV());

  // File drop zones
  const wireDrop = (zoneId, inputId, handler) => {
    const zone = $(zoneId);
    const input = $(inputId);
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--border)'; });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.style.borderColor = 'var(--border)';
      if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) handler(input.files[0]); });
  };
  wireDrop('drop-zone', 'file-input', handleFile);
  wireDrop('gloss-drop-zone', 'gloss-file-input', handleGlossaryFile);

  // Settings
  $('btn-save-settings').addEventListener('click', () => saveSettingsUI());
  $('set-lang').addEventListener('change', async (e) => {
    settings.lang = e.target.value;
    await settingsSave(settings);
    applyLang();
  });
  $('btn-scale-down').addEventListener('click', () => nudgeUiScale(-0.1));
  $('btn-scale-up').addEventListener('click', () => nudgeUiScale(0.1));
  $('btn-clear-tm').addEventListener('click', () => clearAllTM());
  $('btn-clear-gloss').addEventListener('click', () => clearAllGlossary());

  // Selection tracking — the Office.js replacement for content.js's
  // 200ms DOM polling loop. Outside an Office host (plain browser,
  // for UI development) the search pane just stays on its placeholder;
  // the management tabs are fully usable either way.
  if (hasExcel) {
    Office.context.document.addHandlerAsync(
      Office.EventType.DocumentSelectionChanged,
      scheduleSelectionCheck,
      () => scheduleSelectionCheck() // initial paint once the handler is live
    );
  }
}

Office.onReady((info) => {
  init(info.host === Office.HostType.Excel);
});
