export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
/** 0 = explicit natural. */
export type Alter = -2 | -1 | 0 | 1 | 2;
export type BaseDuration = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
export type ClefType = 'treble' | 'bass' | 'alto' | 'tenor';
export type BarlineStyle = 'single' | 'double' | 'final';
export type Dots = 0 | 1 | 2;

export interface Duration {
  base: BaseDuration;
  dots: Dots;
}

export interface Note {
  id: string;
  step: Step;
  /** Scientific pitch notation octave, middle C = C4. */
  octave: number;
  /** null = no written accidental (key signature / measure accidentals apply). */
  alter: Alter | null;
  tieToNext?: boolean;
}

export interface ChordEvent {
  id: string;
  type: 'chord';
  duration: Duration;
  notes: Note[];
}

export interface RestEvent {
  id: string;
  type: 'rest';
  duration: Duration;
}

export interface BarlineEvent {
  id: string;
  type: 'barline';
  style: BarlineStyle;
}

export type ScoreEvent = ChordEvent | RestEvent | BarlineEvent;
export type TimedEvent = ChordEvent | RestEvent;

export interface TimeSignature {
  beats: number;
  beatType: 1 | 2 | 4 | 8 | 16;
  symbol?: 'common' | 'cut';
}

export interface Composition {
  title: string;
  /** Quarter-note BPM. */
  tempo: number;
  clef: ClefType;
  timeSignature: TimeSignature;
  /** Fifths: -7 (7 flats) .. +7 (7 sharps). */
  keySignature: number;
  events: ScoreEvent[];
}

export const BASE_DURATIONS: BaseDuration[] = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'];
export const CLEFS: ClefType[] = ['treble', 'bass', 'alto', 'tenor'];
