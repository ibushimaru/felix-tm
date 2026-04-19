---
name: felix-tm-reload
description: Hot-reload the Felix TM Chrome extension after editing its source so the user's browser is running the latest code before they verify it themselves. Use this skill whenever the user has just edited files under `plugins/chrome-extension/` and says anything like "reload", "apply", "試して", "更新を反映して", "再読み込み", "動作確認して" — basically any cue that means "make the browser pick up the changes." Functional verification is NOT this skill's job; that's the user's (they can see the panel, click buttons, read toasts in seconds). Logic verification is the Node unit tests under `plugins/chrome-extension/tests/`. This skill only does one thing: get the newly-edited extension running in the Sheets tab, and confirm that a fresh content-script instance replaced the old one.
---

# Felix TM — Hot Reload

Purpose: after the user edits extension source files, get those changes running in their Chrome without them having to open `chrome://extensions/` and click the reload icon. That's it. Anything else (does the button look right? did the cell update? is the toast correct?) is either the user's job or the Node tests' job.

## How the bridge works

- `plugins/chrome-extension/content.js` listens on the page for `window.postMessage({ type: 'FELIX_TM_DEV_RELOAD' })` (scoped to `e.source === window`, `{ signal }` so re-injected instances tear it down cleanly).
- It forwards a `DEV_RELOAD` message to the background.
- `plugins/chrome-extension/background.js` handles `DEV_RELOAD` by calling `chrome.runtime.reload()`. The `onInstalled` hook then re-injects `content.js` into every open Sheets tab.

Claude-in-Chrome's `javascript_tool` runs in the page's main world, which can't reach the extension's isolated world directly, but it *can* `postMessage` to it. That's the entire mechanism.

## Preconditions

1. Claude-in-Chrome MCP is connected. If the first call returns "not connected", tell the user and stop. There is no shell workaround.
2. A Google Sheets tab is inside the Claude-in-Chrome tab group. Verify with `mcp__Claude_in_Chrome__tabs_context_mcp`. If none exists, ask the user for a URL and `mcp__Claude_in_Chrome__navigate` to it.
3. The `DEV_RELOAD` handler exists in the currently-installed build. If the user has never loaded a build containing it, they must reload once manually from `chrome://extensions/` as a bootstrap. After that the skill takes over.

## Procedure

### 1. Locate the Sheets tab

Use `mcp__Claude_in_Chrome__tabs_context_mcp({ createIfEmpty: false })`. Pick the first tab whose URL matches `https://docs.google.com/spreadsheets/d/…` and record its `tabId`.

### 2. Confirm the content script is alive

```js
!!document.getElementById('felix-tm-panel')
```

If this returns `false`, wait ~2 s and retry once. If still `false`, ask the user to reload the Sheets tab manually — the content script hasn't attached.

### 3. Mark the panel, fire reload, check replacement

Run as one atomic expression so the before/after comparison can't lie:

```js
const before = document.getElementById('felix-tm-panel');
if (before) before.setAttribute('data-felix-reload-marker', 'pre');
window.postMessage({ type: 'FELIX_TM_DEV_RELOAD' }, '*');
new Promise(r => setTimeout(r, 2500)).then(() => {
  const after = document.getElementById('felix-tm-panel');
  return {
    same_element: before === after,
    after_has_marker: after ? after.getAttribute('data-felix-reload-marker') : null,
    panel_present: !!after,
  };
});
```

### 4. Interpret

| Result | Meaning | Action |
|---|---|---|
| `same_element: false`, `after_has_marker: null`, `panel_present: true` | A fresh content-script instance replaced the old one. Reload succeeded. | Report success. |
| `same_element: true` and `after_has_marker === "pre"` | postMessage arrived but reload didn't fire. | The installed build lacks the `DEV_RELOAD` handler. Ask the user to bootstrap-reload once from `chrome://extensions/`. |
| `panel_present: false` | Reload fired but re-injection is still in progress or `onInstalled` didn't run. | Wait another 2 s and re-check. If still false, ask the user to reload the Sheets tab. |
| JS error `Cannot access a chrome:// URL` | The MCP tab is off Sheets. | Re-navigate or pick a different tab. |

### 5. Hand off to the user

Tell them, briefly, that the reload landed and remind them which file(s) they edited. They run the eyeball check. You don't.

## What this skill is NOT for

- **Do not** try to click buttons in the in-page overlay. The Shadow DOM is closed; main-world JS can't see it. The user can click in seconds — that's their job.
- **Do not** try to read Sheets data, move the cursor, or diff cell contents via `javascript_tool` to "verify" Auto Translate or similar features. That path is brittle (zombie listeners from stale content scripts, scaling issues with screenshots, Sheets DOM changes). If you need confidence that a *pure* logic change works, add a case to `plugins/chrome-extension/tests/` and run `npm test` from `plugins/chrome-extension/`. That's much faster and doesn't need a browser at all.
- **Do not** add new dev-only postMessage bridges to support verification flows. The project deliberately shrank its bridge surface to just `DEV_RELOAD`; growing it again reintroduces the "every page on docs.google.com can drive this extension" problem.

## Node unit tests — your real feedback loop

When you change anything in `felix-engine.js` or in any pure helper, run:

```bash
cd plugins/chrome-extension && npm test
```

That runs `node --test tests/*.test.js` over the pure logic (Auto Translate planners, glossary/number placement, edit-distance). No browser, ~50 ms. Add new cases there first; if they pass and the user reports a problem, then the bug is in the I/O layer (content.js) and this reload skill gets them back into the browser fast.

## Keep the bridge in sync

If the user is editing `content.js` or `background.js`, make sure both sides of the `DEV_RELOAD` bridge still exist:

```bash
grep -n "FELIX_TM_DEV_RELOAD\|DEV_RELOAD" plugins/chrome-extension/content.js plugins/chrome-extension/background.js
```

The bridge is dev-only. Before the extension is published it should be removed or gated behind a build flag — flag this to the user if they mention shipping, publishing, or packaging.
