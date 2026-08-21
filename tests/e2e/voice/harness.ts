/**
 * Voice Call E2E Test Harness & Virtual Simulation Environment
 *
 * Provides a comprehensive, opaque-box virtual test environment for the
 * NanoForge Interactive Audio Voice Call System.
 *
 * Implements:
 * 1. Mock Web Audio engine (AudioContext, AnalyserNode, GainNode, MediaStreamTrack).
 * 2. Mock SpeechRecognition engine (Web Speech STT API, interim/final events, VAD).
 * 3. Mock SpeechSynthesis engine (Web Speech TTS API, barge-in cancellation, voice controls).
 * 4. Virtual Voice Host (Fastify WebSocket server coordinator, state machine, token streaming).
 * 5. Virtual Voice Client & VoiceCallDrawer simulation with transcript persistence.
 * 6. Fluent assertion helpers and telemetry logging.
 */

import {
  VoiceCallStatus,
  VoiceCallSession,
  VoiceProfile,
  VoiceTranscriptFrame,
  VoiceTtsChunk,
  VoiceTurnSync,
  VoiceInterruptFrame,
  VoiceClientMessage,
  VoiceHostEvent,
  voiceClientMessageSchema,
  voiceHostEventSchema,
  createVoiceCallSession,
  isValidVoiceStateTransition,
  VoiceCallEndReason,
  VoiceInterruptReason,
} from "@protocol/voice";

/* ------------------------------------------------------------------ */
/* 1. Mock Web Audio Primitives                                       */
/* ------------------------------------------------------------------ */

export class MockAudioParam {
  private _value: number;

  constructor(defaultValue: number = 1.0) {
    this._value = defaultValue;
  }

  get value(): number {
    return this._value;
  }

  set value(v: number) {
    this._value = v;
  }

  setValueAtTime(val: number, _startTime: number): void {
    this._value = val;
  }

  linearRampToValueAtTime(val: number, _endTime: number): void {
    this._value = val;
  }

  exponentialRampToValueAtTime(val: number, _endTime: number): void {
    this._value = val;
  }
}

export class MockAudioNode {
  protected _connectedNodes: MockAudioNode[] = [];

  connect(destination: MockAudioNode): MockAudioNode {
    this._connectedNodes.push(destination);
    return destination;
  }

  disconnect(): void {
    this._connectedNodes = [];
  }
}

export class MockGainNode extends MockAudioNode {
  readonly gain: MockAudioParam;

  constructor(defaultGain: number = 1.0) {
    super();
    this.gain = new MockAudioParam(defaultGain);
  }
}

export class MockAnalyserNode extends MockAudioNode {
  fftSize: number = 2048;
  minDecibels: number = -100;
  maxDecibels: number = -30;
  smoothingTimeConstant: number = 0.8;

  public active: boolean = false;
  public amplitude: number = 0.8;
  public mode: "mic" | "speaker" = "mic";

  get frequencyBinCount(): number {
    return Math.floor(this.fftSize / 2);
  }

  getByteTimeDomainData(array: Uint8Array): void {
    const len = array.length;
    if (!this.active || this.amplitude <= 0) {
      // Flat baseline: 128 represents zero offset in 8-bit unsigned PCM
      for (let i = 0; i < len; i++) {
        array[i] = 128;
      }
      return;
    }

    // Realistic oscillating waveform around 128
    for (let i = 0; i < len; i++) {
      const angle = (i / len) * Math.PI * 8; // 4 periods
      const wave = Math.sin(angle) * this.amplitude;
      array[i] = Math.max(0, Math.min(255, Math.round(128 + wave * 120)));
    }
  }

  getByteFrequencyData(array: Uint8Array): void {
    const len = array.length;
    if (!this.active || this.amplitude <= 0) {
      for (let i = 0; i < len; i++) {
        array[i] = 0;
      }
      return;
    }

    // Voice frequency distribution: peak around 300Hz-3kHz (early bins)
    for (let i = 0; i < len; i++) {
      const normalizedIdx = i / len;
      // Exponential decay with simulated harmonic peaks
      const harmonic = Math.abs(Math.sin(normalizedIdx * Math.PI * 16));
      const decay = Math.exp(-normalizedIdx * 4);
      const val = Math.round(this.amplitude * 255 * decay * (0.6 + 0.4 * harmonic));
      array[i] = Math.max(0, Math.min(255, val));
    }
  }

  getFloatTimeDomainData(array: Float32Array): void {
    const len = array.length;
    if (!this.active || this.amplitude <= 0) {
      for (let i = 0; i < len; i++) {
        array[i] = 0.0;
      }
      return;
    }
    for (let i = 0; i < len; i++) {
      const angle = (i / len) * Math.PI * 8;
      array[i] = Math.sin(angle) * this.amplitude;
    }
  }

  getFloatFrequencyData(array: Float32Array): void {
    const len = array.length;
    if (!this.active || this.amplitude <= 0) {
      for (let i = 0; i < len; i++) {
        array[i] = this.minDecibels;
      }
      return;
    }
    for (let i = 0; i < len; i++) {
      const normalizedIdx = i / len;
      const decay = Math.exp(-normalizedIdx * 4);
      array[i] = this.minDecibels + (this.maxDecibels - this.minDecibels) * this.amplitude * decay;
    }
  }
}

export class MockMediaStreamTrack {
  readonly id: string;
  readonly kind: string = "audio";
  readonly label: string;
  enabled: boolean = true;
  readyState: "live" | "ended" = "live";
  onended: (() => void) | null = null;

  constructor(label: string = "Mock Mic Track") {
    this.id = crypto.randomUUID();
    this.label = label;
  }

  stop(): void {
    this.readyState = "ended";
    this.enabled = false;
    if (this.onended) {
      this.onended();
    }
  }
}

export class MockMediaStream {
  readonly id: string;
  private _tracks: MockMediaStreamTrack[] = [];

  constructor(tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()]) {
    this.id = crypto.randomUUID();
    this._tracks = [...tracks];
  }

  get active(): boolean {
    return this._tracks.some((t) => t.readyState === "live");
  }

  getTracks(): MockMediaStreamTrack[] {
    return [...this._tracks];
  }

  getAudioTracks(): MockMediaStreamTrack[] {
    return this._tracks.filter((t) => t.kind === "audio");
  }

  addTrack(track: MockMediaStreamTrack): void {
    this._tracks.push(track);
  }

  removeTrack(track: MockMediaStreamTrack): void {
    this._tracks = this._tracks.filter((t) => t.id !== track.id);
  }
}

export class MockAudioContext {
  state: "suspended" | "running" | "closed" = "running";
  sampleRate: number = 44100;
  currentTime: number = 0;
  onstatechange: (() => void) | null = null;

  private _nodes: MockAudioNode[] = [];

  createGain(): MockGainNode {
    const gain = new MockGainNode(1.0);
    this._nodes.push(gain);
    return gain;
  }

  createAnalyser(): MockAnalyserNode {
    const analyser = new MockAnalyserNode();
    this._nodes.push(analyser);
    return analyser;
  }

  createMediaStreamSource(_stream: MockMediaStream): MockAudioNode {
    const source = new MockAudioNode();
    this._nodes.push(source);
    return source;
  }

  async resume(): Promise<void> {
    this.state = "running";
    if (this.onstatechange) this.onstatechange();
  }

  async suspend(): Promise<void> {
    this.state = "suspended";
    if (this.onstatechange) this.onstatechange();
  }

  async close(): Promise<void> {
    this.state = "closed";
    if (this.onstatechange) this.onstatechange();
  }
}

export interface AudioVisualData {
  timeDomainData: Uint8Array;
  frequencyData: Uint8Array;
  rmsVolume: number;
}

export class MockAudioEngine {
  public context: MockAudioContext | null = null;
  public micGainNode: MockGainNode | null = null;
  public speakerGainNode: MockGainNode | null = null;
  public micAnalyser: MockAnalyserNode | null = null;
  public speakerAnalyser: MockAnalyserNode | null = null;
  public micStream: MockMediaStream | null = null;

  public isInitialized: boolean = false;
  public isMuted: boolean = false;
  public micGain: number = 1.0;
  public speakerVolume: number = 1.0;

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    this.context = new MockAudioContext();
    this.micGainNode = this.context.createGain();
    this.speakerGainNode = this.context.createGain();
    this.micAnalyser = this.context.createAnalyser();
    this.micAnalyser.mode = "mic";
    this.speakerAnalyser = this.context.createAnalyser();
    this.speakerAnalyser.mode = "speaker";

    this.micStream = new MockMediaStream([new MockMediaStreamTrack("Internal Mic")]);
    const micSource = this.context.createMediaStreamSource(this.micStream);

    micSource.connect(this.micGainNode);
    this.micGainNode.connect(this.micAnalyser);

    this.setMicGain(this.micGain);
    this.setSpeakerVolume(this.speakerVolume);
    this.setMuted(this.isMuted);

    this.isInitialized = true;
    return true;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
    if (this.micGainNode) {
      this.micGainNode.gain.value = muted ? 0.0 : this.micGain;
    }
    if (this.micAnalyser) {
      if (muted) {
        this.micAnalyser.active = false;
      }
    }
  }

  setMicGain(gain: number): void {
    // Clamp to [0.0, 2.0] with NaN protection
    const safeGain = Number.isFinite(gain) ? gain : 1.0;
    const clamped = Math.max(0.0, Math.min(2.0, safeGain));
    this.micGain = clamped;
    if (this.micGainNode && !this.isMuted) {
      this.micGainNode.gain.value = clamped;
    }
    if (this.micAnalyser) {
      this.micAnalyser.amplitude = clamped;
    }
  }

  setSpeakerVolume(volume: number): void {
    // Clamp to [0.0, 1.0] with NaN protection
    const safeVolume = Number.isFinite(volume) ? volume : 1.0;
    const clamped = Math.max(0.0, Math.min(1.0, safeVolume));
    this.speakerVolume = clamped;
    if (this.speakerGainNode) {
      this.speakerGainNode.gain.value = clamped;
    }
    if (this.speakerAnalyser) {
      this.speakerAnalyser.amplitude = clamped;
    }
  }

  getMicVisualData(): AudioVisualData {
    const timeDomainData = new Uint8Array(256);
    const frequencyData = new Uint8Array(128);

    if (this.micAnalyser && !this.isMuted) {
      this.micAnalyser.getByteTimeDomainData(timeDomainData);
      this.micAnalyser.getByteFrequencyData(frequencyData);
    } else {
      timeDomainData.fill(128);
      frequencyData.fill(0);
    }

    // Calculate root mean square volume
    let sum = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const normalized = (timeDomainData[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rawRms = Math.sqrt(sum / timeDomainData.length);
    const rmsVolume = Number.isFinite(rawRms) ? rawRms : 0.0;

    return { timeDomainData, frequencyData, rmsVolume };
  }

  getSpeakerVisualData(): AudioVisualData {
    const timeDomainData = new Uint8Array(256);
    const frequencyData = new Uint8Array(128);

    if (this.speakerAnalyser) {
      this.speakerAnalyser.getByteTimeDomainData(timeDomainData);
      this.speakerAnalyser.getByteFrequencyData(frequencyData);
    } else {
      timeDomainData.fill(128);
      frequencyData.fill(0);
    }

    let sum = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const normalized = (timeDomainData[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rawRms = Math.sqrt(sum / timeDomainData.length);
    const rmsVolume = Number.isFinite(rawRms) ? rawRms : 0.0;

    return { timeDomainData, frequencyData, rmsVolume };
  }

  simulateMicActivity(active: boolean, amplitude: number = 0.8): void {
    if (this.micAnalyser) {
      this.micAnalyser.active = active && !this.isMuted;
      this.micAnalyser.amplitude = this.micGain * (Number.isFinite(amplitude) ? amplitude : 0.8);
    }
  }

  simulateSpeakerActivity(active: boolean, amplitude: number = 0.8): void {
    if (this.speakerAnalyser) {
      this.speakerAnalyser.active = active;
      this.speakerAnalyser.amplitude = this.speakerVolume * (Number.isFinite(amplitude) ? amplitude : 0.8);
    }
  }

  cleanup(): void {
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    if (this.context && this.context.state !== "closed") {
      this.context.close();
    }
    this.context = null;
    this.micGainNode = null;
    this.speakerGainNode = null;
    this.micAnalyser = null;
    this.speakerAnalyser = null;
    this.isInitialized = false;
  }
}

/* ------------------------------------------------------------------ */
/* 2. Mock Speech Recognition Engine                                  */
/* ------------------------------------------------------------------ */

export interface MockSpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

export interface MockSpeechRecognitionResult {
  0: MockSpeechRecognitionResultItem;
  length: number;
  isFinal: boolean;
  item(index: number): MockSpeechRecognitionResultItem;
}

export class MockSpeechRecognition {
  continuous: boolean = true;
  interimResults: boolean = true;
  lang: string = "en-US";
  maxAlternatives: number = 1;

  isListening: boolean = false;
  currentTranscript: string = "";

  // Callbacks
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onsoundend: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: { error: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  // Custom VAD handler
  onVadAutoDispatch: ((finalText: string) => void) | null = null;
  private _vadTimer: any = null;
  public vadSilenceDelayMs: number = 800;

  start(): void {
    if (this.isListening) return;
    this.isListening = true;
    if (this.onstart) this.onstart();
    if (this.onaudiostart) this.onaudiostart();
  }

  stop(): void {
    if (!this.isListening) return;
    this.isListening = false;
    this._clearVadTimer();
    if (this.onspeechend) this.onspeechend();
    if (this.onaudioend) this.onaudioend();
    if (this.onend) this.onend();
  }

  abort(): void {
    this.stop();
  }

  simulateUtterance(text: string, isFinal: boolean = false, confidence: number = 0.95): void {
    if (!this.isListening) return;
    if (!text || !text.trim()) return; // Filter out empty or whitespace-only noise bursts

    this.currentTranscript = text;

    if (this.onspeechstart) {
      this.onspeechstart();
    }

    const resultItem: MockSpeechRecognitionResultItem = {
      transcript: text,
      confidence,
    };

    const result: MockSpeechRecognitionResult = {
      0: resultItem,
      length: 1,
      isFinal,
      item: (i: number) => (i === 0 ? resultItem : { transcript: "", confidence: 0 }),
    };

    const event = {
      resultIndex: 0,
      results: [result],
    };

    if (this.onresult) {
      this.onresult(event);
    }

    if (isFinal) {
      this._scheduleVadAutoDispatch(text);
    }
  }

  simulateInterim(text: string): void {
    this.simulateUtterance(text, false);
  }

  simulateFinal(text: string): void {
    this.simulateUtterance(text, true);
  }

  simulateSpeechPause(): void {
    if (this.currentTranscript && this.onVadAutoDispatch) {
      const dispatched = this.currentTranscript;
      this.currentTranscript = "";
      this._clearVadTimer();
      this.onVadAutoDispatch(dispatched);
    }
  }

  simulateError(error: string, message?: string): void {
    if (this.onerror) {
      this.onerror({ error, message });
    }
  }

  private _scheduleVadAutoDispatch(text: string): void {
    this._clearVadTimer();
    this._vadTimer = setTimeout(() => {
      if (this.onVadAutoDispatch && this.currentTranscript === text) {
        this.currentTranscript = "";
        this.onVadAutoDispatch(text);
      }
    }, this.vadSilenceDelayMs);
  }

  private _clearVadTimer(): void {
    if (this._vadTimer) {
      clearTimeout(this._vadTimer);
      this._vadTimer = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3. Mock Speech Synthesis Engine                                    */
/* ------------------------------------------------------------------ */

export interface MockSpeechSynthesisVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

export class MockSpeechSynthesisUtterance {
  text: string;
  lang: string = "en-US";
  pitch: number = 1.0;
  rate: number = 1.0;
  volume: number = 1.0;
  voice: MockSpeechSynthesisVoice | null = null;

  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  onboundary: ((event: any) => void) | null = null;

  constructor(text: string = "") {
    this.text = text;
  }
}

export class MockSpeechSynthesis {
  speaking: boolean = false;
  paused: boolean = false;
  pending: boolean = false;

  private _queue: MockSpeechSynthesisUtterance[] = [];
  public currentUtterance: MockSpeechSynthesisUtterance | null = null;
  private _voices: MockSpeechSynthesisVoice[] = [
    {
      voiceURI: "agent-default-en",
      name: "NanoForge Agent Standard",
      lang: "en-US",
      default: true,
      localService: true,
    },
    {
      voiceURI: "agent-warm-en",
      name: "NanoForge Agent Warm",
      lang: "en-US",
      default: false,
      localService: true,
    },
    {
      voiceURI: "agent-crisp-en",
      name: "NanoForge Agent Crisp",
      lang: "en-US",
      default: false,
      localService: true,
    },
  ];

  public onIdle: (() => void) | null = null;

  speak(utterance: MockSpeechSynthesisUtterance): void {
    // Sanitize parameters with NaN and boundary protection
    const safePitch = Number.isFinite(utterance.pitch) ? utterance.pitch : 1.0;
    const safeRate = Number.isFinite(utterance.rate) ? utterance.rate : 1.0;
    const safeVolume = Number.isFinite(utterance.volume) ? utterance.volume : 1.0;

    utterance.pitch = Math.max(0.0, Math.min(2.0, safePitch));
    utterance.rate = Math.max(0.1, Math.min(10.0, safeRate));
    utterance.volume = Math.max(0.0, Math.min(1.0, safeVolume));

    this._queue.push(utterance);
    this.pending = true;

    if (!this.speaking) {
      this._processNext();
    }
  }

  cancel(): void {
    // Instant Barge-In cancellation
    const active = this.currentUtterance;
    this._queue = [];
    this.currentUtterance = null;
    this.speaking = false;
    this.paused = false;
    this.pending = false;

    if (active && active.onerror) {
      active.onerror({ error: "canceled" });
    }
    if (this.onIdle) {
      this.onIdle();
    }
  }

  pause(): void {
    if (this.speaking && !this.paused) {
      this.paused = true;
      if (this.currentUtterance && this.currentUtterance.onpause) {
        this.currentUtterance.onpause();
      }
    }
  }

  resume(): void {
    if (this.speaking && this.paused) {
      this.paused = false;
      if (this.currentUtterance && this.currentUtterance.onresume) {
        this.currentUtterance.onresume();
      }
    }
  }

  getVoices(): MockSpeechSynthesisVoice[] {
    return [...this._voices];
  }

  completeCurrentUtterance(): void {
    if (this.currentUtterance) {
      const finished = this.currentUtterance;
      this.currentUtterance = null;
      if (finished.onend) {
        finished.onend();
      }
      this._processNext();
    }
  }

  private _processNext(): void {
    if (this._queue.length === 0) {
      this.speaking = false;
      this.pending = false;
      this.currentUtterance = null;
      if (this.onIdle) {
        this.onIdle();
      }
      return;
    }

    this.currentUtterance = this._queue.shift()!;
    this.speaking = true;
    this.pending = this._queue.length > 0;

    if (this.currentUtterance.onstart) {
      this.currentUtterance.onstart();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 4. Text & Utility Helpers for Voice Call Processing                */
/* ------------------------------------------------------------------ */

export function chunkTextForTts(text: string): string[] {
  if (!text || !text.trim()) return [];
  // Split on sentence terminators (. ! ? \n) while preserving words
  const rawChunks = text.split(/(?<=[.!?\n])\s+/);
  const result: string[] = [];

  for (const chunk of rawChunks) {
    const trimmed = chunk.trim();
    if (trimmed.length > 0) {
      result.push(trimmed);
    }
  }
  return result.length > 0 ? result : [text.trim()];
}

export function formatCallDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hrs = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function sanitizeVoiceTranscript(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function cleanMarkdownForSpeech(text: string): string {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, " code block omitted ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[*_#~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVoiceCommand(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "/call" || trimmed.startsWith("/call ")) {
    return "/call";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 5. Virtual Voice Host (Server-Side Session Coordinator)            */
/* ------------------------------------------------------------------ */

export interface VirtualVoiceHostOptions {
  autoRespond?: boolean;
  defaultResponseGenerator?: (prompt: string) => string;
}

export class VirtualVoiceHost {
  public sessions: Map<string, VoiceCallSession> = new Map();
  public activeSessionId: string | null = null;
  public eventLog: VoiceHostEvent[] = [];
  public wireLog: Array<{ direction: "c2s" | "s2c"; payload: any; at: string }> = [];

  private _activeAbortController: AbortController | null = null;
  private _autoRespond: boolean;
  private _defaultResponseGenerator: (prompt: string) => string;
  private _listeners: Set<(event: VoiceHostEvent) => void> = new Set();

  constructor(options: VirtualVoiceHostOptions = {}) {
    this._autoRespond = options.autoRespond ?? true;
    this._defaultResponseGenerator =
      options.defaultResponseGenerator ??
      ((prompt: string) => `This is the agent response for: "${prompt}". Everything is working properly.`);
  }

  set onHostEvent(fn: ((event: VoiceHostEvent) => void) | null) {
    if (fn) {
      this._listeners.add(fn);
    }
  }

  get onHostEvent(): ((event: VoiceHostEvent) => void) | null {
    return this._listeners.values().next().value ?? null;
  }

  addListener(fn: (event: VoiceHostEvent) => void): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  }

  handleClientMessage(msgOrJson: string | VoiceClientMessage): VoiceHostEvent[] {
    const emittedEvents: VoiceHostEvent[] = [];

    let msg: VoiceClientMessage;
    if (typeof msgOrJson === "string") {
      try {
        const parsed = JSON.parse(msgOrJson);
        msg = voiceClientMessageSchema.parse(parsed);
      } catch (err: any) {
        throw new Error(`Malformed client frame: ${err.message}`);
      }
    } else {
      msg = voiceClientMessageSchema.parse(msgOrJson);
    }

    this.wireLog.push({ direction: "c2s", payload: msg, at: new Date().toISOString() });

    switch (msg.type) {
      case "voice.session.start": {
        const session = createVoiceCallSession({
          inputGain: msg.inputGain ?? 1.0,
          outputVolume: msg.outputVolume ?? 1.0,
          voiceProfile: {
            voiceId: msg.voiceProfile?.voiceId ?? "default-voice",
            name: msg.voiceProfile?.name ?? "Agent Voice",
            rate: msg.voiceProfile?.rate ?? 1.0,
            pitch: msg.voiceProfile?.pitch ?? 1.0,
            timbre: msg.voiceProfile?.timbre ?? "neutral",
            language: msg.voiceProfile?.language ?? "en-US",
          },
          status: "listening",
        });

        this.sessions.set(session.sessionId, session);
        this.activeSessionId = session.sessionId;

        const readyEvent: VoiceHostEvent = {
          type: "voice.session.ready",
          requestId: msg.requestId,
          session,
          at: new Date().toISOString(),
        };
        const stateEvent: VoiceHostEvent = {
          type: "voice.session.state",
          sessionId: session.sessionId,
          status: "listening",
          at: new Date().toISOString(),
        };

        this._emit(readyEvent, emittedEvents);
        this._emit(stateEvent, emittedEvents);
        break;
      }

      case "voice.session.pause": {
        const session = this.sessions.get(msg.sessionId);
        if (session) {
          session.status = "idle";
          const stateEvent: VoiceHostEvent = {
            type: "voice.session.state",
            sessionId: msg.sessionId,
            status: "idle",
            at: new Date().toISOString(),
            detail: "Session paused",
          };
          this._emit(stateEvent, emittedEvents);
        }
        break;
      }

      case "voice.session.resume": {
        const session = this.sessions.get(msg.sessionId);
        if (session) {
          session.status = "listening";
          const stateEvent: VoiceHostEvent = {
            type: "voice.session.state",
            sessionId: msg.sessionId,
            status: "listening",
            at: new Date().toISOString(),
            detail: "Session resumed",
          };
          this._emit(stateEvent, emittedEvents);
        }
        break;
      }

      case "voice.session.mute": {
        const session = this.sessions.get(msg.sessionId);
        if (session) {
          session.isMuted = msg.muted;
          const nextStatus: VoiceCallStatus = msg.muted ? "muted" : "listening";
          session.status = nextStatus;
          const stateEvent: VoiceHostEvent = {
            type: "voice.session.state",
            sessionId: msg.sessionId,
            status: nextStatus,
            at: new Date().toISOString(),
            detail: msg.muted ? "Microphone muted" : "Microphone unmuted",
          };
          this._emit(stateEvent, emittedEvents);
        }
        break;
      }

      case "voice.session.end": {
        const session = this.sessions.get(msg.sessionId);
        if (session) {
          session.status = "ended";
          session.endedAt = new Date().toISOString();
          session.endReason = msg.reason ?? "user_hangup";

          const stateEvent: VoiceHostEvent = {
            type: "voice.session.state",
            sessionId: msg.sessionId,
            status: "ended",
            at: new Date().toISOString(),
            detail: `Session ended: ${session.endReason}`,
          };
          this._emit(stateEvent, emittedEvents);
          if (this.activeSessionId === msg.sessionId) {
            this.activeSessionId = null;
          }
        }
        break;
      }

      case "voice.transcript.submit": {
        const session = this.sessions.get(msg.sessionId);
        if (session) {
          session.currentTurnId = msg.turnId;
          session.totalTurns += 1;

          // Emit user transcript event
          const transcriptEvent: VoiceHostEvent = {
            type: "voice.transcript.event",
            frame: {
              sessionId: msg.sessionId,
              turnId: msg.turnId,
              speaker: "user",
              kind: msg.isFinal ? "final" : "interim",
              text: msg.text,
              confidence: msg.confidence ?? 1.0,
              isFinal: msg.isFinal,
              timestamp: new Date().toISOString(),
            },
            at: new Date().toISOString(),
          };
          this._emit(transcriptEvent, emittedEvents);

          if (msg.isFinal) {
            // Turn transitions: thinking -> speaking -> completed
            session.status = "thinking";
            const thinkingState: VoiceHostEvent = {
              type: "voice.session.state",
              sessionId: msg.sessionId,
              status: "thinking",
              at: new Date().toISOString(),
            };
            const turnStartEvent: VoiceHostEvent = {
              type: "voice.turn.event",
              turn: {
                sessionId: msg.sessionId,
                turnId: msg.turnId,
                state: "thinking",
                prompt: msg.text,
                timestamp: new Date().toISOString(),
              },
              at: new Date().toISOString(),
            };
            this._emit(thinkingState, emittedEvents);
            this._emit(turnStartEvent, emittedEvents);

            if (this._autoRespond) {
              this._streamAgentResponse(session, msg.turnId, msg.text, emittedEvents);
            }
          }
        }
        break;
      }

      case "voice.interrupt": {
        const session = this.sessions.get(msg.sessionId);
        if (session) {
          // Abort ongoing token stream
          if (this._activeAbortController) {
            this._activeAbortController.abort();
            this._activeAbortController = null;
          }

          const turnId = msg.turnId ?? session.currentTurnId ?? crypto.randomUUID();

          const interruptFrame: VoiceInterruptFrame = {
            sessionId: msg.sessionId,
            turnId,
            reason: msg.reason,
            interruptedAtMs: Date.now(),
            spokenTextSnippet: msg.spokenTextSnippet,
            timestamp: new Date().toISOString(),
          };

          const interruptedEvent: VoiceHostEvent = {
            type: "voice.interrupted",
            frame: interruptFrame,
            at: new Date().toISOString(),
          };

          const turnInterruptedEvent: VoiceHostEvent = {
            type: "voice.turn.event",
            turn: {
              sessionId: msg.sessionId,
              turnId,
              state: "interrupted",
              prompt: msg.spokenTextSnippet ?? "Interrupted Turn",
              response: "[Interrupted by user]",
              timestamp: new Date().toISOString(),
            },
            at: new Date().toISOString(),
          };

          session.status = "listening";
          const listeningState: VoiceHostEvent = {
            type: "voice.session.state",
            sessionId: msg.sessionId,
            status: "listening",
            at: new Date().toISOString(),
            detail: "Agent interrupted, reverting to listening",
          };

          this._emit(interruptedEvent, emittedEvents);
          this._emit(turnInterruptedEvent, emittedEvents);
          this._emit(listeningState, emittedEvents);
        }
        break;
      }

      default:
        break;
    }

    return emittedEvents;
  }

  private _streamAgentResponse(
    session: VoiceCallSession,
    turnId: string,
    prompt: string,
    emittedEvents: VoiceHostEvent[]
  ): void {
    this._activeAbortController = new AbortController();
    const signal = this._activeAbortController.signal;

    if (signal.aborted) return;

    const responseText = this._defaultResponseGenerator(prompt);
    const chunks = chunkTextForTts(responseText);

    session.status = "speaking";
    const speakingState: VoiceHostEvent = {
      type: "voice.session.state",
      sessionId: session.sessionId,
      status: "speaking",
      at: new Date().toISOString(),
    };
    this._emit(speakingState, emittedEvents);

    // Emit TTS chunks
    for (let i = 0; i < chunks.length; i++) {
      if (signal.aborted) return;

      const isLast = i === chunks.length - 1;
      const ttsChunk: VoiceTtsChunk = {
        sessionId: session.sessionId,
        turnId,
        chunkIndex: i,
        textChunk: chunks[i],
        isLastChunk: isLast,
        timestamp: new Date().toISOString(),
        waveformBins: [10, 25, 45, 60, 30],
      };

      const chunkEvent: VoiceHostEvent = {
        type: "voice.tts.chunk",
        chunk: ttsChunk,
        at: new Date().toISOString(),
      };
      this._emit(chunkEvent, emittedEvents);
    }

    // Turn complete
    if (!signal.aborted) {
      const turnCompletedEvent: VoiceHostEvent = {
        type: "voice.turn.event",
        turn: {
          sessionId: session.sessionId,
          turnId,
          state: "completed",
          prompt,
          response: responseText,
          tokensUsed: 42,
          latencyMs: 150,
          timestamp: new Date().toISOString(),
        },
        at: new Date().toISOString(),
      };

      session.status = "listening";
      const listeningState: VoiceHostEvent = {
        type: "voice.session.state",
        sessionId: session.sessionId,
        status: "listening",
        at: new Date().toISOString(),
      };

      this._emit(turnCompletedEvent, emittedEvents);
      this._emit(listeningState, emittedEvents);
    }
  }

  private _emit(event: VoiceHostEvent, collection?: VoiceHostEvent[]): void {
    const validated = voiceHostEventSchema.parse(event);
    this.eventLog.push(validated);
    this.wireLog.push({ direction: "s2c", payload: validated, at: new Date().toISOString() });
    if (collection) collection.push(validated);
    for (const listener of this._listeners) {
      listener(validated);
    }
  }

  handleSocketDisconnect(sessionId?: string): void {
    const targetId = sessionId ?? this.activeSessionId;
    if (targetId) {
      const session = this.sessions.get(targetId);
      if (session) {
        session.status = "ended";
        session.endedAt = new Date().toISOString();
        session.endReason = "connection_lost";
      }
    }
    if (this._activeAbortController) {
      this._activeAbortController.abort();
      this._activeAbortController = null;
    }
    this.activeSessionId = null;
  }
}

/* ------------------------------------------------------------------ */
/* 6. Virtual Voice Client & Controller                               */
/* ------------------------------------------------------------------ */

export interface VoiceDialogueTurn {
  turnId: string;
  speaker: "user" | "agent";
  text: string;
  interimText?: string;
  isFinal: boolean;
  interrupted?: boolean;
  timestamp: string;
}

export class VirtualVoiceClient {
  public session: VoiceCallSession | null = null;
  public status: VoiceCallStatus = "idle";
  public isMuted: boolean = false;
  public micGain: number = 1.0;
  public speakerVolume: number = 1.0;
  public durationSeconds: number = 0;
  public isDrawerOpen: boolean = false;

  public transcriptHistory: VoiceDialogueTurn[] = [];
  public currentInterimTranscript: string = "";
  public mainChatHistory: Array<{ role: string; content: string; source?: string }> = [];

  public audio: MockAudioEngine;
  public recognition: MockSpeechRecognition;
  public synthesis: MockSpeechSynthesis;
  public host: VirtualVoiceHost;

  private _durationTimer: any = null;
  private _pendingStartRequestId: string | null = null;

  constructor(host: VirtualVoiceHost) {
    this.host = host;
    this.audio = new MockAudioEngine();
    this.recognition = new MockSpeechRecognition();
    this.synthesis = new MockSpeechSynthesis();

    this._setupEventBridges();
  }

  private _setupEventBridges(): void {
    // Recognition interim / final / VAD bridges
    this.recognition.onresult = (event: any) => {
      if (this.isMuted || this.status === "muted") return;
      const result = event.results[event.resultIndex];
      const text = result[0].transcript;
      if (!text || !text.trim()) return;
      if (result.isFinal) {
        this.currentInterimTranscript = "";
        this._addOrUpdateUserTurn(text, true);
      } else {
        this.currentInterimTranscript = text;
        this._addOrUpdateUserTurn(text, false);
      }
    };

    this.recognition.onVadAutoDispatch = (finalText: string) => {
      if (this.session && this.status !== "muted" && !this.isMuted && this.status !== "ended") {
        this.submitVoicePrompt(finalText);
      }
    };

    // Synthesis idle bridge
    this.synthesis.onIdle = () => {
      if (this.status === "speaking" && !this.isMuted) {
        this.status = "listening";
        this.audio.simulateSpeakerActivity(false);
      }
    };

    // Host event listener
    this.host.addListener((event: VoiceHostEvent) => {
      this.handleHostEvent(event);
    });
  }

  async startCall(profile?: Partial<VoiceProfile>): Promise<void> {
    if (this.status !== "idle" && this.status !== "ended") {
      // Already active, focus drawer
      this.isDrawerOpen = true;
      return;
    }

    this.status = "connecting";
    this.isDrawerOpen = true;
    this.durationSeconds = 0;
    this.transcriptHistory = [];
    this.currentInterimTranscript = "";

    await this.audio.initialize();
    this.recognition.start();

    const requestId = crypto.randomUUID();
    this._pendingStartRequestId = requestId;

    const startMsg: VoiceClientMessage = {
      type: "voice.session.start",
      requestId,
      voiceProfile: profile,
      inputGain: this.micGain,
      outputVolume: this.speakerVolume,
    };

    this.host.handleClientMessage(startMsg);
    this._startDurationTimer();
  }

  endCall(reason: VoiceCallEndReason = "user_hangup"): void {
    if (this.session && this.status !== "ended") {
      const endMsg: VoiceClientMessage = {
        type: "voice.session.end",
        requestId: crypto.randomUUID(),
        sessionId: this.session.sessionId,
        reason,
      };
      this.host.handleClientMessage(endMsg);
    }

    this.status = "ended";
    this._stopDurationTimer();
    this.recognition.stop();
    this.synthesis.cancel();
    this.audio.cleanup();

    // Persist transcript to main chat
    this.persistTranscriptToMainChat();
    this.isDrawerOpen = false;
  }

  toggleMute(): boolean {
    const nextMuted = !this.isMuted;
    this.setMuted(nextMuted);
    return nextMuted;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.audio.setMuted(muted);

    if (this.session) {
      const muteMsg: VoiceClientMessage = {
        type: "voice.session.mute",
        requestId: crypto.randomUUID(),
        sessionId: this.session.sessionId,
        muted,
      };
      this.host.handleClientMessage(muteMsg);
    }
  }

  setMicGain(gain: number): void {
    this.micGain = Math.max(0.0, Math.min(2.0, gain));
    this.audio.setMicGain(this.micGain);
  }

  setSpeakerVolume(volume: number): void {
    this.speakerVolume = Math.max(0.0, Math.min(1.0, volume));
    this.audio.setSpeakerVolume(this.speakerVolume);
  }

  submitVoicePrompt(text: string): void {
    if (!this.session || !text.trim()) return;

    const turnId = crypto.randomUUID();
    this._addOrUpdateUserTurn(text, true, turnId);

    const submitMsg: VoiceClientMessage = {
      type: "voice.transcript.submit",
      requestId: crypto.randomUUID(),
      sessionId: this.session.sessionId,
      turnId,
      text,
      isFinal: true,
    };

    this.host.handleClientMessage(submitMsg);
  }

  interruptAgent(reason: VoiceInterruptReason = "user_manual_button"): void {
    if (!this.session) return;

    // Instant client audio cancel
    this.synthesis.cancel();
    this.audio.simulateSpeakerActivity(false);
    this.status = "listening";

    const interruptMsg: VoiceClientMessage = {
      type: "voice.interrupt",
      requestId: crypto.randomUUID(),
      sessionId: this.session.sessionId,
      turnId: this.session.currentTurnId ?? crypto.randomUUID(),
      reason,
      spokenTextSnippet: this.currentInterimTranscript || undefined,
    };

    this.host.handleClientMessage(interruptMsg);
  }

  handleHostEvent(event: VoiceHostEvent): void {
    switch (event.type) {
      case "voice.session.ready":
        if (event.requestId ? event.requestId === this._pendingStartRequestId : !this.session) {
          this.session = event.session;
          this.status = event.session.status;
          this._pendingStartRequestId = null;
        }
        break;

      case "voice.session.state":
        if (this.session && event.sessionId === this.session.sessionId) {
          if (event.status === "listening" && this.synthesis.speaking) {
            this.status = "speaking";
          } else {
            this.status = event.status;
          }
          if (this.status === "speaking") {
            this.audio.simulateSpeakerActivity(true);
          } else {
            this.audio.simulateSpeakerActivity(false);
          }
        }
        break;

      case "voice.tts.chunk": {
        if (this.session && event.chunk.sessionId === this.session.sessionId) {
          const utterance = new MockSpeechSynthesisUtterance(event.chunk.textChunk);
          utterance.rate = this.session?.voiceProfile.rate ?? 1.0;
          utterance.pitch = this.session?.voiceProfile.pitch ?? 1.0;
          utterance.volume = this.speakerVolume;

          this.status = "speaking";
          this.audio.simulateSpeakerActivity(true);
          this.synthesis.speak(utterance);
          this._addOrUpdateAgentTurn(event.chunk.textChunk, event.chunk.turnId, event.chunk.isLastChunk);
        }
        break;
      }

      case "voice.interrupted": {
        if (this.session && event.frame.sessionId === this.session.sessionId) {
          this.synthesis.cancel();
          this.audio.simulateSpeakerActivity(false);
          const lastTurn = this.transcriptHistory[this.transcriptHistory.length - 1];
          if (lastTurn && lastTurn.speaker === "agent") {
            lastTurn.interrupted = true;
          }
        }
        break;
      }

      case "voice.turn.event": {
        if (this.session && event.turn.sessionId === this.session.sessionId) {
          if (event.turn.state === "completed" && event.turn.response) {
            this._addOrUpdateAgentTurn(event.turn.response, event.turn.turnId, true);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  persistTranscriptToMainChat(): void {
    for (const turn of this.transcriptHistory) {
      if (turn.text && turn.isFinal) {
        this.mainChatHistory.push({
          role: turn.speaker === "user" ? "user" : "assistant",
          content: turn.interrupted ? `${turn.text} [interrupted]` : turn.text,
          source: "voice_call",
        });
      }
    }
  }

  private _addOrUpdateUserTurn(text: string, isFinal: boolean, turnId?: string): void {
    const id = turnId ?? "user-current";
    if (turnId) {
      const pendingCurrent = this.transcriptHistory.find((t) => t.turnId === "user-current");
      if (pendingCurrent) {
        pendingCurrent.turnId = turnId;
        pendingCurrent.text = text;
        pendingCurrent.isFinal = isFinal;
        return;
      }
    }
    const existing = this.transcriptHistory.find((t) => t.turnId === id);
    if (existing) {
      existing.text = text;
      existing.isFinal = isFinal;
    } else {
      this.transcriptHistory.push({
        turnId: id,
        speaker: "user",
        text,
        isFinal,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private _addOrUpdateAgentTurn(text: string, turnId: string, isFinal: boolean): void {
    const existing = this.transcriptHistory.find((t) => t.turnId === turnId && t.speaker === "agent");
    if (existing) {
      if (isFinal) {
        existing.text = text;
        existing.isFinal = true;
      } else {
        existing.text = existing.text ? `${existing.text} ${text}` : text;
      }
    } else {
      this.transcriptHistory.push({
        turnId,
        speaker: "agent",
        text,
        isFinal,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private _startDurationTimer(): void {
    this._stopDurationTimer();
    this._durationTimer = setInterval(() => {
      this.durationSeconds += 1;
    }, 1000);
  }

  private _stopDurationTimer(): void {
    if (this._durationTimer) {
      clearInterval(this._durationTimer);
      this._durationTimer = null;
    }
  }

  dispose(): void {
    this.endCall("user_hangup");
  }
}

/* ------------------------------------------------------------------ */
/* 7. Unified Test Harness Factory & Class                            */
/* ------------------------------------------------------------------ */

export interface VoiceTestHarnessOptions {
  autoRespond?: boolean;
  defaultResponseGenerator?: (prompt: string) => string;
}

export class VoiceTestHarness {
  public host: VirtualVoiceHost;
  public client: VirtualVoiceClient;

  constructor(options: VoiceTestHarnessOptions = {}) {
    this.host = new VirtualVoiceHost(options);
    this.client = new VirtualVoiceClient(this.host);
  }

  get audio(): MockAudioEngine {
    return this.client.audio;
  }

  get recognition(): MockSpeechRecognition {
    return this.client.recognition;
  }

  get synthesis(): MockSpeechSynthesis {
    return this.client.synthesis;
  }

  /* Fluent Assertion Helpers */
  assertStatus(expected: VoiceCallStatus): void {
    if (this.client.status !== expected) {
      throw new Error(`Expected client status '${expected}', but got '${this.client.status}'`);
    }
  }

  assertMuted(expected: boolean): void {
    if (this.client.isMuted !== expected) {
      throw new Error(`Expected isMuted to be ${expected}, but got ${this.client.isMuted}`);
    }
  }

  assertHostEventCount(type: string, expectedCount: number): void {
    const count = this.host.eventLog.filter((e) => e.type === type).length;
    if (count !== expectedCount) {
      throw new Error(`Expected ${expectedCount} events of type '${type}', but found ${count}`);
    }
  }

  assertLastHostEvent(type: string): void {
    const last = this.host.eventLog[this.host.eventLog.length - 1];
    if (!last || last.type !== type) {
      throw new Error(`Expected last host event to be '${type}', but got '${last?.type}'`);
    }
  }

  assertTranscriptContains(text: string): void {
    const found = this.client.transcriptHistory.some((t) => t.text.includes(text));
    if (!found) {
      throw new Error(`Expected transcript history to contain "${text}", but was not found`);
    }
  }

  assertMainChatContains(text: string): void {
    const found = this.client.mainChatHistory.some((m) => m.content.includes(text));
    if (!found) {
      throw new Error(`Expected main chat history to contain "${text}", but was not found`);
    }
  }

  dispose(): void {
    this.client.dispose();
  }
}

export function createVoiceTestHarness(options?: VoiceTestHarnessOptions): VoiceTestHarness {
  return new VoiceTestHarness(options);
}
