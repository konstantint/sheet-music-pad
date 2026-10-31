import type { Alter, ClefType, Note, Step } from './types';

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/** Number of ledger lines allowed above and below the staff when placing notes. */
export const LEDGER_LIMIT = 4;
export const MIN_STAFF_POS = -2 * LEDGER_LIMIT;
export const MAX_STAFF_POS = 8 + 2 * LEDGER_LIMIT;

/** Diatonic index of the bottom staff line for each clef. */
export const BOTTOM_LINE_D: Record<ClefType, number> = {
  treble: 30, // E4
  bass: 18, // G2
  alto: 24, // F3
  tenor: 22, // D3
};

export interface Pitch {
  step: Step;
  octave: number;
}

export const stepIndex = (step: Step): number => STEPS.indexOf(step);

export const diatonicIndex = (p: Pitch): number => p.octave * 7 + stepIndex(p.step);

export function fromDiatonic(d: number): Pitch {
  const octave = Math.floor(d / 7);
  return { step: STEPS[d - octave * 7], octave };
}

export const staffPosOf = (p: Pitch, clef: ClefType): number => diatonicIndex(p) - BOTTOM_LINE_D[clef];

export const pitchAtStaffPos = (pos: number, clef: ClefType): Pitch => fromDiatonic(pos + BOTTOM_LINE_D[clef]);

export const clampStaffPos = (pos: number): number => Math.max(MIN_STAFF_POS, Math.min(MAX_STAFF_POS, pos));

export function midiNumber(step: Step, octave: number, alter: number): number {
  return 12 * (octave + 1) + STEP_SEMITONES[stepIndex(step)] + alter;
}

const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Alteration the key signature applies to a step. */
export function keyAlter(step: Step, fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

/** Staff positions of key signature accidentals, in drawing order. */
export function keySignaturePositions(fifths: number, clef: ClefType): number[] {
  const trebleSharps = [8, 5, 9, 6, 3, 7, 4];
  const trebleFlats = [4, 7, 3, 6, 2, 5, 1];
  const n = Math.abs(fifths);
  if (n === 0) return [];
  if (clef === 'tenor') {
    const pos = fifths > 0 ? [2, 6, 3, 7, 4, 8, 5] : [5, 8, 4, 7, 3, 6, 2];
    return pos.slice(0, n);
  }
  const shift = clef === 'treble' ? 0 : clef === 'bass' ? -2 : -1;
  return (fifths > 0 ? trebleSharps : trebleFlats).slice(0, n).map((p) => p + shift);
}

const ACC_LABEL: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '♮', 1: '♯', 2: '𝄪' };

export function pitchLabel(p: Pitch, alter: Alter | null = null): string {
  return `${p.step}${alter === null ? '' : ACC_LABEL[alter]}${p.octave}`;
}

export const noteKey = (n: Pick<Note, 'step' | 'octave'>): string => `${n.step}${n.octave}`;

export function sortNotes<T extends Pitch>(notes: T[]): T[] {
  return [...notes].sort((a, b) => diatonicIndex(a) - diatonicIndex(b));
}

export const ALTERS: Alter[] = [-2, -1, 0, 1, 2];
