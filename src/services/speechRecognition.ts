/**
 * SpeechRecognitionService
 * Web Speech API continuous speech recognition with streaming interim transcripts,
 * VAD pause auto-dispatch (1400ms default), instant TTS barge-in hooks, and headless simulation seam.
 */

export interface SpeechRecognitionOptions {
  lang?: string; // default: "en-US"
  continuous?: boolean; // default: true
  interimResults?: boolean; // default: true
  silenceTimeoutMs?: number; // default: 1400ms
  onInterimResult?: (interimText: string) => void;
  onFinalResult?: (finalText: string) => void;
  onSpeechStart?: () => void; // Used for TTS Barge-in
  onSpeechEnd?: () => void;
  onAutoDispatch?: (fullPrompt: string) => void;
  onError?: (error: unknown) => void;
}

export interface ISpeechRecognitionService {
  readonly isSupported: boolean;
  readonly isListening: boolean;
  readonly transcript: string;
  readonly interimText: string;
  readonly finalText: string;

  start(): void;
  stop(): void;
  resetTranscript(): void;
  simulateTranscript(text: string, isFinal?: boolean): void; // Fallback / Testing seam
}

interface SpeechRecognitionItem {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  0?: SpeechRecognitionItem;
  length: number;
  isFinal?: boolean;
}

interface SpeechRecognitionEventLike {
  results?: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex?: number;
}

interface SpeechRecognitionErrorLike {
  error?: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

export class SpeechRecognitionService implements ISpeechRecognitionService {
  private recognition: SpeechRecognitionInstance | null = null;
  private options: SpeechRecognitionOptions;

  private _isListening = false;
  private _isExplicitlyStopped = true;
  private _isUserSpeaking = false;

  private _committedFinalText = "";
  private _currentSessionFinalText = "";
  private _interimText = "";
  private _finalText = "";
  private _transcript = "";

  private _silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SpeechRecognitionOptions = {}) {
    this.options = {
      lang: "en-US",
      continuous: true,
      interimResults: true,
      silenceTimeoutMs: 1400,
      ...options,
    };

    this.initRecognition();
  }

  public get isSupported(): boolean {
    if (typeof window === "undefined") return false;
    const win = window as unknown as WindowWithSpeechRecognition;
    return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  public get isListening(): boolean {
    return this._isListening;
  }

  public get transcript(): string {
    return this._transcript;
  }

  public get interimText(): string {
    return this._interimText;
  }

  public get finalText(): string {
    return this._finalText;
  }

  private initRecognition(): void {
    if (!this.isSupported) return;

    try {
      const win = window as unknown as WindowWithSpeechRecognition;
      const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

      if (!SpeechRecognitionClass) return;

      const recognition = new SpeechRecognitionClass();
      recognition.continuous = this.options.continuous ?? true;
      recognition.interimResults = this.options.interimResults ?? true;
      recognition.lang = this.options.lang ?? "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this._isListening = true;
      };

      recognition.onspeechstart = () => {
        this.handleSpeechStart();
      };

      recognition.onspeechend = () => {
        this.handleSpeechEnd();
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        this.handleResult(event);
      };

      recognition.onerror = (event: SpeechRecognitionErrorLike) => {
        this.handleError(event);
      };

      recognition.onend = () => {
        this.handleEnd();
      };

      this.recognition = recognition;
    } catch (err) {
      this.options.onError?.(err);
    }
  }

  public start(): void {
    if (this._isListening) return;

    this._isExplicitlyStopped = false;
    this.clearRestartTimer();

    if (!this.recognition) {
      this.initRecognition();
    }

    if (this.recognition) {
      try {
        this.recognition.start();
        this._isListening = true;
      } catch (err: unknown) {
        if (err && typeof err === "object" && "name" in err && err.name !== "InvalidStateError") {
          this.options.onError?.(err);
        }
      }
    } else {
      this._isListening = true;
    }
  }

  public stop(): void {
    this._isExplicitlyStopped = true;
    this._isListening = false;
    this._isUserSpeaking = false;

    this.clearSilenceTimer();
    this.clearRestartTimer();

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore if already stopped
      }
    }
  }

  public resetTranscript(): void {
    this.clearSilenceTimer();
    this._committedFinalText = "";
    this._currentSessionFinalText = "";
    this._interimText = "";
    this._finalText = "";
    this._transcript = "";
    this._isUserSpeaking = false;
  }

  public simulateTranscript(text: string, isFinal: boolean = true): void {
    const trimmed = text.trim();
    if (!trimmed && isFinal) return;

    // 1. Trigger speech start if starting new utterance
    if (!this._isUserSpeaking) {
      this.handleSpeechStart();
    }

    // 2. Clear any pending silence timeout while speech arrives
    this.clearSilenceTimer();

    // 3. Accumulate text
    if (isFinal) {
      this._committedFinalText = [this._committedFinalText, trimmed]
        .filter(Boolean)
        .join(" ");
      this._interimText = "";
      this._finalText = this._committedFinalText;
      this._transcript = this._finalText;

      this.options.onFinalResult?.(this._finalText);
      this.handleSpeechEnd();
    } else {
      this._interimText = trimmed;
      this._transcript = [this._finalText, this._interimText]
        .filter(Boolean)
        .join(" ");

      this.options.onInterimResult?.(this._interimText);
      // Restart silence timer even for interim updates to catch speech pause
      this.armSilenceTimer();
    }
  }

  private handleSpeechStart(): void {
    this._isUserSpeaking = true;
    this.clearSilenceTimer();
    this.options.onSpeechStart?.();
  }

  private handleSpeechEnd(): void {
    this._isUserSpeaking = false;
    this.options.onSpeechEnd?.();
    this.armSilenceTimer();
  }

  private handleResult(event: SpeechRecognitionEventLike): void {
    if (!this._isUserSpeaking) {
      this.handleSpeechStart();
    }

    this.clearSilenceTimer();

    let sessionFinal = "";
    let interim = "";

    const results = event.results || [];
    const len = results.length;
    for (let i = 0; i < len; ++i) {
      const item = results[i];
      if (!item) continue;
      const text = item[0]?.transcript || "";
      if (item.isFinal) {
        sessionFinal += (sessionFinal ? " " : "") + text.trim();
      } else {
        interim += (interim ? " " : "") + text.trim();
      }
    }

    this._currentSessionFinalText = sessionFinal;
    this._interimText = interim;

    const combinedFinal = [this._committedFinalText, this._currentSessionFinalText]
      .filter(Boolean)
      .join(" ")
      .trim();

    this._finalText = combinedFinal;
    this._transcript = [this._finalText, this._interimText]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (interim) {
      this.options.onInterimResult?.(interim);
    }
    if (combinedFinal && sessionFinal) {
      this.options.onFinalResult?.(combinedFinal);
    }

    this.armSilenceTimer();
  }

  private handleError(event: SpeechRecognitionErrorLike): void {
    const errorType = event?.error || "unknown";

    // Non-fatal errors in continuous mode
    if (errorType === "no-speech" || errorType === "aborted") {
      return;
    }

    // Permission denied or system blocked
    if (errorType === "not-allowed" || errorType === "service-not-allowed") {
      this._isListening = false;
      this._isExplicitlyStopped = true;
      this.clearSilenceTimer();
      this.options.onError?.(event);
      return;
    }

    this.options.onError?.(event);
  }

  private handleEnd(): void {
    // If recognition ended during active session, commit session text and auto-restart
    if (this._currentSessionFinalText) {
      this._committedFinalText = [this._committedFinalText, this._currentSessionFinalText]
        .filter(Boolean)
        .join(" ");
      this._currentSessionFinalText = "";
    }

    if (this._isListening && !this._isExplicitlyStopped) {
      this.clearRestartTimer();
      this._restartTimer = setTimeout(() => {
        if (this._isListening && !this._isExplicitlyStopped && this.recognition) {
          try {
            this.recognition.start();
          } catch {
            // Handled on next cycle
          }
        }
      }, 100);
    } else {
      this._isListening = false;
    }
  }

  private armSilenceTimer(): void {
    this.clearSilenceTimer();
    const timeoutMs = this.options.silenceTimeoutMs ?? 1400;

    this._silenceTimer = setTimeout(() => {
      this.handleSilenceTimeout();
    }, timeoutMs);
  }

  private clearSilenceTimer(): void {
    if (this._silenceTimer !== null) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  private clearRestartTimer(): void {
    if (this._restartTimer !== null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
  }

  private handleSilenceTimeout(): void {
    this._silenceTimer = null;
    const promptToDispatch = this._transcript.trim();

    if (promptToDispatch.length > 0) {
      this.options.onAutoDispatch?.(promptToDispatch);
      this.resetTranscript();
    }
  }
}

export const speechRecognitionService = new SpeechRecognitionService();
