# AudioEngineService Technical Specification & Architecture Report

## 1. Observation
- Direct codebase examination of `PROJECT.md` (lines 52, 91-99, 125, 128, 131) and `.agents/m2_orch/SCOPE.md` (lines 4-18, 22-54) reveals that Milestone 2 Feature F4 requires `src/services/audioEngine.ts` to implement the Web Audio API graph management, microphone stream capture, gain/volume controls, RMS/peak volume calculation, and visualizer data tap.
- `package.json` (lines 6-13, 89-108) configures `vitest` in node/jsdom environment. Web Audio API and `navigator.mediaDevices.getUserMedia` are browser-native APIs that do not exist natively in Node.js / JSDOM, requiring injectable fallbacks or a mock harness (`src/test/audioMocks.ts`) for 100% test coverage.
- `tsconfig.app.json` specifies `"strict": true`, `"noUnusedLocals": true`, `"verbatimModuleSyntax": true`, `"lib": ["ES2022", "DOM", "DOM.Iterable"]`. All types, interfaces, and classes must adhere to strict TypeScript standards with no implicit any.
- The microphone stream must never be connected to `audioContext.destination` to prevent acoustic local feedback / echo loop.
- The visualizer data contract (`AudioVisualData`) requires returning `timeDomainData: Uint8Array`, `frequencyData: Uint8Array`, `rmsVolume: number`, and `peakVolume: number`.

## 2. Logic Chain
1. **Lifecycle & Support**:
   - `AudioEngineService` must check for `window.AudioContext || window.webkitAudioContext` and `navigator.mediaDevices?.getUserMedia`. If unavailable, `isSupported` is false, `audioContextState` is `"unsupported"`, and `initialize()` gracefully resolves `false` without crashing.
   - On `initialize()`, instantiate `AudioContext`, capture `MediaStream` with constraints `{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }`, and construct the audio graph.
   - To handle browser autoplay policies where `AudioContext` initializes in `"suspended"` state, `resumeContext()` explicitly calls `audioContext.resume()`.
   - On `cleanup()`, stop all `MediaStreamTrack`s, disconnect all audio nodes, and close the `AudioContext` cleanly.

2. **Microphone Audio Graph**:
   - Flow: `MediaStreamAudioSourceNode` -> `micGainNode` (`GainNode`) -> `micAnalyserNode` (`AnalyserNode`).
   - `micAnalyserNode` is configured with `fftSize: 128` (yielding 64 frequency bins: `frequencyBinCount = 64`), `smoothingTimeConstant: 0.8`, `minDecibels: -90`, `maxDecibels: -10`.
   - Termination: `micAnalyserNode` is the leaf node of the mic graph; it is **NOT** connected to `audioContext.destination`.

3. **Speaker Audio Graph**:
   - Flow: `speakerGainNode` (`GainNode`) -> `speakerAnalyserNode` (`AnalyserNode`) -> `audioContext.destination`.
   - Configured with matching FFT/smoothing parameters so visualizers get consistent resolution (64 frequency bins).
   - Provides `getSpeakerInputNode(): GainNode | null` for external audio routing (such as synthesized speech or audio playback elements).

4. **Gain, Volume & Mute Controls**:
   - `setMicGain(gain: number)`: Clamps gain to `[0.0, 2.0]`. If not muted, applies `micGainNode.gain.setValueAtTime(gain, currentTime)`. Saves internal `_micGain`.
   - `setMuted(muted: boolean)`: Toggles `_isMuted`. When `true`, sets `micGainNode.gain.setValueAtTime(0, currentTime)` and sets `track.enabled = false` on all microphone tracks. When `false`, sets `track.enabled = true` and restores `micGainNode.gain.setValueAtTime(_micGain, currentTime)`.
   - `setSpeakerVolume(volume: number)`: Clamps volume to `[0.0, 1.0]` and applies `speakerGainNode.gain.setValueAtTime(volume, currentTime)`. Saves internal `_speakerVolume`.
   - State preservation: If setters are invoked prior to `initialize()`, the desired values are stored in internal state and immediately applied during graph construction in `initialize()`.

5. **Visualizer Data Tap & Normalization Mathematics**:
   - `getMicVisualData()` and `getSpeakerVisualData()` fetch data using `analyser.getByteTimeDomainData()` and `analyser.getByteFrequencyData()`.
   - Silent / uninitialized fallback: Returns `timeDomainData` of length `fftSize` filled with `128` (zero crossing in byte domain `[0..255]`), `frequencyData` of length `frequencyBinCount` filled with `0`, `rmsVolume: 0`, and `peakVolume: 0`.
   - Mathematical formula for Time Domain Normalization:
     For byte sample $v_i \in [0, 255]$, normalized amplitude is $s_i = \frac{v_i - 128}{128.0} \in [-1.0, 1.0]$.
   - Peak Volume:
     $$\text{Peak} = \max_{0 \le i < N} |s_i| \in [0.0, 1.0]$$
   - RMS Volume (Root Mean Square):
     $$\text{RMS} = \sqrt{\frac{1}{N} \sum_{i=0}^{N-1} s_i^2} \in [0.0, 1.0]$$

6. **Error Handling & Resilience**:
   - Wrap `getUserMedia` in try-catch to intercept `NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`, `SecurityError`.
   - If user denies microphone access or hardware is unavailable, `initialize()` returns `false` and resets state without throwing unhandled rejections.
   - All public methods guard against null nodes and closed contexts.

## 3. Caveats
- Browser-specific autoplay policy might require a direct user interaction before `audioContext.resume()` transitions state to `"running"`. The `useVoiceCall` hook in Milestone 3 must invoke `resumeContext()` in the click handler for "Start Call" or "Unmute".
- In headless/CI test environments, Web Audio API and `MediaStream` must be mocked via `src/test/audioMocks.ts`.
- The Web Speech API `SpeechSynthesis` output is rendered directly by the browser's speech synthesis engine in some browsers and is not automatically routed through Web Audio API nodes. In Milestone 2/3, `AudioEngineService` provides `speakerGainNode` and `speakerAnalyserNode` with audio injection seams and simulated/oscillator visualizer capabilities.

## 4. Conclusion & Proposed Implementation Blueprint

### Interface Contract (`src/services/audioEngine.ts`)

```typescript
export interface AudioEngineConfig {
  fftSize?: number; // default: 128 (64 frequency bins)
  smoothingTimeConstant?: number; // default: 0.8
  minDecibels?: number; // default: -90
  maxDecibels?: number; // default: -10
}

export interface AudioVisualData {
  timeDomainData: Uint8Array;
  frequencyData: Uint8Array;
  rmsVolume: number; // 0.0 to 1.0 normalized
  peakVolume: number; // 0.0 to 1.0 normalized
}

export interface IAudioEngine {
  readonly isInitialized: boolean;
  readonly isMuted: boolean;
  readonly micGain: number;
  readonly speakerVolume: number;
  readonly audioContextState: AudioContextState | "unsupported";

  initialize(): Promise<boolean>;
  setMuted(muted: boolean): void;
  setMicGain(gain: number): void; // 0.0 - 2.0
  setSpeakerVolume(volume: number): void; // 0.0 - 1.0
  getMicVisualData(): AudioVisualData;
  getSpeakerVisualData(): AudioVisualData;
  getSpeakerInputNode(): GainNode | null;
  resumeContext(): Promise<void>;
  cleanup(): void;
}
```

### Complete Proposed Implementation for `src/services/audioEngine.ts`

```typescript
export interface AudioEngineConfig {
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
}

export interface AudioVisualData {
  timeDomainData: Uint8Array;
  frequencyData: Uint8Array;
  rmsVolume: number;
  peakVolume: number;
}

export interface IAudioEngine {
  readonly isInitialized: boolean;
  readonly isMuted: boolean;
  readonly micGain: number;
  readonly speakerVolume: number;
  readonly audioContextState: AudioContextState | "unsupported";

  initialize(): Promise<boolean>;
  setMuted(muted: boolean): void;
  setMicGain(gain: number): void;
  setSpeakerVolume(volume: number): void;
  getMicVisualData(): AudioVisualData;
  getSpeakerVisualData(): AudioVisualData;
  getSpeakerInputNode(): GainNode | null;
  resumeContext(): Promise<void>;
  cleanup(): void;
}

export class AudioEngineService implements IAudioEngine {
  private config: Required<AudioEngineConfig>;
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micGainNode: GainNode | null = null;
  private micAnalyserNode: AnalyserNode | null = null;
  private speakerGainNode: GainNode | null = null;
  private speakerAnalyserNode: AnalyserNode | null = null;

  private _isInitialized = false;
  private _isMuted = false;
  private _micGain = 1.0;
  private _speakerVolume = 1.0;

  // Cached buffers for zero-allocation performance in animation loops
  private micTimeBuffer: Uint8Array | null = null;
  private micFreqBuffer: Uint8Array | null = null;
  private speakerTimeBuffer: Uint8Array | null = null;
  private speakerFreqBuffer: Uint8Array | null = null;

  constructor(config?: AudioEngineConfig) {
    this.config = {
      fftSize: config?.fftSize ?? 128,
      smoothingTimeConstant: config?.smoothingTimeConstant ?? 0.8,
      minDecibels: config?.minDecibels ?? -90,
      maxDecibels: config?.maxDecibels ?? -10,
    };
  }

  public get isInitialized(): boolean {
    return this._isInitialized;
  }

  public get isMuted(): boolean {
    return this._isMuted;
  }

  public get micGain(): number {
    return this._micGain;
  }

  public get speakerVolume(): number {
    return this._speakerVolume;
  }

  public get audioContextState(): AudioContextState | "unsupported" {
    if (!this.audioContext) {
      return typeof window !== "undefined" &&
        (window.AudioContext || (window as any).webkitAudioContext)
        ? "suspended"
        : "unsupported";
    }
    return this.audioContext.state;
  }

  public async initialize(): Promise<boolean> {
    if (this._isInitialized) {
      return true;
    }

    try {
      const AudioCtxClass =
        typeof window !== "undefined"
          ? window.AudioContext || (window as any).webkitAudioContext
          : null;

      if (!AudioCtxClass || !navigator?.mediaDevices?.getUserMedia) {
        console.warn("AudioContext or getUserMedia is not supported in this environment");
        return false;
      }

      this.audioContext = new AudioCtxClass();

      // 1. Capture microphone
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      };

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);

      // 2. Setup Mic Audio Graph: Source -> Gain -> Analyser (NO destination connection!)
      this.micSourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      this.micGainNode = this.audioContext.createGain();
      this.micGainNode.gain.setValueAtTime(
        this._isMuted ? 0 : this._micGain,
        this.audioContext.currentTime
      );

      this.micAnalyserNode = this.audioContext.createAnalyser();
      this.micAnalyserNode.fftSize = this.config.fftSize;
      this.micAnalyserNode.smoothingTimeConstant = this.config.smoothingTimeConstant;
      this.micAnalyserNode.minDecibels = this.config.minDecibels;
      this.micAnalyserNode.maxDecibels = this.config.maxDecibels;

      this.micSourceNode.connect(this.micGainNode);
      this.micGainNode.connect(this.micAnalyserNode);

      // 3. Setup Speaker Audio Graph: Gain -> Analyser -> Destination
      this.speakerGainNode = this.audioContext.createGain();
      this.speakerGainNode.gain.setValueAtTime(
        this._speakerVolume,
        this.audioContext.currentTime
      );

      this.speakerAnalyserNode = this.audioContext.createAnalyser();
      this.speakerAnalyserNode.fftSize = this.config.fftSize;
      this.speakerAnalyserNode.smoothingTimeConstant = this.config.smoothingTimeConstant;
      this.speakerAnalyserNode.minDecibels = this.config.minDecibels;
      this.speakerAnalyserNode.maxDecibels = this.config.maxDecibels;

      this.speakerGainNode.connect(this.speakerAnalyserNode);
      this.speakerAnalyserNode.connect(this.audioContext.destination);

      // 4. Allocate reusable buffers
      const timeLen = this.micAnalyserNode.fftSize;
      const freqLen = this.micAnalyserNode.frequencyBinCount;
      this.micTimeBuffer = new Uint8Array(timeLen);
      this.micFreqBuffer = new Uint8Array(freqLen);
      this.speakerTimeBuffer = new Uint8Array(timeLen);
      this.speakerFreqBuffer = new Uint8Array(freqLen);

      // 5. Apply initial mute state to tracks
      if (this._isMuted) {
        this.micStream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }

      this._isInitialized = true;
      return true;
    } catch (error) {
      console.warn("AudioEngine initialization failed:", error);
      this.cleanup();
      return false;
    }
  }

  public setMuted(muted: boolean): void {
    this._isMuted = Boolean(muted);

    if (this.micGainNode && this.audioContext) {
      const targetGain = this._isMuted ? 0 : this._micGain;
      this.micGainNode.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
    }

    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !this._isMuted;
      });
    }
  }

  public setMicGain(gain: number): void {
    const clamped = Math.max(0.0, Math.min(2.0, Number.isFinite(gain) ? gain : 1.0));
    this._micGain = clamped;

    if (this.micGainNode && this.audioContext && !this._isMuted) {
      this.micGainNode.gain.setValueAtTime(clamped, this.audioContext.currentTime);
    }
  }

  public setSpeakerVolume(volume: number): void {
    const clamped = Math.max(0.0, Math.min(1.0, Number.isFinite(volume) ? volume : 1.0));
    this._speakerVolume = clamped;

    if (this.speakerGainNode && this.audioContext) {
      this.speakerGainNode.gain.setValueAtTime(clamped, this.audioContext.currentTime);
    }
  }

  public async resumeContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch (err) {
        console.warn("Failed to resume AudioContext:", err);
      }
    }
  }

  public getSpeakerInputNode(): GainNode | null {
    return this.speakerGainNode;
  }

  public getMicVisualData(): AudioVisualData {
    if (
      !this._isInitialized ||
      this._isMuted ||
      !this.micAnalyserNode ||
      !this.micTimeBuffer ||
      !this.micFreqBuffer
    ) {
      return this.createSilentVisualData();
    }

    this.micAnalyserNode.getByteTimeDomainData(this.micTimeBuffer);
    this.micAnalyserNode.getByteFrequencyData(this.micFreqBuffer);

    const { rmsVolume, peakVolume } = this.calculateVolumeMetrics(this.micTimeBuffer);

    return {
      timeDomainData: new Uint8Array(this.micTimeBuffer),
      frequencyData: new Uint8Array(this.micFreqBuffer),
      rmsVolume,
      peakVolume,
    };
  }

  public getSpeakerVisualData(): AudioVisualData {
    if (
      !this._isInitialized ||
      !this.speakerAnalyserNode ||
      !this.speakerTimeBuffer ||
      !this.speakerFreqBuffer
    ) {
      return this.createSilentVisualData();
    }

    this.speakerAnalyserNode.getByteTimeDomainData(this.speakerTimeBuffer);
    this.speakerAnalyserNode.getByteFrequencyData(this.speakerFreqBuffer);

    const { rmsVolume, peakVolume } = this.calculateVolumeMetrics(this.speakerTimeBuffer);

    return {
      timeDomainData: new Uint8Array(this.speakerTimeBuffer),
      frequencyData: new Uint8Array(this.speakerFreqBuffer),
      rmsVolume,
      peakVolume,
    };
  }

  public cleanup(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.micStream = null;
    }

    try { this.micSourceNode?.disconnect(); } catch {}
    try { this.micGainNode?.disconnect(); } catch {}
    try { this.micAnalyserNode?.disconnect(); } catch {}
    try { this.speakerGainNode?.disconnect(); } catch {}
    try { this.speakerAnalyserNode?.disconnect(); } catch {}

    this.micSourceNode = null;
    this.micGainNode = null;
    this.micAnalyserNode = null;
    this.speakerGainNode = null;
    this.speakerAnalyserNode = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        void this.audioContext.close();
      } catch (err) {
        console.warn("Error closing AudioContext:", err);
      }
    }
    this.audioContext = null;

    this.micTimeBuffer = null;
    this.micFreqBuffer = null;
    this.speakerTimeBuffer = null;
    this.speakerFreqBuffer = null;

    this._isInitialized = false;
  }

  private createSilentVisualData(): AudioVisualData {
    const timeLen = this.config.fftSize;
    const freqLen = this.config.fftSize / 2;
    const timeData = new Uint8Array(timeLen);
    timeData.fill(128); // 128 represents 0 amplitude in unsigned byte PCM
    const freqData = new Uint8Array(freqLen); // 0 represents 0 energy

    return {
      timeDomainData: timeData,
      frequencyData: freqData,
      rmsVolume: 0.0,
      peakVolume: 0.0,
    };
  }

  private calculateVolumeMetrics(timeBuffer: Uint8Array): { rmsVolume: number; peakVolume: number } {
    let sumSquares = 0;
    let peak = 0;
    const len = timeBuffer.length;

    for (let i = 0; i < len; i++) {
      const normalized = (timeBuffer[i] - 128) / 128.0;
      const abs = Math.abs(normalized);
      if (abs > peak) {
        peak = abs;
      }
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / len);

    return {
      rmsVolume: Math.min(1.0, Math.max(0.0, rms)),
      peakVolume: Math.min(1.0, Math.max(0.0, peak)),
    };
  }
}
```

### Comprehensive Mock Harness (`src/test/audioMocks.ts`)

```typescript
export class MockAudioParam {
  public value: number;
  constructor(defaultValue = 1.0) {
    this.value = defaultValue;
  }
  public setValueAtTime(value: number, _time: number): void {
    this.value = value;
  }
}

export class MockAudioNode {
  public destination: MockAudioNode | null = null;
  public connect(dest: MockAudioNode): MockAudioNode {
    this.destination = dest;
    return dest;
  }
  public disconnect(): void {
    this.destination = null;
  }
}

export class MockGainNode extends MockAudioNode {
  public gain: MockAudioParam;
  constructor(defaultValue = 1.0) {
    super();
    this.gain = new MockAudioParam(defaultValue);
  }
}

export class MockAnalyserNode extends MockAudioNode {
  public fftSize = 128;
  public smoothingTimeConstant = 0.8;
  public minDecibels = -90;
  public maxDecibels = -10;

  private mockTimeData: Uint8Array | null = null;
  private mockFreqData: Uint8Array | null = null;

  public get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  public setMockData(timeData?: Uint8Array, freqData?: Uint8Array): void {
    if (timeData) this.mockTimeData = timeData;
    if (freqData) this.mockFreqData = freqData;
  }

  public getByteTimeDomainData(array: Uint8Array): void {
    if (this.mockTimeData) {
      array.set(this.mockTimeData.subarray(0, array.length));
    } else {
      array.fill(128);
    }
  }

  public getByteFrequencyData(array: Uint8Array): void {
    if (this.mockFreqData) {
      array.set(this.mockFreqData.subarray(0, array.length));
    } else {
      array.fill(0);
    }
  }
}

export class MockMediaStreamTrack {
  public enabled = true;
  public kind = "audio";
  public id = "mock-track-" + Math.random();
  public stop = vi.fn();
}

export class MockMediaStream {
  public tracks: MockMediaStreamTrack[];
  constructor(tracks?: MockMediaStreamTrack[]) {
    this.tracks = tracks || [new MockMediaStreamTrack()];
  }
  public getAudioTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  public getVideoTracks(): MockMediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
  public getTracks(): MockMediaStreamTrack[] {
    return [...this.tracks];
  }
}

export class MockAudioContext {
  public state: AudioContextState = "suspended";
  public currentTime = 0;
  public destination = new MockAudioNode();

  public createGain(): MockGainNode {
    return new MockGainNode();
  }

  public createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode();
  }

  public createMediaStreamSource(_stream: MediaStream): MockAudioNode {
    return new MockAudioNode();
  }

  public async resume(): Promise<void> {
    this.state = "running";
  }

  public async close(): Promise<void> {
    this.state = "closed";
  }
}

export function setupAudioMocks(): void {
  (window as any).AudioContext = MockAudioContext;
  (window as any).webkitAudioContext = MockAudioContext;

  if (!navigator.mediaDevices) {
    (navigator as any).mediaDevices = {};
  }

  navigator.mediaDevices.getUserMedia = vi.fn().mockImplementation(async () => {
    return new MockMediaStream();
  });
}

export function resetAudioMocks(): void {
  vi.restoreAllMocks();
}
```

## 5. Verification Method
1. **Unit Test Verification (`src/services/__tests__/audioEngine.test.ts`)**:
   - Test AudioContext and MediaStream capture initialization with echoCancellation, noiseSuppression, autoGainControl constraints.
   - Test audio graph construction: verifies mic graph does not connect to destination.
   - Test mic gain clamping (0.0 - 2.0) and speaker volume clamping (0.0 - 1.0).
   - Test muting: verifies gain set to 0 and `track.enabled = false`, and unmuting restores gain and track enabled.
   - Test `getMicVisualData()` and `getSpeakerVisualData()` RMS and Peak calculations on known sample buffers (silent 128 -> RMS 0, Peak 0; full-scale sine 255/0 -> RMS 1.0, Peak 1.0).
   - Test cleanup: verifies all tracks are stopped, nodes disconnected, and AudioContext closed.
   - Test unsupported environment & getUserMedia rejection fallbacks.
2. **Commands**:
   - `npx vitest run src/services/__tests__/audioEngine.test.ts`
   - `npm test`
   - `npm run build`
