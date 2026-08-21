# Milestone 3 — UI Component & Audio Visualizer Specification Report

**Author**: `m3_spec_miner_3` (teamwork_preview_spec_miner)  
**Target Milestone**: Milestone 3 — Voice Call UI Components, Visualizers, and Triggers  
**Status**: Specification Discovery & Implementation Blueprint Complete  
**Integrity Mode**: Development (Strict Read-Only Probe)

---

## Table of Contents
1. [Executive Summary & Architecture](#1-executive-summary--architecture)
2. [Component Specifications & Prop Contracts](#2-component-specifications--prop-contracts)
   - [2.1 `VoiceCallDrawer.tsx`](#21-voicecalldrawertsx)
   - [2.2 `VoiceCallHeader.tsx`](#22-voicecallheadertsx)
   - [2.3 `VoiceParticipantCard.tsx`](#23-voiceparticipantcardtsx)
   - [2.4 `VoiceWaveformVisualizer.tsx`](#24-voicewaveformvisualizertsx)
   - [2.5 `VoiceFrequencyVisualizer.tsx`](#25-voicefrequencyvisualizertsx)
   - [2.6 `VoiceCallTranscriptionStream.tsx`](#26-voicecalltranscriptionstreamtsx)
   - [2.7 `VoiceCallControls.tsx`](#27-voicecallcontrolstsx)
3. [Visualizer Mathematical Algorithms & Rendering Engine](#3-visualizer-mathematical-algorithms--rendering-engine)
   - [3.1 Time-Domain Oscilloscope Waveform Algorithm](#31-time-domain-oscilloscope-waveform-algorithm)
   - [3.2 Frequency-Domain Equalizer Bar Algorithm](#32-frequency-domain-equalizer-bar-algorithm)
   - [3.3 High-DPI Canvas Scaling & Canvas Context Recovery](#33-high-dpi-canvas-scaling--canvas-context-recovery)
   - [3.4 `requestAnimationFrame` Lifecycle & Zero-Allocation Loops](#34-requestanimationframe-lifecycle--zero-allocation-loops)
4. [DOM, Accessibility & Responsive Behavior Matrix](#4-dom-accessibility--responsive-behavior-matrix)
   - [4.1 Accessibility (`data-testid`, ARIA, Keyboard Trapping)](#41-accessibility-data-testid-aria-keyboard-trapping)
   - [4.2 Responsive Breakpoints & Viewport Adaptation](#42-responsive-breakpoints--viewport-adaptation)
5. [Component & Unit Test Specifications (`src/components/voice/__tests__/`)](#5-component--unit-test-specifications-srccomponentsvoice__tests__)
   - [5.1 `VoiceCallDrawer.test.tsx`](#51-voicecalldrawertesttsx)
   - [5.2 `VoiceVisualizers.test.tsx`](#52-voicevisualizerstesttsx)
   - [5.3 `VoiceCallControls.test.tsx`](#53-voicecallcontrolstesttsx)
   - [5.4 `VoiceCallTranscriptionStream.test.tsx`](#54-voicecalltranscriptionstreamtesttsx)
   - [5.5 `VoiceParticipantCard.test.tsx` & `VoiceCallHeader.test.tsx`](#55-voiceparticipantcardtesttsx--voicecallheadertesttsx)
6. [E2E Test Assertion Traceability Matrix (Tiers 1–4)](#6-e2e-test-assertion-traceability-matrix-tiers-14)

---

## 1. Executive Summary & Architecture

The Interactive Audio Voice Call System provides real-time, bidirectional voice communication inside NanoForge. Milestone 3 encapsulates the presentation layer, visualizer canvas rendering engines, transcription stream displays, and user controls.

```
+----------------------------------------------------------------------------------------------------+
|                                    VoiceCallDrawer (Modal / Dock)                                  |
|  +-----------------------------------------------------------------------------------------------+ |
|  | VoiceCallHeader: Status Badge ("listening"|"speaking"|etc.) | Duration Timer | Close/Minimize | |
|  +-----------------------------------------------------------------------------------------------+ |
|  | VoiceParticipantCard (Agent & User Profiles, Live Speaking Halo, Voice Timbre Tag)            | |
|  +-----------------------------------------------------------------------------------------------+ |
|  | Dual Visualizer Dock:                                                                         | |
|  |   - VoiceWaveformVisualizer (Mic Input Oscilloscope - Canvas requestAnimationFrame)           | |
|  |   - VoiceFrequencyVisualizer (Agent Output Equalizer Bars - Canvas FFT Spectrum)              | |
|  +-----------------------------------------------------------------------------------------------+ |
|  | VoiceCallTranscriptionStream:                                                                 | |
|  |   - Historical turns (User bubble & Agent bubble)                                             | |
|  |   - Live Interim speech hypothesis (Real-time pulsing transcript)                             | |
|  |   - Interrupted turn indicator tag ([interrupted])                                            | |
|  +-----------------------------------------------------------------------------------------------+ |
|  | VoiceCallControls:                                                                            | |
|  |   - Mic Mute/Unmute Toggle Button (with active/muted icon & aria-pressed)                     | |
|  |   - Barge-In Interrupt Button (enabled during "speaking" / "thinking")                         | |
|  |   - Mic Input Gain Slider (0.0x - 2.0x, step 0.05)                                            | |
|  |   - Speaker Output Volume Slider (0.0x - 1.0x, step 0.05)                                     | |
|  |   - End Call Hangup Button (destructive button -> persists turns -> closes drawer)           | |
|  +-----------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Component Specifications & Prop Contracts

### 2.1 `VoiceCallDrawer.tsx`
**Path**: `src/components/voice/VoiceCallDrawer.tsx`  
**Purpose**: Main container drawer/modal dialog housing all voice call subcomponents. Supports docking, backdrop interactions, escape key confirmation, and seamless transitions between active and minimized states.

#### Props Interface
```typescript
import type { VoiceCallSession, VoiceCallStatus, VoiceDialogueTurn, AudioVisualData } from "@protocol/voice";

export interface VoiceCallDrawerProps {
  /** Controls open/close visibility state of the drawer */
  isOpen: boolean;
  /** Active session state machine object */
  session: VoiceCallSession | null;
  /** Current voice call status ("idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended") */
  status: VoiceCallStatus;
  /** Call duration in seconds (formatted as MM:SS or HH:MM:SS) */
  durationSeconds: number;
  /** Whether the microphone is currently muted */
  isMuted: boolean;
  /** Current microphone gain (0.0 to 2.0) */
  micGain: number;
  /** Current speaker volume (0.0 to 1.0) */
  speakerVolume: number;
  /** Live interim transcription string currently being recognized */
  interimTranscript: string;
  /** Historical dialogue turns exchanged during this active session */
  transcriptHistory: VoiceDialogueTurn[];
  /** Audio visualizer data tap for user mic input */
  micVisualData: AudioVisualData;
  /** Audio visualizer data tap for agent speaker output */
  speakerVisualData: AudioVisualData;
  
  // Action Handlers
  onClose: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onSetMicGain: (gain: number) => void;
  onSetSpeakerVolume: (volume: number) => void;
  onInterrupt: () => void;
  className?: string;
}
```

#### DOM & Layout Specification
- Uses Radix UI Dialog / Vaul Drawer primitive (`data-slot="drawer"`).
- Root container: `<div data-testid="voice-call-drawer" role="dialog" aria-modal="true" aria-label="Interactive Voice Call">`.
- Backdrop overlay: `<div data-testid="voice-call-backdrop" className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />`.
- Drawer panel: Right-side fixed slide-out or floating modal on desktop (`w-full sm:max-w-lg md:max-w-xl`), full-screen drawer on mobile (<640px).
- Internal Sections:
  1. `<VoiceCallHeader ... />`
  2. `<VoiceParticipantCard ... />`
  3. `<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-secondary/30 rounded-lg">` containing both visualizers.
  4. `<VoiceCallTranscriptionStream ... />` (flex-1 min-h-0 overflow-y-auto).
  5. `<VoiceCallControls ... />` (pinned to bottom).

---

### 2.2 `VoiceCallHeader.tsx`
**Path**: `src/components/voice/VoiceCallHeader.tsx`  
**Purpose**: Top bar of the voice call drawer displaying current status badge, duration counter, agent connection details, and minimize/close controls.

#### Props Interface
```typescript
import type { VoiceCallStatus } from "@protocol/voice";

export interface VoiceCallHeaderProps {
  status: VoiceCallStatus;
  durationSeconds: number;
  agentName?: string;
  onClose: () => void;
  className?: string;
}
```

#### Status Badge Styling Matrix
| Status | Badge Label | Background / Border Class | Icon / Dot Indicator |
|---|---|---|---|
| `idle` | `Idle` | `bg-secondary text-muted-foreground border-border` | Static gray dot |
| `connecting` | `Connecting…` | `bg-amber-500/10 text-amber-400 border-amber-500/30` | Pulsing amber dot (`animate-pulse`) |
| `listening` | `Listening` | `bg-emerald-500/10 text-emerald-400 border-emerald-500/30` | Wave ping dot (`pulse-dot bg-emerald-400`) |
| `thinking` | `Thinking…` | `bg-blue-500/10 text-blue-400 border-blue-500/30` | Spinning loader icon (`animate-spin`) |
| `speaking` | `Speaking` | `bg-primary/15 text-primary border-primary/40` | Animated audio wave equalizer bars |
| `muted` | `Mic Muted` | `bg-destructive/15 text-destructive border-destructive/30` | Red microphone-off icon |
| `ended` | `Call Ended` | `bg-muted text-muted-foreground border-border` | Static gray dot |

#### Duration Formatter Helper
- Formats `durationSeconds` to `MM:SS` (e.g. `00:05`, `14:23`) or `HH:MM:SS` when `durationSeconds >= 3600` (e.g. `01:02:45`).
- Guaranteed NaN protection (`Number.isFinite(seconds) ? seconds : 0`).

---

### 2.3 `VoiceParticipantCard.tsx`
**Path**: `src/components/voice/VoiceParticipantCard.tsx`  
**Purpose**: Displays participant identities (User profile and NanoForge Agent profile), voice timbre metadata badge, and animated active speaker rings (speaking halos).

#### Props Interface
```typescript
import type { VoiceProfile, VoiceParticipant, VoiceCallStatus } from "@protocol/voice";

export interface VoiceParticipantCardProps {
  participant?: VoiceParticipant;
  voiceProfile?: VoiceProfile;
  status: VoiceCallStatus;
  isUserSpeaking?: boolean;
  className?: string;
}
```

#### DOM & Layout Details
- Container: `<div data-testid="voice-participant-card" className="flex items-center justify-between p-3.5 rounded-lg border border-border bg-card/60">`.
- Agent Section:
  - Agent Avatar with dynamic glow halo: `ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse` active during `status === "speaking"`.
  - Agent name: `<span className="font-mono text-sm font-semibold truncate">{participant?.agentName || "NanoForge Agent"}</span>`.
  - Voice Profile Timbre Pill: `<span className="rounded px-1.5 py-0.5 text-[10px] font-mono uppercase bg-primary/10 text-primary border border-primary/20">{voiceProfile?.timbre || "neutral"} · {voiceProfile?.rate || 1.0}x</span>`.
- User Section:
  - User Avatar with dynamic glow halo: `ring-2 ring-emerald-400 ring-offset-2 ring-offset-background animate-pulse` active during `isUserSpeaking && status !== "muted"`.
  - User Name: `<span className="font-mono text-xs text-muted-foreground truncate">{participant?.userName || "User"}</span>`.

---

### 2.4 `VoiceWaveformVisualizer.tsx`
**Path**: `src/components/voice/VoiceWaveformVisualizer.tsx`  
**Purpose**: High-fidelity HTML5 Canvas oscilloscope rendering the live time-domain audio waveform from the microphone in real time.

#### Props Interface
```typescript
import type { AudioVisualData } from "@protocol/voice";

export interface VoiceWaveformVisualizerProps {
  /** Real-time audio visual data (timeDomainData: Uint8Array, frequencyData: Uint8Array, rmsVolume: number) */
  visualData: AudioVisualData;
  /** Whether the microphone is muted (forces flat baseline rendering) */
  isMuted?: boolean;
  /** Visualizer canvas width (defaults to responsive container width or 280) */
  width?: number;
  /** Visualizer canvas height (default: 80) */
  height?: number;
  /** Primary waveform color (defaults to emerald/primary `#10b981` or CSS var) */
  color?: string;
  /** Canvas background fill (default: transparent) */
  backgroundColor?: string;
  className?: string;
}
```

#### Mathematical Rendering Requirements
- Uses `<canvas data-testid="voice-waveform-canvas" role="img" aria-label="Microphone Audio Waveform Visualizer" />`.
- Reads `visualData.timeDomainData` (length $N = 256$ or $128$).
- Baseline: Byte value $128$ maps to exact vertical center line $y = H / 2$.
- Formula for point $i \in [0, N-1]$:
  $$x_i = \left(\frac{i}{N - 1}\right) \times W$$
  $$y_i = \frac{H}{2} + \left(\frac{v_i - 128}{128.0}\right) \times \left(\frac{H}{2} \times 0.85\right)$$
- If `isMuted === true` or RMS volume is $0.0$, draws a crisp, straight horizontal line through $(0, H/2)$ to $(W, H/2)$.
- Glow effect: `ctx.shadowBlur = 8`, `ctx.shadowColor = color`, line width = $2\text{px}$.

---

### 2.5 `VoiceFrequencyVisualizer.tsx`
**Path**: `src/components/voice/VoiceFrequencyVisualizer.tsx`  
**Purpose**: HTML5 Canvas spectrum equalizer bar visualizer rendering agent TTS output audio frequency bins.

#### Props Interface
```typescript
import type { AudioVisualData } from "@protocol/voice";

export interface VoiceFrequencyVisualizerProps {
  /** Real-time audio visual data from speaker output */
  visualData: AudioVisualData;
  /** Whether agent is currently speaking */
  isSpeaking?: boolean;
  /** Number of discrete equalizer bars to render (default: 32) */
  barCount?: number;
  /** Canvas width in pixels (default: 280) */
  width?: number;
  /** Canvas height in pixels (default: 80) */
  height?: number;
  /** Bar color gradient (start and end colors, e.g. primary orange / cyan) */
  gradientColors?: [string, string];
  className?: string;
}
```

#### Mathematical Rendering Requirements
- Uses `<canvas data-testid="voice-frequency-canvas" role="img" aria-label="Agent Speaker Frequency Visualizer" />`.
- Reads `visualData.frequencyData` (length $M = 128$ or $64$).
- Bins downsampling: maps $M$ raw FFT bins into $K = 32$ discrete bars using logarithmic or grouped linear averaging:
  $$\text{barValue}_k = \frac{1}{|B_k|} \sum_{j \in B_k} \text{rawFrequency}[j]$$
- Bar height calculation:
  $$\text{barHeight}_k = \left(\frac{\text{barValue}_k}{255.0}\right) \times H$$
- Rounded top bar geometry: `ctx.roundRect(x, H - barHeight, barWidth - gap, barHeight, [2, 2, 0, 0])`.
- When `isSpeaking === false` or `rmsVolume === 0`, all bars animate smoothly down to a resting baseline height of $2\text{px}$.

---

### 2.6 `VoiceCallTranscriptionStream.tsx`
**Path**: `src/components/voice/VoiceCallTranscriptionStream.tsx`  
**Purpose**: Live scrolling dialogue transcript viewport displaying finalized turns, streaming interim speech bubbles, and barge-in interrupted turn indicators.

#### Props Interface
```typescript
import type { VoiceDialogueTurn } from "@protocol/voice";

export interface VoiceCallTranscriptionStreamProps {
  /** Historical list of completed speech turns */
  turns: VoiceDialogueTurn[];
  /** Current in-flight interim transcript text (streaming from user microphone) */
  interimTranscript?: string;
  /** Whether agent is currently speaking / synthesizing */
  isAgentSpeaking?: boolean;
  /** Auto-scroll lock behavior (default: true) */
  autoScroll?: boolean;
  className?: string;
}
```

#### DOM & Interaction Requirements
- Root container: `<div data-testid="voice-transcription-stream" role="log" aria-live="polite" aria-label="Live Voice Call Transcript" className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">`.
- Dialogue bubbles:
  - User bubble (`speaker === "user"`):
    `<div data-testid="transcript-bubble-user" className="flex flex-col items-end">`
    Bubble container: `max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-primary-foreground font-sans text-sm shadow-sm`.
  - Agent bubble (`speaker === "agent"`):
    `<div data-testid="transcript-bubble-agent" className="flex flex-col items-start">`
    Bubble container: `max-w-[85%] rounded-2xl rounded-tl-sm bg-secondary border border-border px-3.5 py-2 text-foreground font-sans text-sm`.
  - Interrupted badge: If `turn.interrupted === true`, renders `<span data-testid="interrupted-badge" className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">[interrupted]</span>`.
  - Streaming interim bubble: If `interimTranscript` has content, renders an active animated bubble:
    `<div data-testid="transcript-bubble-interim" className="flex flex-col items-end opacity-90">` with an animated pulse dot and italicized text.
- Auto-Scroll Engine: `useRef<HTMLDivElement>` attached to a bottom anchor element, invoking `scrollIntoView({ behavior: "smooth" })` whenever `turns.length` or `interimTranscript` changes.

---

### 2.7 `VoiceCallControls.tsx`
**Path**: `src/components/voice/VoiceCallControls.tsx`  
**Purpose**: Primary interaction dock containing mute/unmute toggle, barge-in interrupt action button, microphone gain slider, speaker volume slider, and call termination button.

#### Props Interface
```typescript
import type { VoiceCallStatus } from "@protocol/voice";

export interface VoiceCallControlsProps {
  status: VoiceCallStatus;
  isMuted: boolean;
  micGain: number; // 0.0 to 2.0
  speakerVolume: number; // 0.0 to 1.0
  onToggleMute: () => void;
  onInterrupt: () => void;
  onSetMicGain: (gain: number) => void;
  onSetSpeakerVolume: (volume: number) => void;
  onEndCall: () => void;
  className?: string;
}
```

#### Controls Matrix & Attributes
| Control | `data-testid` | Type / Element | ARIA Attributes | Disabled Conditions | Key Interaction |
|---|---|---|---|---|---|
| **Mute Button** | `mute-toggle-button` | `<button>` | `aria-label="Mute microphone"` / `"Unmute microphone"`, `aria-pressed={isMuted}` | `status === "ended"` or `status === "connecting"` | Toggles mute, icon switches between `Mic` and `MicOff` with red accent when muted. |
| **Interrupt Button** | `interrupt-agent-button` | `<button>` | `aria-label="Interrupt agent speech"` | `status !== "speaking" && status !== "thinking"` | Instantly halts TTS audio and clears agent output queue. |
| **Mic Gain Slider** | `mic-gain-slider` | `<Slider>` / `<input type="range">` | `role="slider"`, `aria-label="Microphone Input Gain"`, `aria-valuenow={micGain}`, `aria-valuemin={0.0}`, `aria-valuemax={2.0}` | `isMuted` or `status === "ended"` | Adjusts gain $[0.0, 2.0]$, step $0.05$. |
| **Speaker Volume Slider** | `speaker-volume-slider` | `<Slider>` / `<input type="range">` | `role="slider"`, `aria-label="Speaker Output Volume"`, `aria-valuenow={speakerVolume}`, `aria-valuemin={0.0}`, `aria-valuemax={1.0}` | `status === "ended"` | Adjusts volume $[0.0, 1.0]$, step $0.05$. |
| **End Call Button** | `end-call-button` | `<button>` | `aria-label="End voice call"` | `status === "ended"` | Terminates call, persists transcripts, closes drawer. Styled with `bg-destructive hover:bg-destructive/90 text-destructive-foreground`. |

---

## 3. Visualizer Mathematical Algorithms & Rendering Engine

### 3.1 Time-Domain Oscilloscope Waveform Algorithm
The microphone oscilloscope visualizer maps raw byte PCM samples into a smooth bezier or polyline path across the HTML5 Canvas.

```
Canvas Coordinates:
  (0, 0) --------------------------- (W, 0)
    |                                   |
    |      /\      /\                   |
  (0, H/2) ---\/------\/----------------- (W, H/2)  <-- Zero Baseline (128)
    |                                   |
  (0, H) --------------------------- (W, H)
```

#### Step-by-Step Algorithm:
1. **Clear Canvas**: `ctx.clearRect(0, 0, width, height)`.
2. **Handle Muted / Inactive State**:
   If `isMuted || rmsVolume <= 0.001`:
   - `ctx.beginPath()`
   - `ctx.moveTo(0, height / 2)`
   - `ctx.lineTo(width, height / 2)`
   - `ctx.strokeStyle = colorWithReducedAlpha`
   - `ctx.lineWidth = 1.5`
   - `ctx.stroke()`
   - Return early.
3. **Compute Active Waveform Path**:
   - $N = \text{timeDomainData.length}$ (e.g. 256).
   - Slice width $dx = \frac{W}{N - 1}$.
   - For index $i = 0$ to $N - 1$:
     - Normalized sample: $s_i = \frac{\text{timeDomainData}[i] - 128}{128.0} \in [-1.0, 1.0]$.
     - Clamped sample with gain factor: $y_i = \frac{H}{2} + s_i \times \left(\frac{H}{2} \times 0.90\right)$.
     - If $i == 0$: `ctx.moveTo(0, y_0)`.
     - Else: `ctx.lineTo(i * dx, y_i)`.
4. **Stroke & Neon Glow Pass**:
   - `ctx.strokeStyle = color` (e.g. `#10b981`).
   - `ctx.lineWidth = 2.0`.
   - `ctx.shadowColor = color`.
   - `ctx.shadowBlur = 8`.
   - `ctx.stroke()`.

---

### 3.2 Frequency-Domain Equalizer Bar Algorithm
The speaker frequency visualizer aggregates FFT bins into $K = 32$ logarithmic/linear spectrum bars.

```
Equalizer Bars:
  H |      █
    |   █  █  █     █
    | █ █  █  █  █  █  █  █
  0 +----------------------- W
      0 1  2  3  4  5  6 ... 31 (Frequency Bins)
```

#### Step-by-Step Algorithm:
1. **Bin Aggregation**:
   - Input: `frequencyData` of length $M = 128$.
   - Output: $K = 32$ bars.
   - For each bar $k \in [0, K-1]$:
     - Determine bin range $[j_{\text{start}}, j_{\text{end}}]$ using exponential/logarithmic spacing:
       $$j_{\text{start}} = \left\lfloor M \times \left(\frac{k}{K}\right)^2 \right\rfloor, \quad j_{\text{end}} = \left\lceil M \times \left(\frac{k+1}{K}\right)^2 \right\rceil$$
     - Compute average amplitude in band: $\bar{A}_k = \frac{1}{j_{\text{end}} - j_{\text{start}} + 1} \sum_{j=j_{\text{start}}}^{j_{\text{end}}} \text{frequencyData}[j]$.
2. **Bar Layout Calculation**:
   - Bar width $w = \frac{W}{K} - \text{gap}$ (where $\text{gap} = 2\text{px}$).
   - Bar height $h_k = \max\left(2, \left(\frac{\bar{A}_k}{255.0}\right) \times H\right)$.
   - Top-left coordinates: $x_k = k \times \left(\frac{W}{K}\right)$, $y_k = H - h_k$.
3. **Gradient Fill**:
   - Linear gradient from bottom $(0, H)$ to top $(0, 0)$:
     `const grad = ctx.createLinearGradient(0, H, 0, 0);`
     `grad.addColorStop(0, "hsl(22 100% 50%)");` // NanoForge Warm Orange
     `grad.addColorStop(1, "hsl(32 100% 55%)");` // Gold Accent
   - `ctx.fillStyle = grad`.
   - `ctx.beginPath()`.
   - `ctx.roundRect(x_k, y_k, w, h_k, [3, 3, 0, 0])`.
   - `ctx.fill()`.

---

### 3.3 High-DPI Canvas Scaling & Canvas Context Recovery
To prevent blurry lines on Retina / 4K displays:
```typescript
function setupHighDPICanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
  }
  return ctx;
}
```

---

### 3.4 `requestAnimationFrame` Lifecycle & Zero-Allocation Loops
1. **No Garbage Collection in Render Loop**:
   - Reusable `Float32Array` or pre-allocated `Uint8Array` buffers.
   - Canvas path reused without allocating intermediate point arrays.
2. **Page Visibility & Background Throttling**:
   - Listens to `document.addEventListener("visibilitychange")`.
   - When `document.hidden === true`, cancels `requestAnimationFrame` to save CPU/battery.
   - When `document.hidden === false`, resumes animation loop seamlessly.
3. **Component Unmount Safety**:
   - `useEffect` cleanup hook cancels active RAF ID:
     ```typescript
     useEffect(() => {
       let rafId: number;
       const render = () => {
         draw();
         rafId = requestAnimationFrame(render);
       };
       rafId = requestAnimationFrame(render);
       return () => cancelAnimationFrame(rafId);
     }, [visualData]);
     ```

---

## 4. DOM, Accessibility & Responsive Behavior Matrix

### 4.1 Accessibility (`data-testid`, ARIA, Keyboard Trapping)

| Component / Node | `data-testid` | Role | ARIA Attributes | Keyboard Shortcuts |
|---|---|---|---|---|
| Drawer Modal | `voice-call-drawer` | `dialog` | `aria-modal="true"`, `aria-label="Interactive Voice Call"` | `Escape` prompts confirmation/close |
| Header Close | `voice-call-close-button` | `button` | `aria-label="Close voice call drawer"` | `Enter` / `Space` |
| Duration Timer | `voice-call-timer` | `timer` | `aria-live="off"`, `aria-atomic="true"` | — |
| Status Badge | `voice-status-badge` | `status` | `aria-live="polite"` | — |
| Waveform Canvas | `voice-waveform-canvas` | `img` | `aria-label="Microphone Audio Waveform Visualizer"` | — |
| Frequency Canvas | `voice-frequency-canvas` | `img` | `aria-label="Agent Speaker Frequency Visualizer"` | — |
| Transcript Log | `voice-transcription-stream` | `log` | `aria-live="polite"`, `aria-relevant="additions text"` | `PageUp` / `PageDown` scroll |
| User Bubble | `transcript-bubble-user` | `article` | `aria-label="User speech turn"` | — |
| Agent Bubble | `transcript-bubble-agent` | `article` | `aria-label="Agent speech turn"` | — |
| Interim Bubble | `transcript-bubble-interim` | `status` | `aria-live="polite"`, `aria-label="Interim transcription"` | — |
| Mute Button | `mute-toggle-button` | `button` | `aria-label="Mute microphone"`, `aria-pressed={isMuted}` | `Enter` / `Space`, `M` |
| Interrupt Button | `interrupt-agent-button` | `button` | `aria-label="Interrupt agent speech"` | `Enter` / `Space`, `I` |
| Mic Gain Slider | `mic-gain-slider` | `slider` | `aria-label="Microphone Input Gain"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="2"` | Arrow keys ($\pm 0.05$) |
| Volume Slider | `speaker-volume-slider` | `slider` | `aria-label="Speaker Output Volume"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="1"` | Arrow keys ($\pm 0.05$) |
| End Call Button | `end-call-button` | `button` | `aria-label="End voice call"` | `Enter` / `Space` |

---

### 4.2 Responsive Breakpoints & Viewport Adaptation

```
+-----------------------------------------------------------------------------------------+
| Breakpoint | Screen Width | Drawer Layout Mode       | Visualizer Layout | Dimensions   |
+------------+--------------+--------------------------+-------------------+--------------+
| Mobile     | < 640px      | Full-screen bottom sheet | Stacked (1 col)   | W: 100%, H:60|
| Tablet     | 640px–1023px | Slide-out overlay drawer | Side-by-side (2)  | W: 440px, H:70|
| Desktop    | >= 1024px    | Docked rail / Side modal | Side-by-side (2)  | W: 480px, H:80|
| Ultra-wide | >= 1920px    | Fixed-width side dock    | Side-by-side (2)  | W: 520px, H:90|
+-----------------------------------------------------------------------------------------+
```

---

## 5. Component & Unit Test Specifications (`src/components/voice/__tests__/`)

### 5.1 `VoiceCallDrawer.test.tsx`
**File**: `src/components/voice/__tests__/VoiceCallDrawer.test.tsx`  
**Pragma**: `// @vitest-environment jsdom`

#### Required Test Scenarios (100% Pass Target):
1. **Rendering & Visibility**:
   - Renders drawer when `isOpen={true}` with `data-testid="voice-call-drawer"`.
   - Does NOT render in DOM or is hidden when `isOpen={false}`.
2. **Header & Status Updates**:
   - Displays correct badge label for each status (`listening`, `thinking`, `speaking`, `muted`, `ended`).
   - Formats call duration correctly (`00:00` -> `01:05` -> `01:00:00`).
3. **Mute Toggling**:
   - Clicking `data-testid="mute-toggle-button"` triggers `onToggleMute`.
   - Reflects `aria-pressed="true"` when `isMuted={true}`.
4. **Barge-In Interrupt Button**:
   - Button is enabled when status is `speaking` or `thinking`.
   - Button is disabled when status is `listening` or `muted`.
   - Clicking button invokes `onInterrupt`.
5. **Gain and Volume Sliders**:
   - Changing mic gain slider fires `onSetMicGain` with clamped value in $[0.0, 2.0]$.
   - Changing volume slider fires `onSetSpeakerVolume` with clamped value in $[0.0, 1.0]$.
6. **End Call Flow**:
   - Clicking `data-testid="end-call-button"` invokes `onEndCall`.
7. **Keyboard Escape & Backdrop Clicks**:
   - Pressing `Escape` or clicking backdrop calls `onClose`.

---

### 5.2 `VoiceVisualizers.test.tsx`
**File**: `src/components/voice/__tests__/VoiceVisualizers.test.tsx`  
**Pragma**: `// @vitest-environment jsdom`

#### Required Test Scenarios:
1. **Waveform Visualizer Canvas**:
   - Renders `<canvas data-testid="voice-waveform-canvas">` with accessible `role="img"`.
   - Renders flat line through center $(y = H/2)$ when `isMuted={true}` or silent (128 bytes).
   - Computes non-flat oscillating path when user speaks (active byte variance).
2. **Frequency Visualizer Canvas**:
   - Renders `<canvas data-testid="voice-frequency-canvas">` with 32 bars.
   - Sets bar heights proportional to frequency bin amplitudes during agent speech.
   - Drops bar heights to baseline when `isSpeaking={false}`.
3. **High-DPI Scaling**:
   - Verifies canvas pixel dimensions scale by `window.devicePixelRatio`.
4. **Animation Frame Lifecycle**:
   - Starts `requestAnimationFrame` loop on mount.
   - Cleans up `cancelAnimationFrame` on unmount to prevent leaks.
   - Pauses/resumes RAF on `visibilitychange` events.

---

### 5.3 `VoiceCallControls.test.tsx`
**File**: `src/components/voice/__tests__/VoiceCallControls.test.tsx`  
**Pragma**: `// @vitest-environment jsdom`

#### Required Test Scenarios:
1. **Mute Control**:
   - Renders Mic icon when unmuted; renders MicOff icon with destructive color when muted.
   - Keyboard `Space`/`Enter` toggles mute.
2. **Interrupt Action**:
   - Enabled during `speaking` / `thinking`.
   - Disabled during `listening` / `muted`.
3. **Audio Sliders**:
   - Clamping checks: non-finite inputs fallback to defaults.
4. **End Call**:
   - Renders destructive styled button; fires `onEndCall` callback.

---

### 5.4 `VoiceCallTranscriptionStream.test.tsx`
**File**: `src/components/voice/__tests__/VoiceCallTranscriptionStream.test.tsx`  
**Pragma**: `// @vitest-environment jsdom`

#### Required Test Scenarios:
1. **Dialogue Bubble Rendering**:
   - User turns render with right alignment (`data-testid="transcript-bubble-user"`).
   - Agent turns render with left alignment (`data-testid="transcript-bubble-agent"`).
2. **Interim Speech Updates**:
   - Live in-flight transcript renders in `data-testid="transcript-bubble-interim"`.
   - Clears interim bubble when turn becomes final.
3. **Barge-In Interrupted Tag**:
   - Renders `data-testid="interrupted-badge"` containing `[interrupted]` when `turn.interrupted === true`.
4. **XSS Sanitization & Security**:
   - Script tags `<script>alert(1)</script>` in transcripts are safely escaped and not executed.
5. **Scale & Virtualization**:
   - Handles 100+ turns without freezing or layout thrashing.
   - Auto-scrolls to the bottom upon each new turn or interim update.

---

### 5.5 `VoiceParticipantCard.test.tsx` & `VoiceCallHeader.test.tsx`
**File**: `src/components/voice/__tests__/VoiceParticipantCard.test.tsx`  
**Pragma**: `// @vitest-environment jsdom`

#### Required Test Scenarios:
1. **Participant Card**:
   - Displays Agent name, User name, Timbre pill (`warm`, `crisp`, `neutral`).
   - Renders speaking halo glow around Agent avatar when `status === "speaking"`.
   - Renders speaking halo around User avatar when `isUserSpeaking === true`.
   - Truncates extreme character lengths (>128 chars).
2. **Call Header**:
   - Displays status badge matching active state.
   - Formats duration correctly across boundary intervals (`0s`, `59s`, `65s`, `3600s`, `7200s`).
   - Close button fires `onClose`.

---

## 6. E2E Test Assertion Traceability Matrix (Tiers 1–4)

All features implemented by Milestone 3 components directly map to assertions across the 138 test cases in `tests/e2e/voice/`:

| E2E Test Suite | Test IDs | Validated Component & Feature | Key Assertions |
|---|---|---|---|
| **Tier 1 — Features** | `T1.F7.1`–`T1.F7.5` | `TopBar.tsx`, `ChatComposer.tsx`, `VoiceCallDrawer.tsx` | "Start Voice Call" opens drawer, `/call` command activates session, active call badge displays on TopBar. |
| **Tier 1 — Features** | `T1.F8.1`–`T1.F8.5` | `VoiceCallHeader`, `VoiceCallControls`, `VoiceCallDrawer` | Status badges (`listening` $\to$ `speaking`), duration timer increments each sec, Mute toggles, Interrupt barge-in, End Call cleanly closes drawer. |
| **Tier 1 — Features** | `T1.F9.1`–`T1.F9.5` | `VoiceWaveformVisualizer`, `VoiceFrequencyVisualizer` | Waveform renders oscillating path on user speech; flattens on mute; Frequency bars render on agent speech; unmount cleanly cancels RAF. |
| **Tier 1 — Features** | `T1.F10.1`–`T1.F10.5` | `VoiceCallTranscriptionStream`, `App.tsx` | Interim transcript updates live; final turns commit to bubbles; End Call persists all voice turns into main Chat history with `source: 'voice_call'`. |
| **Tier 2 — Boundaries** | `T2.F7.1`–`T2.F7.5` | `TopBar`, `ChatComposer`, `VoiceCallDrawer` | Double-click spam creates 1 session; modal backgrounding; `/call now` command normalization; button disabled during `connecting`. |
| **Tier 2 — Boundaries** | `T2.F8.1`–`T2.F8.5` | `VoiceCallDrawer`, `VoiceCallHeader`, `VoiceParticipantCard` | Viewports 320px to 4K responsive layout; duration >1 hr formatted as `01:00:00`; Escape key confirmation; 128-char participant truncation. |
| **Tier 2 — Boundaries** | `T2.F9.1`–`T2.F9.5` | `VoiceWaveformVisualizer`, `VoiceFrequencyVisualizer` | Zero amplitude baseline; clipping amplitude (5.0) within byte bounds; High DPI DPR scaling; canvas context loss resilience; background tab throttling. |
| **Tier 2 — Boundaries** | `T2.F10.1`–`T2.F10.5` | `VoiceCallTranscriptionStream`, `App.tsx` | 100+ dialogue turns rendering; 2000-word turn wrapping; pre-existing chat history appended correctly; XSS HTML sanitization. |
| **Tier 3 — Combinations** | `T3.1`–`T3.12` | All UI Components & Audio Graph | Full pairwise workflows: VAD pause auto-dispatch (T3.1), Equalizer sync (T3.2), UI interrupt barge-in (T3.3), Mute flattens waveform (T3.5), Gain/Volume sliders (T3.6), 3-turn chat persistence (T3.8), Minimize/maximize drawer (T3.11). |
| **Tier 4 — Scenarios** | `T4.1`–`T4.6` | End-to-End Real-World Workflows | Multi-turn voice dialogue (T4.1), Barge-in interruption with `[interrupted]` tagging (T4.2), Mute privacy (T4.3), Device gain tuning (T4.4), Rapid dialogue (T4.5), Disconnect recovery (T4.6). |

---

## 7. Delivery Checklist for Milestone 3 Workers

When building Milestone 3, workers must adhere to:
1. **Component Files to Create**:
   - `src/components/voice/VoiceCallDrawer.tsx`
   - `src/components/voice/VoiceCallHeader.tsx`
   - `src/components/voice/VoiceParticipantCard.tsx`
   - `src/components/voice/VoiceWaveformVisualizer.tsx`
   - `src/components/voice/VoiceFrequencyVisualizer.tsx`
   - `src/components/voice/VoiceCallTranscriptionStream.tsx`
   - `src/components/voice/VoiceCallControls.tsx`
2. **Component Test Files to Create**:
   - `src/components/voice/__tests__/VoiceCallDrawer.test.tsx`
   - `src/components/voice/__tests__/VoiceVisualizers.test.tsx`
   - `src/components/voice/__tests__/VoiceCallControls.test.tsx`
   - `src/components/voice/__tests__/VoiceCallTranscriptionStream.test.tsx`
   - `src/components/voice/__tests__/VoiceParticipantCard.test.tsx`
   - `src/components/voice/__tests__/VoiceCallHeader.test.tsx`
3. **Trigger Seams to Wire**:
   - `src/sections/TopBar.tsx`: Add "Start Voice Call" button with phone icon, tooltip, and active call indicator badge.
   - `src/sections/ChatComposer.tsx`: Add microphone button next to run agent and `/call` command in `BUILTIN_SLASH_COMMANDS`.
   - `src/App.tsx`: Mount `VoiceCallDrawer` connected to `useVoiceCall`, and sync completed voice turns into `session.messages` with `source: 'voice_call'`.
4. **Verification Gates**:
   - `npm run test:protocol` -> 100% pass
   - `npm test` -> 100% pass across all unit and component test suites
   - `npm run build` -> 0 TypeScript / Vite errors, clean production bundle.
