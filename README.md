# Dutch Flight Sim Community Installer
Short name: **Dsfc Installer**  
Author: **Grazzy_Duck / Bas**

Windows-only Electron desktop installer/manager for Microsoft Flight Simulator 2024 Community addons hosted on a NAS/VPS via HTTPS.

## Tech
- Electron + TypeScript
- Renderer: React + TailwindCSS
- Main: Node.js (download, SHA256 verify, extract, atomic install)
- Settings: `electron-store`
- Auto-update: `electron-builder` + `electron-updater` (GitHub Releases provider)

## Development (macOS)
Prereqs:
- Node.js (>= 18)

Install:
- `npm install`

Run dev:
- `npm run dev`

Notes:
- The app **targets Windows only**, but can run in dev on macOS for UI + logic smoke tests.
- Community folder auto-detection is **Windows-only**. Use the **Browse…** button in dev.
- macOS: there is no native “window icon next to title” like Windows. In dev we use a **custom draggable titlebar** (BrowserWindow `titleBarStyle: hiddenInset`) to show DFSC branding, and we set the Dock icon via `app.dock.setIcon()`.
- macOS traffic light inset (single source of truth): `src/shared/windowChrome.ts`

## Build (Windows target)
### Option A: Build on Windows (recommended)
- Clone repo on a Windows machine
- `npm install`
- `npm run dist:win`

### Option B: Cross-build from macOS (possible, depends on tooling)
Electron Builder can cross-build Windows artifacts from macOS, but may require additional tooling (Wine / mono) depending on target and signing.
- `npm run dist:win`

Artifacts are written to `release/`.

## Configuration
Persistent settings are stored via `electron-store` under key `dsfc`.

Configurable settings:
- `manifestBaseUrl` (defaults to `https://nas.example.com/addons`)
- `updateBaseUrl` (defaults to `https://nas.example.com/app-updates`)
- `communityPath` (selected by user)
- `installPath` (destination for installs; defaults to Community when `installPathMode=followCommunity`)

Manifest channel download URL:
- `zipUrl` is preferred
- `url` is accepted for backward compatibility

## NAS folder structure (addons)
Example layout (you can change URLs; the app reads `manifest.json`):

- `https://nas.example.com/addons/manifest.json`
- `https://nas.example.com/addons/assets/...`
- `https://nas.example.com/addons/<category>/<addon-id>/<channel>/<zip>`

An example manifest is in `resources/example-manifest.json`.

## App auto-updates (GitHub Releases)
The app uses `electron-updater` with the **GitHub Releases** provider.

Source of truth repo:
- `FlightSimCommunityNL/Dfsc-Installer`

Runtime config:
- `src/main/update-config.ts` (`GITHUB_RELEASES_OWNER`, `GITHUB_RELEASES_REPO`)

Build-time publish config:
- `package.json` → `build.publish` (`provider=github`, `owner`, `repo`)

### GitHub Actions publishing (required)
This repo includes `.github/workflows/release.yml` which:
- triggers on tags like `v0.1.0`
- builds Windows NSIS
- publishes a GitHub Release via `electron-builder`

You must add a repo secret:
- `GH_TOKEN` → a GitHub token that can create releases and upload assets

### How to cut a release
1) Bump `package.json` version (e.g. `0.1.0` → `0.1.1`).
2) Commit and push.
3) Tag and push the tag:
   - `git tag v0.1.1`
   - `git push origin v0.1.1`
4) Wait for GitHub Actions workflow **Release** to finish.
5) Verify the GitHub Release contains (names may vary):
   - `*.exe` (NSIS installer)
   - `latest.yml`
   - `*.blockmap`

### How to test the update flow (Windows)
1) Install `v0.1.0` from GitHub Releases.
2) Publish `v0.1.1`.
3) Launch the installed `v0.1.0` app:
   - it should detect an update
   - download it
   - restart to install
4) Confirm the app version is now `0.1.1`.

### Local build (no publishing)
- `npm run dist:win`

Dev mode note:
- `npm run dev` never blocks on updates; update checks are skipped when the app is not packaged.

## App metadata
- productName: `DFSC Installer`
- appId: `nl.flightsimcommunity.dfsc.installer`
- author: `Grazzy_Duck / Bas`
