## 2026-08-15T04:41:06Z
You are worker_m4.
Your working directory is: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/worker_m4
Read ORIGINAL_REQUEST.md at c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/ORIGINAL_REQUEST.md
Read PROJECT.md at c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/orchestrator_1/PROJECT.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

SCOPE & EXCLUSIVE WRITE OWNERSHIP:
You own:
- `apps/agent-host/src/terminal/ptyManager.ts` (create new file)
- `apps/agent-host/src/terminal/ptyManager.test.ts` (create new file)
- `apps/agent-host/src/server.ts` (wire PTY messages)
- `apps/agent-host/src/session.ts` (wire PTY session)
- `src/sections/TerminalDock.tsx` (create new file)
- `src/sections/TerminalDock.test.tsx` (create new file)

TASKS:
1. `apps/agent-host/src/terminal/ptyManager.ts`:
   - Implement interactive PTY manager managing virtual terminal sessions.
   - Spawns shell processes (using `node-pty` if available or cross-platform child process stream with ConPTY / stdio fallback, env sanitization, workspace confinement).
   - Circular scrollback buffer (2MB per session).
   - Handles PTY protocol messages: `terminal.create`, `terminal.input`, `terminal.resize`, `terminal.kill`, streaming `terminal.data`, `terminal.exit`.
2. Wire PTY manager into `apps/agent-host/src/server.ts` and `apps/agent-host/src/session.ts` over WebSocket connection.
3. `src/sections/TerminalDock.tsx`:
   - Implement Virtual Terminal Dock using `@xterm/xterm` (and fit addon).
   - Multi-tab terminal instances (create tab, switch tab, close tab, tab title).
   - Full ANSI color rendering, resize observer synchronizing dimensions to host (`terminal.resize`), stdin input forwarding (`terminal.input`), stdout data rendering (`terminal.data`), and process exit handlers.
4. Add comprehensive unit and component tests:
   - `apps/agent-host/src/terminal/ptyManager.test.ts`
   - `src/sections/TerminalDock.test.tsx`
5. Run verification:
   - `npm run test:host`
   - `npm test`
   - `npm run build`

Deliverables:
Write handoff report to `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/worker_m4/handoff.md` with test outputs.
Send completion message to orchestrator.
