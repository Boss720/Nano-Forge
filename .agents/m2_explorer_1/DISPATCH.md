## 2026-08-15T17:20:58Z

Investigate and design the exact technical specification for `src/services/audioEngine.ts`:
1. AudioContext lifecycle (creation, state checking, resume on user gesture, close on cleanup).
2. Microphone capture via `navigator.mediaDevices.getUserMedia` with constraints: `echoCancellation: true, noiseSuppression: true, autoGainControl: true`.
3. Mic audio graph: `MediaStreamAudioSourceNode` -> `micGainNode` -> `micAnalyserNode` (fftSize: 128 -> 64 bins, smoothingTimeConstant: 0.8). Note: do not connect mic to audioContext.destination to avoid local feedback.
4. Speaker audio graph: `speakerGainNode` -> `speakerAnalyserNode` -> `audioContext.destination`.
5. Gain and volume controls: `setMicGain(gain: number)` (0.0 to 2.0), `setMuted(muted: boolean)` (sets mic gain to 0 and track.enabled = false), `setSpeakerVolume(volume: number)` (0.0 to 1.0).
6. Visualizer data tap: `getMicVisualData()` and `getSpeakerVisualData()`, returning `{ timeDomainData: Uint8Array, frequencyData: Uint8Array, rmsVolume: number, peakVolume: number }`.
7. Cleanup: stopping all media stream tracks, disconnecting nodes, closing context.
8. Error handling & fallbacks when AudioContext or getUserMedia is not supported.

Write findings and comprehensive implementation plan to `handoff.md` in working directory and notify parent.
