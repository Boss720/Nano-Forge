# NanoForge Repo Guide

This file is the local operating guide for the repository. `PROJECT.md` is a short pointer; this file is the source of truth for scope, gates, and handoff rules.

## Repo Map

- `src/` - browser UI, hooks, and NanoGPT client code.
- `apps/agent-host/` - loopback host, protocol validation, browser-origin checks, terminal/session plumbing, and host tests.
- `packages/protocol/` - shared wire schemas and protocol helpers.
- `packages/core/` and `packages/sdk/` - shared runtime and SDK surfaces used by the app and host.
- `tests/e2e/` - end-to-end smoke coverage that exercises the browser-host contract.
- `plans/` - frozen specs, model routing records, and usage notes.
- `.github/workflows/` - canonical CI and verification jobs.

## Module Index

- Browser contract work: `src/lib/__tests__/nanogpt.test.ts` and any narrowly scoped browser hook test under `src/hooks/__tests__/`.
- Host envelope/auth work: `apps/agent-host/src/server.test.ts` or a narrowly scoped host test in `apps/agent-host/src/`.
- Smoke coverage: `tests/e2e/m0_contract_smoke.test.ts` for the M0 slice.
- Planning docs: `plans/spec-template.md`, `plans/usage.md`, `plans/models.json`, and frozen milestone specs under `plans/m0/`.

## Gates

- Run the focused M0 slice before broader validation.
- Treat `pnpm lint`, `pnpm typecheck`, `pnpm test:all`, `pnpm build`, and `pnpm test:e2e` as repo-level gates when work is ready.
- Keep all tests mocked unless a spec explicitly asks for a live endpoint.
- Use Node 22 and pnpm 9.15.4 in local and CI verification.

## Hard Constraints

- Do not touch `apps/agent-host/src/capabilities/**`, `apps/agent-host/src/session.ts`, workspace-write behavior, browser provider wiring, or unrelated dirty files unless the task explicitly authorizes it.
- Preserve the browser-direct NanoGPT path; do not redirect contract tests to live credentials or endpoints.
- Do not add plain-text credentials to persisted state, logs, examples, or test fixtures.
- Use `apply_patch` for file edits and avoid destructive deletion commands.
- Preserve dirty worktree changes that are outside the requested scope.

## Delegation Tiers

- Tier 0: single-file, low-risk fixes and contract tests that do not change behavior.
- Tier 1: focused multi-file changes within one subsystem, with small verification.
- Tier 2: cross-surface changes that affect workflow, CI, or several test slices.
- Tier 3: release, packaging, or contract changes that need explicit verification and clear handoff notes.
