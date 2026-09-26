---
name: release
description: Release a new version of Warden — bump the version, tag, push, and watch the GitHub Actions build that publishes signed, notarized macOS DMGs to GitHub Releases.
argument-hint: "[patch | minor | major | x.y.z]"
disable-model-invocation: true
---

# Release Warden

Publishing is outward-facing and a pushed tag triggers a public GitHub Release,
so follow these steps in order and stop on any failure.

The pipeline: `npm version` bumps `package.json`, commits (message is the bare
version, e.g. `0.2.0`) and creates tag `vX.Y.Z`. Pushing the tag runs
`.github/workflows/release.yml`, which tests, signs with the Developer ID
certificate, notarizes via the App Store Connect API key, builds arm64 + x64
DMGs and zips and creates the GitHub Release. Installed copies auto-update
from that release via `latest-mac.yml` (electron-updater), so a broken
release reaches existing users within hours — the verification step matters.
The workflow fails if the tag doesn't match `package.json`.

## 1. Preflight

Run and check all of these; if any fails, report it and stop:

```bash
git status --porcelain            # must be empty
git branch --show-current         # must be main
git fetch origin && git status -sb | head -1   # must not be behind origin/main
gh secret list                    # needs CSC_LINK, APPLE_API_KEY_P8, APPLE_API_KEY_ID, APPLE_API_ISSUER
npm test && npm run lint && npm run build
```

If the signing secrets are missing, the release still builds but is ad-hoc
signed and users get a Gatekeeper warning — ask before continuing.

## 2. Choose the version

- If the argument is `patch`, `minor`, `major` or an explicit `x.y.z`, use it.
- Otherwise show the commits since the last tag
  (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`), suggest a bump
  (new features → minor, only fixes → patch) and ask the user to confirm.
- If there are no commits since the last tag, stop: nothing to release.

## 3. Confirm, then tag and push

Show the user the current version → new version and the commit list, and get
an explicit go-ahead before pushing. Then:

```bash
npm version <bump>            # commit + tag vX.Y.Z
git push --follow-tags
```

## 4. Watch the build

```bash
gh run list --workflow release.yml --limit 1     # get the run ID for the new tag
gh run watch <run-id> --exit-status
```

The run takes roughly 10–20 minutes (notarization is most of it); run the
watch in the background rather than blocking. If it fails, fetch the failing
step's log with `gh run view <run-id> --log-failed` and diagnose. Common causes:

- Tag/version mismatch — the tag was created by hand instead of `npm version`.
- `security import` failed — `CSC_LINK` is wrong, or `CSC_KEY_PASSWORD` is set
  but the `.p12` has no password (delete that secret with
  `gh secret delete CSC_KEY_PASSWORD`).
- Notarization errors — check `APPLE_API_*` secrets.

To retry after fixing the workflow, delete the tag and release, then re-tag
the new commit — ask the user first, since this rewrites a published tag:
`gh release delete vX.Y.Z --yes; git push --delete origin vX.Y.Z; git tag -d vX.Y.Z`.

## 5. Verify the published release

```bash
gh release view vX.Y.Z --json url,assets -q '.url, (.assets[].name)'
```

Expect `Warden-X.Y.Z-arm64.dmg`, `Warden-X.Y.Z-x64.dmg`,
`Warden-X.Y.Z-{arm64,x64}-mac.zip` (+ `.blockmap`) and `latest-mac.yml`, whose
`version` must be X.Y.Z (`gh release download vX.Y.Z -p latest-mac.yml -O -`).
Without the yml and zips, installed copies can't update. Then download the
arm64 DMG and confirm Gatekeeper accepts the app inside it:

```bash
tmp=$(mktemp -d)
gh release download vX.Y.Z -p '*-arm64.dmg' -D "$tmp"
mnt=$(hdiutil attach -nobrowse -readonly "$tmp"/*.dmg | tail -1 | cut -f3)
spctl -a -vvv -t exec "$mnt/Warden.app"   # expect: accepted, source=Notarized Developer ID
xcrun stapler validate "$mnt/Warden.app"
hdiutil detach "$mnt"; rm -rf "$tmp"
```

Report the release URL and the verification result.
