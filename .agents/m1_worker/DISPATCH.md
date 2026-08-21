## 2026-08-15T17:23:40Z

You are the Worker for Milestone 1: Voice Call Protocol & Agent-Host Voice Integration for the NanoForge Voice Call System.
Your working directory is: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m1_worker

MANDATORY: Read ORIGINAL_REQUEST.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md
Read PROJECT.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\PROJECT.md
Read SCOPE.md at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m1_orch\SCOPE.md
Read Explorer 1 handoff at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m1_exp_protocol\handoff.md
Read Explorer 2 handoff at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m1_exp_host\handoff.md
Read Explorer 3 handoff at: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m1_exp_spec\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Write Ownership (You own these files exclusively):
- `packages/protocol/src/voice.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/voice.test.ts` (and/or `packages/protocol/test/voice.test.ts`)
- `apps/agent-host/src/protocol.ts`
- `apps/agent-host/src/voice/voiceManager.ts`
- `apps/agent-host/src/session.ts`
- `apps/agent-host/test/voice/voiceManager.test.ts`

Your mission:
1. Implement `packages/protocol/src/voice.ts` with all pure isomorphic Zod schemas, types, constants, error codes, entities, client message schemas, host event schemas, state transition engine (`isValidVoiceStateTransition`), entity factories (`createVoiceCallSession`, etc.), and wire serialization/validation helpers as designed in Explorer 1's handoff.
2. Update `packages/protocol/src/index.ts` to export all symbols from `./voice`.
3. Implement comprehensive unit tests in `packages/protocol/src/voice.test.ts` covering all schemas, state transitions, boundary checks, factories, and message roundtrips.
4. Update `apps/agent-host/src/protocol.ts` to import voice schemas from `@protocol/voice` (or `@protocol`) and extend `clientMessageSchema` and `hostMessageSchema` discriminated unions with all voice messages and events.
5. Implement `apps/agent-host/src/voice/voiceManager.ts` with `VoiceSessionManager` class supporting session lifecycles (start, pause, resume, end, mute, gain), STT transcript submission (interim and final), streaming TTS token chunking, barge-in interruption signal handling with `AbortController` cancellation, client message routing, and cleanup.
6. Update `apps/agent-host/src/session.ts` to attach `VoiceSessionManager`, route `voice.*` WebSocket messages, and dispose on socket closure.
7. Implement comprehensive unit and integration tests in `apps/agent-host/test/voice/voiceManager.test.ts` covering session lifecycle, message handling, barge-in interruption, turn sync, streaming, and error conditions.
8. Execute verification commands:
   - `npm run test:protocol` (Must pass 100%)
   - `npm run test:host` (Must pass 100%)
   - `npm run typecheck:protocol` (0 errors)
   - `npm run typecheck:host` (0 errors)
9. Write a comprehensive handoff report at `c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\m1_worker\handoff.md` including exact verification commands and outputs.
10. Send a message to parent when complete.
