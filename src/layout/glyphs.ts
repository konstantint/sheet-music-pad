import type { BaseDuration } from '../model/types';

/** SMuFL code points (Bravura). */
export const G = {
  gClef: '',
  fClef: '',
  cClef: '',
  noteheadWhole: '',
  noteheadHalf: '',
  noteheadBlack: '',
  augmentationDot: '',
  timeSigCommon: '',
  timeSigCut: '',
} as const;

export const timeSigDigits = (n: number): string =>
  String(n)
    .split('')
    .map((d) => String.fromCharCode(0xe080 + Number(d)))
    .join('');

export const ACCIDENTAL_GLYPH: Record<number, string> = {
  [-2]: '',
  [-1]: '',
  0: '',
  1: '',
  2: '',
};

/** Width of accidental glyphs in staff spaces. */
export const ACCIDENTAL_WIDTH: Record<number, number> = { [-2]: 1.65, [-1]: 0.9, 0: 0.7, 1: 1.0, 2: 1.0 };

export const REST_GLYPH: Record<BaseDuration, string> = {
  whole: '',
  half: '',
  quarter: '',
  eighth: '',
  '16th': '',
  '32nd': '',
};

/** Flag glyphs [up, down]. */
export const FLAG_GLYPH: Partial<Record<BaseDuration, [string, string]>> = {
  eighth: ['', ''],
  '16th': ['', ''],
  '32nd': ['', ''],
};

/** Metronome-mark style note glyphs (stem up) for the palette. */
export const PALETTE_NOTE_GLYPH: Record<BaseDuration, string> = {
  whole: '',
  half: '',
  quarter: '',
  eighth: '',
  '16th': '',
  '32nd': '',
};

export const MUSIC_FONT = 'Bravura';
