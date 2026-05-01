const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const isDev = !app.isPackaged;
const storePath = path.join(app.getPath("userData"), "store.json");

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data) {
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("dialog:save", async (_, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName || "vault.warden",
    filters: [{ name: "Warden Vault", extensions: ["warden"] }],
  });
  return canceled ? null : filePath;
});

ipcMain.handle("dialog:open", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: "Warden Vault", extensions: ["warden"] }],
    properties: ["openFile"],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle("file:read", async (_, filePath) => {
  return fs.readFileSync(filePath, "utf-8");
});

ipcMain.handle("file:write", async (_, filePath, data) => {
  fs.writeFileSync(filePath, data, "utf-8");
});

ipcMain.handle("file:exists", async (_, filePath) => {
  return fs.existsSync(filePath);
});

ipcMain.handle("store:get", async (_, key) => {
  const store = readStore();
  return store[key] ?? null;
});

ipcMain.handle("store:set", async (_, key, value) => {
  const store = readStore();
  store[key] = value;
  writeStore(store);
});

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    const { nativeImage } = require("electron");
    const icon = nativeImage.createFromPath(
      path.join(__dirname, "../build/icon.png")
    );
    app.dock.setIcon(icon);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
