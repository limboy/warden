import { useEffect, useState } from "react";
import { LandingPage } from "@/components/landing-page";
import { EditorPage } from "@/components/editor-page";
import type { VaultKey } from "@/lib/crypto";
import { requestLock } from "@/lib/lock-bus";

interface Session {
  filePath: string;
  vaultKey: VaultKey;
  content: string;
}

interface OpenRequest {
  filePath: string;
  id: number;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);

  // Vaults opened from Finder/Explorer or dropped onto the window: lock the
  // current vault (if any) and show the unlock prompt for the new one.
  useEffect(() => {
    let nextId = 1;
    const open = (filePath: string | null) => {
      if (!filePath) return;
      setOpenRequest({ filePath, id: nextId++ });
      requestLock();
    };
    const takePending = () => window.electron.takePendingOpen().then(open);

    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) open(await window.electron.allowDroppedFile(file));
    };

    takePending();
    const unsubscribe = window.electron.onOpenFilePending(takePending);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      unsubscribe();
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  if (session) {
    return (
      <EditorPage
        key={session.filePath}
        filePath={session.filePath}
        vaultKey={session.vaultKey}
        initialContent={session.content}
        onLock={() => setSession(null)}
      />
    );
  }

  return (
    <LandingPage
      key={openRequest?.id ?? 0}
      initialOpenPath={openRequest?.filePath}
      onUnlock={(filePath, vaultKey, content) => {
        setOpenRequest(null);
        setSession({ filePath, vaultKey, content });
        window.electron.addRecent(filePath);
      }}
    />
  );
}

export default App;
