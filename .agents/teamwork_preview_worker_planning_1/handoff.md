# Planning & UI PRD Specification Handoff Report

**Author:** Worker 3 (Planning & UI PRD Author)  
**Date:** 2026-08-15  
**Working Directory:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_worker_planning_1`  
**Primary Deliverable:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/docs/PRD_PLANNING_ARTIFACTS_SLASH.md`  

---

## 1. Observation

A systematic inspection of the user request, codebase audit reports (Surveys 1, 2, and 3), protocol definitions, and UI panel implementations revealed:

1. **Planning System Gaps**:
   - `packages/protocol/src/plan.ts` and `src/sections/PlanPanel.tsx` define a flat array of steps with static dependency strings and basic approval gating.
   - The UI lacks visual DAG authoring, dynamic phase grouping (`Discovery` -> `Implementation` -> `Verification` -> `Handoff`), drag-and-drop step reordering, interactive cycle detection, and revision forking.
2. **Artifact System Gaps**:
   - Diffs and previews are fragmented across inline `PatchCard` components, basic code blocks in `RichText.tsx`, and isolated modal viewers.
   - There is no persistent right-side Artifact Dock capable of rendering Monaco side-by-side/inline diffs, live sandboxed HTML/React iframe previews, Mermaid diagrams, or interactive version history scrubbers.
   - No structured metadata schema (`UserFacing`, `RequestFeedback`, `Summary`, `Revision`) or user feedback request hooks exist in the protocol.
3. **Slash Command Engine Gaps**:
   - The chat composer in `src/sections/ChatPanel.tsx` has no inline slash command trigger (`/`).
   - Missing essential built-in commands: `/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/compact`, `/cost`, `/export`.
   - No parameter parsing engine (positional, flags, quoted strings, context mentions `@file`, `#symbol`, `@agent`) or plugin registry.

---

## 2. Logic Chain

1. **Protocol-First Architecture**:
   - In order to support advanced Planning, Artifacts, and Slash Commands across both the Fastify Agent Host daemon and the Vite/React UI, shared Zod schemas and TypeScript interfaces must be consolidated in `packages/protocol`.
2. **Security & Approval Invariants**:
   - Natural language text from chat can never grant tool or plan execution permissions.
   - The UI maintains a client-side approval ledger that downgrades rogue `running` statuses to `blocked`.
   - Side-effecting steps (`sideEffecting: true`) require explicit user approval (`approval: "required"`).
3. **Dedicated Rendering Isolation**:
   - Live web previews must run inside a sandboxed `iframe` (`sandbox="allow-scripts allow-forms allow-popups"`) with a strict CSP blocking loopback network calls to prevent token theft or malicious host RPC calls.
4. **Comprehensive PRD Formulation**:
   - Authored `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` (1,461 lines) specifying complete state machines, component hierarchies, pure Redux/Zustand-style reducers (`planComposerReducer`, `artifactDockReducer`, `slashCommandReducer`), ASCII wireframes, WebSocket wire frames, and Vitest test criteria.

---

## 3. Caveats

1. **External Dependency Requirements**:
   - Monaco Diff Viewer requires `@monaco-editor/react`. Dynamic `lazy()` import should be used to avoid bundle bloat.
   - Mermaid diagram rendering requires `mermaid.js`.
   - Live React Preview requires Babel Standalone and React/ReactDOM UMD bundles loaded dynamically.
2. **Host Daemon Seam**:
   - Real-time features (`/schedule`, `/browse`, DAG topological execution) require the loopback Fastify host WebSocket connection. In standalone browser direct mode, features fall back to local VFS simulations.

---

## 4. Conclusion

The specification document `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` is complete, fully elaborated, production-grade, and ready for immediate engineering implementation. It covers:
1. **Antigravity-Style Planning Mode PRD**: Visual DAG, drag-and-drop step dependencies, dynamic phase grouping, two-tier approval gates, side-effect step policies, revision lifecycles, and `planComposerReducer`.
2. **Dedicated Artifact Viewers PRD**: Right-side Artifact Dock, multi-format rendering engine (Monaco Diff, Sandboxed Live Preview Canvas, Mermaid, Markdown, Carousel), metadata schema (`UserFacing`, `RequestFeedback`, `Summary`), versioning scrubber, and `useArtifactFeedback` hook.
3. **Extensible Slash Command Engine PRD**: Native chat composer autocomplete palette, 8 built-in commands (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/compact`, `/cost`, `/export`), parameter parser, and extensibility SDK.
4. **Complete Protocol Contracts & Test Criteria**: Zod wire schemas in `packages/protocol` and 100% test coverage matrices.

---

## 5. Verification Method

To independently verify the deliverable:

1. **Verify Deliverable Existence & Line Count**:
   ```powershell
   Get-Item docs/PRD_PLANNING_ARTIFACTS_SLASH.md
   (Get-Content docs/PRD_PLANNING_ARTIFACTS_SLASH.md).Count
   ```
   *Verified*: File exists at `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` with 1,461 lines.

2. **Verify Section Completeness**:
   - Section 1: Executive Summary & System Architecture Overview
   - Section 2: Antigravity-Style Planning Mode PRD & Technical Architecture
   - Section 3: Dedicated Artifact Viewers PRD (Artifact Dock & Multi-Format Canvas)
   - Section 4: Extensible Slash Command Engine PRD
   - Section 5: Complete TypeScript Protocol Schemas (`packages/protocol`)
   - Section 6: Testing Strategy, Edge Cases & Verification Criteria
