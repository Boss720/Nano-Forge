/**
 * Speech Synthesis Service for NanoForge Interactive Audio Call System
 * Wraps window.speechSynthesis and window.SpeechSynthesisUtterance with:
 * - Robust voice enumeration and asynchronous voice loading
 * - Sentence boundary chunking engine for long assistant responses (>150 chars)
 * - Immediate barge-in cancellation and queue reset
 * - Settings validation and clamping (voiceURI, rate, pitch, volume)
 * - Chrome GC bug prevention via strong utterance anchoring
 */

export interface TTSSettings {
  voiceURI: string | null;
  rate: number; // 0.5 to 2.0 (default: 1.0)
  pitch: number; // 0.5 to 1.5 (default: 1.0)
  volume: number; // 0.0 to 1.0 (default: 1.0)
}

export type TTSEventCallback = (...args: unknown[]) => void;

export interface ISpeechSynthesisService {
  readonly isSupported: boolean;
  readonly isSpeaking: boolean;
  readonly voices: SpeechSynthesisVoice[];
  readonly settings: TTSSettings;
  readonly activeUtterance: SpeechSynthesisUtterance | null;

  updateSettings(settings: Partial<TTSSettings>): void;
  speak(text: string): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): SpeechSynthesisVoice[];
  on(event: string, callback: TTSEventCallback): () => void;
  off(event: string, callback: TTSEventCallback): void;
}

interface SpeechSynthesisErrorEventLike {
  error?: string;
  type?: string;
}

/**
 * Splits text into conversational utterance chunks:
 * 1. Split on sentence boundaries (. ! ? \n)
 * 2. If chunk > maxChunkLength (150 chars), split on clause boundaries (, ; : —)
 * 3. If clause > maxChunkLength, split on word boundaries (whitespace)
 * 4. Filter empty/whitespace chunks
 */
export function chunkTextForSpeech(text: string, maxChunkLength = 150): string[] {
  if (!text || !text.trim()) return [];

  const normalized = text.trim();

  // 1. Split by sentence boundaries (. ! ? \n)
  const sentenceRegex = /[^.!?\n]+[.!?\n]*/g;
  const rawSentences = normalized.match(sentenceRegex) || [normalized];
  const chunks: string[] = [];

  for (const rawSentence of rawSentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    if (sentence.length <= maxChunkLength) {
      chunks.push(sentence);
    } else {
      // 2. Split by clause boundaries (, ; : —)
      const clauseRegex = /[^,;:—]+[,;:—]*/g;
      const rawClauses = sentence.match(clauseRegex) || [sentence];

      for (const rawClause of rawClauses) {
        const clause = rawClause.trim();
        if (!clause) continue;

        if (clause.length <= maxChunkLength) {
          chunks.push(clause);
        } else {
          // 3. Split by word boundaries
          const words = clause.split(/\s+/);
          let currentChunk = "";

          for (const word of words) {
            if (!word) continue;
            const candidate = currentChunk ? `${currentChunk} ${word}` : word;
            if (candidate.length <= maxChunkLength) {
              currentChunk = candidate;
            } else {
              if (currentChunk) chunks.push(currentChunk);
              currentChunk = word;
            }
          }
          if (currentChunk) {
            chunks.push(currentChunk);
          }
        }
      }
    }
  }

  return chunks.length > 0 ? chunks : [normalized];
}

export class SpeechSynthesisService implements ISpeechSynthesisService {
  private _isSupported: boolean = false;
  private _isSpeaking: boolean = false;
  private _voices: SpeechSynthesisVoice[] = [];
  private _settings: TTSSettings = {
    voiceURI: null,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
  };
  private _chunkQueue: string[] = [];
  private _activeResolve: (() => void) | null = null;
  private _activeReject: ((err: unknown) => void) | null = null;
  private _isCancelled: boolean = false;
  private _activeUtteranceRef: SpeechSynthesisUtterance | null = null;
  private _listeners: Map<string, Set<TTSEventCallback>> = new Map();

  constructor() {
    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window
    ) {
      this._isSupported = true;
      this.initVoices();
    }
  }

  private initVoices(): void {
    if (!this._isSupported) return;

    this.refreshVoices();
    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        this.refreshVoices();
      });
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        this.refreshVoices();
      };
    }
  }

  private refreshVoices(): void {
    if (!this._isSupported) return;
    try {
      this._voices = window.speechSynthesis.getVoices() || [];
      this.emit("voiceschanged", this._voices);
    } catch {
      this._voices = [];
    }
  }

  public get isSupported(): boolean {
    return this._isSupported;
  }

  public get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  public get voices(): SpeechSynthesisVoice[] {
    return this._voices;
  }

  public get settings(): TTSSettings {
    return { ...this._settings };
  }

  public get activeUtterance(): SpeechSynthesisUtterance | null {
    return this._activeUtteranceRef;
  }

  public getVoices(): SpeechSynthesisVoice[] {
    if (!this._isSupported) return [];
    this.refreshVoices();
    return this._voices;
  }

  public updateSettings(settings: Partial<TTSSettings>): void {
    if (settings.rate !== undefined) {
      this._settings.rate = Math.max(0.5, Math.min(2.0, Number(settings.rate) || 1.0));
    }
    if (settings.pitch !== undefined) {
      this._settings.pitch = Math.max(0.5, Math.min(1.5, Number(settings.pitch) || 1.0));
    }
    if (settings.volume !== undefined) {
      this._settings.volume = Math.max(0.0, Math.min(1.0, Number(settings.volume) ?? 1.0));
    }
    if (settings.voiceURI !== undefined) {
      this._settings.voiceURI = settings.voiceURI;
    }
    this.emit("settingschanged", this.settings);
  }

  public async speak(text: string): Promise<void> {
    if (!this._isSupported) return;

    // Immediately cancel any in-flight playback before starting new text
    if (this._isSpeaking) {
      this.cancel();
    }
    this._isCancelled = false;

    const chunks = chunkTextForSpeech(text);
    if (chunks.length === 0) return;

    this._chunkQueue = [...chunks];
    this._isSpeaking = true;
    this.emit("start");

    return new Promise<void>((resolve, reject) => {
      this._activeResolve = resolve;
      this._activeReject = reject;
      this.playNextChunk();
    });
  }

  private playNextChunk(): void {
    if (this._isCancelled || this._chunkQueue.length === 0) {
      this.finishSpeech();
      return;
    }

    const chunk = this._chunkQueue.shift();
    if (!chunk) {
      this.finishSpeech();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunk);
    this._activeUtteranceRef = utterance; // Retain GC anchor

    utterance.rate = this._settings.rate;
    utterance.pitch = this._settings.pitch;
    utterance.volume = this._settings.volume;

    if (this._settings.voiceURI) {
      const voice = this._voices.find((v) => v.voiceURI === this._settings.voiceURI);
      if (voice) {
        utterance.voice = voice;
      }
    }

    utterance.onstart = () => {
      this.emit("chunkstart", chunk);
    };

    utterance.onend = () => {
      this._activeUtteranceRef = null;
      if (this._isCancelled) {
        this.finishSpeech();
      } else {
        this.playNextChunk();
      }
    };

    utterance.onerror = (event: SpeechSynthesisErrorEventLike) => {
      this._activeUtteranceRef = null;
      if (
        event?.error === "canceled" ||
        event?.error === "interrupted" ||
        this._isCancelled
      ) {
        this.finishSpeech();
      } else {
        this.finishSpeech(new Error(`SpeechSynthesis error: ${event?.error || "unknown"}`));
      }
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      this.finishSpeech(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public cancel(): void {
    const wasSpeaking = this._isSpeaking;
    this._isCancelled = true;
    this._chunkQueue = [];

    if (this._isSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancel errors
      }
    }

    this.finishSpeech();
    if (wasSpeaking) {
      this.emit("cancel");
    }
  }

  public pause(): void {
    if (this._isSupported && this._isSpeaking) {
      try {
        window.speechSynthesis.pause();
        this.emit("pause");
      } catch {
        // Ignore pause errors
      }
    }
  }

  public resume(): void {
    if (this._isSupported && this._isSpeaking) {
      try {
        window.speechSynthesis.resume();
        this.emit("resume");
      } catch {
        // Ignore resume errors
      }
    }
  }

  private finishSpeech(error?: Error): void {
    const wasSpeaking = this._isSpeaking;
    this._isSpeaking = false;
    this._activeUtteranceRef = null;

    const resolve = this._activeResolve;
    const reject = this._activeReject;
    this._activeResolve = null;
    this._activeReject = null;

    if (error && reject) {
      reject(error);
    } else if (resolve) {
      resolve();
    }

    if (wasSpeaking) {
      this.emit("end");
    }
  }

  public on(event: string, callback: TTSEventCallback): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  public off(event: string, callback: TTSEventCallback): void {
    this._listeners.get(event)?.delete(callback);
  }

  private emit(event: string, ...args: unknown[]): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`Error in SpeechSynthesisService event listener [${event}]:`, err);
        }
      }
    }
  }
}

export const speechSynthesisService = new SpeechSynthesisService();
