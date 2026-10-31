import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/audio/timeline';
import { newComposition } from '../src/model/defaults';
import { durationTicks, measureTicks } from '../src/model/duration';
import { analyzeMeasures, resolveAlters } from '../src/model/measures';
import {
  addNoteToChord,
  insertEvent,
  moveEvent,
  moveNoteToChord,
  moveNoteToNewChord,
  removeItems,
  setDuration,
  transposeNotes,
} from '../src/model/operations';
import { keySignaturePositions, midiNumber, pitchAtStaffPos, pitchLabel, staffPosOf } from '../src/model/pitch';
import type { Alter, BaseDuration, ChordEvent, Composition, Dots, Note, ScoreEvent, Step } from '../src/model/types';

let counter = 0;
const note = (step: Step, octave: number, alter: Alter | null = null, tieToNext = false): Note => ({
  id: `n${++counter}`,
  step,
  octave,
  alter,
  ...(tieToNext ? { tieToNext: true } : {}),
});
const chord = (notes: Note[], base: BaseDuration = 'quarter', dots: Dots = 0): ChordEvent => ({
  id: `e${++counter}`,
  type: 'chord',
  duration: { base, dots },
  notes,
});
const rest = (base: BaseDuration = 'quarter'): ScoreEvent => ({ id: `e${++counter}`, type: 'rest', duration: { base, dots: 0 } });
const bar = (): ScoreEvent => ({ id: `e${++counter}`, type: 'barline', style: 'single' });
const comp = (events: ScoreEvent[], extra: Partial<Composition> = {}): Composition => ({ ...newComposition(), ...extra, events });

describe('pitch', () => {
  it('maps staff positions for every clef', () => {
    const label = (p: number, clef: Composition['clef']) => pitchLabel(pitchAtStaffPos(p, clef));
    expect([0, 2, 3, 4, 5, 8, 10, 14, 16, -2].map((p) => label(p, 'treble'))).toEqual(['E4', 'G4', 'A4', 'B4', 'C5', 'F5', 'A5', 'E6', 'G6', 'C4']);
    expect(label(0, 'bass')).toBe('G2');
    expect(label(6, 'bass')).toBe('F3');
    expect(label(10, 'bass')).toBe('C4');
    expect(label(4, 'alto')).toBe('C4');
    expect(label(6, 'tenor')).toBe('C4');
    expect(label(-8, 'treble')).toBe('D3');
  });

  it('round-trips pitch and staff position', () => {
    for (const clef of ['treble', 'bass', 'alto', 'tenor'] as const)
      for (let p = -8; p <= 16; p++) expect(staffPosOf(pitchAtStaffPos(p, clef), clef)).toBe(p);
  });

  it('computes MIDI numbers', () => {
    expect(midiNumber('C', 4, 0)).toBe(60);
    expect(midiNumber('A', 4, 0)).toBe(69);
    expect(midiNumber('F', 4, 1)).toBe(66);
    expect(midiNumber('B', 3, 1)).toBe(60);
    expect(midiNumber('C', 4, -2)).toBe(58);
    expect(midiNumber('E', 6, 0)).toBe(88);
  });

  it('places key signatures', () => {
    expect(keySignaturePositions(2, 'treble')).toEqual([8, 5]);
    expect(keySignaturePositions(-3, 'bass')).toEqual([2, 5, 1]);
    expect(keySignaturePositions(1, 'tenor')).toEqual([2]);
  });
});

describe('duration & measures', () => {
  it('computes ticks', () => {
    expect(durationTicks({ base: 'quarter', dots: 0 })).toBe(480);
    expect(durationTicks({ base: 'half', dots: 1 })).toBe(1440);
    expect(durationTicks({ base: 'quarter', dots: 2 })).toBe(840);
    expect(durationTicks({ base: '32nd', dots: 0 })).toBe(60);
    expect(measureTicks({ beats: 6, beatType: 8 })).toBe(1440);
  });

  it('computes automatic bar lines when there are no manual ones', () => {
    const c = comp([chord([note('C', 4)], 'half'), chord([note('D', 4)], 'half'), chord([note('E', 4)], 'whole'), chord([note('F', 4)])]);
    const a = analyzeMeasures(c);
    expect([...a.autoBarAfter]).toEqual([1, 2]);
    expect(a.measures.map((m) => m.warning)).toEqual([false, false, false]);
  });

  it('flags wrong measures but not pickups or the unfinished last measure', () => {
    const c = comp([chord([note('C', 4)]), bar(), chord([note('C', 4)], 'whole', 1), bar(), chord([note('C', 4)], 'half'), bar(), chord([note('C', 4)])]);
    const a = analyzeMeasures(c);
    expect(a.hasManualBarlines).toBe(true);
    expect(a.measures.map((m) => m.warning)).toEqual([false, true, true, false]);
    expect(a.autoBarAfter.size).toBe(0);
  });
});

describe('accidentals', () => {
  it('carries accidentals through the measure and resets after a bar line (AC-9)', () => {
    const fs = note('F', 4, 1);
    const f1 = note('F', 4);
    const f2 = note('F', 4);
    const c = comp([chord([fs]), chord([f1]), bar(), chord([f2])]);
    const tl = buildTimeline(c);
    expect(tl.map((e) => e.notes[0].midi)).toEqual([66, 66, 65]);
  });

  it('applies the key signature and explicit naturals', () => {
    const f1 = note('F', 5);
    const f2 = note('F', 5, 0);
    const f3 = note('F', 5);
    const alters = resolveAlters(comp([chord([f1]), chord([f2]), chord([f3])], { keySignature: 1 }));
    expect([alters.get(f1.id), alters.get(f2.id), alters.get(f3.id)]).toEqual([1, 0, 0]);
  });

  it('does not apply accidentals to other octaves', () => {
    const a = note('F', 4, 1);
    const b = note('F', 5);
    const alters = resolveAlters(comp([chord([a]), chord([b])]));
    expect(alters.get(b.id)).toBe(0);
  });

  it('keeps a tied note sharp across the bar line', () => {
    const a = note('F', 4, 1, true);
    const b = note('F', 4);
    const tl = buildTimeline(comp([chord([a], 'whole'), bar(), chord([b])]));
    expect(tl[0].notes).toEqual([{ midi: 66, ticks: 1920 + 480, tied: true }]);
    expect(tl[1].notes).toEqual([]);
  });
});

describe('timeline', () => {
  it('rests take time, bar lines do not', () => {
    const tl = buildTimeline(comp([chord([note('C', 4)]), rest('half'), bar(), chord([note('C', 4), note('E', 4)], 'eighth')]));
    expect(tl.map((e) => [e.startTick, e.ticks, e.notes.length])).toEqual([
      [0, 480, 1],
      [480, 960, 0],
      [1440, 240, 2],
    ]);
  });

  it('ignores a dangling tie', () => {
    const tl = buildTimeline(comp([chord([note('C', 4, null, true)]), chord([note('D', 4)])]));
    expect(tl[0].notes[0].ticks).toBe(480);
    expect(tl[1].notes).toHaveLength(1);
  });
});

describe('operations', () => {
  it('inserts and keeps chord notes sorted, rejecting duplicates', () => {
    const c0 = comp([]);
    const n1 = note('G', 4);
    const ev = chord([n1]);
    const c1 = insertEvent(c0, 0, ev)!;
    const c2 = addNoteToChord(c1, ev.id, note('C', 5))!;
    const c3 = addNoteToChord(c2, ev.id, note('E', 4))!;
    expect((c3.events[0] as ChordEvent).notes.map((n) => pitchLabel(n))).toEqual(['E4', 'G4', 'C5']);
    expect(addNoteToChord(c3, ev.id, note('G', 4))).toBeNull();
  });

  it('rejects leading and adjacent bar lines', () => {
    const c = comp([chord([note('C', 4)]), bar(), chord([note('D', 4)])]);
    expect(insertEvent(c, 0, bar())).toBeNull();
    expect(insertEvent(c, 1, bar())).toBeNull();
    expect(insertEvent(c, 2, bar())).toBeNull();
    expect(insertEvent(c, 3, bar())).not.toBeNull();
  });

  it('removes empty chords and merges bar lines after deletion', () => {
    const n = note('C', 4);
    const c = comp([chord([note('D', 4)]), bar(), chord([n]), bar(), chord([note('E', 4)])]);
    const r = removeItems(c, { noteIds: [n.id], eventIds: [] });
    expect(r.events.map((e) => e.type)).toEqual(['chord', 'barline', 'chord']);
  });

  it('moves notes between chords and into new chords', () => {
    const a = note('C', 4);
    const b = note('E', 4);
    const e1 = chord([a, b]);
    const e2 = chord([note('G', 4)], 'half');
    const c = comp([e1, e2]);
    const moved = moveNoteToChord(c, b.id, e2.id, 5)!; // C5
    expect(moved.events.map((e) => (e as ChordEvent).notes.map((n) => pitchLabel(n)))).toEqual([['C4'], ['G4', 'C5']]);
    const split = moveNoteToNewChord(c, b.id, 1, 1, 'new')!; // F4, between e1 and e2
    expect(split.events.map((e) => e.id)).toEqual([e1.id, 'new', e2.id]);
    expect((split.events[1] as ChordEvent).duration.base).toBe('quarter');
    expect(pitchLabel((split.events[1] as ChordEvent).notes[0])).toBe('F4');
  });

  it('moves a rest', () => {
    const r = rest();
    const c = comp([r, chord([note('C', 4)]), chord([note('D', 4)])]);
    expect(moveEvent(c, r.id, 3)!.events[2].id).toBe(r.id);
  });

  it('transposes within the ledger range and changes durations', () => {
    const n = note('F', 6); // p = 15 in treble
    const c = comp([chord([n])]);
    const up = transposeNotes(c, [n.id], 7)!;
    expect(pitchLabel((up.events[0] as ChordEvent).notes[0])).toBe('G6');
    const d = setDuration(c, { noteIds: [n.id], eventIds: [] }, { base: 'half', dots: 1 });
    expect((d.events[0] as ChordEvent).duration).toEqual({ base: 'half', dots: 1 });
  });
});
