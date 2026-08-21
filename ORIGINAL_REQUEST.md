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
