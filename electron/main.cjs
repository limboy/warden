const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  powerMonitor,
  nativeTheme,
  safeStorage,
  systemPreferences,
} = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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

const VAULT_EXT = ".warden";

function isVaultPath(p) {
  return typeof p === "string" && p.toLowerCase().endsWith(VAULT_EXT);
}

// --- Backups ----------------------------------------------------------------
// Before overwriting a vault, snapshot the previous (still encrypted) file into
// userData/backups/<hash of path>/. At most one snapshot per interval, unless
// forced (password change, restore).

const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const BACKUP_KEEP = 30;
const lastBackupAt = new Map();

function backupDir(filePath) {
  const id = crypto.createHash("sha256").update(filePath).digest("hex");
  return path.join(app.getPath("userData"), "backups", id.slice(0, 16));
}

function listBackupFiles(filePath) {
  const dir = backupDir(filePath);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(VAULT_EXT))
    .map((n) => {
      const stat = fs.statSync(path.join(dir, n));
      return { id: n, time: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.time - a.time);
}

function snapshot(filePath, force) {
  const now = Date.now();
  if (!force && now - (lastBackupAt.get(filePath) ?? 0) < BACKUP_INTERVAL_MS) {
    return;
  }
  if (!fs.existsSync(filePath)) return;
  const dir = backupDir(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = new Date(now).toISOString().replace(/[:.]/g, "-") + VAULT_EXT;
  fs.copyFileSync(filePath, path.join(dir, name));
  lastBackupAt.set(filePath, now);
  for (const old of listBackupFiles(filePath).slice(BACKUP_KEEP)) {
    fs.rmSync(path.join(dir, old.id), { force: true });
  }
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
    // Match the page background to avoid a white flash in dark mode.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
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

handle("file:write", async (_, filePath, data, opts) => {
  if (typeof data !== "string") throw new Error("Invalid data");
  const target = assertAllowed(filePath);
  try {
    snapshot(target, opts?.forceBackup === true);
  } catch (err) {
    // A failed backup must not block saving the user's work.
    console.error("Backup failed:", err);
  }
  writeFileAtomic(target, data);
});

handle("file:allow-dropped", async (_, filePath) => {
  // Paths come from webUtils.getPathForFile on a real dropped File; still,
  // only ever grant access to existing vault files.
  if (!isVaultPath(filePath) || !fs.existsSync(filePath)) return null;
  return allowPath(filePath);
});

handle("backup:list", async (_, filePath) => {
  return listBackupFiles(assertAllowed(filePath));
});

handle("backup:read", async (_, filePath, id) => {
  const target = assertAllowed(filePath);
  if (typeof id !== "string" || !/^[\w-]+\.warden$/.test(id)) {
    throw new Error("Invalid backup id");
  }
  return fs.readFileSync(path.join(backupDir(target), id), "utf-8");
});

handle("app:take-pending-open", async () => {
  const p = pendingOpen;
  pendingOpen = null;
  return p;
});

handle("file:exists", async (_, filePath) => {
  return fs.existsSync(assertAllowed(filePath));
});

// --- Recent vaults ------------------------------------------------------------
// Owned by the main process so the renderer can't plant arbitrary paths in
// the allow-list for the next launch.

const RECENT_MAX = 8;

function readRecents() {
  const { recentFiles } = readStore();
  return Array.isArray(recentFiles) ? recentFiles.filter(isVaultPath) : [];
}

function writeRecents(list) {
  const store = readStore();
  store.recentFiles = list.slice(0, RECENT_MAX);
  writeStore(store);
}

handle("recent:list", async () => {
  return readRecents().map((p) => ({ path: p, exists: fs.existsSync(p) }));
});

handle("recent:add", async (_, filePath) => {
  const p = assertAllowed(filePath);
  writeRecents([p, ...readRecents().filter((r) => r !== p)]);
});

handle("recent:remove", async (_, filePath) => {
  if (typeof filePath !== "string") return;
  writeRecents(readRecents().filter((r) => r !== filePath));
});

// --- Touch ID ------------------------------------------------------------------
// Opt-in per vault. The password is encrypted with safeStorage (key held in the
// macOS Keychain) and only released to the renderer after a successful Touch ID
// prompt. The "biometric" store entry is not reachable through store:get/set.

function biometricAvailable() {
  return (
    process.platform === "darwin" &&
    systemPreferences.canPromptTouchID() &&
    safeStorage.isEncryptionAvailable()
  );
}

function readBiometric() {
  const { biometric } = readStore();
  return biometric && typeof biometric === "object" ? biometric : {};
}

function writeBiometric(map) {
  const store = readStore();
  store.biometric = map;
  writeStore(store);
}

function sealPassword(password) {
  if (typeof password !== "string" || !password) {
    throw new Error("Invalid password");
  }
  return safeStorage.encryptString(password).toString("base64");
}

handle("bio:available", async () => biometricAvailable());

handle("bio:has", async (_, filePath) => {
  return (
    biometricAvailable() &&
    typeof readBiometric()[assertAllowed(filePath)] === "string"
  );
});

handle("bio:enable", async (_, filePath, password) => {
  const target = assertAllowed(filePath);
  if (!biometricAvailable()) throw new Error("Touch ID is not available");
  const sealed = sealPassword(password);
  await systemPreferences.promptTouchID(
    `turn on Touch ID for “${path.basename(target)}”`
  );
  writeBiometric({ ...readBiometric(), [target]: sealed });
});

// Keep the saved password in sync after a password change (no-op if Touch ID
// isn't enabled for this vault).
handle("bio:update", async (_, filePath, password) => {
  const target = assertAllowed(filePath);
  const map = readBiometric();
  if (!(target in map)) return;
  if (biometricAvailable()) map[target] = sealPassword(password);
  else delete map[target];
  writeBiometric(map);
});

handle("bio:disable", async (_, filePath) => {
  if (typeof filePath !== "string") return;
  const map = readBiometric();
  delete map[path.resolve(filePath)];
  writeBiometric(map);
});

handle("bio:unlock", async (_, filePath) => {
  const target = assertAllowed(filePath);
  const sealed = readBiometric()[target];
  if (!biometricAvailable() || typeof sealed !== "string") {
    throw new Error("Touch ID is not set up for this vault");
  }
  await systemPreferences.promptTouchID(`unlock “${path.basename(target)}”`);
  return safeStorage.decryptString(Buffer.from(sealed, "base64"));
});

const STORE_KEYS = new Set(["autoLockMinutes", "viewMode"]);
const VIEW_MODES = new Set(["edit", "split", "preview"]);
const AUTO_LOCK_CHOICES = new Set([0, 1, 5, 15, 30, 60]);

handle("store:get", async (_, key) => {
  if (!STORE_KEYS.has(key)) throw new Error("Unknown store key");
  return readStore()[key] ?? null;
});

handle("store:set", async (_, key, value) => {
  if (!STORE_KEYS.has(key)) throw new Error("Unknown store key");
  if (key === "autoLockMinutes" && !AUTO_LOCK_CHOICES.has(value)) {
    throw new Error("Invalid auto-lock value");
  }
  if (key === "viewMode" && !VIEW_MODES.has(value)) {
    throw new Error("Invalid view mode");
  }
  const store = readStore();
  store[key] = value;
  writeStore(store);
});

// --- Opening vaults from Finder / Explorer ------------------------------------
// The path is parked in `pendingOpen` and the renderer is poked to fetch it, so
// requests that arrive before the page has loaded aren't lost.

let pendingOpen = null;

function requestOpen(filePath) {
  if (!isVaultPath(filePath)) return;
  pendingOpen = allowPath(filePath);
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send("app:open-file-pending");
  } else if (app.isReady()) {
    createWindow();
  }
}

// macOS: must be registered before "ready" to catch launch-by-double-click.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  requestOpen(filePath);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_, argv) => {
    const file = argv.slice(1).find(isVaultPath);
    if (file) {
      requestOpen(file);
    } else {
      const [win] = BrowserWindow.getAllWindows();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    }
  });

  app.whenReady().then(() => {
    // Migrate the single "lastFile" entry from older versions.
    const store = readStore();
    if (typeof store.lastFile === "string") {
      if (!Array.isArray(store.recentFiles)) store.recentFiles = [store.lastFile];
      delete store.lastFile;
      writeStore(store);
    }
    for (const p of readRecents()) allowPath(p);

    // Packaged builds get their dock icon from the .icns in the bundle.
    if (isDev && process.platform === "darwin") {
      app.dock.setIcon(
        nativeImage.createFromPath(path.join(__dirname, "../build/icon.png"))
      );
    }
    // Windows / Linux pass the file on the command line.
    const argFile = process.argv.slice(1).find(isVaultPath);
    if (argFile) requestOpen(argFile);

    // Lock open vaults when the machine locks or sleeps.
    const lockAll = () => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send("app:system-lock");
      }
    };
    powerMonitor.on("lock-screen", lockAll);
    powerMonitor.on("suspend", lockAll);

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
