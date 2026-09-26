import { useCallback, useEffect, useRef, useState } from "react";
import {
  Shield,
  FilePlus,
  FolderOpen,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Fingerprint,
  X,
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
import {
  createVaultKey,
  seal,
  unlock,
  WrongPasswordError,
  CorruptVaultError,
  type VaultKey,
} from "@/lib/crypto";
import { useBiometric } from "@/lib/use-biometric";
import { basename, dirname } from "@/lib/utils";

type Mode =
  | { type: "idle" }
  | { type: "create"; filePath: string }
  | { type: "open"; filePath: string };

interface Props {
  /** Start in the unlock (or create) prompt for this vault. */
  initialRequest?: OpenRequest;
  onUnlock: (filePath: string, vaultKey: VaultKey, content: string) => void;
}

class FileMissingError extends Error {}

/** Read and decrypt a vault, upgrading legacy KDF parameters if needed. */
async function openVault(filePath: string, password: string) {
  if (!(await window.electron.fileExists(filePath))) {
    throw new FileMissingError();
  }
  const raw = await window.electron.readFile(filePath);
  const { content, vaultKey, outdated } = await unlock(raw, password);
  if (!outdated) return { content, vaultKey };

  const upgraded = await createVaultKey(password);
  try {
    await window.electron.writeFile(filePath, await seal(content, upgraded));
    return { content, vaultKey: upgraded };
  } catch {
    // Keep working with the old parameters; the upgrade is retried next time.
    return { content, vaultKey };
  }
}

function unlockErrorMessage(err: unknown, filePath: string) {
  if (err instanceof FileMissingError) {
    return `${basename(filePath)} no longer exists — it may have been moved or deleted`;
  }
  if (err instanceof WrongPasswordError) return "Wrong password";
  if (err instanceof CorruptVaultError) return err.message;
  return "Failed to open vault";
}

const actionCardClass =
  "flex flex-col items-center gap-2 rounded-xl border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LandingPage({ initialRequest, onUnlock }: Props) {
  const [mode, setMode] = useState<Mode>(
    initialRequest
      ? {
          type: initialRequest.create ? "create" : "open",
          filePath: initialRequest.path,
        }
      : { type: "idle" }
  );
  const [recents, setRecents] = useState<RecentVault[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const resumePasswordRef = useRef<HTMLInputElement>(null);

  const refreshRecents = useCallback(() => {
    window.electron.listRecents().then(setRecents);
  }, []);

  useEffect(refreshRecents, [refreshRecents]);

  // Offer the most recent vault that still exists for one-step unlocking;
  // list the rest below.
  const lastFile = recents.find((r) => r.exists)?.path ?? null;
  const otherRecents = recents.filter((r) => r.path !== lastFile);

  function forgetRecent(path: string) {
    window.electron.removeRecent(path).then(refreshRecents);
  }

  function handleUnlockError(err: unknown, filePath: string) {
    setError(unlockErrorMessage(err, filePath));
    if (err instanceof FileMissingError) forgetRecent(filePath);
    setLoading(false);
  }

  const resumeBiometric = useBiometric(lastFile);
  const openBiometric = useBiometric(
    mode.type === "open" ? mode.filePath : null
  );

  async function handleBiometricUnlock(filePath: string) {
    setLoading(true);
    setError("");
    let password: string;
    try {
      password = await window.electron.unlockWithBiometric(filePath);
    } catch {
      setError("Touch ID was cancelled or didn't match");
      setLoading(false);
      return;
    }
    try {
      const { content, vaultKey } = await openVault(filePath, password);
      onUnlock(filePath, vaultKey, content);
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        // Password was changed elsewhere; the saved one is useless now.
        await window.electron.disableBiometric(filePath);
        resumeBiometric.refresh();
        openBiometric.refresh();
        setError(
          "The password saved for Touch ID no longer works. Enter your password; you can turn Touch ID on again in vault settings."
        );
        setLoading(false);
      } else {
        handleUnlockError(err, filePath);
      }
    }
  }

  function openRecent(filePath: string) {
    setMode({ type: "open", filePath });
    setError("");
  }

  async function handleResume(e: React.FormEvent) {
    e.preventDefault();
    if (!lastFile || !resumePasswordRef.current) return;
    const password = resumePasswordRef.current.value;
    if (!password) return;

    setLoading(true);
    setError("");
    try {
      const { content, vaultKey } = await openVault(lastFile, password);
      onUnlock(lastFile, vaultKey, content);
    } catch (err) {
      handleUnlockError(err, lastFile);
    }
  }

  async function handleNewVault() {
    const filePath = await window.electron.showSaveDialog("vault.warden");
    if (!filePath) return;
    if (await window.electron.fileExists(filePath)) {
      setError(
        `${basename(filePath)} already exists. Choose a new name, or use Open Vault.`
      );
      return;
    }
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
      const vaultKey = await createVaultKey(password);
      await window.electron.writeFile(mode.filePath, await seal("", vaultKey));
      onUnlock(mode.filePath, vaultKey, "");
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
      const { content, vaultKey } = await openVault(mode.filePath, password);
      onUnlock(mode.filePath, vaultKey, content);
    } catch (err) {
      handleUnlockError(err, mode.filePath);
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
                    {basename(lastFile)}
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
                    {resumeBiometric.enabled && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="px-2"
                        disabled={loading}
                        onClick={() => handleBiometricUnlock(lastFile)}
                        title="Unlock with Touch ID"
                        aria-label="Unlock with Touch ID"
                      >
                        <Fingerprint className="h-4 w-4" />
                      </Button>
                    )}
                  </form>
                </CardContent>
              </Card>
            )}

            {otherRecents.length > 0 && (
              <div className="space-y-1.5">
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  Recent
                </p>
                <ul className="divide-y rounded-xl border">
                  {otherRecents.map((r) => (
                    <li key={r.path} className="group flex items-center">
                      <button
                        type="button"
                        disabled={!r.exists}
                        onClick={() => openRecent(r.path)}
                        title={r.exists ? r.path : `${r.path} (not found)`}
                        className="min-w-0 flex-1 px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        <span className="block truncate text-sm">
                          {basename(r.path)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.exists ? dirname(r.path) : "File not found"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => forgetRecent(r.path)}
                        title="Remove from list"
                        aria-label={`Remove ${basename(r.path)} from recent list`}
                        className="mr-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className={actionCardClass}
                onClick={handleNewVault}
              >
                <FilePlus className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">New Vault</span>
              </button>
              <button
                type="button"
                className={actionCardClass}
                onClick={handleOpenVault}
              >
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">Open Vault</span>
              </button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Or drop a .warden file onto this window
            </p>
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
                    {basename(mode.filePath)}
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
                    autoFocus
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
                    {basename(mode.filePath)}
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
                {openBiometric.enabled && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="px-2"
                    disabled={loading}
                    onClick={() => handleBiometricUnlock(mode.filePath)}
                    title="Unlock with Touch ID"
                    aria-label="Unlock with Touch ID"
                  >
                    <Fingerprint className="h-4 w-4" />
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
