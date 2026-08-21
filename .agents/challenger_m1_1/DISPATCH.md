## 2026-08-15T04:36:52Z
You are challenger_m1_1.
Your working directory is: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/challenger_m1_1
Read ORIGINAL_REQUEST.md at c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/ORIGINAL_REQUEST.md
Read PROJECT.md at c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/orchestrator_1/PROJECT.md

TASK:
Adversarially challenge and stress-test the new `packages/protocol/src/terminal.ts` schemas.
Test malformed inputs, extreme dimensions (cols: -1, 0, 999999), empty IDs, invalid JSON-RPC types, injection strings in data/signals, and edge cases.
Verify that invalid frames are rejected and valid frames parse strictly.

Deliverables:
Write stress test findings and verdict (APPROVE / REQUEST_CHANGES) in `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/challenger_m1_1/handoff.md`.
Send completion message to orchestrator.
