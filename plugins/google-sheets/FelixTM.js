/**
 * Felix TM - Google Sheets Translation Memory Plugin
 *
 * Core TM engine (Levenshtein fuzzy matching) ported from felix-tm Python.
 * Based on Felix CAT System by Ryan Ginstrom (MIT License).
 * https://github.com/ibushimaru/felix-tm
 */

// ============================================================
// Menu & Initialization
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Felix TM')
    .addItem('Open Sidebar', 'showSidebar')
    .addSeparator()
    .addItem('TM Lookup (selected cell)', 'tmLookupSelected')
    .addItem('Set Translation + Next Row', 'setAndNext')
    .addSeparator()
    .addItem('Register Selection to TM', 'registerSelectionToTM')
    .addItem('Build TM from Sheet', 'buildTMFromSheetPrompt')
    .addSeparator()
    .addItem('Highlight Glossary Terms', 'highlightGlossaryTerms')
    .addItem('Export Glossary to Sheet', 'exportGlossaryToSheet')
    .addSeparator()
    .addItem('Settings', 'showSettings')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Felix TM')
    .setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ============================================================
// Settings (stored in Script Properties)
// ============================================================

const DEFAULT_SETTINGS = {
  sourceCol: 'A',
  targetCol: 'B',
  minScore: 0.7,
  tmSheetName: '_FelixTM',
  glossarySheetName: '_FelixGlossary',
};

function getSettings() {
  const props = PropertiesService.getDocumentProperties();
  const saved = props.getProperty('felixSettings');
  if (saved) {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('felixSettings', JSON.stringify(settings));
  return settings;
}

function showSettings() {
  const html = HtmlService.createHtmlOutputFromFile('Settings')
    .setWidth(350)
    .setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, 'Settings');
}

// ============================================================
// TM Storage (dedicated sheet)
// ============================================================

function _getTMSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSettings();
  let sheet = ss.getSheetByName(settings.tmSheetName);
  if (!sheet) {
    sheet = ss.insertSheet(settings.tmSheetName);
    sheet.appendRow(['source', 'target', 'context', 'source_cmp', 'score_cache']);
    sheet.setFrozenRows(1);
    // Hide the TM sheet
    sheet.hideSheet();
  }
  return sheet;
}

function _getGlossarySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getSettings();
  let sheet = ss.getSheetByName(settings.glossarySheetName);
  if (!sheet) {
    sheet = ss.insertSheet(settings.glossarySheetName);
    sheet.appendRow(['term', 'translation', 'notes', 'term_cmp']);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function getTMCount() {
  const sheet = _getTMSheet();
  return Math.max(0, sheet.getLastRow() - 1);
}

function getGlossaryCount() {
  const sheet = _getGlossarySheet();
  return Math.max(0, sheet.getLastRow() - 1);
}

// ============================================================
// Core: Text Normalization (port of segment.py)
// ============================================================

function _stripTags(text) {
  return text.replace(/<[^>]+>/g, '');
}

function _normalizeWidth(text) {
  // Full-width ASCII -> half-width
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Full-width ASCII: FF01-FF5E -> 0021-007E
    if (code >= 0xFF01 && code <= 0xFF5E) {
      result += String.fromCharCode(code - 0xFEE0);
    }
    // Full-width space
    else if (code === 0x3000) {
      result += ' ';
    } else {
      result += text[i];
    }
  }
  return result;
}

function _normalizeHiraToKata(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Hiragana: 3041-3096 -> Katakana: 30A1-30F6
    if (code >= 0x3041 && code <= 0x3096) {
      result += String.fromCharCode(code + 0x60);
    } else {
      result += text[i];
    }
  }
  return result;
}

function makeCmp(text) {
  let s = _stripTags(text);
  s = _normalizeWidth(s);
  s = s.toLowerCase();
  s = _normalizeHiraToKata(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function containsCJK(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0x3000 && code <= 0x9FFF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFF00 && code <= 0xFFEF)) {
      return true;
    }
  }
  return false;
}

// ============================================================
// Core: Levenshtein Edit Distance (port of distance.py)
// ============================================================

function editDistance(source, target, maxDistance) {
  const n = source.length;
  const m = target.length;

  if (n === 0) return m;
  if (m === 0) return n;

  // Skip matching prefix
  let prefix = 0;
  while (prefix < n && prefix < m && source[prefix] === target[prefix]) prefix++;

  // Skip matching suffix
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix &&
         source[n - 1 - suffix] === target[m - 1 - suffix]) suffix++;

  const s = source.substring(prefix, n - suffix);
  const t = target.substring(prefix, m - suffix);
  const n2 = s.length;
  const m2 = t.length;

  if (n2 === 0) return m2;
  if (m2 === 0) return n2;

  // Single char optimization
  if (n2 === 1) return s[0] === t.indexOf(s[0]) >= 0 ? m2 - 1 : m2;
  if (m2 === 1) return t[0] === s.indexOf(t[0]) >= 0 ? n2 - 1 : n2;

  // Ensure shorter string in inner loop
  let rows, cols;
  if (n2 > m2) { rows = t; cols = s; } else { rows = s; cols = t; }
  const rl = rows.length;
  const cl = cols.length;

  if (maxDistance === undefined) maxDistance = cl;

  const row = [];
  for (let i = 0; i <= rl; i++) row[i] = i;

  for (let j = 1; j <= cl; j++) {
    let prev = row[0];
    row[0] = j;
    let rowMin = j;

    for (let i = 1; i <= rl; i++) {
      const cost = rows[i - 1] === cols[j - 1] ? 0 : 1;
      const temp = row[i];
      row[i] = Math.min(row[i] + 1, row[i - 1] + 1, prev + cost);
      prev = temp;
      if (row[i] < rowMin) rowMin = row[i];
    }

    if (rowMin > maxDistance) return maxDistance + 1;
  }

  return row[rl];
}

function editDistanceScore(source, target, minScore) {
  if (!source && !target) return 1.0;
  const highLen = Math.max(source.length, target.length);
  if (highLen === 0) return 1.0;

  const maxDist = Math.floor(highLen * (1.0 - (minScore || 0)));
  const dist = editDistance(source, target, maxDist);

  if (dist > maxDist) return 0.0;
  return (highLen - dist) / highLen;
}

function bagDistance(source, target) {
  const freqS = {};
  const freqT = {};
  for (const ch of source) freqS[ch] = (freqS[ch] || 0) + 1;
  for (const ch of target) freqT[ch] = (freqT[ch] || 0) + 1;

  const allChars = new Set([...Object.keys(freqS), ...Object.keys(freqT)]);
  let diff = 0;
  for (const ch of allChars) {
    diff += Math.abs((freqS[ch] || 0) - (freqT[ch] || 0));
  }
  return diff;
}

// ============================================================
// Core: Fuzzy Match (port of match_maker.py)
// ============================================================

function fuzzyMatchScore(queryCmp, sourceCmp, minScore) {
  if (queryCmp === sourceCmp) return 1.0;

  const qLen = queryCmp.length;
  const sLen = sourceCmp.length;
  const highLen = Math.max(qLen, sLen);

  if (highLen === 0) return 1.0;

  // Pass 1: Length check
  const diff = highLen - Math.min(qLen, sLen);
  if ((highLen - diff) / highLen < minScore) return 0.0;

  // Pass 2: Bag-of-characters
  const bagDist = bagDistance(queryCmp, sourceCmp);
  const bagScore = (highLen - bagDist) / highLen;
  if (bagScore < minScore) return 0.0;

  // Pass 3: Edit distance
  const score = editDistanceScore(queryCmp, sourceCmp, minScore);
  return score >= minScore ? score : 0.0;
}

// ============================================================
// TM Operations
// ============================================================

function tmLookup(query, minScore) {
  if (!query || query.trim() === '') return [];

  const settings = getSettings();
  if (minScore === undefined) minScore = settings.minScore;

  const queryCmp = makeCmp(query);
  const sheet = _getTMSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const matches = [];

  for (let i = 0; i < data.length; i++) {
    const source = data[i][0];
    const target = data[i][1];
    const sourceCmp = data[i][3] || makeCmp(source);

    const score = fuzzyMatchScore(queryCmp, sourceCmp, minScore);
    if (score >= minScore) {
      matches.push({
        score: score,
        source: source,
        target: target,
        context: data[i][2] || '',
        row: i + 2,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 20);
}

function tmLookupSelected() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getActiveCell();
  const sourceCol = settings.sourceCol.toUpperCase().charCodeAt(0) - 64;
  const query = sheet.getRange(cell.getRow(), sourceCol).getValue();

  if (!query) {
    SpreadsheetApp.getUi().alert('Source cell is empty.');
    return;
  }

  const matches = tmLookup(String(query), settings.minScore);
  if (matches.length === 0) {
    SpreadsheetApp.getUi().alert('No matches found.');
    return;
  }

  // Show top match
  const top = matches[0];
  const pct = Math.round(top.score * 100);
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    `TM Match: ${pct}%`,
    `Source: ${top.source}\nTarget: ${top.target}\n\nInsert this translation?`,
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    const targetCol = settings.targetCol.toUpperCase().charCodeAt(0) - 64;
    sheet.getRange(cell.getRow(), targetCol).setValue(top.target);
  }
}

function addToTM(source, target, context) {
  if (!source || !target) return;
  const sheet = _getTMSheet();
  const sourceCmp = makeCmp(source);
  sheet.appendRow([source, target, context || '', sourceCmp]);
}

function registerSelectionToTM() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getActiveCell();
  const row = cell.getRow();
  const sourceCol = settings.sourceCol.toUpperCase().charCodeAt(0) - 64;
  const targetCol = settings.targetCol.toUpperCase().charCodeAt(0) - 64;

  const source = String(sheet.getRange(row, sourceCol).getValue()).trim();
  const target = String(sheet.getRange(row, targetCol).getValue()).trim();

  if (!source || !target) {
    SpreadsheetApp.getUi().alert('Both source and target cells must have content.');
    return;
  }

  addToTM(source, target);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Registered: "${source.substring(0, 30)}..." → "${target.substring(0, 30)}..."`,
    'Felix TM', 3
  );
}

function buildTMFromSheetPrompt() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    'Build TM',
    'Build Translation Memory from all rows in the active sheet?\n' +
    'This will read the source and target columns defined in Settings.',
    ui.ButtonSet.YES_NO
  );
  if (result === ui.Button.YES) {
    buildTMFromSheet();
  }
}

function buildTMFromSheet() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const sourceCol = settings.sourceCol.toUpperCase().charCodeAt(0) - 64;
  const targetCol = settings.targetCol.toUpperCase().charCodeAt(0) - 64;

  const tmSheet = _getTMSheet();
  let count = 0;
  const batchRows = [];

  for (let row = 2; row <= lastRow; row++) {
    const source = String(sheet.getRange(row, sourceCol).getValue()).trim();
    const target = String(sheet.getRange(row, targetCol).getValue()).trim();

    if (source && target) {
      batchRows.push([source, target, '', makeCmp(source)]);
      count++;
    }
  }

  if (batchRows.length > 0) {
    tmSheet.getRange(tmSheet.getLastRow() + 1, 1, batchRows.length, 4).setValues(batchRows);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Added ${count} entries to TM (total: ${getTMCount()})`,
    'Felix TM', 5
  );
}

function setAndNext() {
  // Called from sidebar - insert translation and move to next row
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getActiveCell();
  const nextRow = cell.getRow() + 1;
  const sourceCol = settings.sourceCol.toUpperCase().charCodeAt(0) - 64;

  // Move to next row's source cell
  sheet.getRange(nextRow, sourceCol).activate();
}

// ============================================================
// Glossary Operations
// ============================================================

function addToGlossary(term, translation, notes) {
  if (!term || !translation) return;
  const sheet = _getGlossarySheet();
  sheet.appendRow([term, translation, notes || '', makeCmp(term)]);
}

function getGlossaryTerms() {
  const sheet = _getGlossarySheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, 3).getValues().map(r => ({
    term: r[0], translation: r[1], notes: r[2]
  }));
}

function highlightGlossaryTerms() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const sourceCol = settings.sourceCol.toUpperCase().charCodeAt(0) - 64;
  const lastRow = sheet.getLastRow();

  const terms = getGlossaryTerms();
  if (terms.length === 0) {
    SpreadsheetApp.getUi().alert('Glossary is empty.');
    return;
  }

  let highlightCount = 0;
  const yellow = SpreadsheetApp.newColor().setRgbColor('#FFF2CC').build();

  for (let row = 2; row <= lastRow; row++) {
    const cell = sheet.getRange(row, sourceCol);
    const text = String(cell.getValue()).toLowerCase();

    let found = false;
    for (const entry of terms) {
      if (text.includes(entry.term.toLowerCase())) {
        found = true;
        break;
      }
    }

    if (found) {
      cell.setBackground('#FFF2CC');
      highlightCount++;
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Highlighted ${highlightCount} cells containing glossary terms.`,
    'Felix TM', 5
  );
}

function exportGlossaryToSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const terms = getGlossaryTerms();

  if (terms.length === 0) {
    SpreadsheetApp.getUi().alert('Glossary is empty.');
    return;
  }

  let exportSheet = ss.getSheetByName('Glossary Export');
  if (exportSheet) ss.deleteSheet(exportSheet);
  exportSheet = ss.insertSheet('Glossary Export');

  exportSheet.appendRow(['Term', 'Translation', 'Notes']);
  exportSheet.getRange(1, 1, 1, 3).setFontWeight('bold');

  const rows = terms.map(t => [t.term, t.translation, t.notes]);
  if (rows.length > 0) {
    exportSheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }

  exportSheet.autoResizeColumns(1, 3);
  ss.setActiveSheet(exportSheet);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Exported ${terms.length} glossary entries.`,
    'Felix TM', 5
  );
}

// ============================================================
// API for Sidebar
// ============================================================

function sidebarSearch(query, minScore, searchType) {
  if (searchType === 'glossary') {
    return glossaryLookup(query);
  }
  return tmLookup(query, minScore);
}

function glossaryLookup(query) {
  const queryCmp = makeCmp(query);
  const terms = getGlossaryTerms();
  const matches = [];

  for (const entry of terms) {
    const termCmp = makeCmp(entry.term);
    if (queryCmp.includes(termCmp) || termCmp.includes(queryCmp)) {
      matches.push({
        score: 1.0,
        source: entry.term,
        target: entry.translation,
        context: entry.notes,
      });
    }
  }
  return matches;
}

function sidebarInsertTranslation(target, rowOffset) {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getActiveCell();
  const targetCol = settings.targetCol.toUpperCase().charCodeAt(0) - 64;
  const row = cell.getRow() + (rowOffset || 0);

  sheet.getRange(row, targetCol).setValue(target);

  // Also register to TM
  const sourceCol = settings.sourceCol.toUpperCase().charCodeAt(0) - 64;
  const source = String(sheet.getRange(row, sourceCol).getValue());
  if (source) {
    addToTM(source, target);
  }

  // Move to next row
  sheet.getRange(row + 1, sourceCol).activate();

  return { nextSource: String(sheet.getRange(row + 1, sourceCol).getValue()) };
}

function sidebarGetCurrentSource() {
  const settings = getSettings();
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getActiveCell();
  const sourceCol = settings.sourceCol.toUpperCase().charCodeAt(0) - 64;
  return String(sheet.getRange(cell.getRow(), sourceCol).getValue());
}

function getStats() {
  return {
    tmCount: getTMCount(),
    glossaryCount: getGlossaryCount(),
  };
}
