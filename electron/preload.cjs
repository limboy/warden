const { contextBridge, ipcRenderer } = require("electron");

// Registered by the renderer to flush unsaved work before the window closes.
let beforeCloseHandler = null;

ipcRenderer.on("app:before-close", async () => {
  try {
    if (beforeCloseHandler) await beforeCloseHandler();
  } finally {
    ipcRenderer.send("app:close-ready");
  }
});

contextBridge.exposeInMainWorld("electron", {
  platform: process.platform,
  showSaveDialog: (defaultName) =>
    ipcRenderer.invoke("dialog:save", defaultName),
  showOpenDialog: () => ipcRenderer.invoke("dialog:open"),
  readFile: (path) => ipcRenderer.invoke("file:read", path),
  writeFile: (path, data) => ipcRenderer.invoke("file:write", path, data),
  fileExists: (path) => ipcRenderer.invoke("file:exists", path),
  storeGet: (key) => ipcRenderer.invoke("store:get", key),
  storeSet: (key, value) => ipcRenderer.invoke("store:set", key, value),
  setBeforeCloseHandler: (fn) => {
    beforeCloseHandler = typeof fn === "function" ? fn : null;
  },
});
