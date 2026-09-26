const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Registered by the renderer to flush unsaved work before the window closes.
let beforeCloseHandler = null;

ipcRenderer.on("app:before-close", async () => {
  try {
    if (beforeCloseHandler) await beforeCloseHandler();
  } finally {
    ipcRenderer.send("app:close-ready");
  }
});

/** Subscribe to a main-process event; returns an unsubscribe function. */
function subscribe(channel, cb) {
  const listener = () => cb();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  showSaveDialog: (defaultName) =>
    ipcRenderer.invoke("dialog:save", defaultName),
  showOpenDialog: () => ipcRenderer.invoke("dialog:open"),
  readFile: (path) => ipcRenderer.invoke("file:read", path),
  writeFile: (path, data, opts) =>
    ipcRenderer.invoke("file:write", path, data, opts),
  fileExists: (path) => ipcRenderer.invoke("file:exists", path),
  allowDroppedFile: (file) =>
    ipcRenderer.invoke("file:allow-dropped", webUtils.getPathForFile(file)),
  listBackups: (path) => ipcRenderer.invoke("backup:list", path),
  readBackup: (path, id) => ipcRenderer.invoke("backup:read", path, id),
  storeGet: (key) => ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => ipcRenderer.invoke("store:set", key, value),
  takePendingOpen: () => ipcRenderer.invoke("app:take-pending-open"),
  onOpenFilePending: (cb) => subscribe("app:open-file-pending", cb),
  onSystemLock: (cb) => subscribe("app:system-lock", cb),
  setBeforeCloseHandler: (fn) => {
    beforeCloseHandler = typeof fn === "function" ? fn : null;
  },
});
