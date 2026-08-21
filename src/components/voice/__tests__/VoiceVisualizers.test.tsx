// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VoiceWaveformVisualizer } from "../VoiceWaveformVisualizer";
import { VoiceFrequencyVisualizer } from "../VoiceFrequencyVisualizer";
import type { AudioVisualData } from "@/services/audioEngine";

describe("Voice Visualizers Component Suite", () => {
  beforeEach(() => {
    // Mock HTMLCanvasElement getContext
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({
        addColorStop: vi.fn(),
      }),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      shadowBlur: 0,
      shadowColor: "",
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(cleanup);

  describe("VoiceWaveformVisualizer", () => {
    it("1. Renders waveform canvas with role img and accessible label", () => {
      const silentData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).fill(128),
        frequencyData: new Uint8Array(128).fill(0),
        rmsVolume: 0,
        peakVolume: 0,
      };

      render(<VoiceWaveformVisualizer visualData={silentData} />);

      const canvas = screen.getByTestId("voice-waveform-canvas");
      expect(canvas).toBeInTheDocument();
      expect(canvas).toHaveAttribute("role", "img");
      expect(canvas).toHaveAttribute("aria-label", "Microphone Audio Waveform Visualizer");
    });

    it("2. Handles muted state and renders resting baseline", () => {
      const activeData: AudioVisualData = {
        timeDomainData: new Uint8Array([128, 180, 200, 150, 90, 60, 128]),
        frequencyData: new Uint8Array(128).fill(100),
        rmsVolume: 0.5,
        peakVolume: 0.8,
      };

      render(<VoiceWaveformVisualizer visualData={activeData} isMuted={true} />);

      expect(screen.getByText("MUTED")).toBeInTheDocument();
      expect(screen.getByTestId("voice-waveform-canvas")).toBeInTheDocument();
    });

    it("3. Handles active oscillating mic input without crashing", () => {
      const timeData = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        timeData[i] = Math.round(128 + Math.sin(i / 10) * 100);
      }

      const activeData: AudioVisualData = {
        timeDomainData: timeData,
        frequencyData: new Uint8Array(128).fill(80),
        rmsVolume: 0.6,
        peakVolume: 0.9,
      };

      render(<VoiceWaveformVisualizer visualData={activeData} isMuted={false} />);

      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
      expect(screen.getByTestId("voice-waveform-canvas")).toBeInTheDocument();
    });
  });

  describe("VoiceFrequencyVisualizer", () => {
    it("1. Renders frequency equalizer canvas with role img and label", () => {
      const silentData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).fill(128),
        frequencyData: new Uint8Array(128).fill(0),
        rmsVolume: 0,
        peakVolume: 0,
      };

      render(<VoiceFrequencyVisualizer visualData={silentData} isSpeaking={false} />);

      const canvas = screen.getByTestId("voice-frequency-canvas");
      expect(canvas).toBeInTheDocument();
      expect(canvas).toHaveAttribute("role", "img");
      expect(canvas).toHaveAttribute("aria-label", "Agent Speaker Frequency Visualizer");
    });

    it("2. Handles agent speaking state with active frequency bins", () => {
      const freqData = new Uint8Array(128);
      for (let i = 0; i < 128; i++) {
        freqData[i] = Math.round(Math.random() * 200);
      }

      const activeData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).fill(128),
        frequencyData: freqData,
        rmsVolume: 0.7,
        peakVolume: 0.95,
      };

      render(<VoiceFrequencyVisualizer visualData={activeData} isSpeaking={true} barCount={32} />);

      expect(screen.getByText("OUTPUTTING")).toBeInTheDocument();
      expect(screen.getByTestId("voice-frequency-canvas")).toBeInTheDocument();
    });

    it("3. Handles resting state when agent is silent", () => {
      const silentData: AudioVisualData = {
        timeDomainData: new Uint8Array(256).fill(128),
        frequencyData: new Uint8Array(128).fill(0),
        rmsVolume: 0,
        peakVolume: 0,
      };

      render(<VoiceFrequencyVisualizer visualData={silentData} isSpeaking={false} />);

      expect(screen.getByText("RESTING")).toBeInTheDocument();
    });
  });
});
