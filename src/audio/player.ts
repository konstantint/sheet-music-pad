import type { Composition } from '../model/types';
import type { Output } from './outputs';
import { buildTimeline, secondsPerTick, type TimelineEntry } from './timeline';

export type PlayState = 'stopped' | 'playing' | 'paused';

const LOOKAHEAD = 0.1;
const INTERVAL_MS = 25;
const LATE_LIMIT = 0.1;
const VELOCITY = 80;
const ARTICULATION = 0.95;

interface PlayerCallbacks {
  onEvent: (eventId: string | null) => void;
  onState: (state: PlayState) => void;
}

/**
 * Look-ahead scheduler on AudioContext time. It reads the latest composition on every
 * tick, so edits and tempo changes during playback affect events not yet scheduled.
 */
export class Player {
  state: PlayState = 'stopped';
  /** Where Play resumes after Pause. */
  pausedTick: number | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private highlightTimers: ReturnType<typeof setTimeout>[] = [];
  private anchorTime = 0;
  private anchorTick = 0;
  private tempo = 100;
  private nextTick = 0;
  private cachedComp: Composition | null = null;
  private cachedTimeline: TimelineEntry[] = [];

  constructor(
    private ac: AudioContext,
    private getComp: () => Composition,
    private getOutput: () => Output,
    private cb: PlayerCallbacks,
  ) {}

  private timeline(): TimelineEntry[] {
    const comp = this.getComp();
    if (comp !== this.cachedComp) {
      this.cachedComp = comp;
      this.cachedTimeline = buildTimeline(comp);
    }
    return this.cachedTimeline;
  }

  private tickAt(time: number) {
    return this.anchorTick + (time - this.anchorTime) / secondsPerTick(this.tempo);
  }

  private timeOf(tick: number) {
    return this.anchorTime + (tick - this.anchorTick) * secondsPerTick(this.tempo);
  }

  play(fromTick: number) {
    if (this.state === 'playing') return;
    this.tempo = this.getComp().tempo;
    this.anchorTime = this.ac.currentTime + 0.05;
    this.anchorTick = fromTick;
    this.nextTick = fromTick;
    this.pausedTick = null;
    this.setState('playing');
    this.timer = setInterval(() => this.tick(), INTERVAL_MS);
    this.tick();
  }

  pause() {
    if (this.state !== 'playing') return;
    const current = this.tickAt(this.ac.currentTime);
    // Resume from the next event rather than restarting a note that was cut off.
    const next = this.timeline().find((e) => e.startTick >= current - 1e-6);
    this.halt();
    this.pausedTick = next ? next.startTick : null;
    this.setState(this.pausedTick === null ? 'stopped' : 'paused');
  }

  stop() {
    this.halt();
    this.pausedTick = null;
    this.setState('stopped');
  }

  dispose() {
    this.halt();
  }

  private halt(silence = true) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.highlightTimers.forEach(clearTimeout);
    this.highlightTimers = [];
    if (silence) this.getOutput().allOff();
    this.cb.onEvent(null);
  }

  private setState(s: PlayState) {
    this.state = s;
    this.cb.onState(s);
  }

  private tick() {
    const now = this.ac.currentTime;
    const comp = this.getComp();
    if (comp.tempo !== this.tempo) {
      const current = this.tickAt(Math.max(now, this.anchorTime));
      this.anchorTime = Math.max(now, this.anchorTime);
      this.anchorTick = current;
      this.tempo = comp.tempo;
    }
    const timeline = this.timeline();
    const spt = secondsPerTick(this.tempo);
    const output = this.getOutput();
    for (;;) {
      const entry = timeline.find((e) => e.startTick >= this.nextTick - 1e-6);
      if (!entry) break;
      const time = this.timeOf(entry.startTick);
      if (time > now + LOOKAHEAD) break;
      this.nextTick = entry.startTick + entry.ticks;
      if (time < now - LATE_LIMIT) continue; // e.g. background tab throttling: skip instead of bursting
      for (const n of entry.notes) {
        const dur = n.ticks * spt;
        output.play(n.midi, time, n.tied ? dur : dur * ARTICULATION, VELOCITY);
      }
      const id = entry.eventId;
      this.highlightTimers.push(setTimeout(() => this.cb.onEvent(id), Math.max(0, (time - now) * 1000)));
    }
    const last = timeline[timeline.length - 1];
    const endTick = last ? last.startTick + last.ticks : 0;
    if (this.nextTick >= endTick - 1e-6 && now >= this.timeOf(endTick)) {
      this.halt(false); // let the last note ring out
      this.pausedTick = null;
      this.setState('stopped');
    }
  }
}

/** Start tick of an event, or 0. */
export function startTickOf(comp: Composition, eventId: string): number {
  const entry = buildTimeline(comp).find((e) => e.eventId === eventId);
  if (entry) return entry.startTick;
  // A bar line: start at the next timed event.
  const idx = comp.events.findIndex((e) => e.id === eventId);
  const after = comp.events.slice(idx + 1).find((e) => e.type !== 'barline');
  return after ? (buildTimeline(comp).find((e) => e.eventId === after.id)?.startTick ?? 0) : 0;
}
