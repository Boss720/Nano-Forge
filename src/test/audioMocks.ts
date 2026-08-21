// @vitest-environment jsdom
import { vi } from "vitest";

export interface MockAudioOptions {
  autoCompleteTTS?: boolean;
  ttsDelayMs?: number;
  initialVoices?: SpeechSynthesisVoice[];
}

export class MockAudioParam {
  public value: number = 1.0;
  public setValueAtTime = vi.fn((val: number, _time?: number) => {
    this.value = val;
  });
  public linearRampToValueAtTime = vi.fn((val: number, _time?: number) => {
    this.value = val;
  });
  public exponentialRampToValueAtTime = vi.fn((val: number, _time?: number) => {
    this.value = val;
  });

  constructor(defaultValue: number = 1.0) {
    this.value = defaultValue;
  }
}

export class MockGainNode {
  public gain = new MockAudioParam(1.0);
  public destination: unknown = null;

  public connect = vi.fn((target: unknown) => {
    this.destination = target;
    return target;
  });

  public disconnect = vi.fn(() => {
    this.destination = null;
  });

  constructor(defaultValue: number = 1.0) {
    this.gain = new MockAudioParam(defaultValue);
  }
}

export class MockAnalyserNode {
  private _fftSize: number = 128;
  public smoothingTimeConstant: number = 0.8;
  public minDecibels: number = -90;
  public maxDecibels: number = -10;
  public destination: unknown = null;
  private _mockTimeData: Uint8Array | null = null;
  private _mockFreqData: Uint8Array | null = null;

  public get fftSize(): number {
    return this._fftSize;
  }
  public set fftSize(val: number) {
    this._fftSize = val;
  }
  public get frequencyBinCount(): number {
    return this._fftSize / 2;
  }

  public setMockData(timeData?: Uint8Array, freqData?: Uint8Array): void {
    if (timeData) this._mockTimeData = timeData;
    if (freqData) this._mockFreqData = freqData;
  }

  public setMockTimeDomainData(data: Uint8Array | number[]): void {
    this._mockTimeData = new Uint8Array(data);
  }

  public setMockFrequencyData(data: Uint8Array | number[]): void {
    this._mockFreqData = new Uint8Array(data);
  }

  public getByteTimeDomainData(array: Uint8Array): void {
    if (this._mockTimeData) {
      array.set(this._mockTimeData.subarray(0, array.length));
    } else {
      // Default to silence (128 = 0 amplitude in unsigned byte PCM)
      array.fill(128);
    }
  }

  public getByteFrequencyData(array: Uint8Array): void {
    if (this._mockFreqData) {
      array.set(this._mockFreqData.subarray(0, array.length));
    } else {
      // Default to silence (0)
      array.fill(0);
    }
  }

  public connect = vi.fn((target: unknown) => {
    this.destination = target;
    return target;
  });

  public disconnect = vi.fn(() => {
    this.destination = null;
  });
}

export class MockMediaStreamAudioSourceNode {
  public mediaStream: MediaStream | MockMediaStream;
  public destination: unknown = null;
  public connect = vi.fn((target: unknown) => {
    this.destination = target;
    return target;
  });
  public disconnect = vi.fn(() => {
    this.destination = null;
  });
  constructor(mediaStream: MediaStream | MockMediaStream) {
    this.mediaStream = mediaStream;
  }
}

export class MockAudioDestinationNode {
  public maxChannelCount: number = 2;
}

export class MockAudioContext {
  public state: AudioContextState = "suspended";
  public sampleRate: number = 44100;
  public currentTime: number = 0;
  public destination = new MockAudioDestinationNode();

  public createGain = vi.fn(() => new MockGainNode());
  public createAnalyser = vi.fn(() => new MockAnalyserNode());
  public createMediaStreamSource = vi.fn(
    (stream: MediaStream | MockMediaStream) => new MockMediaStreamAudioSourceNode(stream)
  );

  public resume = vi.fn(async () => {
    this.state = "running";
  });

  public suspend = vi.fn(async () => {
    this.state = "suspended";
  });

  public close = vi.fn(async () => {
    this.state = "closed";
  });
}

export class MockMediaStreamTrack {
  public id: string = "mock-track-" + Math.random().toString(36).substring(7);
  public kind: string = "audio";
  public enabled: boolean = true;
  public muted: boolean = false;
  public readyState: "live" | "ended" = "live";

  public stop = vi.fn(() => {
    this.readyState = "ended";
  });
}

export class MockMediaStream {
  public id: string = "mock-stream-" + Math.random().toString(36).substring(7);
  private _tracks: MockMediaStreamTrack[];

  constructor(tracks?: MockMediaStreamTrack[]) {
    this._tracks = tracks && tracks.length > 0 ? tracks : [new MockMediaStreamTrack()];
  }

  public get active(): boolean {
    return this._tracks.some((t) => t.readyState === "live");
  }

  public getTracks(): MockMediaStreamTrack[] {
    return [...this._tracks];
  }

  public getAudioTracks(): MockMediaStreamTrack[] {
    return this._tracks.filter((t) => t.kind === "audio");
  }

  public getVideoTracks(): MockMediaStreamTrack[] {
    return this._tracks.filter((t) => t.kind === "video");
  }

  public addTrack(track: MockMediaStreamTrack): void {
    this._tracks.push(track);
  }

  public removeTrack(track: MockMediaStreamTrack): void {
    this._tracks = this._tracks.filter((t) => t !== track);
  }
}

export interface MockSpeechRecognitionResultItem {
  transcript: string;
  confidence?: number;
}

export interface MockSpeechRecognitionResultList {
  0: MockSpeechRecognitionResultItem;
  length: number;
  isFinal?: boolean;
}

export class MockSpeechRecognitionEvent {
  public type: string;
  public resultIndex: number;
  public results: MockSpeechRecognitionResultList[];
  constructor(type: string, initDict: { resultIndex: number; results: MockSpeechRecognitionResultList[] }) {
    this.type = type;
    this.resultIndex = initDict.resultIndex;
    this.results = initDict.results;
  }
}

export class MockSpeechRecognition {
  public static lastInstance: MockSpeechRecognition | null = null;
  public continuous: boolean = true;
  public interimResults: boolean = true;
  public lang: string = "en-US";
  public maxAlternatives: number = 1;

  public onstart: ((ev: Event) => void) | null = null;
  public onend: ((ev: Event) => void) | null = null;
  public onspeechstart: ((ev: Event) => void) | null = null;
  public onspeechend: ((ev: Event) => void) | null = null;
  public onresult: ((ev: MockSpeechRecognitionEvent) => void) | null = null;
  public onerror: ((ev: { error: string; message?: string }) => void) | null = null;

  public isRunning: boolean = false;

  constructor() {
    MockSpeechRecognition.lastInstance = this;
  }

  public start = vi.fn(() => {
    this.isRunning = true;
    if (this.onstart) {
      this.onstart(new Event("start"));
    }
  });

  public stop = vi.fn(() => {
    this.isRunning = false;
    if (this.onspeechend) {
      this.onspeechend(new Event("speechend"));
    }
    if (this.onend) {
      this.onend(new Event("end"));
    }
  });

  public abort = vi.fn(() => {
    this.isRunning = false;
    if (this.onend) {
      this.onend(new Event("end"));
    }
  });

  // Test triggers
  public emitSpeechStart(): void {
    if (this.onspeechstart) {
      this.onspeechstart(new Event("speechstart"));
    }
  }

  public emitSpeechEnd(): void {
    if (this.onspeechend) {
      this.onspeechend(new Event("speechend"));
    }
  }

  public emitResult(
    input:
      | string
      | Array<{ transcript: string; isFinal?: boolean; confidence?: number }>,
    isFinalParam: boolean = true
  ): void {
    let results: MockSpeechRecognitionResultList[];
    if (typeof input === "string") {
      const resultItem: [MockSpeechRecognitionResultItem] & { isFinal?: boolean } = [
        { transcript: input, confidence: 0.95 },
      ];
      resultItem.isFinal = isFinalParam;
      results = [resultItem];
    } else {
      results = input.map((item) => {
        const alt: [MockSpeechRecognitionResultItem] & { isFinal?: boolean } = [
          { transcript: item.transcript, confidence: item.confidence ?? 0.95 },
        ];
        const isFinal = item.isFinal !== undefined ? item.isFinal : isFinalParam;
        alt.isFinal = Boolean(isFinal);
        return alt;
      });
    }

    if (this.onresult) {
      this.onresult(
        new MockSpeechRecognitionEvent("result", {
          resultIndex: 0,
          results,
        })
      );
    }
  }

  public emitError(error: string, message = "Speech recognition error"): void {
    if (this.onerror) {
      this.onerror({ error, message });
    }
  }

  public emitEnd(): void {
    this.isRunning = false;
    if (this.onend) {
      this.onend(new Event("end"));
    }
  }
}

export interface MockSpeechSynthesisEventLike {
  type: string;
  utterance?: MockSpeechSynthesisUtterance;
}

export interface MockSpeechSynthesisErrorEventLike {
  type: string;
  error: string;
  utterance?: MockSpeechSynthesisUtterance;
}

export class MockSpeechSynthesisUtterance {
  public text: string;
  public lang: string = "en-US";
  public voice: SpeechSynthesisVoice | null = null;
  public volume: number = 1.0;
  public rate: number = 1.0;
  public pitch: number = 1.0;

  public onstart: ((ev: MockSpeechSynthesisEventLike) => void) | null = null;
  public onend: ((ev: MockSpeechSynthesisEventLike) => void) | null = null;
  public onerror: ((ev: MockSpeechSynthesisErrorEventLike) => void) | null = null;
  public onpause: ((ev: MockSpeechSynthesisEventLike) => void) | null = null;
  public onresume: ((ev: MockSpeechSynthesisEventLike) => void) | null = null;

  constructor(text: string = "") {
    this.text = text;
  }
}

export type MockEventListener = (event: Event) => void;

export class MockSpeechSynthesis {
  public static lastInstance: MockSpeechSynthesis | null = null;
  public speaking: boolean = false;
  public paused: boolean = false;
  public pending: boolean = false;
  public onvoiceschanged: ((ev: Event) => void) | null = null;

  public autoComplete: boolean = true;
  public ttsDelayMs: number = 0;
  public spokenUtterances: MockSpeechSynthesisUtterance[] = [];
  private _voices: SpeechSynthesisVoice[] = [];
  private _listeners: Map<string, Set<MockEventListener>> = new Map();

  constructor(options?: MockAudioOptions) {
    MockSpeechSynthesis.lastInstance = this;
    if (options?.autoCompleteTTS !== undefined) {
      this.autoComplete = options.autoCompleteTTS;
    }
    if (options?.ttsDelayMs !== undefined) {
      this.ttsDelayMs = options.ttsDelayMs;
    }
    this._voices = options?.initialVoices || [
      {
        voiceURI: "Google US English",
        name: "Google US English",
        lang: "en-US",
        localService: false,
        default: true,
      } as SpeechSynthesisVoice,
      {
        voiceURI: "Samantha",
        name: "Samantha",
        lang: "en-US",
        localService: true,
        default: false,
      } as SpeechSynthesisVoice,
    ];
  }

  public getVoices = vi.fn((): SpeechSynthesisVoice[] => [...this._voices]);

  public setVoices(voices: SpeechSynthesisVoice[]): void {
    this._voices = [...voices];
    if (this.onvoiceschanged) {
      this.onvoiceschanged(new Event("voiceschanged"));
    }
    this.dispatchEvent(new Event("voiceschanged"));
  }

  public speak = vi.fn((utterance: MockSpeechSynthesisUtterance) => {
    this.spokenUtterances.push(utterance);
    this.speaking = true;

    if (utterance.onstart) {
      utterance.onstart({ type: "start", utterance });
    }

    if (this.autoComplete) {
      if (this.ttsDelayMs > 0) {
        setTimeout(() => {
          if (this.speaking) {
            this.speaking = false;
            if (utterance.onend) utterance.onend({ type: "end", utterance });
          }
        }, this.ttsDelayMs);
      } else {
        queueMicrotask(() => {
          if (this.speaking) {
            this.speaking = false;
            if (utterance.onend) utterance.onend({ type: "end", utterance });
          }
        });
      }
    }
  });

  public cancel = vi.fn(() => {
    this.speaking = false;
    this.paused = false;
    const current = this.spokenUtterances[this.spokenUtterances.length - 1];
    if (current && current.onerror) {
      current.onerror({ error: "canceled", type: "error" });
    }
  });

  public pause = vi.fn(() => {
    this.paused = true;
  });

  public resume = vi.fn(() => {
    this.paused = false;
  });

  public addEventListener(event: string, cb: MockEventListener): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(cb);
  }

  public removeEventListener(event: string, cb: MockEventListener): void {
    this._listeners.get(event)?.delete(cb);
  }

  public dispatchEvent(event: Event): boolean {
    this._listeners.get(event.type)?.forEach((cb) => cb(event));
    return true;
  }
}

export function setupAudioMocks(options?: MockAudioOptions) {
  const globalObj = globalThis as unknown as Record<string, unknown>;
  const originalAudioContext = globalObj.AudioContext;
  const originalWebkitAudioContext = globalObj.webkitAudioContext;
  const originalGetUserMedia = typeof navigator !== "undefined" ? navigator.mediaDevices?.getUserMedia : undefined;
  const originalSpeechRecognition = globalObj.SpeechRecognition;
  const originalWebkitSpeechRecognition = globalObj.webkitSpeechRecognition;
  const originalSpeechSynthesis = globalObj.speechSynthesis;
  const originalSpeechSynthesisUtterance = globalObj.SpeechSynthesisUtterance;

  globalObj.AudioContext = MockAudioContext;
  globalObj.webkitAudioContext = MockAudioContext;

  if (typeof navigator !== "undefined") {
    if (!navigator.mediaDevices) {
      (navigator as unknown as { mediaDevices: Partial<MediaDevices> }).mediaDevices = {};
    }
    navigator.mediaDevices.getUserMedia = vi.fn(
      async () => new MockMediaStream() as unknown as MediaStream
    );
  }

  globalObj.SpeechRecognition = MockSpeechRecognition;
  globalObj.webkitSpeechRecognition = MockSpeechRecognition;

  const mockSynthesis = new MockSpeechSynthesis(options);
  globalObj.speechSynthesis = mockSynthesis;
  globalObj.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

  return {
    mockAudioContext: MockAudioContext,
    mockSpeechRecognition: MockSpeechRecognition,
    mockSpeechSynthesis: mockSynthesis,
    restore: () => {
      globalObj.AudioContext = originalAudioContext;
      globalObj.webkitAudioContext = originalWebkitAudioContext;
      if (typeof navigator !== "undefined" && navigator.mediaDevices) {
        if (originalGetUserMedia) {
          navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        } else {
          delete (navigator.mediaDevices as unknown as { getUserMedia?: unknown }).getUserMedia;
        }
      }
      globalObj.SpeechRecognition = originalSpeechRecognition;
      globalObj.webkitSpeechRecognition = originalWebkitSpeechRecognition;
      globalObj.speechSynthesis = originalSpeechSynthesis;
      globalObj.SpeechSynthesisUtterance = originalSpeechSynthesisUtterance;
    },
  };
}

export function resetAudioMocks(): void {
  vi.clearAllMocks();
  vi.clearAllTimers();
  MockSpeechRecognition.lastInstance = null;
  MockSpeechSynthesis.lastInstance = null;
}

export function cleanupAudioMocks(): void {
  resetAudioMocks();
}
