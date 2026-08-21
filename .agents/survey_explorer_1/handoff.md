# Frontend UI Architecture Investigation Report: NanoForge Voice Call System

## 1. Observation

### 1.1 Codebase & Workspace Architecture
- **Root Configuration & Dependencies (`package.json`)**:
  - React 19 (`react: ^19.2.0`, `react-dom: ^19.2.0`), Vite 7.2.4 (`vite: ^7.2.4`).
  - Radix UI primitives: `@radix-ui/react-dialog`, `@radix-ui/react-slider`, `@radix-ui/react-popover`, `@radix-ui/react-tabs`, `@radix-ui/react-avatar`, `@radix-ui/react-tooltip`, `@radix-ui/react-scroll-area`, `@radix-ui/react-dropdown-menu`.
  - Drawer support: `vaul: ^1.1.2` (`src/components/ui/drawer.tsx`).
  - Icons: `lucide-react: ^0.562.0`.
  - Styling: `tailwindcss: ^3.4.19`, `tailwindcss-animate: ^1.0.7`, `clsx: ^2.1.1`, `tailwind-merge: ^3.4.0`.
  - Testing: `vitest: ^4.1.10`, `@testing-library/react: ^16.3.2`, `@testing-library/user-event: ^14.6.3`, `@testing-library/jest-dom: ^7.0.1`, `jsdom: ^30.0.1`.

### 1.2 Layout & Component Hierarchy in `src/`
- **Main Shell (`src/App.tsx`)**:
  - Lines 564–663: Renders `<TopBar>`, `<Sidebar>` (collapsible inline rail / drawer on `< lg`), `<ChatPanel>` (main transcript and composer), and conditional dock rails (`ArtifactDock` line 612, `SubagentsPanel` line 624, `PlanPanel` line 638, `ModelPanel` line 654).
  - Lines 666–872: Renders overlay drawers and modal dialogs using Radix `Sheet` and `Dialog` primitives (`Sidebar Sheet`, `ModelPanel Sheet`, `SubagentsPanel Sheet`, `ConnectDialog`, `ThemeCustomizer Dialog`, `IntegrationsPanel Dialog`, `BrowserPermissionDialog`, `CommandDialog` model switcher, `CostDashboard Dialog`, lazy `ImagePanel Dialog`).
- **TopBar (`src/sections/TopBar.tsx`)**:
  - Lines 46–200: Top navigation bar containing workspace mark, subscription link, action buttons (`Export`, `CostDashboard`, `ImagePanel`, `ArtifactDock` toggle with badge, `SubagentsPanel` toggle with badge, connection status indicator, theme customizer button, and settings button).
  - Action button styling pattern: `rounded-md border border-border bg-secondary/60 p-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary`.
- **ChatComposer (`src/sections/ChatComposer.tsx`)**:
  - Lines 37–92: `BUILTIN_SLASH_COMMANDS` array containing `/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/cost`, `/compact`, `/clear`.
  - Lines 496–512: Auto-expanding textarea with floating slash command popover (lines 349–416) and `@file` context mention popover (lines 418–467).
  - Lines 514–563: Bottom status bar rendering active model badge, connection status, token budget meter, generation preferences popover (`GenSettings`), and Run / Stop button triggers.
- **ChatPanel (`src/sections/ChatPanel.tsx`)**:
  - Lines 78–109: Embeds transcript message list (`MessageView`, `ToolCard`, `ToolRunCard`, `PatchCard`, `EmptyState`) and mounts `<ChatComposer>`.
  - Lines 294–408 (`src/App.tsx`): `handleSend(text, opts)` dispatches prompts to either `runDemoAgent` (demo mode) or `streamChat` (live mode) via OpenAI-compatible endpoint.

### 1.3 State Management & Hooks
- **Active State Hooks**:
  - `src/App.tsx`: Manages core app state (`sessions`, `activeId`, `running`, `usage`, `runs`, `files`, `genPrefsMap`, `connection`).
  - `src/hooks/useArtifacts.ts`: Manages multi-format artifacts (`diff`, `html`, `mermaid`, `markdown`, `image`), active artifact selection, and dock open/close toggle state.
  - `src/lib/hostSession.ts`: Manages local host communication (`useHostSession`), plan state machine, terminal tool runs, permissions, and subagent swarm control.
  - `src/lib/persist.ts`: Debounced local storage saver for `nanoforge.v1` (`sessions`, `usage`, `files`, `runs`).

### 1.4 Test Suite Status & Execution Results
- `npx vitest run src/`: **37 test files passed, 362 tests passed (100% success rate)** in 16.84s.
- `npm run test:protocol`: **10 test files passed, 239 tests passed (100% success rate)** in 1.76s.
- `npm run build`: **`tsc -b && vite build` completed with 0 errors** (bundle built in 17.42s).

---

## 2. Logic Chain

```
[Observation 1.1, 1.2: App Shell & Section Components]
   │
   ├─► App.tsx coordinates high-level state, dock rails, and overlay dialogs/drawers.
   │
   ├─► TopBar and ChatComposer are the two primary interaction anchors for user actions.
   │
   └─► Adding a Voice Call System requires trigger seams in TopBar & ChatComposer,
       backed by a dedicated Voice Call Hook and Interactive Drawer/Modal.
```

### Step-by-Step Architectural Inferences:

1. **Trigger Seam 1 — TopBar (`src/sections/TopBar.tsx`)**:
   - TopBar already holds dock triggers for Artifacts (`Layers` with badge) and Subagents (`Network` with badge).
   - Adding a Voice Call trigger button with a phone/mic icon (`PhoneCall` or `Mic`), active call pulse badge, and tooltip (`"Start Voice Call"` / `"Active Call (00:42)"`) matches the design pattern perfectly without breaking layout symmetry.

2. **Trigger Seam 2 — ChatComposer (`src/sections/ChatComposer.tsx`)**:
   - ChatComposer bottom bar (lines 514–563) contains model tags, context meter, gen settings, and the run/stop button.
   - Adding a Voice Call trigger button (`Mic` icon with text "voice call" or active call pulse badge) in the bottom bar provides instant access during typing.
   - Adding `/call` and `/voice` to `BUILTIN_SLASH_COMMANDS` enables instant keyboard shortcut activation for power users.

3. **Dedicated Voice Call State Store & Lifecycle (`src/hooks/useVoiceCall.ts` / `src/lib/voiceSession.ts`)**:
   - A centralized React hook `useVoiceCall` should encapsulate:
     - **Call Status**: `"idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "error"`.
     - **Audio Session & Controls**: Microphone mute toggle, mic input gain (`0.0`–`2.0`), speaker volume (`0.0`–`1.0`), call duration timer.
     - **Speech-to-Text (STT)**: Real-time browser `SpeechRecognition` / Web Speech API (with fallback/Whisper bridge) producing live interim transcript and final utterance dispatch.
     - **Text-to-Speech (TTS)**: Dynamic `SpeechSynthesis` / audio playback queue for agent tokens/messages, supporting voice timbre selection (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`), speech rate (`0.5x`–`2.0x`), and speech pitch (`0.5x`–`1.5x`).
     - **Barge-in / Interruption Engine**: Detecting user speech utterance during agent TTS playback automatically halts/cancels the active TTS synthesis stream.
     - **Dual Audio Waveform & Visualizer Data**: Analyzing real-time `AnalyserNode` frequency bins for both user mic amplitude and agent playback frequency.
     - **Transcript Persistence**: Merging finalized voice call turns into the active chat session (`Message[]`) upon utterance completion or call termination.

4. **Dedicated Voice Call Drawer / Modal UI (`src/sections/voice/VoiceCallDrawer.tsx` or `VoiceCallModal.tsx`)**:
   - Component Hierarchy:
     - `VoiceCallHeader`: Call status badge, duration timer, active model chip, minimize/expand controls, close/hangup button.
     - `VoiceCallParticipants`: Dual participant cards (User Card with live mic meter + Agent Card with animated thinking/speaking state and voice timbre chip).
     - `VoiceCallVisualizerDock`: Real-time dual audio visualizer rendering dynamic frequency spectrum bars and waveform canvas.
     - `VoiceCallTranscriptionStream`: Live transcript view highlighting active interim speech recognition and historical turns.
     - `VoiceCallControlsBar`: Accessible controls for Mute/Unmute, Interrupt / Barge-in, Audio Settings popover (Gain, Volume, Voice Timbre, Rate, Pitch), and End Call (destructive red).

5. **Testing & Mocking Strategy**:
   - Following the existing pattern in `src/sections/ChatComposer.test.tsx` and `src/sections/__tests__/App.hostWiring.test.tsx`, tests must run under `// @vitest-environment jsdom`.
   - Mocking required for browser audio APIs:
     - `window.AudioContext` / `webkitAudioContext` (`createAnalyser`, `createGain`, `createMediaStreamSource`, `close`, `resume`).
     - `navigator.mediaDevices.getUserMedia` (`MediaStream`, `AudioTrack`, `stop`).
     - `window.SpeechRecognition` / `window.webkitSpeechRecognition` (`start`, `stop`, `abort`, `onresult`, `onend`, `onerror`).
     - `window.speechSynthesis` / `SpeechSynthesisUtterance` (`speak`, `cancel`, `pause`, `resume`, `getVoices`).

---

## 3. Caveats

1. **Browser SpeechRecognition Web API Availability**: In standard jsdom environments and non-Chromium browsers, `SpeechRecognition` / `webkitSpeechRecognition` may be undefined without proper polyfills or mocks. The frontend hook must gracefully detect availability and fallback to simulated STT or Whisper API.
2. **AudioContext Autoplay Policies**: Modern browsers require a user gesture (e.g. clicking "Start Voice Call") before starting an `AudioContext`. The state machine must initialize `AudioContext` only on explicit user click.
3. **Session Concurrency & Leakage**: Following Task 0.2 discipline in `src/App.tsx`, voice call transcripts must target the specific session ID captured at call start to avoid leaking deltas into a newly selected session if the user switches sessions during a call.

---

## 4. Conclusion

The NanoForge frontend architecture is well-structured, modular, and ready for clean Voice Call System integration:
1. **Trigger Insertion Points**:
   - `src/sections/TopBar.tsx`: Add Voice Call button with active indicator pill in header actions group.
   - `src/sections/ChatComposer.tsx`: Add Voice Call trigger button in bottom bar and `/call` command in `BUILTIN_SLASH_COMMANDS`.
2. **Voice Call Drawer / Modal**:
   - Create `src/sections/voice/VoiceCallDrawer.tsx` (and supporting components: `VoiceVisualizer.tsx`, `ParticipantCard.tsx`, `TranscriptionStream.tsx`, `AudioControls.tsx`).
   - Mount in `src/App.tsx` alongside existing docks/sheets.
3. **State Management**:
   - Implement `src/hooks/useVoiceCall.ts` encapsulating STT, TTS, Gain/Volume audio graph, barge-in interruption, and transcript persistence to `App.tsx`'s `handleSend`.
4. **Design System & Styling**:
   - Leverage existing Tailwind CSS tokens, `vaul` / `Sheet` drawer primitives, Radix sliders, and Lucide icons (`PhoneCall`, `PhoneOff`, `Mic`, `MicOff`, `Volume2`, `VolumeX`, `Sliders`).
5. **Automated Verification**:
   - All existing 362 frontend tests pass and production build succeeds. New Voice Call component and hook suites will follow Vitest + Testing Library conventions with Web Audio / Speech API mocks.

---

## 5. Verification Method

To independently verify the frontend state and codebase integrity:

```bash
# 1. Run all frontend unit & component tests in src/
npx vitest run src/

# 2. Run protocol package test suite
npm run test:protocol

# 3. Verify TypeScript type checking & production build
npm run build
```

### Invalidation Conditions:
- Failure of any existing frontend test suite in `src/`.
- Build errors or TypeScript compilation failures during `npm run build`.
- Inability to mount the Voice Call trigger buttons in `TopBar` and `ChatComposer` or open the Voice Call drawer.
