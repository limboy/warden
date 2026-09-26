# Warden

An encrypted markdown vault for the desktop. Each vault is a single `.warden`
file you can keep anywhere (including a synced folder); its contents are only
ever decrypted in memory.

## Features

- Markdown editor with live preview (GitHub-flavored markdown)
- Autosave with atomic writes; pending edits are flushed on lock and quit
- Auto-lock when idle (configurable), on screen lock and on sleep
- Change password
- Automatic encrypted backups with in-app restore
- Open vaults from Finder/Explorer or by dropping them onto the window

## Security model

| | |
|---|---|
| Cipher | AES-256-GCM, fresh 96-bit IV on every save |
| Key derivation | PBKDF2-HMAC-SHA256, 600,000 iterations, 128-bit random salt |
| Header integrity | Version, KDF name, iterations and salt are authenticated as AES-GCM additional data |
| In memory | Only the derived, non-extractable `CryptoKey` is kept after unlocking; the password is discarded |
| Renderer isolation | Context isolation + sandbox, strict CSP in production, external links open in the system browser |
| File access | The renderer can only read/write files the user chose through a dialog, drag-and-drop or the OS |

There is no password recovery. If you forget the password, the vault cannot be
decrypted.

### File format (v2)

A vault is a small JSON document:

```json
{
  "v": 2,
  "kdf": "PBKDF2-SHA256",
  "iter": 600000,
  "salt": "<base64>",
  "iv": "<base64>",
  "ct": "<base64 ciphertext + GCM tag>"
}
```

The additional authenticated data is `JSON.stringify({ v, kdf, iter, salt })`.
Version 1 files (100,000 iterations, no AAD) still open and are upgraded to v2
on unlock.

### Backups

Before a vault is overwritten, the previous (still encrypted) file is copied to
`<userData>/backups/<hash of vault path>/` — at most once every 10 minutes, and
always before a password change or restore. The 30 most recent snapshots are
kept. `<userData>` is `~/Library/Application Support/warden` on macOS.

## Development

```bash
npm install
npm run dev:electron   # Vite dev server + Electron
npm test               # unit tests (vitest)
npm run lint
npm run build          # typecheck + production renderer build
```

## Packaging

```bash
npm run build:mac   # unpacked .app in release/
npm run build:dmg   # .dmg installer
```

Code signing uses whatever Developer ID certificate electron-builder finds in
the keychain. For a local unsigned build, set `CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Project layout

```
electron/main.cjs      main process: windows, IPC, file access, backups, OS integration
electron/preload.cjs   the narrow API exposed to the renderer as window.electron
src/lib/crypto.ts      vault format, key derivation, encryption
src/components/        landing (create/unlock), editor, settings dialog
```
