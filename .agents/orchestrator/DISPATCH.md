## 2026-08-15T17:14:35Z
You are the Project Orchestrator for NanoForge.
Your mission is to orchestrate the implementation and complete verification of the Interactive Audio Voice Call System for NanoForge.

The authoritative user request is documented in:
c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\ORIGINAL_REQUEST.md

Workspace root: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge
Your working directory: c:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge\.agents\orchestrator

Key requirements:
1. R1: Audio Voice Call Controls & Trigger Seams (TopBar, ChatComposer, Voice Call modal/drawer, status, mute, gain/volume, end call).
2. R2: Live Speech-to-Text (STT) Voice Input & Interim Transcription (Web Speech API / fallbacks, interim transcript streaming, auto-dispatch on voice pause).
3. R3: Text-to-Speech (TTS) Synthesis & Streaming Agent Audio Playback (synthesis of agent tokens/turns, barge-in / interrupt support when user speaks, pitch/rate/voice controls).
4. R4: Real-Time Audio Waveform & Visualizer Dock (dynamic microphone & speaker frequency/amplitude visualizers).
5. R5: Complete Verification & System Integrity (unit, component, and adversarial tests across packages/protocol, apps/agent-host, src/; npm run test:protocol, npm run test:host, npm test, and npm run build must all pass cleanly with 100% success).

Maintain your progress in your working directory progress.md and BRIEFING.md.
When you have fully implemented and verified the entire system, deliver your final report and handoff back to the sentinel.
