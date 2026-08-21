## 2026-08-15T12:50:57Z
You are Worker M5 for NanoForge (M5: Executable Packaging & Installer Tooling).
Your working directory is: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_worker_m5/

You MUST read:
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/ORIGINAL_REQUEST.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/PROJECT.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_explorer_survey_3/analysis.md
- Existing packaging configs, `package.json`, `scripts/`, `release/`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Exclusively Owned Files:
1. `scripts/nanoforge-launcher.cjs`: Standalone dual launcher script coordinating:
   - Starting the Fastify Agent Host daemon (port 4174).
   - Serving the Vite production `dist/` web UI (port 4173) with MIME type handling and SPA routing fallback.
   - Generating a session auth token.
   - Automatically opening the default browser to `http://127.0.0.1:4173/?hostPort=4174&token=...`.
   - Handling graceful process shutdown (SIGINT/SIGTERM) for both servers.
2. `scripts/package-release.js`: Automated release packager script that:
   - Verifies `dist/` and `apps/agent-host/dist/` builds exist.
   - Bundles launcher, static assets, and backend server into a clean distribution structure in `release/bundle/`.
   - Generates Windows executable launcher `release/NanoForge.exe` or standalone runner.
3. `release/install-nanoforge.ps1`: Windows PowerShell distribution installer script that sets up NanoForge in `%LOCALAPPDATA%\NanoForge`, creates Desktop and Start Menu shortcuts, and configures uninstaller entry.
4. `release/install-nanoforge.bat`: One-click Windows batch installer wrapper.
5. `release/uninstall-nanoforge.ps1`: Clean PowerShell uninstaller script.
6. `scripts/__tests__/packaging.test.ts` (or `scripts/packaging.test.ts`): Automated test verifying release packager, launcher syntax, and installer scripts.

Verification commands:
- Run `node scripts/package-release.js` (or test packaging)
- Run `npm test`
Ensure 100% tests pass and packaging succeeds cleanly.

Output Requirements:
- Write `changes.md` and `handoff.md` to your working directory.
- Send a completion message to the orchestrator.
