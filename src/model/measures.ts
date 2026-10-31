import { durationTicks, measureTicks } from './duration';
import { keyAlter, noteKey } from './pitch';
import type { Composition } from './types';

export interface Measure {
  number: number;
  /** Indices (into composition.events) of the chords/rests in this measure. */
  eventIndices: number[];
  ticks: number;
  expected: number;
  /** True when the content does not match the time signature (pickup / unfinished last measure excepted). */
  warning: boolean;
}

export interface MeasureAnalysis {
  measures: Measure[];
  /** Event index for every chord/rest -> measure index. */
  measureOf: Map<number, number>;
  /** Event indices after which an automatic (computed) bar line falls. Empty when manual bar lines exist. */
  autoBarAfter: Set<number>;
  hasManualBarlines: boolean;
}

/**
 * Split the composition into measures: at manual bar lines if any exist,
 * otherwise at computed bar lines every full measure.
 */
export function analyzeMeasures(comp: Composition): MeasureAnalysis {
  const expected = measureTicks(comp.timeSignature);
  const hasManualBarlines = comp.events.some((e) => e.type === 'barline');
  const measures: Measure[] = [];
  const measureOf = new Map<number, number>();
  const autoBarAfter = new Set<number>();

  let current: Measure = { number: 1, eventIndices: [], ticks: 0, expected, warning: false };
  const close = () => {
    measures.push(current);
    current = { number: current.number + 1, eventIndices: [], ticks: 0, expected, warning: false };
  };

  comp.events.forEach((ev, i) => {
    if (ev.type === 'barline') {
      if (hasManualBarlines) close();
      return;
    }
    current.eventIndices.push(i);
    current.ticks += durationTicks(ev.duration);
    measureOf.set(i, measures.length);
    if (!hasManualBarlines && current.ticks >= expected) {
      close();
      if (i < comp.events.length - 1) autoBarAfter.add(i);
    }
  });
  if (current.eventIndices.length > 0 || measures.length === 0) measures.push(current);
  // A trailing manual bar line closes the last measure; drop the empty measure it would open.

  measures.forEach((m, idx) => {
    if (m.eventIndices.length === 0) return;
    const isFirst = idx === 0;
    const isLast = idx === measures.length - 1;
    if (m.ticks > m.expected) m.warning = true;
    else if (m.ticks < m.expected && !isFirst && !isLast) m.warning = true;
  });

  return { measures, measureOf, autoBarAfter, hasManualBarlines };
}

/**
 * Effective alteration of every note (by note id), following:
 * written accidental > earlier accidental on the same step+octave in the measure > key signature.
 * Tied continuation notes keep the alteration of the note they are tied from.
 */
export function resolveAlters(comp: Composition, analysis: MeasureAnalysis = analyzeMeasures(comp)): Map<string, number> {
  const result = new Map<string, number>();
  let measureIdx = -1;
  let measureAcc = new Map<string, number>();
  let pendingTies = new Map<string, number>();

  comp.events.forEach((ev, i) => {
    if (ev.type === 'barline') return;
    const m = analysis.measureOf.get(i)!;
    if (m !== measureIdx) {
      measureIdx = m;
      measureAcc = new Map();
    }
    if (ev.type === 'rest') {
      pendingTies = new Map();
      return;
    }
    const nextTies = new Map<string, number>();
    for (const n of ev.notes) {
      const key = noteKey(n);
      let alter: number;
      if (n.alter !== null) {
        alter = n.alter;
        measureAcc.set(key, alter);
      } else if (pendingTies.has(key)) {
        alter = pendingTies.get(key)!;
      } else if (measureAcc.has(key)) {
        alter = measureAcc.get(key)!;
      } else {
        alter = keyAlter(n.step, comp.keySignature);
      }
      result.set(n.id, alter);
      if (n.tieToNext) nextTies.set(key, alter);
    }
    pendingTies = nextTies;
  });
  return result;
}
