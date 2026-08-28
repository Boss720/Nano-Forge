# M0 — Harness and contract freeze

## Objective

Establish a credential-free delivery harness for the Claude Desktop-style workbench programme without changing the verified browser-direct NanoGPT streaming path or the in-progress host capability-broker work.

## Scope and file ownership

| Area | Files |
| --- | --- |
| Agent guidance | `AGENTS.md`, `PROJECT.md`, `plans/spec-template.md`, `plans/usage.md`, `plans/models.json`, `plans/m0/spec.md` |
| Browser NanoGPT contracts | `src/lib/__tests__/nanogpt.test.ts`, plus a new narrowly named browser-contract test only if required |
| Host envelope-auth contract | `apps/agent-host/src/server.test.ts`, `apps/agent-host/src/security_invariants.adversarial.test.ts`, or a new narrowly named host-contract test |
| E2E smoke | `tests/e2e/e2e_phase7_smoke.test.ts`, or a new `tests/e2e/m0_contract_smoke.test.ts` |
| CI | `.github/workflows/ci.yml`, `.github/workflows/verify.yml`, `package.json` only if a stable focused script is required |

Do **not** change `apps/agent-host/src/capabilities/**`, `session.ts`, workspace-write behaviour, browser/agent providers, local-storage credential handling, or unrelated dirty files.

## Required contracts

1. `/models` is mocked credential-free and maps valid catalog data; `validateKey` distinguishes 200, 401/403, 402, and transport failure.
2. `/chat/completions` is mocked credential-free and preserves OpenAI-compatible SSE request/response semantics: `stream`, `stream_options.include_usage`, text deltas, usage, `[DONE]`, and error/402 paths.
3. Host authentication remains loopback-only, uses single-use opaque tokens, rejects unauthenticated/reused tokens with 4401, and rejects malformed/schema-invalid frames with 4400. Browser-origin policy remains fail-closed.
4. The browser NanoGPT key and configured base URL are never forwarded to the host automatically, never logged, and are not added to persisted state beyond the existing safe base-URL behaviour.

## Tests and acceptance

- Add only gap-filling contract tests; reuse existing test helpers rather than duplicating broad suites.
- Add a focused M0 script/job that runs the browser contract slice, host envelope-auth slice, and an e2e smoke slice on Node 22/pnpm 9.15.4. Mirror it in both canonical workflows if both remain active.
- All tests are mocked and require no API key or live endpoint.
- Repo gates: `pnpm lint && pnpm typecheck && pnpm test:all && pnpm build`; run these plus `pnpm test:e2e` after dependencies are available.

## Model-routing record

The public model catalog was fetched on 2026-08-28. Pin verified exact NanoGPT slugs in `plans/models.json`: T0 `openai/gpt-5.4-nano`, T1 `openai/gpt-5.4-mini`, T2 `qwen/qwen3-coder-next`, T3 `openai/gpt-5.6-sol`.

## Commit and reporting

- Make one conventional commit: `test(m0): freeze browser and host contracts`.
- Do not include unrelated dirty changes.
- Record M0 outcome, raw verification commands/results, and known blocker(s) in `PROGRESS.md` and `HANDOFF.md` after review approval; append model/task usage to `plans/usage.md`.
