import { useState } from "react";
import { LandingPage } from "@/components/landing-page";
import { EditorPage } from "@/components/editor-page";
import type { VaultKey } from "@/lib/crypto";

interface Session {
  filePath: string;
  vaultKey: VaultKey;
  content: string;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);

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
      onUnlock={(filePath, vaultKey, content) =>
        setSession({ filePath, vaultKey, content })
      }
    />
  );
}

export default App;
