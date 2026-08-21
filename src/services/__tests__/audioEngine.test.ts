// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngineService } from "../audioEngine";
import { setupAudioMocks, resetAudioMocks, MockAudioContext, MockAnalyserNode, MockGainNode } from "@/test/audioMocks";

describe("AudioEngineService", () => {
  let mocks: ReturnType<typeof setupAudioMocks>;
  let service: AudioEngineService;

  beforeEach(() => {
    mocks = setupAudioMocks();
    service = new AudioEngineService();
  });

  afterEach(() => {
    service.cleanup();
    resetAudioMocks();
    mocks.restore();
  });

  describe("Initial State & Defaults", () => {
    it("initializes with uninitialized default state", () => {
      expect(service.isInitialized).toBe(false);
      expect(service.isMuted).toBe(false);
      expect(service.micGain).toBe(1.0);
      expect(service.speakerVolume).toBe(1.0);
      expect(service.audioContextState).toBe("suspended");
      expect(service.getSpeakerInputNode()).toBeNull();
    });

    it("accepts custom config for fftSize, smoothing, decibel ranges", () => {
      const customService = new AudioEngineService({
        fftSize: 256,
        smoothingTimeConstant: 0.5,
        minDecibels: -80,
        maxDecibels: -20,
      });
      expect(customService.isInitialized).toBe(false);
    });

    it("returns silent visual data when not initialized", () => {
      const micData = service.getMicVisualData();
      expect(micData.rmsVolume).toBe(0);
      expect(micData.peakVolume).toBe(0);
      expect(micData.timeDomainData.length).toBe(128);
      expect(micData.frequencyData.length).toBe(64);
      expect(micData.timeDomainData[0]).toBe(128);
      expect(micData.frequencyData[0]).toBe(0);

      const spkData = service.getSpeakerVisualData();
      expect(spkData.rmsVolume).toBe(0);
      expect(spkData.peakVolume).toBe(0);
      expect(spkData.timeDomainData.length).toBe(128);
      expect(spkData.frequencyData.length).toBe(64);
    });
  });

  describe("Environment Support & Fallbacks", () => {
    it("gracefully returns false when AudioContext is unavailable", async () => {
      mocks.restore();
      const origAC = (globalThis as any).AudioContext;
      const origWAC = (globalThis as any).webkitAudioContext;
      delete (globalThis as any).AudioContext;
      delete (globalThis as any).webkitAudioContext;

      const unsuppService = new AudioEngineService();
      expect(unsuppService.audioContextState).toBe("unsupported");

      const success = await unsuppService.initialize();
      expect(success).toBe(false);
      expect(unsuppService.isInitialized).toBe(false);

      (globalThis as any).AudioContext = origAC;
      (globalThis as any).webkitAudioContext = origWAC;
    });

    it("gracefully returns false when getUserMedia is denied or throws", async () => {
      navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error("NotAllowedError"));

      const failService = new AudioEngineService();
      const success = await failService.initialize();

      expect(success).toBe(false);
      expect(failService.isInitialized).toBe(false);
    });
  });

  describe("Initialization & Audio Graph Construction", () => {
    it("initializes Web Audio graph with expected constraints", async () => {
      const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, "getUserMedia");

      const success = await service.initialize();
      expect(success).toBe(true);
      expect(service.isInitialized).toBe(true);
      expect(service.audioContextState).toBe("suspended");

      expect(getUserMediaSpy).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      expect(service.getSpeakerInputNode()).not.toBeNull();
    });

    it("is idempotent on repeated initialize() calls", async () => {
      const first = await service.initialize();
      const second = await service.initialize();

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(service.isInitialized).toBe(true);
    });

    it("does NOT connect mic graph to AudioContext destination", async () => {
      await service.initialize();

      // Inspect internal nodes
      const micAnalyser = (service as any).micAnalyserNode as MockAnalyserNode;
      const speakerAnalyser = (service as any).speakerAnalyserNode as MockAnalyserNode;
      const audioCtx = (service as any).audioContext as MockAudioContext;

      // Microphone analyser must NOT be connected to destination
      expect(micAnalyser.destination).toBeNull();

      // Speaker analyser MUST be connected to destination
      expect(speakerAnalyser.destination).toBe(audioCtx.destination);
    });

    it("applies pre-configured gain and volume upon initialize()", async () => {
      service.setMicGain(1.8);
      service.setSpeakerVolume(0.4);
      service.setMuted(true);

      await service.initialize();

      expect(service.micGain).toBe(1.8);
      expect(service.speakerVolume).toBe(0.4);
      expect(service.isMuted).toBe(true);

      const micGainNode = (service as any).micGainNode as MockGainNode;
      expect(micGainNode.gain.value).toBe(0); // 0 because muted
    });
  });

  describe("Gain, Volume & Mute Controls", () => {
    it("clamps mic gain to range [0.0, 2.0]", async () => {
      await service.initialize();

      service.setMicGain(1.5);
      expect(service.micGain).toBe(1.5);

      service.setMicGain(-0.5);
      expect(service.micGain).toBe(0.0);

      service.setMicGain(3.5);
      expect(service.micGain).toBe(2.0);

      service.setMicGain(NaN);
      expect(service.micGain).toBe(1.0);
    });

    it("clamps speaker volume to range [0.0, 1.0]", async () => {
      await service.initialize();

      service.setSpeakerVolume(0.6);
      expect(service.speakerVolume).toBe(0.6);

      service.setSpeakerVolume(-0.2);
      expect(service.speakerVolume).toBe(0.0);

      service.setSpeakerVolume(1.8);
      expect(service.speakerVolume).toBe(1.0);

      service.setSpeakerVolume(NaN);
      expect(service.speakerVolume).toBe(1.0);
    });

    it("mutes microphone by disabling tracks and setting gain to 0", async () => {
      await service.initialize();
      service.setMicGain(1.4);

      const micGainNode = (service as any).micGainNode as MockGainNode;
      const stream = (service as any).micStream as any;
      const track = stream.getAudioTracks()[0];

      service.setMuted(true);
      expect(service.isMuted).toBe(true);
      expect(track.enabled).toBe(false);
      expect(micGainNode.gain.value).toBe(0);

      // Visual data returns silent when muted
      const visualData = service.getMicVisualData();
      expect(visualData.rmsVolume).toBe(0);
      expect(visualData.peakVolume).toBe(0);

      // Unmute restores track and gain
      service.setMuted(false);
      expect(service.isMuted).toBe(false);
      expect(track.enabled).toBe(true);
      expect(micGainNode.gain.value).toBe(1.4);
    });
  });

  describe("Audio Context State & Resume", () => {
    it("resumes context when suspended", async () => {
      await service.initialize();
      const audioCtx = (service as any).audioContext as MockAudioContext;
      expect(audioCtx.state).toBe("suspended");

      await service.resumeContext();
      expect(audioCtx.state).toBe("running");
      expect(service.audioContextState).toBe("running");
    });

    it("handles resume errors gracefully without crashing", async () => {
      await service.initialize();
      const audioCtx = (service as any).audioContext as MockAudioContext;
      audioCtx.resume = vi.fn().mockRejectedValue(new Error("Autoplay blocked"));

      await expect(service.resumeContext()).resolves.toBeUndefined();
    });
  });

  describe("Visualizer FFT & Volume Calculations", () => {
    it("computes accurate RMS and Peak volume for silent signal", async () => {
      await service.initialize();
      const micAnalyser = (service as any).micAnalyserNode as MockAnalyserNode;

      // 128 in unsigned byte PCM is zero amplitude
      const silentData = new Uint8Array(128).fill(128);
      micAnalyser.setMockTimeDomainData(silentData);

      const visualData = service.getMicVisualData();
      expect(visualData.rmsVolume).toBeCloseTo(0.0, 4);
      expect(visualData.peakVolume).toBeCloseTo(0.0, 4);
    });

    it("computes accurate RMS and Peak volume for full-scale square wave", async () => {
      await service.initialize();
      const micAnalyser = (service as any).micAnalyserNode as MockAnalyserNode;

      // Alternating 0 and 255 (full scale: normalized amplitude = +/- 1.0)
      const fullScaleData = new Uint8Array(128);
      for (let i = 0; i < 128; i++) {
        fullScaleData[i] = i % 2 === 0 ? 255 : 0;
      }
      micAnalyser.setMockTimeDomainData(fullScaleData);

      const visualData = service.getMicVisualData();
      expect(visualData.peakVolume).toBeCloseTo(1.0, 2);
      expect(visualData.rmsVolume).toBeCloseTo(1.0, 2);
    });

    it("computes speaker visual data independently", async () => {
      await service.initialize();
      const speakerAnalyser = (service as any).speakerAnalyserNode as MockAnalyserNode;

      const speakerData = new Uint8Array(128).fill(192); // (192-128)/128 = 0.5 amplitude
      speakerAnalyser.setMockTimeDomainData(speakerData);

      const visualData = service.getSpeakerVisualData();
      expect(visualData.peakVolume).toBeCloseTo(0.5, 2);
      expect(visualData.rmsVolume).toBeCloseTo(0.5, 2);
    });

    it("returns defensive copies of Uint8Arrays from getMicVisualData", async () => {
      await service.initialize();
      const data1 = service.getMicVisualData();
      data1.timeDomainData[0] = 99;

      const data2 = service.getMicVisualData();
      expect(data2.timeDomainData[0]).not.toBe(99);
    });
  });

  describe("Resource Cleanup", () => {
    it("stops all tracks and closes AudioContext on cleanup()", async () => {
      await service.initialize();
      const stream = (service as any).micStream as any;
      const track = stream.getAudioTracks()[0];
      const audioCtx = (service as any).audioContext as MockAudioContext;

      service.cleanup();

      expect(track.stop).toHaveBeenCalled();
      expect(audioCtx.close).toHaveBeenCalled();
      expect(service.isInitialized).toBe(false);
      expect(service.getSpeakerInputNode()).toBeNull();
    });

    it("handles multiple consecutive cleanup() calls safely", async () => {
      await service.initialize();
      expect(() => {
        service.cleanup();
        service.cleanup();
      }).not.toThrow();
    });
  });
});
