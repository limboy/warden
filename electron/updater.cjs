// Auto-update from GitHub Releases (packaged macOS builds only).
//
// Checks shortly after launch and then periodically, downloads in the
// background and offers to restart. A downloaded update that isn't installed
// right away is applied on the next quit. quitAndInstall closes every window
// first, so the renderer still gets "app:before-close" and flushes its edits.

const { app, dialog, BrowserWindow } = require("electron");

const FIRST_CHECK_DELAY_MS = 10 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// "idle" | "checking" | "downloading" | "ready"
let state = "idle";
let readyVersion = null;
let onStateChange = () => {};
let autoUpdater = null;

function isSupported() {
  return app.isPackaged && process.platform === "darwin";
}

function setState(next) {
  state = next;
  onStateChange();
}

function parentWindow() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function showMessage(options) {
  const win = parentWindow();
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

async function promptRestart() {
  const { response } = await showMessage({
    type: "info",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
    message: `Warden ${readyVersion} is ready to install`,
    detail: "Restart now to update, or it will be installed the next time you quit.",
  });
  if (response === 0) autoUpdater.quitAndInstall();
}

/** Check for updates; `manual` reports "up to date" and errors to the user. */
async function checkForUpdates(manual = false) {
  if (!autoUpdater) {
    if (manual) {
      showMessage({ type: "info", message: "Updates are only available in the installed app." });
    }
    return;
  }
  if (state === "ready") {
    if (manual) promptRestart();
    return;
  }
  if (state !== "idle") {
    if (manual) showMessage({ type: "info", message: "An update is already being downloaded." });
    return;
  }
  setState("checking");
  try {
    const result = await autoUpdater.checkForUpdates();
    // The download continues in the background; "update-downloaded" takes over.
    if (result?.isUpdateAvailable) {
      if (state === "checking") setState("downloading");
      if (manual) {
        showMessage({
          type: "info",
          message: `Downloading Warden ${result.updateInfo.version}`,
          detail: "You'll be asked to restart when it's ready.",
        });
      }
    } else {
      setState("idle");
      if (manual) {
        showMessage({ type: "info", message: `Warden ${app.getVersion()} is up to date.` });
      }
    }
  } catch (err) {
    if (state !== "ready") setState("idle");
    console.error("Update check failed:", err);
    if (manual) {
      showMessage({
        type: "warning",
        message: "Couldn't check for updates",
        detail: String(err?.message ?? err),
      });
    }
  }
}

/** Menu label for the update item, reflecting the current state. */
function menuLabel() {
  if (state === "ready") return "Restart to Install Update…";
  if (state === "downloading") return "Downloading Update…";
  return "Check for Updates…";
}

function menuEnabled() {
  return state === "idle" || state === "ready";
}

/** Start background checks. `onChange` is called when the menu should update. */
function initUpdater(onChange) {
  onStateChange = onChange;
  if (!isSupported()) return;

  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on("update-downloaded", (info) => {
    readyVersion = info.version;
    setState("ready");
    promptRestart();
  });
  autoUpdater.on("error", (err) => {
    console.error("Updater error:", err);
    if (state !== "ready") setState("idle");
  });

  setTimeout(() => checkForUpdates(), FIRST_CHECK_DELAY_MS);
  setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
}

module.exports = { initUpdater, checkForUpdates, menuLabel, menuEnabled };
