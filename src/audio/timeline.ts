import { durationTicks } from '../model/duration';
import { analyzeMeasures, resolveAlters } from '../model/measures';
import { midiNumber, noteKey } from '../model/pitch';
import type { Composition } from '../model/types';

export interface TimelineNote {
  midi: number;
  /** Sounding length in ticks (ties merged). */
  ticks: number;
  /** True when the note continues through a tie onto the following chord. */
  tied: boolean;
}

export interface TimelineEntry {
  eventId: string;
  startTick: number;
  ticks: number;
  /** Notes attacked at this event (tied continuations are not repeated). */
  notes: TimelineNote[];
}

/** Convert the composition into timed entries, one per chord/rest. Bar lines take no time. */
export function buildTimeline(comp: Composition): TimelineEntry[] {
  const alters = resolveAlters(comp, analyzeMeasures(comp));
  const entries: TimelineEntry[] = [];
  let tick = 0;
  let openTies = new Map<string, TimelineNote>();
  for (const ev of comp.events) {
    if (ev.type === 'barline') continue;
    const ticks = durationTicks(ev.duration);
    const entry: TimelineEntry = { eventId: ev.id, startTick: tick, ticks, notes: [] };
    const nextTies = new Map<string, TimelineNote>();
    if (ev.type === 'chord') {
      for (const n of ev.notes) {
        const key = noteKey(n);
        const midi = midiNumber(n.step, n.octave, alters.get(n.id) ?? 0);
        const open = openTies.get(key);
        let tn: TimelineNote;
        if (open && open.midi === midi) {
          open.ticks += ticks;
          tn = open;
        } else {
          tn = { midi, ticks, tied: false };
          entry.notes.push(tn);
        }
        if (n.tieToNext) {
          tn.tied = true;
          nextTies.set(key, tn);
        }
      }
    }
    openTies = nextTies;
    entries.push(entry);
    tick += ticks;
  }
  return entries;
}

export const secondsPerTick = (tempo: number): number => 60 / (tempo * 480);
