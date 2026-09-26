import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Lock, Eye, Pencil, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { seal, type VaultKey } from "@/lib/crypto";
import { basename } from "@/lib/utils";

type SaveStatus = "saved" | "unsaved" | "saving" | "error";

const AUTOSAVE_DELAY = 800;

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
  const [preview, setPreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState("");
  const [locking, setLocking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Save bookkeeping lives in refs so saves never see stale closures.
  const saveTimer = useRef<number | undefined>(undefined);
  const contentRef = useRef(initialContent);
  const editVersion = useRef(0);
  const savedVersion = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const fileName = basename(filePath);

  // Saves are serialized so an older snapshot can never land on disk after a
  // newer one.
  const flush = useCallback((): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }
    saveQueue.current = saveQueue.current.then(async () => {
      const version = editVersion.current;
      if (version === savedVersion.current) return;
      setSaveStatus("saving");
      try {
        const encrypted = await seal(contentRef.current, vaultKey);
        await window.electron.writeFile(filePath, encrypted);
        savedVersion.current = version;
        setSaveError("");
        setSaveStatus(
          editVersion.current === savedVersion.current ? "saved" : "unsaved"
        );
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        setSaveStatus("error");
      }
    });
    return saveQueue.current;
  }, [filePath, vaultKey]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
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
    if (!preview) textareaRef.current?.focus();
  }, [preview]);

  const handleLock = useCallback(async () => {
    setLocking(true);
    await flush();
    if (
      editVersion.current !== savedVersion.current &&
      !window.confirm(
        "Your latest changes could not be saved. Lock anyway and discard them?"
      )
    ) {
      setLocking(false);
      return;
    }
    // Discard so the unmount flush doesn't retry.
    savedVersion.current = editVersion.current;
    onLock();
  }, [flush, onLock]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        flush();
      }
    },
    [flush]
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        // execCommand keeps the native undo stack intact.
        document.execCommand("insertText", false, "  ");
      }
    },
    []
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
            onClick={() => setPreview(!preview)}
            title={preview ? "Edit" : "Preview"}
          >
            {preview ? (
              <Pencil className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
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

      {/* Editor / Preview. The textarea stays mounted so cursor, scroll and
          undo history survive toggling preview. */}
      {preview && (
        <div className="flex-1 overflow-auto">
          <article className="prose prose-neutral mx-auto max-w-3xl p-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || "*Empty vault — switch to edit to start writing.*"}
            </ReactMarkdown>
          </article>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={`flex-1 resize-none bg-transparent p-8 font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground ${preview ? "hidden" : ""}`}
        value={content}
        onChange={handleChange}
        onKeyDown={handleTextareaKeyDown}
        placeholder="Start writing markdown..."
        spellCheck={false}
      />
    </div>
  );
}
