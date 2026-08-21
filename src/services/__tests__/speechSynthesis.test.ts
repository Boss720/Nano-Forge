// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SpeechSynthesisService, chunkTextForSpeech } from "../speechSynthesis";
import { setupAudioMocks, resetAudioMocks } from "@/test/audioMocks";

describe("SpeechSynthesisService & Chunking Engine", () => {
  let mocks: ReturnType<typeof setupAudioMocks>;
  let service: SpeechSynthesisService;

  beforeEach(() => {
    mocks = setupAudioMocks({ autoCompleteTTS: true });
    service = new SpeechSynthesisService();
  });

  afterEach(() => {
    resetAudioMocks();
    mocks.restore();
  });

  describe("Sentence Boundary Chunking Engine (chunkTextForSpeech)", () => {
    it("returns empty array for empty or whitespace text", () => {
      expect(chunkTextForSpeech("")).toEqual([]);
      expect(chunkTextForSpeech("   \n\t  ")).toEqual([]);
    });

    it("keeps short sentences as single chunks", () => {
      const text = "Hello, how are you?";
      expect(chunkTextForSpeech(text)).toEqual(["Hello, how are you?"]);
    });

    it("splits multiple sentences on standard punctuation (. ! ? \n)", () => {
      const text = "Hello world! How are you today? I am your AI assistant.\nReady to help.";
      const chunks = chunkTextForSpeech(text);
      expect(chunks).toEqual([
        "Hello world!",
        "How are you today?",
        "I am your AI assistant.",
        "Ready to help.",
      ]);
    });

    it("subdivides long sentences (>150 chars) along clause boundaries (commas/semicolons/em-dashes)", () => {
      const longSentence =
        "This is an intentionally verbose sentence designed to exceed the maximum character limit of one hundred and fifty characters, and it features several distinct clauses; in addition: it tests em-dashes — so we can ensure clause-level partitioning functions properly.";
      const chunks = chunkTextForSpeech(longSentence, 100);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });

    it("subdivides long sentences without punctuation along word boundaries", () => {
      const longRunOn =
        "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24 word25 word26 word27 word28 word29 word30";
      const chunks = chunkTextForSpeech(longRunOn, 50);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(50);
      });
      // Rejoined words match original
      expect(chunks.join(" ")).toBe(longRunOn);
    });

    it("handles single extremely long word without crashing", () => {
      const longWord = "SupercalifragilisticexpialidociousAndEvenLongerStringWithoutAnySpaces";
      const chunks = chunkTextForSpeech(longWord, 20);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(longWord);
    });
  });

  describe("Service Initialization & Voices", () => {
    it("reports isSupported === true in mock browser environment", () => {
      expect(service.isSupported).toBe(true);
    });

    it("enumerates available voices and handles voiceschanged event", () => {
      const voices = service.getVoices();
      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].voiceURI).toBe("Google US English");

      const onVoicesChanged = vi.fn();
      service.on("voiceschanged", onVoicesChanged);

      mocks.mockSpeechSynthesis.setVoices([
        {
          voiceURI: "Custom Voice",
          name: "Custom Voice",
          lang: "en-US",
          localService: true,
          default: true,
        } as SpeechSynthesisVoice,
      ]);

      expect(onVoicesChanged).toHaveBeenCalled();
      expect(service.voices[0].voiceURI).toBe("Custom Voice");
    });
  });

  describe("Settings & Boundary Clamping", () => {
    it("initializes with default TTSSettings", () => {
      expect(service.settings).toEqual({
        voiceURI: null,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
      });
    });

    it("clamps rate between 0.5 and 2.0", () => {
      service.updateSettings({ rate: 3.5 });
      expect(service.settings.rate).toBe(2.0);

      service.updateSettings({ rate: 0.1 });
      expect(service.settings.rate).toBe(0.5);
    });

    it("clamps pitch between 0.5 and 1.5", () => {
      service.updateSettings({ pitch: 2.0 });
      expect(service.settings.pitch).toBe(1.5);

      service.updateSettings({ pitch: 0.2 });
      expect(service.settings.pitch).toBe(0.5);
    });

    it("clamps volume between 0.0 and 1.0", () => {
      service.updateSettings({ volume: 1.5 });
      expect(service.settings.volume).toBe(1.0);

      service.updateSettings({ volume: -0.5 });
      expect(service.settings.volume).toBe(0.0);
    });

    it("updates voiceURI and emits settingschanged event", () => {
      const onSettingsChanged = vi.fn();
      service.on("settingschanged", onSettingsChanged);

      service.updateSettings({ voiceURI: "Samantha" });
      expect(service.settings.voiceURI).toBe("Samantha");
      expect(onSettingsChanged).toHaveBeenCalledWith(
        expect.objectContaining({ voiceURI: "Samantha" })
      );
    });
  });

  describe("Event Listener Management", () => {
    it("allows unsubscribing via off() and unsubscribe callback", () => {
      const listener = vi.fn();
      const unsubscribe = service.on("start", listener);

      (service as any).emit("start");
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      (service as any).emit("start");
      expect(listener).toHaveBeenCalledTimes(1);

      service.on("end", listener);
      service.off("end", listener);
      (service as any).emit("end");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("catches errors thrown inside event listeners without breaking synthesis", () => {
      const faultyListener = vi.fn(() => {
        throw new Error("Crash inside listener");
      });
      service.on("start", faultyListener);

      expect(() => (service as any).emit("start")).not.toThrow();
    });
  });

  describe("Speech Playback & Sequential Chunking", () => {
    it("speaks short text and resolves promise on completion", async () => {
      const startSpy = vi.fn();
      const endSpy = vi.fn();
      service.on("start", startSpy);
      service.on("end", endSpy);

      await service.speak("Hello from NanoForge voice assistant.");

      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(endSpy).toHaveBeenCalledTimes(1);
      expect(service.isSpeaking).toBe(false);
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);
      expect(mocks.mockSpeechSynthesis.spokenUtterances[0].text).toBe(
        "Hello from NanoForge voice assistant."
      );
    });

    it("speaks multi-sentence text in sequential chunks", async () => {
      const chunkSpy = vi.fn();
      service.on("chunkstart", chunkSpy);

      await service.speak("Sentence one. Sentence two! Sentence three?");

      expect(chunkSpy).toHaveBeenCalledTimes(3);
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(3);
      expect(mocks.mockSpeechSynthesis.spokenUtterances[0].text).toBe("Sentence one.");
      expect(mocks.mockSpeechSynthesis.spokenUtterances[1].text).toBe("Sentence two!");
      expect(mocks.mockSpeechSynthesis.spokenUtterances[2].text).toBe("Sentence three?");
    });

    it("applies customized rate, pitch, volume, and voice to utterances", async () => {
      service.updateSettings({
        rate: 1.5,
        pitch: 1.2,
        volume: 0.8,
        voiceURI: "Google US English",
      });

      await service.speak("Testing configured timbre and speed.");

      const utt = mocks.mockSpeechSynthesis.spokenUtterances[0];
      expect(utt.rate).toBe(1.5);
      expect(utt.pitch).toBe(1.2);
      expect(utt.volume).toBe(0.8);
      expect(utt.voice?.voiceURI).toBe("Google US English");
    });

    it("supports pause and resume operations", async () => {
      const pauseSpy = vi.fn();
      const resumeSpy = vi.fn();
      service.on("pause", pauseSpy);
      service.on("resume", resumeSpy);

      // Trigger speak without auto-completion to test active pause
      mocks.mockSpeechSynthesis.autoComplete = false;
      const speakPromise = service.speak("Holding speech open.");

      expect(service.isSpeaking).toBe(true);

      service.pause();
      expect(mocks.mockSpeechSynthesis.pause).toHaveBeenCalled();
      expect(pauseSpy).toHaveBeenCalled();

      service.resume();
      expect(mocks.mockSpeechSynthesis.resume).toHaveBeenCalled();
      expect(resumeSpy).toHaveBeenCalled();

      service.cancel();
      await speakPromise;
    });
  });

  describe("Immediate Barge-In Cancellation", () => {
    it("cancels active speech, clears queue, and aborts subsequent chunks", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;
      const cancelSpy = vi.fn();
      service.on("cancel", cancelSpy);

      const speakPromise = service.speak(
        "First long chunk. Second long chunk. Third long chunk."
      );

      expect(service.isSpeaking).toBe(true);
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);

      // User barges in!
      service.cancel();

      await speakPromise;

      expect(mocks.mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(service.isSpeaking).toBe(false);
      // Ensure remaining chunks were NOT spoken
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);
    });

    it("automatically cancels prior playback when speak() is called again", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;

      const firstSpeak = service.speak("Initial message.");
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(1);

      mocks.mockSpeechSynthesis.autoComplete = true;
      const secondSpeak = service.speak("Overriding urgent message.");

      await Promise.all([firstSpeak, secondSpeak]);

      expect(mocks.mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(mocks.mockSpeechSynthesis.spokenUtterances.length).toBe(2);
      expect(mocks.mockSpeechSynthesis.spokenUtterances[1].text).toBe(
        "Overriding urgent message."
      );
    });

    it("gracefully handles cancel() when idle", () => {
      expect(() => service.cancel()).not.toThrow();
      expect(service.isSpeaking).toBe(false);
    });
  });

  describe("Error Resilience & Unsupported Environments", () => {
    it("handles utterance cancellation error without rejecting promise", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;

      const speakPromise = service.speak("Testing cancellation error tolerance.");
      const utt = mocks.mockSpeechSynthesis.spokenUtterances[0];

      // Simulate browser firing canceled error event
      utt.onerror?.({ error: "canceled", type: "error" });

      await expect(speakPromise).resolves.toBeUndefined();
      expect(service.isSpeaking).toBe(false);
    });

    it("handles fatal utterance errors cleanly", async () => {
      mocks.mockSpeechSynthesis.autoComplete = false;

      const speakPromise = service.speak("Testing fatal synthesis error.");
      const utt = mocks.mockSpeechSynthesis.spokenUtterances[0];

      utt.onerror?.({ error: "audio-busy", type: "error" });

      await expect(speakPromise).rejects.toThrow(/audio-busy/);
      expect(service.isSpeaking).toBe(false);
    });

    it("degrades safely when speechSynthesis is not in window", async () => {
      mocks.restore();
      const original = (globalThis as any).speechSynthesis;
      delete (globalThis as any).speechSynthesis;

      const unsupportedService = new SpeechSynthesisService();
      expect(unsupportedService.isSupported).toBe(false);
      expect(unsupportedService.getVoices()).toEqual([]);

      await expect(unsupportedService.speak("Test text")).resolves.toBeUndefined();
      expect(() => unsupportedService.cancel()).not.toThrow();

      (globalThis as any).speechSynthesis = original;
    });
  });
});
