const { contextBridge, ipcRenderer } = require("electron");

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
});
