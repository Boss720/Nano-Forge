import { useEffect, useRef } from "react";
import type { AudioVisualData } from "@/services/audioEngine";

export interface VoiceFrequencyVisualizerProps {
  /** Real-time audio visual data from speaker output */
  visualData: AudioVisualData;
  /** Whether agent is currently speaking */
  isSpeaking?: boolean;
  /** Number of discrete equalizer bars to render (default: 32) */
  barCount?: number;
  /** Canvas width in CSS pixels (default: 280) */
  width?: number;
  /** Canvas height in CSS pixels (default: 80) */
  height?: number;
  /** Bar color gradient [bottomColor, topColor] */
  gradientColors?: [string, string];
  className?: string;
}

export function VoiceFrequencyVisualizer({
  visualData,
  isSpeaking = false,
  barCount = 32,
  width = 280,
  height = 80,
  gradientColors = ["hsl(22 100% 50%)", "hsl(32 100% 55%)"],
  className = "",
}: VoiceFrequencyVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, width * dpr);
    canvas.height = Math.max(1, height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const freqData = visualData.frequencyData;
    const freqLen = freqData ? freqData.length : 0;
    const K = Math.max(8, Math.min(64, barCount));
    const gap = 2;
    const totalGap = gap * (K - 1);
    const barWidth = Math.max(1, (width - totalGap) / K);

    // Create gradient
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, gradientColors[0]);
    gradient.addColorStop(1, gradientColors[1]);
    ctx.fillStyle = gradient;

    const hasAudio = isSpeaking || visualData.rmsVolume > 0.001;

    for (let k = 0; k < K; k++) {
      let barHeight = 2; // Resting baseline height

      if (hasAudio && freqLen > 0) {
        // Group frequency bins
        const startBin = Math.floor((k / K) * freqLen);
        const endBin = Math.max(startBin + 1, Math.floor(((k + 1) / K) * freqLen));
        let sum = 0;
        let count = 0;

        for (let j = startBin; j < endBin && j < freqLen; j++) {
          sum += freqData[j];
          count++;
        }

        const avg = count > 0 ? sum / count : 0;
        const normalized = avg / 255.0;
        barHeight = Math.max(2, normalized * (height - 4));
      }

      const x = k * (barWidth + gap);
      const y = height - barHeight;

      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    }

    ctx.restore();
  }, [visualData, isSpeaking, barCount, width, height, gradientColors]);

  return (
    <div className={`flex flex-col items-center justify-center overflow-hidden rounded-md border border-border/40 bg-card/40 p-2 ${className}`}>
      <div className="mb-1 flex w-full items-center justify-between px-1">
        <span className="micro-label text-[10px] text-muted-foreground">Speaker Spectrum (Equalizer)</span>
        <span className={`font-mono text-[9px] ${isSpeaking ? "text-primary font-semibold" : "text-muted-foreground"}`}>
          {isSpeaking ? "OUTPUTTING" : "RESTING"}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        data-testid="voice-frequency-canvas"
        role="img"
        aria-label="Agent Speaker Frequency Visualizer"
        className="h-full w-full"
      />
    </div>
  );
}
