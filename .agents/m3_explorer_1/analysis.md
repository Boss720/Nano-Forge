# Milestone 3 (Voice Call UI) Integration Analysis & Implementation Plan

**Agent**: `m3_explorer_1` (`teamwork_preview_explorer`)  
**Date**: 2026-08-15  
**Mission**: Investigate UI trigger seams, host/chat integrations, and component architecture in NanoForge to design the complete integration specification for Milestone 3 (Interactive Audio Voice Call UI).

---

## 1. Executive Summary & Architectural Map

Milestone 3 bridges the protocol layer (`packages/protocol/src/voice.ts`), the Agent-Host server lifecycle (`apps/agent-host/src/voice/voiceManager.ts`), and the browser Web Audio & Speech services (`src/services/audioEngine.ts`, `src/services/speechRecognition.ts`, `src/services/speechSynthesis.ts`) into a unified frontend experience.

```
+--------------------------------------------------------------------------------------------------+
|                                    Frontend Client (src/)                                        |
|                                                                                                  |
|   [TopBar Trigger Button & Badge]   [ChatComposer Mic Button]   [/call Slash Command]            |
|                 │                              │                         │                       |
|                 └──────────────────────────────┼─────────────────────────┘                       |
|                                                ▼                                                 |
|                                    [useVoiceCall Hook]                                           |
|                                    ├── State Machine (idle -> connecting -> listening ...)       |
|                                    ├── audioEngineService (Mic & Speaker FFT Data)               |
|                                    ├── speechRecognitionService (STT & VAD Auto-Dispatch)        |
|                                    ├── speechSynthesisService (TTS Queue & Barge-in Cancel)      |
|                                    └── Transcript History Accumulator                            |
|                                                │                                                 |
|                                                ▼                                                 |
|                                    [VoiceCallDrawer Dock]                                        |
|                         ┌──────────────────────┴───────────────────────┐                         |
|                         ▼                                              ▼                         |
|                [VoiceCallHeader]                            [VoiceParticipantCard]               |
|             (Status Badge & Timer)                         (User & Agent Profiles)               |
|                         │                                              │                         |
|                         ▼                                              ▼                         |
|            [VoiceWaveformVisualizer]                      [VoiceFrequencyVisualizer]             |
|           (Mic Time-Domain Canvas)                       (Speaker FFT Equalizer)                 |
|                         │                                              │                         |
|                         ▼                                              ▼                         |
|         [VoiceCallTranscriptionStream]                        [VoiceCallControls]                |
|         (Interim & Final Turn Bubbles)                   (Mute, Interrupt, Gain, Volume)         |
|                                                │                                                 |
|                                                ▼ On Turn Commit / End Call                       |
|                                     [App.tsx Session Sync]                                       |
|                                   (Main Chat History Append)                                     |
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Trigger Seam Analysis & Specifications

### 2.1. TopBar Trigger Button & Active Call Badge (`src/sections/TopBar.tsx`)

#### Current State
- `TopBar.tsx` renders left navigation drawer triggers, branding, plan chip, transcript export, cost dashboard, image generation, artifact dock, subagents dock, token usage stats, connection status indicator, model catalog trigger, theme customizer, and settings dialog trigger.

#### Integration Plan
1. **Props Extension**:
   ```typescript
   export interface TopBarProps {
     // ... existing props
     /** Milestone 3: Voice Call trigger & active status */
     onOpenVoiceCall?: () => void;
     isVoiceCallActive?: boolean;
     voiceCallStatus?: VoiceCallStatus;
   }
   ```
2. **Button Placement & Visuals**:
   - Placed in the right actions toolbar alongside Artifacts, Subagents, and Costs triggers.
   - Icon: `PhoneCall` (when active) / `Mic` (when idle/standby) from `lucide-react`.
   - Active Indicator:
     - When `isVoiceCallActive` is `true`: Button receives an active pulse indicator (`pulse-dot bg-emerald-400` or status-specific color), border highlight (`border-emerald-500/50`), and tooltip displaying `Voice Call (${voiceCallStatus})`.
     - Clicking when active focuses/opens the `VoiceCallDrawer`.
     - Clicking when idle initiates `onOpenVoiceCall`.
   - Data Attributes for Testing: `data-testid="topbar-voice-call-button"`, `data-call-active={String(isVoiceCallActive)}`.

---

### 2.2. ChatComposer Mic Trigger & `/call` Slash Command (`src/sections/ChatComposer.tsx`)

#### Current State
- `ChatComposer.tsx` provides textarea input, `@file` context mention autocomplete, `/` slash command palette (`BUILTIN_SLASH_COMMANDS`), context meter, generation preferences popover, and run/stop agent buttons.
- `ChatPanel.tsx` wraps `ChatComposer` and forwards chat actions.

#### Integration Plan
1. **`/call` Built-in Slash Command**:
   - Add `/call` to `BUILTIN_SLASH_COMMANDS`:
   ```typescript
   {
     name: "/call",
     aliases: ["/voice"],
     description: "Start interactive voice call session with live speech transcription & TTS",
     usage: "/call [start]",
     category: "execution",
   }
   ```
   - Icon mapping: `COMMAND_ICONS["/call"] = PhoneCall;` or `Mic`.

2. **ChatComposer Mic Button**:
   - Add accessible microphone trigger button next to the textarea actions / status bar:
   ```tsx
   <button
     type="button"
     data-testid="composer-mic-button"
     onClick={onTriggerVoiceCall}
     title={isVoiceCallActive ? "Voice Call Active — Click to open call drawer" : "Start Voice Call (/call)"}
     className={`rounded p-1.5 transition-colors ${
       isVoiceCallActive
         ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse"
         : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
     }`}
     aria-label="Start Voice Call"
   >
     <Mic className="h-4 w-4" />
   </button>
   ```

3. **Execution Routing**:
   - In `submit()`:
   ```typescript
   if (text.startsWith("/call") || text.startsWith("/voice")) {
     if (onTriggerVoiceCall) {
       onTriggerVoiceCall();
       setDraft("");
       return;
     }
   }
   ```

---

## 3. Hook Architecture: `src/hooks/useVoiceCall.ts`

`useVoiceCall` serves as the centralized orchestrator hook connecting audio services, speech recognition, speech synthesis, protocol states, and chat synchronization.

### Hook Interface Contract
```typescript
export interface UseVoiceCallOptions {
  hostSession?: HostSession;
  modelName?: string;
  onCommitTurn?: (turn: { speaker: "user" | "agent"; text: string; interrupted?: boolean }) => void;
}

export interface UseVoiceCallReturn {
  // State
  session: VoiceCallSession | null;
  status: VoiceCallStatus;
  isMuted: boolean;
  micGain: number;
  speakerVolume: number;
  durationSeconds: number;
  isDrawerOpen: boolean;
  interimTranscript: string;
  transcriptHistory: VoiceDialogueTurn[];
  micVisualData: AudioVisualData;
  speakerVisualData: AudioVisualData;
  availableVoices: SpeechSynthesisVoice[];
  selectedVoiceURI: string | null;

  // Actions
  startCall: (profile?: Partial<VoiceProfile>) => Promise<void>;
  endCall: (reason?: VoiceCallEndReason) => void;
  toggleMute: () => void;
  setMicGain: (gain: number) => void;
  setSpeakerVolume: (volume: number) => void;
  setVoiceURI: (voiceURI: string) => void;
  interruptAgent: (reason?: VoiceInterruptReason) => void;
  sendVoicePrompt: (text: string) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}
```

### Key Implementation Mechanisms:
1. **Audio Graph Management**:
   - Initializes `audioEngineService` on call start; creates MediaStream, gain nodes, and analysers.
   - Cleans up audio tracks and closes `AudioContext` on `endCall`.
2. **Speech Recognition & VAD Auto-Dispatch**:
   - Hooks `speechRecognitionService.onInterimResult` to update `interimTranscript`.
   - Hooks `speechRecognitionService.onFinalResult` to record final user utterances.
   - Hooks `speechRecognitionService.onAutoDispatch` (triggered on silence timeout) to auto-dispatch prompt via `host.handleClientMessage({ type: "voice.transcript.submit", ... })` or direct synthesis stream.
3. **Speech Synthesis & Utterance Streaming**:
   - When agent response chunks arrive (`voice.tts.chunk` or turn completion), feeds `speechSynthesisService.speak(textChunk)`.
   - Updates `status` to `"speaking"` during playback, reverting to `"listening"` on completion.
4. **Barge-in Interruption**:
   - When user starts speaking during synthesis (`speechRecognitionService.onSpeechStart` when `status === "speaking"`) or clicks Interrupt button:
     - Calls `speechSynthesisService.cancel()`.
     - Clears playback queue.
     - Dispatches `voice.interrupt` to host.
     - Marks current agent turn as `interrupted: true`.
     - Sets `status` back to `"listening"`.
5. **Real-time Visualizer Polling**:
   - Drives continuous `requestAnimationFrame` loop polling `audioEngineService.getMicVisualData()` and `audioEngineService.getSpeakerVisualData()` when drawer is open.

---

## 4. UI Component Architecture (`src/components/voice/`)

All voice components are located in `src/components/voice/`:

### 4.1. `VoiceCallDrawer.tsx`
- Main container dialog/drawer.
- Supports docked side rail on desktop (`>= lg`) and modal sheet overlay on mobile/tablet (`< lg`).
- Contains `VoiceCallHeader`, `VoiceParticipantCard`, `VoiceWaveformVisualizer`, `VoiceFrequencyVisualizer`, `VoiceCallTranscriptionStream`, and `VoiceCallControls`.
- `data-testid="voice-call-drawer"`.

### 4.2. `VoiceCallHeader.tsx`
- Displays:
  - Call Status Badge: Animated pill with dynamic color (`connecting`: yellow, `listening`: green pulse, `thinking`: blue pulse, `speaking`: purple wave, `muted`: amber, `ended`: red).
  - Duration Timer: Formatted as `mm:ss` (or `hh:mm:ss`), updating every second.
  - Minimize / Close button.
- `data-testid="voice-call-header"`, `data-testid="voice-call-timer"`, `data-testid="voice-status-badge"`.

### 4.3. `VoiceParticipantCard.tsx`
- Dual-card layout:
  - **User Card**: User avatar, mic activity pulse indicator, mute status badge.
  - **Agent Card**: Agent avatar, active model name, timbre selection dropdown, speaking status indicator.
- `data-testid="voice-participant-user"`, `data-testid="voice-participant-agent"`.

### 4.4. `VoiceWaveformVisualizer.tsx`
- HTML5 Canvas rendering real-time oscilloscope waveform for microphone input.
- Uses `timeDomainData` from `getMicVisualData()`.
- Flattens to center line when muted or silent.
- Zero garbage-collection allocation in render loop.
- `data-testid="voice-waveform-visualizer"`.

### 4.5. `VoiceFrequencyVisualizer.tsx`
- Animated canvas / SVG equalizer bars representing agent speech output frequencies (0 to 64 FFT bins).
- Uses `frequencyData` from `getSpeakerVisualData()`.
- Drops to 0 baseline when agent is silent.
- `data-testid="voice-frequency-visualizer"`.

### 4.6. `VoiceCallTranscriptionStream.tsx`
- Scrollable list of dialogue bubbles:
  - User turns (right-aligned, primary accent border/background).
  - Agent turns (left-aligned, card background, with interrupted marker if barge-in occurred).
  - Live interim bubble (italicized, showing pending STT before final commit).
- Auto-scrolls to bottom on new transcripts.
- `data-testid="voice-transcription-stream"`, `data-testid="voice-interim-bubble"`.

### 4.7. `VoiceCallControls.tsx`
- Controls Toolbar:
  - **Mute Button**: Toggles mic mute (`data-testid="voice-mute-button"`).
  - **Interrupt Button**: Barge-in stop button, active during `speaking`/`thinking` (`data-testid="voice-interrupt-button"`).
  - **Mic Gain Slider**: Input gain adjustment 0.0x to 2.0x (`data-testid="voice-mic-gain-slider"`).
  - **Speaker Volume Slider**: Output volume 0% to 100% (`data-testid="voice-speaker-volume-slider"`).
  - **End Call Button**: Destructive red button cleanly terminating call (`data-testid="voice-end-call-button"`).

---

## 5. Host & Chat Integration in `src/App.tsx`

### 5.1. Mounting Voice Controller
```typescript
const voice = useVoiceCall({
  hostSession: host,
  modelName: model?.name ?? selectedModel,
  onCommitTurn: (turn) => {
    // Persist voice turns into active session messages
    if (!session) return;
    const newMsg: Message = {
      id: uid(),
      role: turn.speaker === "user" ? "user" : "assistant",
      content: turn.interrupted ? `${turn.text} *[interrupted]*` : turn.text,
      ts: Date.now(),
    };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === session.id
          ? {
              ...s,
              title: s.messages.length === 0 ? turn.text.slice(0, 34) : s.title,
              messages: [...s.messages, newMsg],
            }
          : s
      )
    );
  },
});
```

### 5.2. TopBar and ChatPanel Integration
- In `TopBar`:
  ```tsx
  <TopBar
    // ...
    onOpenVoiceCall={voice.openDrawer}
    isVoiceCallActive={voice.status !== "idle" && voice.status !== "ended"}
    voiceCallStatus={voice.status}
  />
  ```
- In `ChatPanel`:
  ```tsx
  <ChatPanel
    // ...
    onTriggerVoiceCall={voice.startCall}
    isVoiceCallActive={voice.status !== "idle" && voice.status !== "ended"}
  />
  ```
- Mounting `VoiceCallDrawer`:
  ```tsx
  <VoiceCallDrawer
    open={voice.isDrawerOpen}
    onClose={voice.closeDrawer}
    voice={voice}
  />
  ```

---

## 6. Comprehensive Verification & Testing Plan

### 6.1. Unit & Component Tests (`src/components/voice/__tests__/`)
1. **`VoiceCallDrawer.test.tsx`**:
   - Renders all 7 call statuses accurately (`idle`, `connecting`, `listening`, `thinking`, `speaking`, `muted`, `ended`).
   - Mute button toggles microphone state without ending the active session.
   - Interrupt button triggers barge-in during `speaking` status.
   - End call button stops audio tracks, cancels synthesis, and invokes transcript commit.
   - Live interim transcript renders in real time and transitions to committed bubble on finalization.
   - Call duration timer ticks upwards accurately.
2. **`VoiceVisualizers.test.tsx`**:
   - `VoiceWaveformVisualizer` canvas draws oscillating time-domain path when audio is present.
   - `VoiceWaveformVisualizer` renders flat horizontal center line when muted or silent.
   - `VoiceFrequencyVisualizer` renders equalizer bars when speaker frequency data > 0.
   - Visualizer animation loop cleans up on drawer unmount.

### 6.2. Hook & Integration Tests (`src/hooks/__tests__/useVoiceCall.test.ts`)
- Tests full hook lifecycle, transitions, audio mock interactions, VAD auto-dispatch, and transcript synchronization.

### 6.3. Regression Verification
- Verify all existing 47 test files (585 tests) continue to pass with 100% success rate.
- Run `npm run test:protocol` and `npm run test:host`.
- Run `npm run build` to confirm 0 TypeScript and bundling errors.

---

## 7. Deliverable Summary & Readiness

All trigger seams, hook contracts, and UI components are fully specified with zero ambiguity. The implementer can directly execute Milestone 3 following this design.
