# Dutch Flight Sim Community Installer
Short name: **Dsfc Installer**  
Author: **Grazzy_Duck / Bas**

Windows-only Electron desktop installer/manager for Microsoft Flight Simulator 2024 Community addons hosted on a NAS/VPS via HTTPS.

## Tech
- Electron + TypeScript
- Renderer: React + TailwindCSS
- Main: Node.js (download, SHA256 verify, extract, atomic install)
- Settings: `electron-store`
- Auto-update: `electron-builder` + `electron-updater` (generic provider)

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

## NAS folder structure (addons)
Example layout (you can change URLs; the app reads `manifest.json`):

- `https://nas.example.com/addons/manifest.json`
- `https://nas.example.com/addons/assets/...`
- `https://nas.example.com/addons/<category>/<addon-id>/<channel>/<zip>`

An example manifest is in `resources/example-manifest.json`.

## App auto-updates (GitHub Releases)
The app uses `electron-updater` with the **GitHub Releases** provider.

Placeholders to change (single source):
- `src/main/update-config.ts`
  - `GITHUB_RELEASES_OWNER`
  - `GITHUB_RELEASES_REPO`

Build-time publish config also includes placeholders:
- `package.json` → `build.publish` → `owner` / `repo`

### Steps to enable publishing later
1) Create a GitHub repository.
2) Update placeholders:
   - `src/main/update-config.ts`
   - `package.json` (`build.publish.owner` / `build.publish.repo`)
3) Create a GitHub token for CI publishing:
   - Set `GH_TOKEN` as a GitHub Actions secret.
4) Add a GitHub Actions workflow that:
   - runs on tag
   - builds Windows NSIS
   - uploads artifacts to GitHub Releases (electron-builder does this automatically when `GH_TOKEN` is present).

### Local build (no publishing)
- `npm run dist:win`

Note: without a real repo + release artifacts, update checks will fail (expected) but the app will still run.

## App metadata
- productName: `Dutch Flight Sim Community Installer`
- appId: `com.dsfc.installer`
- author: `Grazzy_Duck / Bas`
