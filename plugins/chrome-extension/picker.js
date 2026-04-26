/**
 * Google Picker bootstrap for the Felix TM authorization popup.
 *
 * Flow:
 *   1. Request a `drive.file` OAuth token (interactive — first call
 *      shows the consent screen, subsequent calls reuse the token).
 *   2. Load the Picker API (gapi.load('picker')).
 *   3. Build a SpreadsheetsView so only Sheets are listed.
 *   4. On user selection, post the chosen file to background.js
 *      via PICKER_RESULT and close the window. background persists
 *      it to authorized_files and broadcasts AUTH_CHANGED so the
 *      side panel + content scripts re-render.
 *
 * The Picker requires a Google API key in addition to the OAuth
 * token. The key is restricted in Cloud Console to the
 * chrome-extension://<extension-id> referrer, so it's safe to ship
 * publicly. Configure it in the Cloud Console alongside the OAuth
 * client (project 429083959906 — same one as the OAuth client_id).
 *
 * NOTE: until a real API key is provisioned, the Picker will fail
 * with "API key not valid". The script logs a clear console message
 * and reports the error in the popup so it's obvious during testing.
 */

// TODO(deploy): replace with the real API key from Cloud Console.
// Tracked in the launch plan (clever-puzzling-treasure.md, "Cloud
// Console" prereq). Picker API key + Google Picker API enabled.
const PICKER_API_KEY = ''; // <-- TODO: paste from Cloud Console

const statusEl = document.getElementById('status');

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : '';
}

function reportToBackground(payload) {
  chrome.runtime.sendMessage({ type: 'PICKER_RESULT', data: payload }, () => {
    void chrome.runtime.lastError;
    // Close the popup window after the result is dispatched.
    setTimeout(() => window.close(), 200);
  });
}

function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const doc = data.docs && data.docs[0];
    if (doc) {
      reportToBackground({ spreadsheetId: doc.id, name: doc.name || '' });
      return;
    }
  }
  if (data.action === google.picker.Action.CANCEL) {
    reportToBackground({ cancelled: true });
  }
}

function buildAndShowPicker(token) {
  if (!PICKER_API_KEY) {
    setStatus(
      'Picker API key not configured. Set PICKER_API_KEY in picker.js — see the launch plan.',
      true,
    );
    console.error('[FelixTM picker] PICKER_API_KEY is empty. The Picker cannot load until the Cloud Console API key is pasted in.');
    return;
  }
  const view = new google.picker.View(google.picker.ViewId.SPREADSHEETS);
  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(token)
    .setDeveloperKey(PICKER_API_KEY)
    .setCallback(pickerCallback)
    .setTitle('Pick a spreadsheet to share with Felix TM')
    .build();
  picker.setVisible(true);
  setStatus('');
}

function loadPicker(token) {
  gapi.load('picker', { callback: () => buildAndShowPicker(token) });
}

function getTokenAndLoad() {
  // The popup runs in the extension's origin so chrome.identity is
  // available. interactive=true so first-time consent is shown here
  // rather than in a hidden window.
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (!token) {
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      setStatus('Sign-in failed: ' + (err || 'no token returned'), true);
      reportToBackground({ cancelled: true, error: err || 'no token' });
      return;
    }
    loadPicker(token);
  });
}

window.addEventListener('beforeunload', () => {
  // If the user closes the popup without picking, dispatch a cancel so
  // the caller's "pending" UI can resolve.
  reportToBackground({ cancelled: true });
});

getTokenAndLoad();
