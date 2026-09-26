const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { fileURLToPath } = require("url");

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:5173";
const PROD_INDEX = path.join(__dirname, "../dist/index.html");
const storePath = path.join(app.getPath("userData"), "store.json");

// Files the renderer may touch: only paths the user picked through a native
// dialog (or the remembered last file). A compromised renderer cannot read or
// write arbitrary paths.
const allowedPaths = new Set();

function allowPath(p) {
  const resolved = path.resolve(p);
  allowedPaths.add(resolved);
  return resolved;
}

function assertAllowed(p) {
  if (typeof p !== "string" || !allowedPaths.has(path.resolve(p))) {
    throw new Error("Access to this path is not allowed");
  }
  return path.resolve(p);
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf-8"));
  } catch {
    return {};
  }
}

// Write to a temp file, flush, then rename over the target so a crash mid-write
// never leaves a truncated file behind.
function writeFileAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, data, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function writeStore(data) {
  writeFileAtomic(storePath, JSON.stringify(data, null, 2));
}

function isAppUrl(url) {
  try {
    const u = new URL(url);
    if (isDev) return u.origin === DEV_URL;
    return u.protocol === "file:" && fileURLToPath(u) === PROD_INDEX;
  } catch {
    return false;
  }
}

function openExternalSafely(url) {
  try {
    const { protocol } = new URL(url);
    if (["http:", "https:", "mailto:"].includes(protocol)) {
      shell.openExternal(url);
    }
  } catch {
    // ignore malformed URLs
  }
}

// Every IPC handler goes through this: reject calls from anything other than
// our own top-level page.
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent || !isAppUrl(frame.url)) {
      throw new Error(`Blocked IPC "${channel}" from untrusted sender`);
    }
    return fn(event, ...args);
  });
}

let isQuitting = false;

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
      sandbox: true,
    },
  });

  // Never let the app window navigate away or spawn windows; send links to the
  // system browser instead.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  // Give the renderer a chance to flush pending saves before closing.
  let closeReady = false;
  win.on("close", (event) => {
    if (closeReady) return;
    event.preventDefault();
    const finish = () => {
      if (closeReady || win.isDestroyed()) return;
      closeReady = true;
      ipcMain.removeListener("app:close-ready", onReady);
      if (isQuitting) app.quit();
      else win.close();
    };
    const onReady = (e) => {
      if (e.sender === win.webContents) finish();
    };
    ipcMain.on("app:close-ready", onReady);
    win.webContents.send("app:before-close");
    // Don't hang forever if the renderer is unresponsive.
    setTimeout(finish, 5000);
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(PROD_INDEX);
  }
}

handle("dialog:save", async (event, defaultName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: typeof defaultName === "string" ? defaultName : "vault.warden",
    filters: [{ name: "Warden Vault", extensions: ["warden"] }],
  });
  return canceled || !filePath ? null : allowPath(filePath);
});

handle("dialog:open", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: "Warden Vault", extensions: ["warden"] }],
    properties: ["openFile"],
  });
  return canceled || !filePaths[0] ? null : allowPath(filePaths[0]);
});

handle("file:read", async (_, filePath) => {
  return fs.readFileSync(assertAllowed(filePath), "utf-8");
});

handle("file:write", async (_, filePath, data) => {
  if (typeof data !== "string") throw new Error("Invalid data");
  writeFileAtomic(assertAllowed(filePath), data);
});

handle("file:exists", async (_, filePath) => {
  return fs.existsSync(assertAllowed(filePath));
});

const STORE_KEYS = new Set(["lastFile"]);

handle("store:get", async (_, key) => {
  if (!STORE_KEYS.has(key)) throw new Error("Unknown store key");
  return readStore()[key] ?? null;
});

handle("store:set", async (_, key, value) => {
  if (!STORE_KEYS.has(key)) throw new Error("Unknown store key");
  if (key === "lastFile" && value !== null) assertAllowed(value);
  const store = readStore();
  store[key] = value;
  writeStore(store);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const { lastFile } = readStore();
    if (typeof lastFile === "string") allowPath(lastFile);

    // Packaged builds get their dock icon from the .icns in the bundle.
    if (isDev && process.platform === "darwin") {
      app.dock.setIcon(
        nativeImage.createFromPath(path.join(__dirname, "../build/icon.png"))
      );
    }
    createWindow();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  isQuitting = false;
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
