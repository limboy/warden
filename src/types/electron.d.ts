export {};

declare global {
  interface BackupInfo {
    id: string;
    /** Snapshot time, ms since epoch. */
    time: number;
    size: number;
  }

  interface RecentVault {
    path: string;
    exists: boolean;
  }

  interface StoreSchema {
    autoLockMinutes: number;
    viewMode: "edit" | "split" | "preview";
  }

  interface Window {
    electron: {
      platform: string;
      showSaveDialog: (defaultName?: string) => Promise<string | null>;
      showOpenDialog: () => Promise<string | null>;
      readFile: (path: string) => Promise<string>;
      writeFile: (
        path: string,
        data: string,
        opts?: { forceBackup?: boolean }
      ) => Promise<void>;
      fileExists: (path: string) => Promise<boolean>;
      /** Grants access to a dropped .warden file; resolves to its path or null. */
      allowDroppedFile: (file: File) => Promise<string | null>;
      listBackups: (path: string) => Promise<BackupInfo[]>;
      readBackup: (path: string, id: string) => Promise<string>;
      listRecents: () => Promise<RecentVault[]>;
      /** Move a vault to the top of the recent list. */
      addRecent: (path: string) => Promise<void>;
      removeRecent: (path: string) => Promise<void>;
      /** Touch ID can be used on this machine. */
      biometricAvailable: () => Promise<boolean>;
      biometricEnabled: (path: string) => Promise<boolean>;
      /** Prompts for Touch ID, then saves the password for this vault. */
      enableBiometric: (path: string, password: string) => Promise<void>;
      /** Re-saves the password if Touch ID is enabled for this vault. */
      updateBiometric: (path: string, password: string) => Promise<void>;
      disableBiometric: (path: string) => Promise<void>;
      /** Prompts for Touch ID and resolves to the saved password. */
      unlockWithBiometric: (path: string) => Promise<string>;
      storeGet: <K extends keyof StoreSchema>(
        key: K
      ) => Promise<StoreSchema[K] | null>;
      storeSet: <K extends keyof StoreSchema>(
        key: K,
        value: StoreSchema[K] | null
      ) => Promise<void>;
      /** Fetch (and clear) a vault path the OS asked us to open. */
      takePendingOpen: () => Promise<string | null>;
      onOpenFilePending: (cb: () => void) => () => void;
      /** Fired when the screen locks or the machine sleeps. */
      onSystemLock: (cb: () => void) => () => void;
      /** Called (and awaited) before the window closes; pass null to clear. */
      setBeforeCloseHandler: (fn: (() => Promise<void>) | null) => void;
    };
  }
}
