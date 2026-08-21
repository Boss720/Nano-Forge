import { useEffect, useRef } from "react";
import type { AudioVisualData } from "@/services/audioEngine";

export interface VoiceWaveformVisualizerProps {
  /** Real-time audio visual data (timeDomainData: Uint8Array, frequencyData: Uint8Array, rmsVolume: number) */
  visualData: AudioVisualData;
  /** Whether the microphone is muted (forces flat baseline rendering) */
  isMuted?: boolean;
  /** Visualizer canvas width in CSS pixels (default: 280) */
  width?: number;
  /** Visualizer canvas height in CSS pixels (default: 80) */
  height?: number;
  /** Primary waveform neon color (default: #10b981 / emerald) */
  color?: string;
  /** Background color (default: transparent) */
  backgroundColor?: string;
  className?: string;
}

export function VoiceWaveformVisualizer({
  visualData,
  isMuted = false,
  width = 280,
  height = 80,
  color = "#10b981",
  backgroundColor = "transparent",
  className = "",
}: VoiceWaveformVisualizerProps) {
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

    // Clear background
    if (backgroundColor && backgroundColor !== "transparent") {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    const centerY = height / 2;
    const timeData = visualData.timeDomainData;
    const isFlat = isMuted || visualData.rmsVolume <= 0.001 || !timeData || timeData.length === 0;

    if (isFlat) {
      // Draw resting horizontal center line
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.strokeStyle = isMuted ? "rgba(239, 68, 68, 0.4)" : "rgba(16, 185, 129, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
      return;
    }

    const length = timeData.length;
    const sliceWidth = width / (length - 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (let i = 0; i < length; i++) {
      const v = (timeData[i] - 128) / 128.0; // [-1.0, 1.0]
      const y = centerY + v * (centerY * 0.88);
      const x = i * sliceWidth;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }, [visualData, isMuted, width, height, color, backgroundColor]);

  return (
    <div className={`flex flex-col items-center justify-center overflow-hidden rounded-md border border-border/40 bg-card/40 p-2 ${className}`}>
      <div className="mb-1 flex w-full items-center justify-between px-1">
        <span className="micro-label text-[10px] text-muted-foreground">Mic Waveform (Oscilloscope)</span>
        <span className={`font-mono text-[9px] ${isMuted ? "text-destructive" : visualData.rmsVolume > 0.05 ? "text-emerald-400 font-semibold" : "text-muted-foreground"}`}>
          {isMuted ? "MUTED" : visualData.rmsVolume > 0.05 ? "ACTIVE" : "STANDBY"}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        data-testid="voice-waveform-canvas"
        role="img"
        aria-label="Microphone Audio Waveform Visualizer"
        className="h-full w-full"
      />
    </div>
  );
}
