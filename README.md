# NanoForge

<img width="1920" height="1080" alt="nanoforge-console-home" src="https://github.com/user-attachments/assets/f053b952-a838-44ba-adfb-4193192ffbd0" />
<img width="1920" height="1080" alt="nanoforge-swarm-control-plane" src="https://github.com/user-attachments/assets/98b43c03-0763-4934-9cf2-6e5653436efd" />


NanoForge is an independently developed, local-first coding workbench candidate for NanoGPT users. It combines a React/Vite browser UI with an optional loopback agent host, shared TypeScript protocol/core packages, and a programmatic SDK.

## Current status

This repository is a technical-evaluation candidate, not an official NanoGPT product or partnership. The verifiable integration in the UI is a browser-direct OpenAI-compatible API path:

- `GET https://nano-gpt.com/api/v1/models` for a live catalog when the user connects a key.
- `POST https://nano-gpt.com/api/v1/chat/completions` with `stream: true` and OpenAI-style SSE frames.
- `POST .../generate-image` exists in code, but its live response contract is not verified here.

The following are not claims made by this repository: official affiliation or endorsement, seamless embedding into NanoGPT, hosted multi-tenant service, or a first-class host-routed NanoGPT provider. The optional local host and SDK are local control-plane surfaces; they do not automatically route the browser chat path through NanoGPT.

## What is here

The browser workbench supports model selection, streaming chat, a demo mode, local transcript/workspace persistence, reviewable diff-style output, and optional host-backed workspace/agent surfaces. The host and SDK have typed WebSocket and provider-adapter code, with automated tests, but a live NanoGPT end-to-end run is still an integration item for a pilot.

The source manifests currently use version `0.1.0`. Files under `release/` are not treated as a current release or compatibility proof; release provenance is documented in [known limitations](docs/known-limitations.md).

## Architecture

```text
Browser React/Vite UI
  ├─ direct HTTPS → NanoGPT OpenAI-compatible API
  │                  /models, /chat/completions
  └─ optional WebSocket → local Fastify agent host
                          /agent?token=... (canonical)
                              └─ protocol, workspace, tools, runs, providers

Shared packages: protocol schemas · core provider/agent abstractions · SDK client
```

Key areas:

| Area | Location | Role |
| --- | --- | --- |
| Browser API client | `src/lib/nanogpt.ts` | Direct NanoGPT model, chat-stream, and image request code. |
| Browser workbench | `src/`, `src/App.tsx` | React UI, demo/live orchestration, persistence, review surfaces. |
| Local host | `apps/agent-host/` | Optional loopback Fastify/WebSocket control plane and workspace runtime. |
| Shared contracts | `packages/protocol/` | Wire schemas and state contracts. |
| Agent/provider core | `packages/core/` | Provider adapters and agent-loop building blocks. |
| SDK | `packages/sdk/` | Typed client for the local host WebSocket protocol. |

The host has a generic OpenAI-compatible adapter configured through host options/environment. Its default provider URL is intentionally inert until configured; the browser's NanoGPT key and URL are not forwarded into the host automatically. The core provider registry also has no `nanogpt` entry.

## Run locally

Prerequisites:

- Node.js 20 or newer.
- pnpm 9.15.4 (the repository declares pnpm 9.15.4 as its package manager).
- A modern browser. A NanoGPT API key is needed only for a live provider check; demo mode does not need credentials.

Install and start the browser workbench:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. For a live request, use the Connect UI, keep the default base URL `https://nano-gpt.com/api/v1`, enter a key, validate the connection, and select a returned model. The browser must be allowed to make the cross-origin request; a CORS failure is not evidence of provider incompatibility. For a credential-free walkthrough, use Demo mode and label the output as simulated.

The optional local host can be started separately. It chooses an ephemeral port unless `PORT` is set and prints a single-use token on startup:

```powershell
$env:PORT = "4040"
pnpm start:host
```

The canonical host URL is `ws://127.0.0.1:4040/agent?token=<token>`; `/ws` is also registered for compatibility. Do not expose the host publicly. Workspace writes are disabled by default; only enable `NANOFORGE_ALLOW_WORKSPACE_WRITES=1` for a deliberately trusted local evaluation, with a disposable workspace.

## Security and write boundaries

- Browser API keys are held in the live application state for requests. The connection loader removes legacy `apiKey` values from `localStorage`; only non-secret connection settings such as the base URL may be retained. This is browser-memory handling, not a secure vault.
- Chat/workspace state and usage data are persisted locally. Treat the browser profile and any connected page as sensitive while a key is active.
- The host binds to loopback by default, authenticates WebSockets with registered single-use tokens, validates message schemas, and confines workspace operations to a validated root.
- Host workspace writes fail closed unless explicitly enabled and are checked against an expected file version. Read/search/terminal/subagent behavior still needs evaluation against the intended threat model before distribution.
- No hosted tenancy, remote isolation, account authorization flow, or production secret-management service is included in this repository.

## Verification

These commands are the repository's available checks and do not require NanoGPT credentials:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:all
pnpm test:sdk
pnpm test:host
pnpm build
```

Passing local tests prove repository behavior and mocked/provider-adapter contracts only. A live NanoGPT check must be opt-in, keep credentials outside source control, and record no secret values.

## Before presenting to NanoGPT

- [ ] Say “independent local-first companion candidate,” not official integration or partnership.
- [ ] Use a disposable sample workspace and confirm Demo mode is clearly labelled if no live key is available.
- [ ] Confirm the browser API base URL, selected model, catalog freshness, and CORS path.
- [ ] Keep the API key out of source control, screenshots, URLs, logs, and recordings.
- [ ] If showing the local host, show its loopback address and one-use token flow; do not expose it to the network.
- [ ] Do not present host-routed NanoGPT execution, hosted tenancy, a release archive, or live compatibility as already proven.
- [ ] Have the verification output and [known limitations](docs/known-limitations.md) available.

## 3–5 minute demo outline

1. **0:00–0:30 — Positioning:** independent local-first companion candidate; state the browser-direct integration boundary.
2. **0:30–1:00 — Readiness:** show Demo mode or a live NanoGPT connection, selected model, and disposable workspace.
3. **1:00–2:15 — Core loop:** provide a bounded coding request, show context, streamed response, plan/tool visibility, and the generated diff.
4. **2:15–3:15 — Review:** inspect the change, show verification evidence, and apply only within the disposable workspace if the host write path is intentionally enabled.
5. **3:15–4:00 — Boundaries:** show local persistence, optional loopback host/SDK, and the explicit limitations.
6. **4:00–5:00 — Ask:** propose a technical pilot, adapter contract tests, or a companion-app integration discussion.

## Collaboration request

We would like NanoGPT’s guidance on a focused technical pilot: validate the `/models` and streaming chat contracts, capability/pricing/usage fields, authentication and CORS expectations, and error behavior. A useful first milestone could be one of:

- a NanoGPT adapter contract-test suite that both sides can run without sharing credentials;
- an agreed host/provider adapter contract for a first-class NanoGPT route; or
- a local companion-app pilot with explicit branding, security, and support boundaries.

See [technical overview](docs/technical-overview.md), [known limitations](docs/known-limitations.md), and the [local SDK guide](docs/sdk-integration.md).

## License

The repository does not make an approved NanoGPT licensing or ownership claim. Confirm the intended license and branding language before public distribution.
