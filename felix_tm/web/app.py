"""Flask web UI for felix-tm."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request

from ..core.match_maker import MatchConfig
from ..io.tmx import export_tmx, import_tmx
from ..io.tsv import import_tsv
from ..io.xliff import import_xliff
from ..io.xlsx import import_xlsx
from ..memory.record import Record
from ..memory.search import SearchEngine
from ..memory.store import MemoryStore

_HTML = r"""
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>felix-tm</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans CJK JP", sans-serif;
  background: #0f1117; color: #e4e4e7; line-height: 1.6;
}
.container { max-width: 960px; margin: 0 auto; padding: 20px; }
header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 0; border-bottom: 1px solid #27272a; margin-bottom: 24px;
}
header h1 { font-size: 1.4rem; font-weight: 600; color: #fafafa; }
header .badge {
  background: #18181b; border: 1px solid #3f3f46; border-radius: 6px;
  padding: 4px 10px; font-size: 0.8rem; color: #a1a1aa;
}

/* Tabs */
.tabs { display: flex; gap: 4px; margin-bottom: 20px; }
.tab {
  padding: 8px 16px; border-radius: 6px; cursor: pointer;
  background: transparent; border: 1px solid transparent;
  color: #a1a1aa; font-size: 0.9rem; transition: all 0.15s;
}
.tab:hover { color: #e4e4e7; background: #1c1c21; }
.tab.active { background: #27272a; color: #fafafa; border-color: #3f3f46; }
.panel { display: none; }
.panel.active { display: block; }

/* Search */
.search-box {
  display: flex; gap: 8px; margin-bottom: 16px;
}
.search-box input {
  flex: 1; padding: 10px 14px; border-radius: 8px;
  background: #18181b; border: 1px solid #3f3f46; color: #fafafa;
  font-size: 1rem; outline: none;
}
.search-box input:focus { border-color: #6366f1; }
.search-box input::placeholder { color: #52525b; }
.search-box select {
  padding: 10px; border-radius: 8px;
  background: #18181b; border: 1px solid #3f3f46; color: #fafafa;
  font-size: 0.85rem;
}
.btn {
  padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;
  font-size: 0.9rem; font-weight: 500; transition: all 0.15s;
}
.btn-primary { background: #6366f1; color: #fff; }
.btn-primary:hover { background: #4f46e5; }
.btn-secondary { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; }
.btn-secondary:hover { background: #3f3f46; }

/* Results */
.results { display: flex; flex-direction: column; gap: 8px; }
.match {
  background: #18181b; border: 1px solid #27272a; border-radius: 8px;
  padding: 14px 16px; transition: border-color 0.15s;
}
.match:hover { border-color: #3f3f46; }
.match-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
.score {
  display: inline-block; min-width: 48px; text-align: center;
  padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 600;
}
.score-high { background: #166534; color: #4ade80; }
.score-mid { background: #854d0e; color: #facc15; }
.score-low { background: #7f1d1d; color: #f87171; }
.match-source { color: #a1a1aa; font-size: 0.9rem; }
.match-target { color: #fafafa; font-size: 1rem; margin-top: 4px; }
.match-meta { color: #52525b; font-size: 0.75rem; margin-top: 6px; }

/* Import */
.drop-zone {
  border: 2px dashed #3f3f46; border-radius: 12px; padding: 40px;
  text-align: center; color: #71717a; transition: all 0.2s; cursor: pointer;
}
.drop-zone.dragover { border-color: #6366f1; background: rgba(99,102,241,0.05); color: #a5b4fc; }
.drop-zone input { display: none; }
.import-status { margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 0.9rem; }
.import-status.success { background: #052e16; color: #4ade80; }
.import-status.error { background: #450a0a; color: #f87171; }

/* Stats */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.stat-card {
  background: #18181b; border: 1px solid #27272a; border-radius: 8px;
  padding: 16px;
}
.stat-label { color: #71717a; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
.stat-value { color: #fafafa; font-size: 1.8rem; font-weight: 600; margin-top: 4px; }

.empty-state { text-align: center; padding: 60px 20px; color: #52525b; }
.empty-state p { margin-top: 8px; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #3f3f46; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>felix-tm</h1>
    <span class="badge" id="db-badge">-</span>
  </header>

  <div class="tabs">
    <div class="tab active" data-panel="search">Search</div>
    <div class="tab" data-panel="import">Import</div>
    <div class="tab" data-panel="browse">Browse</div>
    <div class="tab" data-panel="stats">Info</div>
  </div>

  <!-- Search Panel -->
  <div id="search" class="panel active">
    <div class="search-box">
      <input type="text" id="query" placeholder="Enter text to search TM..." autofocus>
      <select id="min-score">
        <option value="0.5">50%</option>
        <option value="0.6">60%</option>
        <option value="0.7" selected>70%</option>
        <option value="0.8">80%</option>
        <option value="0.9">90%</option>
        <option value="1.0">100%</option>
      </select>
      <select id="search-type">
        <option value="fuzzy">Fuzzy</option>
        <option value="concordance">Concordance</option>
        <option value="reverse">Reverse</option>
        <option value="glossary">Glossary</option>
      </select>
      <button class="btn btn-primary" onclick="doSearch()">Search</button>
    </div>
    <div id="results" class="results">
      <div class="empty-state">
        <p>Enter a query to search the translation memory</p>
      </div>
    </div>
  </div>

  <!-- Import Panel -->
  <div id="import" class="panel">
    <div class="drop-zone" id="drop-zone">
      <p>Drop TMX / XLIFF / XLSX / TSV files here</p>
      <p style="font-size:0.85rem; margin-top:8px">or click to browse</p>
      <input type="file" id="file-input" accept=".tmx,.xlf,.xliff,.xlsx,.tsv,.txt,.csv">
    </div>
    <div id="import-status"></div>
  </div>

  <!-- Browse Panel -->
  <div id="browse" class="panel">
    <div class="search-box" style="margin-bottom:12px">
      <input type="text" id="browse-filter" placeholder="Filter records...">
      <button class="btn btn-secondary" onclick="loadRecords()">Load</button>
    </div>
    <div id="records-list" class="results">
      <div class="empty-state"><p>Click Load to browse records</p></div>
    </div>
  </div>

  <!-- Stats Panel -->
  <div id="stats" class="panel">
    <div class="stats-grid" id="stats-grid"></div>
  </div>
</div>

<script>
// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.panel).classList.add('active');
    if (tab.dataset.panel === 'stats') loadStats();
  });
});

// Search
const queryInput = document.getElementById('query');
queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const q = queryInput.value.trim();
  if (!q) return;
  const minScore = document.getElementById('min-score').value;
  const searchType = document.getElementById('search-type').value;
  const res = document.getElementById('results');
  res.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>';

  const resp = await fetch('/api/search', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query: q, min_score: parseFloat(minScore), type: searchType})
  });
  const data = await resp.json();

  if (!data.matches || data.matches.length === 0) {
    res.innerHTML = '<div class="empty-state"><p>No matches found</p></div>';
    return;
  }

  res.innerHTML = data.matches.map(m => {
    const pct = Math.round(m.score * 100);
    const cls = pct >= 90 ? 'score-high' : pct >= 70 ? 'score-mid' : 'score-low';
    return `<div class="match">
      <div class="match-header">
        <span class="score ${cls}">${pct}%</span>
      </div>
      <div class="match-source">${esc(m.source)}</div>
      <div class="match-target">${esc(m.target)}</div>
      ${m.context ? `<div class="match-meta">ctx: ${esc(m.context)}</div>` : ''}
    </div>`;
  }).join('');
}

// Import - drag & drop
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); uploadFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });

async function uploadFile(file) {
  const status = document.getElementById('import-status');
  status.className = 'import-status'; status.textContent = 'Importing...';
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch('/api/import', {method: 'POST', body: form});
  const data = await resp.json();
  if (data.error) {
    status.className = 'import-status error'; status.textContent = data.error;
  } else {
    status.className = 'import-status success';
    status.textContent = `Imported ${data.count} records (total: ${data.total})`;
    loadStats();
  }
}

// Browse
async function loadRecords() {
  const filter = document.getElementById('browse-filter').value.trim();
  const list = document.getElementById('records-list');
  list.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>';
  const resp = await fetch(`/api/records?filter=${encodeURIComponent(filter)}&limit=100`);
  const data = await resp.json();
  if (!data.records || data.records.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No records</p></div>';
    return;
  }
  list.innerHTML = data.records.map(r => `<div class="match">
    <div class="match-source">${esc(r.source)}</div>
    <div class="match-target">${esc(r.target)}</div>
    <div class="match-meta">id:${r.id} rel:${r.reliability} ref:${r.refcount}${r.validated ? ' validated' : ''}</div>
  </div>`).join('');
}

// Stats
async function loadStats() {
  const resp = await fetch('/api/stats');
  const data = await resp.json();
  document.getElementById('db-badge').textContent = `${data.count} records`;
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Records</div><div class="stat-value">${data.count}</div></div>
    <div class="stat-card"><div class="stat-label">Database</div><div class="stat-value" style="font-size:1rem;word-break:break-all">${esc(data.db_path)}</div></div>
    <div class="stat-card"><div class="stat-label">Source Lang</div><div class="stat-value" style="font-size:1.2rem">${esc(data.source_lang)}</div></div>
    <div class="stat-card"><div class="stat-label">Target Lang</div><div class="stat-value" style="font-size:1.2rem">${esc(data.target_lang)}</div></div>
  `;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// Init
loadStats();
</script>
</body>
</html>
"""


def create_app(db_path: str) -> Flask:
    """Create the Flask application."""
    app = Flask(__name__)
    app.config["DB_PATH"] = db_path

    def get_store() -> MemoryStore:
        return MemoryStore(app.config["DB_PATH"])

    @app.route("/")
    def index():
        return render_template_string(_HTML)

    @app.route("/api/search", methods=["POST"])
    def api_search():
        data = request.json
        query = data.get("query", "")
        min_score = data.get("min_score", 0.7)
        search_type = data.get("type", "fuzzy")

        with get_store() as store:
            engine = SearchEngine(store)

            if search_type == "concordance":
                result = engine.concordance_search(query)
            elif search_type == "reverse":
                result = engine.reverse_search(query, min_score=min_score)
            elif search_type == "glossary":
                result = engine.glossary_search(query, min_score=min_score)
            else:
                result = engine.fuzzy_search(query, min_score=min_score, max_results=20)

        return jsonify({
            "matches": [
                {
                    "score": m.score,
                    "source": m.source,
                    "target": m.target,
                    "context": m.context,
                    "reliability": m.reliability,
                    "validated": m.validated,
                    "refcount": m.refcount,
                }
                for m in result.matches
            ],
            "total_searched": result.total_searched,
        })

    @app.route("/api/import", methods=["POST"])
    def api_import():
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "No file selected"}), 400

        suffix = Path(file.filename).suffix.lower()
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            file.save(tmp.name)
            tmp.close()

            if suffix in (".tmx", ".xml"):
                records = import_tmx(tmp.name)
            elif suffix in (".xlf", ".xliff", ".sdlxliff"):
                records = import_xliff(tmp.name)
            elif suffix in (".xlsx", ".xls"):
                records = import_xlsx(tmp.name)
            elif suffix in (".tsv", ".txt", ".csv"):
                records = import_tsv(tmp.name)
            else:
                return jsonify({"error": f"Unsupported format: {suffix}"}), 400

            with get_store() as store:
                count = store.add_bulk(records)
                total = store.count()

            return jsonify({"count": count, "total": total})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        finally:
            os.unlink(tmp.name)

    @app.route("/api/records")
    def api_records():
        filter_text = request.args.get("filter", "")
        limit = int(request.args.get("limit", "100"))

        with get_store() as store:
            if filter_text:
                records = store.concordance(filter_text)[:limit]
            else:
                records = store.all_records()[:limit]

        return jsonify({
            "records": [r.to_dict() for r in records],
        })

    @app.route("/api/stats")
    def api_stats():
        with get_store() as store:
            count = store.count()
            src_lang = store.get_meta("source_lang", "N/A")
            tgt_lang = store.get_meta("target_lang", "N/A")

        return jsonify({
            "count": count,
            "db_path": db_path,
            "source_lang": src_lang,
            "target_lang": tgt_lang,
        })

    return app


def serve(db_path: str, host: str = "127.0.0.1", port: int = 8080) -> None:
    """Start the web server."""
    app = create_app(db_path)
    print(f"felix-tm web UI: http://{host}:{port}")
    print(f"Database: {db_path}")
    print("Press Ctrl+C to stop")
    app.run(host=host, port=port, debug=False)
