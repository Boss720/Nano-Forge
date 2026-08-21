===================================================
 NanoForge v0.6.0 - Autonomous Swarm Platform
===================================================

Quick Start:
1. Double-click 'NanoForge.exe' (or 'NanoForge.bat' / 'install-nanoforge.bat').
2. The launcher will start the Fastify Agent Host daemon (port 4174)
   and serve the production Web UI (port 4173).
3. Your default browser will open to:
   http://127.0.0.1:4173/?hostPort=4174&token=...

Included Files:
- NanoForge.exe: Compiled standalone launcher executable
- NanoForge.bat: Zero-dependency Windows script launcher
- install-nanoforge.ps1: PowerShell installer (creates Start/Desktop shortcuts)
- install-nanoforge.bat: One-click batch installer
- uninstall-nanoforge.ps1: PowerShell clean uninstaller
- dist/: Production React 19 + Vite visual control plane
- server.mjs / agent-host.mjs: Fastify Agent Host daemon
- nanoforge-launcher.cjs: Standalone dual-launch coordinator

System Requirements:
- Windows 10/11 x64
- Node.js 20+ (optional when running packaged binary)
