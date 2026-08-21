/**
 * Audio Engine Service for NanoForge Interactive Audio Call System
 * Manages Web Audio API graph, microphone stream capture with AEC/NS/AGC,
 * gain/volume controls, visualizer FFT data taps, and clean teardown.
 */

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

interface WindowWithAudioContext {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
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

  private micTimeBuffer: Uint8Array<ArrayBuffer> | null = null;
  private micFreqBuffer: Uint8Array<ArrayBuffer> | null = null;
  private speakerTimeBuffer: Uint8Array<ArrayBuffer> | null = null;
  private speakerFreqBuffer: Uint8Array<ArrayBuffer> | null = null;

  private _isInitialized: boolean = false;
  private _isMuted: boolean = false;
  private _micGain: number = 1.0;
  private _speakerVolume: number = 1.0;

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
      if (typeof window === "undefined") {
        return "unsupported";
      }
      const win = window as unknown as WindowWithAudioContext;
      return (win.AudioContext || win.webkitAudioContext) ? "suspended" : "unsupported";
    }
    return this.audioContext.state;
  }

  public async initialize(): Promise<boolean> {
    if (this._isInitialized) {
      return true;
    }

    try {
      if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) {
        console.warn("AudioContext or getUserMedia is not supported in this environment");
        return false;
      }

      const win = window as unknown as WindowWithAudioContext;
      const AudioCtxClass = win.AudioContext || win.webkitAudioContext;

      if (!AudioCtxClass) {
        console.warn("AudioContext is not supported in this environment");
        return false;
      }

      const ctx = new AudioCtxClass();
      this.audioContext = ctx;

      // 1. Capture microphone with noise suppression, echo cancellation, auto gain control
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      };

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);

      // 2. Setup Mic Audio Graph: Source -> Gain -> Analyser (NO destination connection to prevent acoustic loop!)
      this.micSourceNode = ctx.createMediaStreamSource(this.micStream);
      this.micGainNode = ctx.createGain();
      this.micGainNode.gain.setValueAtTime(
        this._isMuted ? 0 : this._micGain,
        ctx.currentTime
      );

      this.micAnalyserNode = ctx.createAnalyser();
      this.micAnalyserNode.fftSize = this.config.fftSize;
      this.micAnalyserNode.smoothingTimeConstant = this.config.smoothingTimeConstant;
      this.micAnalyserNode.minDecibels = this.config.minDecibels;
      this.micAnalyserNode.maxDecibels = this.config.maxDecibels;

      this.micSourceNode.connect(this.micGainNode);
      this.micGainNode.connect(this.micAnalyserNode);

      // 3. Setup Speaker Audio Graph: Gain -> Analyser -> Destination
      this.speakerGainNode = ctx.createGain();
      this.speakerGainNode.gain.setValueAtTime(
        this._speakerVolume,
        ctx.currentTime
      );

      this.speakerAnalyserNode = ctx.createAnalyser();
      this.speakerAnalyserNode.fftSize = this.config.fftSize;
      this.speakerAnalyserNode.smoothingTimeConstant = this.config.smoothingTimeConstant;
      this.speakerAnalyserNode.minDecibels = this.config.minDecibels;
      this.speakerAnalyserNode.maxDecibels = this.config.maxDecibels;

      this.speakerGainNode.connect(this.speakerAnalyserNode);
      this.speakerAnalyserNode.connect(ctx.destination);

      // 4. Allocate reusable buffers
      const timeLen = this.micAnalyserNode.fftSize;
      const freqLen = this.micAnalyserNode.frequencyBinCount;
      this.micTimeBuffer = new Uint8Array(new ArrayBuffer(timeLen));
      this.micFreqBuffer = new Uint8Array(new ArrayBuffer(freqLen));
      this.speakerTimeBuffer = new Uint8Array(new ArrayBuffer(timeLen));
      this.speakerFreqBuffer = new Uint8Array(new ArrayBuffer(freqLen));

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

export const audioEngineService = new AudioEngineService();
