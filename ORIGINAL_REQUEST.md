# Original User Request

## 2026-08-15T17:14:24Z

Implement the Interactive Audio Voice Call System for NanoForge: Add a live voice call button in the TopBar and ChatComposer, real-time audio waveform visualizers, speech-to-text (STT) voice input, text-to-speech (TTS) streaming playback for agent responses, and full call controls (Mute, Interrupt, End Call) with 100% automated test coverage.

Working directory: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge
Integrity mode: development

## Requirements

### R1. Audio Voice Call Controls & Trigger Seams
Add prominent "Voice Call" button triggers in the TopBar and ChatComposer that open a dedicated interactive Voice Call modal/drawer. Support session initiation, clean call termination, microphone mute/unmute toggling, audio input gain control, and speaker volume controls.

### R2. Live Speech-to-Text (STT) Voice Input & Interim Transcription
Implement real-time microphone capture and speech recognition using browser Web Speech API / Whisper transcription fallbacks. Stream live interim transcripts directly into the active voice drawer, allowing hands-free prompt submission to the active agent host or chat session upon voice pause.

### R3. Text-to-Speech (TTS) Synthesis & Streaming Agent Audio Playback
Integrate dynamic text-to-speech audio synthesis that converts agent output tokens and message turns into spoken audio during an active call. Support speech cancellation/interruption when the user begins speaking, speech rate/pitch configuration, and multiple voice timbre choices.

### R4. Real-Time Audio Waveform & Visualizer Dock
Render animated, dynamic audio frequency / waveform visualizers in the Voice Call drawer reflecting both user mic input amplitude and agent speech output frequency bins.

### R5. Complete Verification & System Integrity
Deliver comprehensive unit, component, and adversarial test suites across `packages/protocol`, `apps/agent-host`, and `src/` ensuring all tests pass with a 100% success rate, 0 build errors (`npm run build`), and clean production bundle packaging.

## Acceptance Criteria

### Voice Call Trigger & Interface
- [ ] TopBar and ChatComposer render accessible "Start Voice Call" buttons with active call indicator badges.
- [ ] Voice Call modal/drawer displays call status (`connecting`, `listening`, `thinking`, `speaking`, `muted`), duration timer, and participant cards.
- [ ] Mute button cleanly mutes microphone input without dropping the active call session.
- [ ] End Call button cleanly stops audio tracks, cancels synthesis, and persists the transcribed conversation to the main chat session.

### Speech Recognition & Synthesis
- [ ] Speaking into the microphone produces real-time interim transcription text in the call view.
- [ ] Completing a speech utterance automatically dispatches the prompt to the agent session.
- [ ] Agent responses trigger TTS audio synthesis and play aloud through the selected audio output device.
- [ ] User speech during agent playback interrupts and cancels the current TTS stream (barge-in / interrupt support).

### Audio Visualizer
- [ ] Audio visualizer reacts dynamically to microphone input levels and speaker playback frequencies.

### Verification & Quality Assurance
- [ ] `npm run test:protocol` passes with 100% success.
- [ ] `npm run test:host` passes with 100% success.
- [ ] `npm test` passes with 100% success across all frontend component suites.
- [ ] `npm run build` completes with 0 errors.

## 2026-09-26T16:47:15Z

Transform NanoForge by implementing Phases 0 to 6 of its development roadmap: establish a forensic baseline, create a provider-independent LLM orchestration layer with normalized adapters, implement a capability-floor model router with quota awareness, and provide model-independent state handoff.

Working directory: C:\Users\Hp\Desktop\nano-forge
Integrity mode: development

## Requirements

### R1. Forensic Baseline & Architecture Documentation
Audit the existing NanoForge repository, ensure existing builds and test suites pass, inspect agent-host and protocol architecture non-destructively, and document the baseline architecture, router design, and integration strategy (`docs/CURRENT_ARCHITECTURE.md`, `docs/ROUTER_ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`).

### R2. Provider-Independent Abstraction & Adapters
Implement a normalized LLM provider contract that abstracts model interactions without leaking provider-specific details. Provide adapters for local inference (Ollama) and cloud APIs (such as Gemini, Groq, OpenRouter, and generic OpenAI-compatible endpoints) with unified handling of messages, streaming, tool calls, structured outputs, usage metrics, and error classifications.

### R3. Model Registry & Capability-Floor Router
Implement a model registry and deterministic routing subsystem that classifies tasks by complexity and assigns the least scarce/least expensive suitable model that satisfies the task's capability floor. Track provider health, rate limits, and quotas to prioritize local and free models, reserve scarce premium models for complex reasoning, and automatically escalate or fail over upon transient provider errors.

### R4. Model-Independent Agent State & Compact Handoff
Implement a decoupled agent state structure that tracks tasks, decisions, tool executions, and file changes independently of any specific LLM conversation history. When switching models or recovering from rate limits, generate compact, structured handoff summaries so alternate models can continue execution seamlessly without context replay.

## Acceptance Criteria

### Baseline & Architecture
- [ ] Existing repository build (`npm run build`) and test suites (`npm run test:protocol`, `npm run test:host`, `npm test`) pass cleanly with no breaking regressions.
- [ ] Architecture documentation files (`docs/CURRENT_ARCHITECTURE.md`, `docs/ROUTER_ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`) are created and reflect the verified codebase state.

### Provider Abstraction & Registry
- [ ] A normalized provider interface is defined with support for model listing, health checks, generation, streaming, tool calling, and standardized error mapping.
- [ ] Local model support (Ollama) and cloud provider adapters are implemented with zero-cost/local prioritized by default.
- [ ] Model registry tracks capabilities (coding, reasoning, tools, context size), pricing tier, and real-time health/cooldown status.

### Routing & Economy
- [ ] Task classifier categorizes tasks (e.g., trivial, light, standard, complex) and filters models by capability floor.
- [ ] Scoring engine deterministically selects the most economical capable model, penalizing quota exhaustion, latency, and recent failures.
- [ ] Free-first routing is enforced by default; paid fallback is prevented unless explicitly permitted.

### State Handoff & Resilience
- [ ] `AgentState` captures task progress, file changes, and decisions independently of provider session state.
- [ ] Unit and integration tests verify automated failover: a simulated rate limit (HTTP 429) triggers model failover via compact handoff without task restart or data loss.
- [ ] All new tests pass and production build (`npm run build`) succeeds with zero type errors.

