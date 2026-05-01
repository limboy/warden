export {};

declare global {
  interface Window {
    electron: {
      platform: string;
      showSaveDialog: (defaultName?: string) => Promise<string | null>;
      showOpenDialog: () => Promise<string | null>;
      readFile: (path: string) => Promise<string>;
      writeFile: (path: string, data: string) => Promise<void>;
      fileExists: (path: string) => Promise<boolean>;
      storeGet: (key: string) => Promise<string | null>;
      storeSet: (key: string, value: string | null) => Promise<void>;
    };
  }
}
