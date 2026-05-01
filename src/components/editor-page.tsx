import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Lock, Eye, Pencil, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { encrypt } from "@/lib/crypto";

type SaveStatus = "saved" | "unsaved" | "saving";

interface Props {
  filePath: string;
  password: string;
  initialContent: string;
  onLock: () => void;
}

export function EditorPage({
  filePath,
  password,
  initialContent,
  onLock,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [preview, setPreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const saveTimer = useRef<number | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fileName = filePath.split("/").pop() || filePath;

  const save = useCallback(
    async (text: string) => {
      setSaveStatus("saving");
      try {
        const encrypted = await encrypt(text, password);
        await window.electron.writeFile(filePath, encrypted);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [filePath, password]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      setContent(newContent);
      setSaveStatus("unsaved");

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => save(newContent), 800);
    },
    [save]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!preview) {
      textareaRef.current?.focus();
    }
  }, [preview]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        save(content);
      }
    },
    [content, save]
  );

  return (
    <div className="flex h-screen flex-col" onKeyDown={handleKeyDown}>
      {/* Title bar drag region + toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 [-webkit-app-region:drag]"
        style={{ height: 52 }}
      >
        <div className="flex items-center gap-2.5 pl-16">
          <span className="text-sm font-medium">{fileName}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
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
            onClick={onLock}
            title="Lock vault"
          >
            <Lock className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Editor / Preview */}
      {preview ? (
        <div className="flex-1 overflow-auto">
          <article className="prose prose-neutral mx-auto max-w-3xl p-8 dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || "*Empty vault — switch to edit to start writing.*"}
            </ReactMarkdown>
          </article>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="flex-1 resize-none bg-transparent p-8 font-mono text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
          value={content}
          onChange={handleChange}
          placeholder="Start writing markdown..."
          spellCheck={false}
        />
      )}
    </div>
  );
}
