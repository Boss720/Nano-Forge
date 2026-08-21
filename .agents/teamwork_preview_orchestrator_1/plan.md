# Orchestration Plan: NanoForge Architecture Audit, PRD & Roadmap

## Overview
Decompose the project into 4 parallel work streams executed by specialized documentation & PRD engineering workers, followed by independent review and verification.

## Work Streams & Artifact Allocation

### Stream 1: Deep Codebase Audit & 7-Pillar Gap Analysis (`worker_audit`)
- **Target Files**: `docs/AUDIT_AND_GAP_ANALYSIS.md`, `PROJECT.md`
- **Scope**:
  - Full codebase anatomy (`apps/agent-host`, `packages/protocol`, `src/`).
  - Trace execution models: Browser Direct (in-memory VFS + 2-turn auto-verify) vs Agent Host (Fastify WS + DAG ExecutionPlan).
  - Trace tool execution pipeline, policy engine (`policy.ts`), terminal runner (`runner.ts`), SQLite audit ledger (`store.ts`), MCP client (`client.ts`), Playwright browser manager (`manager.ts`), visual assertions (`visual.ts`).
  - Comprehensive 7-Pillar Capability Gap Matrix comparing NanoForge vs Claude Code CLI, Claude Desktop, and Antigravity IDE across:
    1. Agent Loop & Multi-Turn Iteration
    2. Multi-Agent & Subagent Hierarchy
    3. Planning & Approvals
    4. Artifacts & Rich UI Viewers
    5. Terminal & Headless Execution
    6. Tool Safety, Permissions & Policy Engine
    7. Extensibility (MCP Resources/Prompts, Skills, Rules, Plugins)

### Stream 2: Multi-Agent Orchestration & Headless Architecture PRDs (`worker_multiagent`)
- **Target Files**: `docs/PRD_MULTI_AGENT_ORCHESTRATION.md`, `docs/PRD_HEADLESS_CLI_TERMINAL.md`
- **Scope**:
  - Hierarchical subagent spawning (`invoke_subagent`), lifecycle management (`manage_subagents`), inter-agent communication (`send_message`), and reactive wakeup.
  - Parent-child tree supervision, failure escalation ladders (Retry -> Replace -> Skip -> Redistribute -> Degrade).
  - Workspace isolation (branched VFS/git worktree) vs shared workspaces.
  - Background daemon management (long-running dev servers, watchers, cron timers).
  - Headless CLI architecture (`nanoforge run`, non-interactive flags, stdin/stdout framing, exit codes, machine-readable JSON event stream).
  - Embedded PTY terminal integration (`@xterm/xterm`, `node-pty`, streaming stdout/stderr frames, resize events).
  - Production-ready TypeScript schemas for wire protocols and host handlers.

### Stream 3: Planning Mode, Artifact Viewers & Slash Command PRDs (`worker_planning_ui`)
- **Target Files**: `docs/PRD_PLANNING_ARTIFACTS_SLASH.md`
- **Scope**:
  - Antigravity-style Planning Mode: interactive plan composer, visual DAG authoring, drag-and-drop step dependency graph, dynamic phase grouping, side-effect approval gates.
  - Dedicated Artifact System: multi-format viewer dock (Monaco diff editor, live sandboxed HTML/React iframe canvas, Mermaid diagram viewer, interactive Markdown with syntax highlighting, carousel/gallery).
  - Artifact lifecycle: creation, revision, metadata tagging (`UserFacing`, `RequestFeedback`), user feedback loop.
  - Extensible Slash Command Engine: `/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/compact`, `/cost`, `/export`.
  - UI component specifications, React hooks, state reducers, and WebSocket protocol extensions.

### Stream 4: Phased Roadmap & E2E Verification Framework (`worker_roadmap`)
- **Target Files**: `docs/PHASED_ROADMAP_AND_VERIFICATION.md`, `docs/E2E_VERIFICATION_PLAN.md`
- **Scope**:
  - 4-Phase Delivery Roadmap structured with Easy/Free-First strategy:
    - Phase 1: Free/Easy High-Value UI & Artifacts (Monaco diffs, Mermaid/Markdown, Slash command palette, UI polish)
    - Phase 2: Planning Mode & Interactive Plan Composer (Visual DAG, step reordering, approval gates)
    - Phase 3: Headless CLI & Terminal Ergonomics (`nanoforge run`, `@xterm/xterm` PTY, streaming output)
    - Phase 4: Full Multi-Agent Orchestration & Daemon/Subagent Engine (Subagents, background tasks, message passing)
  - Clear deliverables, architectural prerequisites, complexity estimates, and developer ergonomics improvements per phase.
  - Concrete acceptance criteria, automated test matrix (unit, integration, Playwright E2E), and verification protocols.
