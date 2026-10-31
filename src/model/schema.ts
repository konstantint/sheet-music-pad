import { z } from 'zod';
import { newId } from './defaults';
import { noteKey, sortNotes } from './pitch';
import type { Composition, ScoreEvent } from './types';

/** The single definition of the Sheet Music Pad file format (spec §6). */

export const FORMAT_NAME = 'sheet-music-pad';
export const FORMAT_VERSION = 1;

const durationSchema = z.object({
  base: z.enum(['whole', 'half', 'quarter', 'eighth', '16th', '32nd']),
  dots: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

const alterSchema = z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]);

const noteSchema = z.object({
  id: z.string().min(1).optional(),
  step: z.enum(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
  octave: z.number().int().min(0, 'expected 0..8').max(8, 'expected 0..8'),
  alter: alterSchema.nullable(),
  tieToNext: z.boolean().optional(),
});

const eventSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1).optional(), type: z.literal('chord'), duration: durationSchema, notes: z.array(noteSchema).min(1, 'a chord needs at least one note') }),
  z.object({ id: z.string().min(1).optional(), type: z.literal('rest'), duration: durationSchema }),
  z.object({ id: z.string().min(1).optional(), type: z.literal('barline'), style: z.enum(['single', 'double', 'final']) }),
]);

const compositionSchema = z.object({
  title: z.string(),
  tempo: z.number().min(20, 'expected 20..300').max(300, 'expected 20..300'),
  clef: z.enum(['treble', 'bass', 'alto', 'tenor']),
  timeSignature: z.object({
    beats: z.number().int().min(1, 'expected 1..16').max(16, 'expected 1..16'),
    beatType: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
    symbol: z.enum(['common', 'cut']).optional(),
  }),
  keySignature: z.number().int().min(-7, 'expected -7..7').max(7, 'expected -7..7'),
  events: z.array(eventSchema),
});

export const fileSchema = z.object({
  format: z.literal(FORMAT_NAME),
  version: z.number().int().min(1),
  composition: compositionSchema,
});

export interface SmpFile {
  format: typeof FORMAT_NAME;
  version: number;
  composition: Composition;
}

export class ImportError extends Error {}

const formatPath = (path: PropertyKey[]): string =>
  path.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), '');

/** Migrations from version N to N+1, keyed by N. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

function migrate(doc: Record<string, unknown>): Record<string, unknown> {
  let current = doc;
  while (typeof current.version === 'number' && current.version < FORMAT_VERSION) {
    const step = MIGRATIONS[current.version];
    if (!step) throw new ImportError(`No migration from version ${current.version}`);
    current = step(current);
  }
  return current;
}

function checkInvariants(events: ScoreEvent[]): string | null {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'barline') {
      if (i === 0) return `events[${i}]: a bar line cannot be the first event`;
      if (events[i - 1].type === 'barline') return `events[${i}]: two bar lines cannot be adjacent`;
    }
    if (ev.type === 'chord') {
      const keys = ev.notes.map(noteKey);
      const dup = keys.findIndex((k, j) => keys.indexOf(k) !== j);
      if (dup >= 0) return `events[${i}].notes[${dup}]: duplicate pitch ${keys[dup]} in chord`;
    }
  }
  return null;
}

/** Parse and validate file contents. Throws ImportError with a readable message. */
export function parseFile(text: string): Composition {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ImportError('The file does not contain a JSON object.');
  const doc = raw as Record<string, unknown>;
  if (doc.format !== FORMAT_NAME) throw new ImportError(`format: expected "${FORMAT_NAME}"`);
  if (typeof doc.version === 'number' && doc.version > FORMAT_VERSION)
    throw new ImportError('This file was made by a newer version of Sheet Music Pad.');

  const result = fileSchema.safeParse(migrate(doc));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ImportError(`${formatPath(issue.path) || 'file'}: ${issue.message}`);
  }
  const comp = result.data.composition;
  const events: ScoreEvent[] = comp.events.map((e) => {
    const id = e.id ?? newId();
    if (e.type === 'chord') {
      return {
        id,
        type: 'chord',
        duration: e.duration,
        notes: sortNotes(e.notes).map((n) => ({
          id: n.id ?? newId(),
          step: n.step,
          octave: n.octave,
          alter: n.alter,
          ...(n.tieToNext ? { tieToNext: true } : {}),
        })),
      };
    }
    return e.type === 'rest' ? { id, type: 'rest', duration: e.duration } : { id, type: 'barline', style: e.style };
  });
  const problem = checkInvariants(events);
  if (problem) throw new ImportError(`composition.${problem}`);
  const ts = comp.timeSignature;
  return {
    title: comp.title,
    tempo: comp.tempo,
    clef: comp.clef,
    timeSignature: { beats: ts.beats, beatType: ts.beatType, ...(ts.symbol ? { symbol: ts.symbol } : {}) },
    keySignature: comp.keySignature,
    events,
  };
}

export function serialize(comp: Composition): string {
  const file: SmpFile = { format: FORMAT_NAME, version: FORMAT_VERSION, composition: comp };
  return JSON.stringify(file, null, 2);
}
