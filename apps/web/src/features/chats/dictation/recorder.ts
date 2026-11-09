import { clipOf } from './wav.ts';

/**
 * Dictation's microphone side (docs/speech.md): raw samples from the Web Audio graph, not MediaRecorder, whose encoder
 * stops when a Bluetooth headset (AirPods) switches profile and sample rate as the mic opens; the graph resamples to its
 * own rate and the samples keep coming. A ScriptProcessor collects them (an AudioWorklet would need a module of its
 * own for the same job), an analyser gives the level meter, and `stop()` hands back a 16 kHz mono WAV.
 */

/** The longest clip: two minutes, as the server takes. */
export const CLIP_MAX_MS = 2 * 60 * 1000;

export interface Clip {
  readonly blob: Blob;
  readonly ms: number;
  /** The microphone's name, for a message when no sound came through. */
  readonly device: string;
  /** No samples arrived at all (a headset still switching, a muted input). */
  readonly empty: boolean;
}

export interface RecorderEvents {
  /** The level 0..1 and the time since the start, each animation frame. */
  onLevel(level: number, elapsedMs: number): void;
  /** Two minutes went by. */
  onLimit(): void;
}

export class PcmRecorder {
  private stream: MediaStream | undefined;
  private context: AudioContext | undefined;
  private processor: ScriptProcessorNode | undefined;
  private chunks: Float32Array[] = [];
  private rate = 48_000;
  private startedAt = 0;
  private frame = 0;
  private limit: ReturnType<typeof setTimeout> | undefined;
  private device = '';
  private recording = false;
  private readonly events: RecorderEvents;

  constructor(events: RecorderEvents) {
    this.events = events;
  }

  /** Opens the microphone (`deviceId`, else the default one) and starts collecting samples. */
  async start(deviceId?: string): Promise<void> {
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.stream = stream;
    this.device = stream.getAudioTracks()[0]?.label ?? '';
    const context = new AudioContext();
    this.context = context;
    if (context.state === 'suspended') await context.resume().catch(() => {});
    this.rate = context.sampleRate;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (this.recording) this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    // The processor runs only when connected to the output; through a muted gain nothing is heard.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.processor = processor;
    this.chunks = [];
    this.recording = true;
    this.startedAt = performance.now();
    this.meter(analyser);
    this.limit = setTimeout(() => this.events.onLimit(), CLIP_MAX_MS);
  }

  private meter(analyser: AnalyserNode): void {
    const buffer = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!this.recording) return;
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128));
      this.events.onLevel(Math.min(1, peak / 64), performance.now() - this.startedAt);
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  private teardown(): void {
    this.recording = false;
    clearTimeout(this.limit);
    cancelAnimationFrame(this.frame);
    try {
      this.processor?.disconnect();
    } catch {
      // Disconnected already.
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.context?.close().catch(() => {});
  }

  /** Stops (after a short tail, so the last word is in) and returns the clip. */
  async stop(): Promise<Clip | undefined> {
    if (!this.recording) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const ms = performance.now() - this.startedAt;
    this.teardown();
    const chunks = this.chunks;
    this.chunks = [];
    return { blob: clipOf(chunks, this.rate), ms, device: this.device, empty: chunks.length === 0 };
  }

  /** Stops and drops what was recorded. */
  cancel(): void {
    if (this.recording) this.teardown();
    this.chunks = [];
  }
}
