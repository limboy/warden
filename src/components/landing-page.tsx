import { useState, useEffect, useRef } from "react";
import {
  Shield,
  FilePlus,
  FolderOpen,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { encrypt, decrypt } from "@/lib/crypto";

type Mode =
  | { type: "idle" }
  | { type: "create"; filePath: string }
  | { type: "open"; filePath: string };

interface Props {
  onUnlock: (filePath: string, password: string, content: string) => void;
}

export function LandingPage({ onUnlock }: Props) {
  const [mode, setMode] = useState<Mode>({ type: "idle" });
  const [lastFile, setLastFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const resumePasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.electron.storeGet("lastFile").then(setLastFile);
  }, []);

  function fileName(path: string) {
    return path.split("/").pop() || path;
  }

  async function handleResume(e: React.FormEvent) {
    e.preventDefault();
    if (!lastFile || !resumePasswordRef.current) return;
    const password = resumePasswordRef.current.value;
    if (!password) return;

    setLoading(true);
    setError("");
    try {
      const raw = await window.electron.readFile(lastFile);
      const content = await decrypt(raw, password);
      onUnlock(lastFile, password, content);
    } catch {
      setError("Wrong password or corrupted file");
      setLoading(false);
    }
  }

  async function handleNewVault() {
    const filePath = await window.electron.showSaveDialog("vault.warden");
    if (!filePath) return;
    setMode({ type: "create", filePath });
    setError("");
    setTimeout(() => passwordRef.current?.focus(), 50);
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.type !== "create") return;
    const form = e.target as HTMLFormElement;
    const password = (form.elements.namedItem("password") as HTMLInputElement)
      .value;
    const confirm = (form.elements.namedItem("confirm") as HTMLInputElement)
      .value;

    if (!password) return;
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const encrypted = await encrypt("", password);
      await window.electron.writeFile(mode.filePath, encrypted);
      await window.electron.storeSet("lastFile", mode.filePath);
      onUnlock(mode.filePath, password, "");
    } catch {
      setError("Failed to create vault");
      setLoading(false);
    }
  }

  async function handleOpenVault() {
    const filePath = await window.electron.showOpenDialog();
    if (!filePath) return;
    setMode({ type: "open", filePath });
    setError("");
    setTimeout(() => passwordRef.current?.focus(), 50);
  }

  async function handleOpenSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.type !== "open") return;
    const password = (
      (e.target as HTMLFormElement).elements.namedItem(
        "password"
      ) as HTMLInputElement
    ).value;
    if (!password) return;

    setLoading(true);
    setError("");
    try {
      const raw = await window.electron.readFile(mode.filePath);
      const content = await decrypt(raw, password);
      await window.electron.storeSet("lastFile", mode.filePath);
      onUnlock(mode.filePath, password, content);
    } catch {
      setError("Wrong password or corrupted file");
      setLoading(false);
    }
  }

  function goBack() {
    setMode({ type: "idle" });
    setError("");
  }

  return (
    <div className="flex min-h-screen select-none items-center justify-center">
      <div
        className="absolute inset-0 [-webkit-app-region:drag]"
        style={{ height: 52 }}
      />
      <div className="w-full max-w-sm space-y-6 px-6">
        {/* Logo */}
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Shield className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Warden</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Encrypted markdown vault
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Idle mode */}
        {mode.type === "idle" && (
          <>
            {lastFile && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">
                    Continue
                  </CardTitle>
                  <CardDescription className="truncate font-mono text-xs">
                    {fileName(lastFile)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleResume} className="flex gap-2">
                    <Input
                      ref={resumePasswordRef}
                      type="password"
                      placeholder="Password"
                      autoFocus
                      disabled={loading}
                    />
                    <Button type="submit" size="sm" disabled={loading}>
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Unlock"
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Card
                className="cursor-pointer transition-colors hover:border-foreground/20"
                onClick={handleNewVault}
              >
                <CardContent className="flex flex-col items-center gap-2 p-5">
                  <FilePlus className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">New Vault</span>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer transition-colors hover:border-foreground/20"
                onClick={handleOpenVault}
              >
                <CardContent className="flex flex-col items-center gap-2 p-5">
                  <FolderOpen className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">Open Vault</span>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Create mode */}
        {mode.type === "create" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={goBack}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <CardTitle className="text-sm font-medium">
                    Create Vault
                  </CardTitle>
                  <CardDescription className="truncate font-mono text-xs">
                    {fileName(mode.filePath)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    ref={passwordRef}
                    id="password"
                    name="password"
                    type="password"
                    placeholder="Choose a password"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm</Label>
                  <Input
                    id="confirm"
                    name="confirm"
                    type="password"
                    placeholder="Confirm password"
                    disabled={loading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Open mode */}
        {mode.type === "open" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={goBack}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <CardTitle className="text-sm font-medium">
                    Unlock Vault
                  </CardTitle>
                  <CardDescription className="truncate font-mono text-xs">
                    {fileName(mode.filePath)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleOpenSubmit} className="flex gap-2">
                <Input
                  ref={passwordRef}
                  name="password"
                  type="password"
                  placeholder="Password"
                  disabled={loading}
                />
                <Button type="submit" size="sm" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Unlock"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
