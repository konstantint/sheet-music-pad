import { SplendidGrandPiano } from 'smplr';

/** A sound output. Times are AudioContext seconds. */
export interface Output {
  readonly id: string;
  play(midi: number, time: number, duration: number, velocity: number): void;
  allOff(): void;
}

let ctx: AudioContext | null = null;

/** Create / resume the shared AudioContext. Call from a user gesture. */
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Simple triangle-wave synth, used when the piano samples cannot be loaded. */
export class FallbackSynth implements Output {
  readonly id = 'synth';
  private voices = new Set<OscillatorNode>();
  private gain: GainNode;
  constructor(private ac: AudioContext) {
    this.gain = ac.createGain();
    this.gain.gain.value = 0.25;
    this.gain.connect(ac.destination);
  }
  set volume(v: number) {
    this.gain.gain.value = 0.25 * v;
  }
  play(midi: number, time: number, duration: number, velocity: number) {
    const ac = this.ac;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    const peak = (velocity / 127) * 0.8;
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.01);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.3), time + Math.max(0.02, duration));
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.12);
    osc.connect(env).connect(this.gain);
    osc.start(time);
    osc.stop(time + duration + 0.15);
    this.voices.add(osc);
    osc.onended = () => this.voices.delete(osc);
  }
  allOff() {
    for (const v of this.voices) {
      try {
        v.stop();
      } catch {
        /* already stopped */
      }
    }
    this.voices.clear();
  }
}

export type PianoStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Sampled grand piano (smplr), falling back to the synth until / unless samples load. */
export class BuiltinPiano implements Output {
  readonly id = 'builtin';
  status: PianoStatus = 'idle';
  private piano: ReturnType<typeof SplendidGrandPiano> | null = null;
  private fallback: FallbackSynth;
  private vol = 0.8;
  constructor(
    private ac: AudioContext,
    private onStatus: (s: PianoStatus) => void,
  ) {
    this.fallback = new FallbackSynth(ac);
  }

  load(): Promise<void> {
    if (this.status !== 'idle') return Promise.resolve();
    this.setStatus('loading');
    const piano = SplendidGrandPiano(this.ac, { volume: Math.round(this.vol * 127) });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000));
    return Promise.race([piano.load, timeout])
      .then(() => {
        this.piano = piano;
        this.setStatus('ready');
      })
      .catch(() => this.setStatus('failed'));
  }

  set volume(v: number) {
    this.vol = v;
    this.fallback.volume = v;
    if (this.piano) this.piano.output.volume = Math.round(v * 127);
  }

  play(midi: number, time: number, duration: number, velocity: number) {
    if (this.piano) this.piano.start({ note: midi, time, duration, velocity });
    else this.fallback.play(midi, time, duration, velocity);
  }

  allOff() {
    this.piano?.stop();
    this.fallback.allOff();
  }

  private setStatus(s: PianoStatus) {
    this.status = s;
    this.onStatus(s);
  }
}

/** Web MIDI output. Converts AudioContext time to performance.now() timestamps. */
export class MidiOutput implements Output {
  constructor(
    readonly port: MIDIOutput,
    private ac: AudioContext,
  ) {
    port.send([0xc0, 0]); // Program Change: Acoustic Grand Piano, channel 1
  }
  get id() {
    return `midi:${this.port.id}`;
  }
  private stamp(time: number) {
    return performance.now() + Math.max(0, time - this.ac.currentTime) * 1000;
  }
  play(midi: number, time: number, duration: number, velocity: number) {
    const on = this.stamp(time);
    this.port.send([0x90, midi, velocity], on);
    this.port.send([0x80, midi, 0], on + duration * 1000);
  }
  allOff() {
    // clear() drops queued messages where supported (Chromium).
    (this.port as MIDIOutput & { clear?: () => void }).clear?.();
    this.port.send([0xb0, 123, 0]);
  }
}

export const midiSupported = (): boolean => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
