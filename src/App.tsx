import { useState } from "react";
import { LandingPage } from "@/components/landing-page";
import { EditorPage } from "@/components/editor-page";

interface Session {
  filePath: string;
  password: string;
  content: string;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);

  if (session) {
    return (
      <EditorPage
        key={session.filePath}
        filePath={session.filePath}
        password={session.password}
        initialContent={session.content}
        onLock={() => setSession(null)}
      />
    );
  }

  return (
    <LandingPage
      onUnlock={(filePath, password, content) =>
        setSession({ filePath, password, content })
      }
    />
  );
}

export default App;
