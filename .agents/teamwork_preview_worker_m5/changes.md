# Changes Implemented for Milestone M5: Executable Packaging & Installer Tooling

## Summary
Milestone M5 delivers standalone packaging and Windows installer tooling for NanoForge Phase 6, enabling seamless dual-launch execution of the Fastify Agent Host daemon alongside the production React 19 + Vite web control plane.

## Detailed Changes

### 1. `scripts/nanoforge-launcher.cjs`
- **Dual Launcher Architecture**: Coordinates booting the Fastify Agent Host daemon (default port 4174) and serving the Vite production `dist/` web UI (default port 4173) under loopback `127.0.0.1`.
- **Session Authentication Handshake**: Generates a 192-bit cryptographic URL-safe base64 auth token via `crypto.randomBytes(24).toString('base64url')` and passes it to both host and browser launch URL.
- **Production Static Serving & SPA Fallback**: Implements comprehensive MIME type mapping and SPA fallback returning `dist/index.html` with `Cache-Control: no-cache` for client-side routing.
- **Path Sanitization & Confinement**: Sanitizes request paths to prevent directory traversal attacks.
- **Browser Auto-Launch**: Automatically opens the default browser to `http://127.0.0.1:4173/?hostPort=4174&token=...` across Windows (`start`), macOS (`open`), and Linux (`xdg-open`), with `--no-open` override.
- **Graceful Lifecycle Shutdown**: Listens for `SIGINT`/`SIGTERM` signals and cleanly shuts down the HTTP UI server and terminates child daemon processes.
- **Dry-run & Unit Testing Hooks**: Supports `--dry-run` and exports modular helpers (`parseArgs`, `generateToken`, `getMimeType`, `resolveDistRoot`, `createStaticServer`, `startLauncher`).

### 2. `scripts/package-release.js`
- **Automated Packaging Pipeline**: Verifies frontend production build (`dist/index.html`) and bundles backend host (`apps/agent-host/src/server.ts`) via `esbuild` into `apps/agent-host/dist/server.mjs`.
- **Distribution Bundle Assembly**: Populates `release/bundle/` containing `dist/` assets, launcher scripts (`nanoforge-launcher.cjs`, `launcher.cjs`), backend daemon (`server.mjs`, `agent-host.mjs`), `NanoForge.bat` script runner, `NanoForge.exe` binary, installer scripts, `package.json`, and `README.txt`.
- **Windows Executable & Batch Runner**: Preserves and syncs `release/NanoForge.exe` and creates zero-dependency `NanoForge.bat` launcher.
- **Release Archive Generation**: Creates `release/NanoForge-v0.6.0-windows-x64.zip` (15.24 MB) using Windows PowerShell `Compress-Archive`.
- **CLI Options**: Supports `--version <v>`, `--skip-build`, `--dry-run`, `--help`.

### 3. `release/install-nanoforge.ps1`
- **Windows Distribution Installer**: Installs NanoForge into `%LOCALAPPDATA%\NanoForge`.
- **Shortcut Creation**: Creates Start Menu (`NanoForge.lnk`, `Uninstall NanoForge.lnk`) and Desktop (`NanoForge.lnk`) shortcuts using `WScript.Shell`.
- **Environment PATH Configuration**: Adds installation folder to User `PATH` environment variable without duplicate entries.
- **Windows Add/Remove Programs**: Registers uninstaller entry in `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\NanoForge`.
- **Automation Flags**: Supports `-InstallDir <path>`, `-Silent`, `-NoShortcuts`, `-NoPath`.

### 4. `release/install-nanoforge.bat`
- **One-Click Batch Wrapper**: Double-clickable batch wrapper invoking `powershell.exe -NoProfile -ExecutionPolicy Bypass -File install-nanoforge.ps1`.

### 5. `release/uninstall-nanoforge.ps1`
- **Clean Uninstaller**: Terminates running `NanoForge` instances, removes Desktop and Start Menu shortcuts, cleans User `PATH`, removes Windows registry uninstaller key, and deletes `%LOCALAPPDATA%\NanoForge`.
- **Automation Flags**: Supports `-InstallDir <path>`, `-Silent`, `-Force`.

### 6. `scripts/__tests__/packaging.test.ts`
- **13 Automated Unit and Integration Tests**:
  - Launcher token generation (32+ chars URL-safe entropy).
  - CLI argument parsing & environment overrides.
  - MIME type resolution across 11+ extensions.
  - Static file serving, SPA route fallback, and traversal confinement.
  - Dual launcher dry-run execution and shutdown.
  - Release packaging bundle structure and zip archive verification.
  - PowerShell installer and uninstaller script structure and parameter validation.

### 7. Configuration & Manifest Updates
- Updated `vitest.config.ts` to include `scripts/**/*.test.{ts,tsx}` in test runs.
- Updated `package.json` with `"package": "node scripts/package-release.js"` and `"start:launcher": "node scripts/nanoforge-launcher.cjs"`.
