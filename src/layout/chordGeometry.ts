import { staffPosOf } from '../model/pitch';
import type { Alter, BaseDuration, ChordEvent, ClefType, Dots } from '../model/types';
import { ACCIDENTAL_WIDTH } from './glyphs';
import { HEAD_W, LEDGER_EXT, S, STEM_W, WHOLE_HEAD_W } from './constants';

/**
 * Geometry of a chord relative to its notehead column: x = 0 is the left edge of a
 * normally placed notehead; vertical values are staff positions (0 = bottom line, 8 = top line).
 */
export interface HeadGeom {
  noteId: string;
  pos: number;
  x: number;
}

export interface AccidentalGeom {
  noteId: string;
  pos: number;
  x: number;
  alter: Alter;
}

export interface LedgerGeom {
  pos: number;
  x1: number;
  x2: number;
}

export interface ChordGeom {
  headW: number;
  heads: HeadGeom[];
  accidentals: AccidentalGeom[];
  ledgers: LedgerGeom[];
  dots: { pos: number; x: number }[];
  stem: { x: number; fromPos: number; toPos: number; up: boolean } | null;
  flag: { x: number; pos: number; up: boolean } | null;
  /** Extent left of x = 0 (positive number) and right edge. */
  left: number;
  right: number;
}

export interface ChordShape {
  duration: { base: BaseDuration; dots: Dots };
  notes: { id: string; pos: number; alter: Alter | null }[];
}

export function chordShape(chord: ChordEvent, clef: ClefType): ChordShape {
  return {
    duration: chord.duration,
    notes: chord.notes.map((n) => ({ id: n.id, pos: staffPosOf(n, clef), alter: n.alter })).sort((a, b) => a.pos - b.pos),
  };
}

export const hasStem = (base: BaseDuration) => base !== 'whole';
export const hasFlag = (base: BaseDuration) => base === 'eighth' || base === '16th' || base === '32nd';

/** Stem goes up when the note farthest from the middle line is below it. */
export function stemUp(positions: number[]): boolean {
  const lo = Math.min(...positions);
  const hi = Math.max(...positions);
  return 4 - lo > hi - 4;
}

export function chordGeometry(shape: ChordShape): ChordGeom {
  const { base, dots } = shape.duration;
  const headW = base === 'whole' ? WHOLE_HEAD_W : HEAD_W;
  const notes = shape.notes;
  const positions = notes.map((n) => n.pos);
  const up = stemUp(positions);

  // Seconds: alternate noteheads to the other side of the stem.
  const xs = new Map<string, number>();
  const order = up ? notes : [...notes].reverse();
  let prevPos: number | null = null;
  let prevShifted = false;
  for (const n of order) {
    const shifted: boolean = prevPos !== null && Math.abs(n.pos - prevPos) === 1 && !prevShifted;
    xs.set(n.id, shifted ? (up ? headW - STEM_W : -headW + STEM_W) : 0);
    prevPos = n.pos;
    prevShifted = shifted;
  }
  const heads: HeadGeom[] = notes.map((n) => ({ noteId: n.id, pos: n.pos, x: xs.get(n.id)! }));
  const headsLeft = Math.min(...heads.map((h) => h.x));
  const headsRight = Math.max(...heads.map((h) => h.x)) + headW;

  // Accidentals: stack in columns, top to bottom, avoiding vertical overlap (< 6 positions apart).
  const columns: { pos: number; width: number }[][] = [];
  const accidentals: AccidentalGeom[] = [];
  for (const n of [...notes].reverse()) {
    if (n.alter === null) continue;
    let col = columns.findIndex((c) => c.every((a) => Math.abs(a.pos - n.pos) >= 6));
    if (col < 0) {
      columns.push([]);
      col = columns.length - 1;
    }
    columns[col].push({ pos: n.pos, width: ACCIDENTAL_WIDTH[n.alter] * S });
    accidentals.push({ noteId: n.id, pos: n.pos, x: 0, alter: n.alter });
  }
  const colWidths = columns.map((c) => Math.max(...c.map((a) => a.width)));
  const gap = 0.2 * S;
  for (const a of accidentals) {
    const col = columns.findIndex((c) => c.some((x) => x.pos === a.pos));
    let x = headsLeft - gap;
    for (let i = 0; i <= col; i++) x -= colWidths[i] + (i > 0 ? gap : 0);
    a.x = x;
  }
  const accLeft = accidentals.length ? Math.min(...accidentals.map((a) => a.x)) : headsLeft;

  // Ledger lines: a ledger line spans every notehead at or beyond it.
  const ledgers: LedgerGeom[] = [];
  const lo = Math.min(...positions);
  const hi = Math.max(...positions);
  const ledgerFor = (pos: number, beyond: (p: number) => boolean) => {
    const hs = heads.filter((h) => beyond(h.pos));
    ledgers.push({
      pos,
      x1: Math.min(...hs.map((h) => h.x)) - LEDGER_EXT,
      x2: Math.max(...hs.map((h) => h.x)) + headW + LEDGER_EXT,
    });
  };
  for (let p = -2; p >= lo; p -= 2) ledgerFor(p, (hp) => hp <= p);
  for (let p = 10; p <= hi; p += 2) ledgerFor(p, (hp) => hp >= p);

  // Dots sit in the space to the right; notes on lines put the dot in the space above.
  const dotList: { pos: number; x: number }[] = [];
  if (dots > 0) {
    const dotPositions = [...new Set(positions.map((p) => (p % 2 === 0 ? p + 1 : p)))];
    for (const pos of dotPositions)
      for (let d = 0; d < dots; d++) dotList.push({ pos, x: headsRight + 0.35 * S + d * 0.55 * S });
  }

  let stem: ChordGeom['stem'] = null;
  let flag: ChordGeom['flag'] = null;
  if (hasStem(base)) {
    const x = up ? headW - STEM_W / 2 : STEM_W / 2;
    const fromPos = up ? lo : hi;
    let toPos = up ? hi + 7 : lo - 7;
    if (up && toPos < 4) toPos = 4;
    if (!up && toPos > 4) toPos = 4;
    if (hasFlag(base)) {
      // Flags need extra stem length for 16ths and 32nds.
      const extra = base === '16th' ? 1 : base === '32nd' ? 2.5 : 0;
      toPos += up ? extra : -extra;
      flag = { x: x - STEM_W / 2, pos: toPos, up };
    }
    stem = { x, fromPos, toPos, up };
  }

  const ledgerLeft = ledgers.length ? Math.min(...ledgers.map((l) => l.x1)) : 0;
  const ledgerRight = ledgers.length ? Math.max(...ledgers.map((l) => l.x2)) : 0;
  const dotsRight = dotList.length ? Math.max(...dotList.map((d) => d.x)) + 0.4 * S : 0;
  const flagRight = flag && up ? headW + 1.1 * S : 0;
  const right = Math.max(headsRight, ledgerRight, dotsRight, flagRight);
  const left = -Math.min(0, accLeft, ledgerLeft);
  return { headW, heads, accidentals, ledgers, dots: dotList, stem, flag, left, right };
}
