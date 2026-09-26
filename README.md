# Warden

An encrypted markdown vault for the desktop. Each vault is a single `.warden`
file you can keep anywhere (including a synced folder); its contents are only
ever decrypted in memory.

## Install

Download the DMG for your Mac from the
[latest release](https://github.com/limboy/warden/releases/latest) (`arm64`
for Apple Silicon, `x64` for Intel), open it and drag Warden into
Applications. Releases are signed and notarized by Apple.

## Features

- CodeMirror markdown editor: syntax highlighting, find/replace, list
  continuation; editor-only, split, or preview-only views
- Light and dark themes following the OS
- Recent vaults list on the start screen
- Autosave with atomic writes; pending edits are flushed on lock and quit
- Auto-lock when idle (configurable), on screen lock and on sleep
- Change password
- Optional Touch ID unlock per vault (macOS)
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

**Touch ID** is opt-in per vault. When enabled, the password is encrypted with
Electron `safeStorage` (key held in the macOS Keychain) and stored in the app's
settings; the main process releases it to the renderer only after a successful
Touch ID prompt. Anyone who can pass Touch ID on that Mac can open the vault.
If the saved password stops working (e.g. it was changed on another machine),
the entry is discarded.

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

To build and install into `/Applications` in one step (quits a running Warden
first):

```bash
npm run install:mac                  # build + install
npm run install:mac -- --unsigned    # skip code signing
npm run install:mac -- --skip-build --open
```

Code signing uses whatever Developer ID certificate electron-builder finds in
the keychain. For a local unsigned build, set `CSC_IDENTITY_AUTO_DISCOVERY=false`.

### Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds DMGs for
Apple Silicon (`arm64`) and Intel (`x64`) and attaches them to a GitHub Release.
The tag must match the `version` in `package.json`:

```bash
npm version 0.1.0        # bumps package.json, commits and tags v0.1.0
git push --follow-tags
```

To sign and notarize, add these repository secrets: `CSC_LINK` (base64 of a
Developer ID Application `.p12`), `CSC_KEY_PASSWORD` (only if the `.p12` has
one), and for an App Store Connect API key `APPLE_API_KEY_P8` (contents of the
`.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. Without them the app gets an
ad-hoc signature, and users must allow the first launch in System Settings →
Privacy & Security → Open Anyway (the release notes explain this).

With Claude Code, `/release [patch|minor|major|x.y.z]` runs the whole process:
preflight checks, version bump, push, watching the build and verifying the
published DMG.

## Project layout

```
electron/main.cjs      main process: windows, IPC, file access, backups, OS integration
electron/preload.cjs   the narrow API exposed to the renderer as window.electron
src/lib/crypto.ts      vault format, key derivation, encryption
src/components/        landing (create/unlock), editor, settings dialog
```
