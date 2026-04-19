---
name: felix-tm-reload
description: Hot-reload the Felix TM Chrome extension after editing its source, verify the new build is active, and report success or failure. Use this skill whenever the user asks to reload the extension, apply extension changes, test the latest code in Sheets, verify Felix TM after edits, check that a fix took effect, or any variant like "拡張機能をリロード", "動作確認して", "更新を反映して", "再読み込み", "試して". Prefer this skill over asking the user to reload manually — the skill talks to the already-installed extension via the Claude-in-Chrome MCP bridge so reloads are scripted, not manual.
---

# Felix TM — Hot Reload

This skill runs the Felix TM Chrome extension's dev self-reload hook through the Claude-in-Chrome MCP, then verifies that a fresh content-script instance is running in a Google Sheets tab.

## How the bridge works (one-time context)

The repo already has two pieces wired up:

- `plugins/chrome-extension/content.js` listens for `window.postMessage({ type: 'FELIX_TM_DEV_RELOAD' })` from the page's main world and forwards a `DEV_RELOAD` message to the background.
- `plugins/chrome-extension/background.js` handles `DEV_RELOAD` by calling `chrome.runtime.reload()`. Its `onInstalled` hook then re-injects `content.js` into every open Sheets tab.

Claude-in-Chrome's `javascript_tool` runs in the page's main world, which can't touch the extension's isolated world directly — but it *can* `postMessage` to it. That's the bridge. When reload succeeds, the old `#felix-tm-panel` DOM element is removed and a fresh one takes its place (different element identity).

Do not reinvent this — the mechanism is deliberate. If it stops working, the likely cause is an edit to one of those two files.

## Preconditions

1. Claude-in-Chrome MCP is connected (the `mcp__Claude_in_Chrome__*` tools respond). If the first call returns "not connected", surface that to the user and stop — do not try to work around it.
2. A Google Sheets tab is inside the Claude-in-Chrome tab group. Verify with `mcp__Claude_in_Chrome__tabs_context_mcp`. If none exists, either:
   - Navigate an existing MCP tab to a spreadsheet URL the user provides, or
   - Ask the user for a spreadsheet URL to test against.
3. The `DEV_RELOAD` handler is present in the currently-installed build. If the user has never loaded a build that contains it, they must manually reload the extension once from `chrome://extensions/` as a bootstrap. After that, this skill takes over.

## Procedure

Run these steps in order. Don't skip the verification step — a postMessage that silently does nothing looks identical to a successful reload from the outside.

### 1. Locate a Sheets tab

```
mcp__Claude_in_Chrome__tabs_context_mcp({ createIfEmpty: false })
```

Pick the first tab whose URL matches `https://docs.google.com/spreadsheets/d/…`. Record its `tabId`. If none match, ask the user for a URL and navigate to it with `mcp__Claude_in_Chrome__navigate`.

### 2. Confirm the content script is live

```js
!!document.getElementById('felix-tm-panel')
```

Run this via `mcp__Claude_in_Chrome__javascript_tool`. If it returns `false`, the content script either hasn't loaded yet or the panel was closed. Wait ~2 seconds and retry once; if still `false`, ask the user to reload the Sheets tab manually.

### 3. Mark the current panel, post the reload message, verify replacement

Do this as a single JS expression so the before/after comparison is atomic. The marker attribute proves we're looking at a different element after reload, not the same one:

```js
const before = document.getElementById('felix-tm-panel');
if (before) before.setAttribute('data-felix-reload-marker', 'pre');
window.postMessage({ type: 'FELIX_TM_DEV_RELOAD' }, '*');
new Promise(r => setTimeout(r, 2500)).then(() => {
  const after = document.getElementById('felix-tm-panel');
  return {
    before_had_marker: before ? before.getAttribute('data-felix-reload-marker') : null,
    after_has_marker: after ? after.getAttribute('data-felix-reload-marker') : null,
    same_element: before === after,
    panel_present: !!after,
  };
});
```

### 4. Interpret the result

| Result | Meaning | Action |
|---|---|---|
| `same_element: false`, `after_has_marker: null`, `panel_present: true` | Reload succeeded — fresh content script instance injected | Report success |
| `same_element: true` and `after_has_marker: "pre"` | postMessage arrived but reload didn't fire | The installed build probably lacks the `DEV_RELOAD` handler; ask user to manually bootstrap once |
| `panel_present: false` | Reload fired but `onInstalled` didn't re-inject, or injection is still in progress | Wait another 2s and re-check; if still false, ask user to reload the Sheets tab |
| JS execution error `Cannot access a chrome:// URL` | The MCP tab navigated off Sheets | Re-navigate the tab or pick a different one |

### 5. Report back

Tell the user concisely what happened. Include which tab was reloaded (tabId + spreadsheet title) so they can cross-check. If the reload was in support of a specific code change, remind them which file(s) they edited and suggest the quickest way to exercise those changes in the sheet.

## When not to use this skill

- The user hasn't edited the extension source — a reload has no observable effect, so just answer their question directly.
- The user explicitly wants to reload via the Chrome UI (e.g. to check extension error logs on `chrome://extensions/`). Defer to them.
- Claude-in-Chrome is disconnected. Say so, don't try to work around it with a shell command — there is no shell path to hot-reload a user's Chrome extension.

## Keep the bridge in sync

If the user is refactoring `content.js` or `background.js`, double-check that both sides of the `DEV_RELOAD` bridge still exist:

```bash
grep -n "FELIX_TM_DEV_RELOAD\|DEV_RELOAD" plugins/chrome-extension/content.js plugins/chrome-extension/background.js
```

The bridge is intentionally dev-only. Before the extension is published, it should be gated behind a build flag or removed — flag this to the user if they mention shipping or publishing.
