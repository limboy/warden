import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Lock,
  Eye,
  PenLine,
  Columns2,
  Check,
  Loader2,
  AlertCircle,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/markdown-editor";
import {
  SettingsDialog,
  type RestoreResult,
} from "@/components/settings-dialog";
import {
  createVaultKey,
  seal,
  unlock,
  unlockWithKey,
  type VaultKey,
} from "@/lib/crypto";
import { onLockRequest } from "@/lib/lock-bus";
import { basename } from "@/lib/utils";

type SaveStatus = "saved" | "unsaved" | "saving" | "error";
type ViewMode = StoreSchema["viewMode"];

const VIEW_MODES: { mode: ViewMode; label: string; Icon: typeof Eye }[] = [
  { mode: "edit", label: "Editor only", Icon: PenLine },
  { mode: "split", label: "Editor and preview", Icon: Columns2 },
  { mode: "preview", label: "Preview only", Icon: Eye },
];

const Preview = memo(function Preview({ markdown }: { markdown: string }) {
  return (
    <article className="prose prose-neutral mx-auto max-w-3xl p-8 dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {markdown || "*Empty vault — switch to the editor to start writing.*"}
      </ReactMarkdown>
    </article>
  );
});

const AUTOSAVE_DELAY = 800;
const DEFAULT_AUTO_LOCK_MINUTES = 5;
const ACTIVITY_EVENTS = ["keydown", "mousedown", "mousemove", "wheel"] as const;

interface Props {
  filePath: string;
  vaultKey: VaultKey;
  initialContent: string;
  onLock: () => void;
}

export function EditorPage({
  filePath,
  vaultKey,
  initialContent,
  onLock,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  // Rendering markdown is slower than typing; let the preview lag behind.
  const previewContent = useDeferredValue(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState("");
  const [locking, setLocking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(
    DEFAULT_AUTO_LOCK_MINUTES
  );
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const lockingRef = useRef(false);
  const lastActivity = useRef(0);

  // Save bookkeeping lives in refs so saves never see stale closures.
  const saveTimer = useRef<number | undefined>(undefined);
  const contentRef = useRef(initialContent);
  const editVersion = useRef(0);
  const savedVersion = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  // Current key; replaced in-queue on password change so no save can ever use
  // a stale key.
  const vaultKeyRef = useRef(vaultKey);

  const fileName = basename(filePath);

  // Saves are serialized so an older snapshot can never land on disk after a
  // newer one. `rekey` / `forceBackup` writes always happen and reject on
  // failure; plain autosaves only report errors through the status indicator.
  const persist = useCallback(
    (opts: { rekey?: VaultKey; forceBackup?: boolean } = {}): Promise<void> => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
      }
      const explicit = !!opts.rekey || !!opts.forceBackup;
      const job = saveQueue.current.then(async () => {
        const version = editVersion.current;
        if (!explicit && version === savedVersion.current) return;
        const key = opts.rekey ?? vaultKeyRef.current;
        setSaveStatus("saving");
        try {
          const encrypted = await seal(contentRef.current, key);
          await window.electron.writeFile(filePath, encrypted, {
            forceBackup: explicit,
          });
          vaultKeyRef.current = key;
          savedVersion.current = version;
          setSaveError("");
          setSaveStatus(
            editVersion.current === savedVersion.current ? "saved" : "unsaved"
          );
        } catch (err) {
          setSaveError(err instanceof Error ? err.message : String(err));
          setSaveStatus("error");
          if (explicit) throw err;
        }
      });
      saveQueue.current = job.catch(() => {});
      return explicit ? job : saveQueue.current;
    },
    [filePath]
  );

  const flush = useCallback(() => persist(), [persist]);

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      contentRef.current = newContent;
      editVersion.current++;
      setSaveStatus((s) => (s === "error" ? s : "unsaved"));

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, AUTOSAVE_DELAY);
    },
    [flush]
  );

  // Flush pending edits when the window closes or the editor unmounts.
  useEffect(() => {
    window.electron.setBeforeCloseHandler(flush);
    return () => {
      window.electron.setBeforeCloseHandler(null);
      flush(); // no-op when nothing is pending
    };
  }, [flush]);

  useEffect(() => {
    document.title = `${fileName} — Warden`;
    return () => {
      document.title = "Warden";
    };
  }, [fileName]);

  useEffect(() => {
    if (viewMode !== "preview") editorRef.current?.focus();
  }, [viewMode]);

  useEffect(() => {
    window.electron.storeGet("viewMode").then((v) => {
      if (v) setViewMode(v);
    });
  }, []);

  const changeViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    window.electron.storeSet("viewMode", mode);
  }, []);

  const handleLock = useCallback(async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;
    setLocking(true);
    await flush();
    if (
      editVersion.current !== savedVersion.current &&
      !window.confirm(
        "Your latest changes could not be saved. Lock anyway and discard them?"
      )
    ) {
      lockingRef.current = false;
      setLocking(false);
      return;
    }
    // Discard so the unmount flush doesn't retry.
    savedVersion.current = editVersion.current;
    onLock();
  }, [flush, onLock]);

  // Unattended lock (idle, screen lock, sleep): never discards unsaved work.
  // If saving fails the vault stays open and the next trigger retries.
  const autoLock = useCallback(async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;
    await flush();
    if (editVersion.current !== savedVersion.current) {
      lockingRef.current = false;
      return;
    }
    onLock();
  }, [flush, onLock]);

  useEffect(() => onLockRequest(handleLock), [handleLock]);
  useEffect(() => window.electron.onSystemLock(autoLock), [autoLock]);

  useEffect(() => {
    window.electron.storeGet("autoLockMinutes").then((v) => {
      if (typeof v === "number") setAutoLockMinutes(v);
    });
  }, []);

  useEffect(() => {
    lastActivity.current = Date.now();
    const bump = () => {
      lastActivity.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, bump, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump);
    };
  }, []);

  useEffect(() => {
    if (!autoLockMinutes) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= autoLockMinutes * 60_000) {
        autoLock();
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [autoLockMinutes, autoLock]);

  const handleAutoLockChange = useCallback((minutes: number) => {
    setAutoLockMinutes(minutes);
    window.electron.storeSet("autoLockMinutes", minutes);
  }, []);

  const handleChangePassword = useCallback(
    async (current: string, next: string) => {
      // Verify against the file on disk, which is always sealed with the
      // current key.
      await unlock(await window.electron.readFile(filePath), current);
      await persist({ rekey: await createVaultKey(next) });
      // Keep a Touch ID-saved password in sync; failure only means Touch ID
      // will ask for the password next time.
      await window.electron.updateBiometric(filePath, next).catch(() => {});
    },
    [filePath, persist]
  );

  const handleEnableBiometric = useCallback(
    async (password: string) => {
      await unlock(await window.electron.readFile(filePath), password);
      await window.electron.enableBiometric(filePath, password);
    },
    [filePath]
  );

  const handleRestore = useCallback(
    async (backupId: string, password?: string): Promise<RestoreResult> => {
      const raw = await window.electron.readBackup(filePath, backupId);
      const restored = password
        ? (await unlock(raw, password)).content
        : await unlockWithKey(raw, vaultKeyRef.current);
      if (restored === null) return "needs-password";

      // Get pending edits onto disk so the forced snapshot below includes them.
      await flush();
      setContent(restored);
      contentRef.current = restored;
      editVersion.current++;
      // Force a snapshot so the pre-restore version can itself be restored.
      await persist({ forceBackup: true });
      return "ok";
    },
    [filePath, flush, persist]
  );

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        flush();
      }
    },
    [flush]
  );

  return (
    <div className="flex h-screen flex-col" onKeyDown={handleKeyDown}>
      {/* Title bar drag region + toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 [-webkit-app-region:drag]"
        style={{ height: 52 }}
      >
        <div className="flex min-w-0 items-center gap-2.5 pl-16">
          <span className="truncate text-sm font-medium">{fileName}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3 w-3" />
                Saved
              </>
            )}
            {saveStatus === "unsaved" && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Unsaved
              </span>
            )}
            {saveStatus === "error" && (
              <span
                className="flex items-center gap-1 text-destructive [-webkit-app-region:no-drag]"
                title={saveError}
              >
                <AlertCircle className="h-3 w-3" />
                Save failed
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSettingsOpen(true)}
            title="Vault settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <div
            role="radiogroup"
            aria-label="View mode"
            className="mx-1 flex items-center rounded-md border p-0.5"
          >
            {VIEW_MODES.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={viewMode === mode}
                title={label}
                onClick={() => changeViewMode(mode)}
                className={`flex h-7 w-7 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  viewMode === mode
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleLock}
            disabled={locking}
            title="Lock vault"
          >
            {locking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* The editor stays mounted in every mode so cursor, scroll and undo
          history survive switching views. */}
      <div className="flex min-h-0 flex-1">
        <MarkdownEditor
          ref={editorRef}
          className={`min-h-0 min-w-0 flex-1 ${viewMode === "preview" ? "hidden" : ""}`}
          value={content}
          onChange={handleChange}
          placeholder="Start writing markdown..."
        />
        {viewMode !== "edit" && (
          <div
            className={`min-w-0 flex-1 overflow-auto ${viewMode === "split" ? "border-l" : ""}`}
          >
            <Preview markdown={previewContent} />
          </div>
        )}
      </div>

      {settingsOpen && (
        <SettingsDialog
          filePath={filePath}
          autoLockMinutes={autoLockMinutes}
          onAutoLockChange={handleAutoLockChange}
          onChangePassword={handleChangePassword}
          onEnableBiometric={handleEnableBiometric}
          onRestore={handleRestore}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}
