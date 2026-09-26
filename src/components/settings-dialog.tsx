import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WrongPasswordError } from "@/lib/crypto";
import { useBiometric } from "@/lib/use-biometric";

const AUTO_LOCK_OPTIONS = [
  { value: 1, label: "After 1 minute" },
  { value: 5, label: "After 5 minutes" },
  { value: 15, label: "After 15 minutes" },
  { value: 30, label: "After 30 minutes" },
  { value: 60, label: "After 1 hour" },
  { value: 0, label: "Never" },
];

export type RestoreResult = "ok" | "needs-password";

interface Props {
  filePath: string;
  autoLockMinutes: number;
  onAutoLockChange: (minutes: number) => void;
  onChangePassword: (current: string, next: string) => Promise<void>;
  /** Verifies the password, then turns on Touch ID for this vault. */
  onEnableBiometric: (password: string) => Promise<void>;
  onRestore: (backupId: string, password?: string) => Promise<RestoreResult>;
  onClose: () => void;
}

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

function errorMessage(err: unknown) {
  if (err instanceof WrongPasswordError) return "Wrong password";
  return err instanceof Error ? err.message : String(err);
}

function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "error") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {status.message}
      </p>
    );
  }
  if (status.kind === "ok") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 shrink-0" />
        {status.message}
      </p>
    );
  }
  return null;
}

export function SettingsDialog({
  filePath,
  autoLockMinutes,
  onAutoLockChange,
  onChangePassword,
  onEnableBiometric,
  onRestore,
  onClose,
}: Props) {
  const biometric = useBiometric(filePath);
  const [bioStatus, setBioStatus] = useState<Status>({ kind: "idle" });
  const [pwStatus, setPwStatus] = useState<Status>({ kind: "idle" });
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<Status>({ kind: "idle" });
  // Backup that needs its own password (made before a password change).
  const [passwordFor, setPasswordFor] = useState<string | null>(null);

  useEffect(() => {
    window.electron.listBackups(filePath).then(setBackups, () => setBackups([]));
  }, [filePath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).value;
    const current = field("current");
    const next = field("next");
    if (!current || !next) return;
    if (next !== field("confirm")) {
      setPwStatus({ kind: "error", message: "New passwords don't match" });
      return;
    }
    setPwStatus({ kind: "busy" });
    try {
      await onChangePassword(current, next);
      form.reset();
      setPwStatus({ kind: "ok", message: "Password changed" });
    } catch (err) {
      setPwStatus({ kind: "error", message: errorMessage(err) });
    }
  }

  async function restore(backup: BackupInfo, password?: string) {
    const when = new Date(backup.time).toLocaleString();
    if (
      !password &&
      !window.confirm(
        `Replace the current content with the backup from ${when}?\n\nThe current version is backed up first.`
      )
    ) {
      return;
    }
    setRestoreStatus({ kind: "busy" });
    try {
      const result = await onRestore(backup.id, password);
      if (result === "needs-password") {
        setPasswordFor(backup.id);
        setRestoreStatus({ kind: "idle" });
        return;
      }
      setPasswordFor(null);
      setRestoreStatus({ kind: "ok", message: `Restored backup from ${when}` });
      window.electron.listBackups(filePath).then(setBackups);
    } catch (err) {
      setRestoreStatus({ kind: "error", message: errorMessage(err) });
    }
  }

  async function handleEnableBiometric(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = (form.elements.namedItem("bio-password") as HTMLInputElement)
      .value;
    if (!password) return;
    setBioStatus({ kind: "busy" });
    try {
      await onEnableBiometric(password);
      form.reset();
      biometric.refresh();
      setBioStatus({ kind: "ok", message: "Touch ID turned on" });
    } catch (err) {
      setBioStatus({
        kind: "error",
        message:
          err instanceof WrongPasswordError
            ? "Wrong password"
            : "Touch ID was cancelled or didn't match",
      });
    }
  }

  async function handleDisableBiometric() {
    await window.electron.disableBiometric(filePath);
    biometric.refresh();
    setBioStatus({ kind: "ok", message: "Touch ID turned off" });
  }

  const busy =
    pwStatus.kind === "busy" ||
    restoreStatus.kind === "busy" ||
    bioStatus.kind === "busy";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 [-webkit-app-region:no-drag]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex max-h-full w-full max-w-md flex-col rounded-xl border bg-card text-card-foreground shadow-lg"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 id="settings-title" className="text-sm font-semibold">
            Vault settings
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            disabled={busy}
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-6 overflow-y-auto px-5 py-4">
          {/* Auto-lock */}
          <section className="space-y-2">
            <Label htmlFor="auto-lock">Auto-lock when idle</Label>
            <select
              id="auto-lock"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={autoLockMinutes}
              onChange={(e) => onAutoLockChange(Number(e.target.value))}
            >
              {AUTO_LOCK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              The vault also locks when the screen locks or the computer sleeps.
            </p>
          </section>

          {/* Change password */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Change password</h3>
            <form onSubmit={handleChangePassword} className="space-y-2">
              <Input
                name="current"
                type="password"
                placeholder="Current password"
                disabled={busy}
              />
              <Input
                name="next"
                type="password"
                placeholder="New password"
                disabled={busy}
              />
              <Input
                name="confirm"
                type="password"
                placeholder="Confirm new password"
                disabled={busy}
              />
              <div className="flex items-center justify-between gap-3">
                <StatusLine status={pwStatus} />
                <Button
                  type="submit"
                  size="sm"
                  className="ml-auto"
                  disabled={busy}
                >
                  {pwStatus.kind === "busy" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Change"
                  )}
                </Button>
              </div>
            </form>
          </section>

          {/* Touch ID (macOS only) */}
          {biometric.available && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Touch ID</h3>
              {biometric.enabled ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    This vault can be unlocked with Touch ID on this Mac.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={handleDisableBiometric}
                  >
                    Turn off
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleEnableBiometric} className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Your password is stored encrypted in this Mac&apos;s
                    Keychain and released only after Touch ID. Anyone who can
                    pass Touch ID on this Mac can open the vault.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      name="bio-password"
                      type="password"
                      placeholder="Current password"
                      disabled={busy}
                    />
                    <Button type="submit" size="sm" className="h-9" disabled={busy}>
                      {bioStatus.kind === "busy" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Turn on"
                      )}
                    </Button>
                  </div>
                </form>
              )}
              <StatusLine status={bioStatus} />
            </section>
          )}

          {/* Backups */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Backups</h3>
            <p className="text-xs text-muted-foreground">
              Encrypted snapshots are kept automatically (at most one every 10
              minutes, last 30 kept).
            </p>
            <StatusLine status={restoreStatus} />
            {backups === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : backups.length === 0 ? (
              <p className="text-xs text-muted-foreground">No backups yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {backups.map((b) => (
                  <li key={b.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs">
                        {new Date(b.time).toLocaleString()}
                        <span className="ml-2 text-muted-foreground">
                          {formatSize(b.size)}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={busy}
                        onClick={() => restore(b)}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Restore
                      </Button>
                    </div>
                    {passwordFor === b.id && (
                      <form
                        className="mt-2 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const input = e.currentTarget.elements.namedItem(
                            "backup-password"
                          ) as HTMLInputElement;
                          if (input.value) restore(b, input.value);
                        }}
                      >
                        <Input
                          name="backup-password"
                          type="password"
                          placeholder="Password used for this backup"
                          className="h-8 text-xs"
                          autoFocus
                          disabled={busy}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          className="h-8"
                          disabled={busy}
                        >
                          Restore
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
