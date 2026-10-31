import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitDrop, type Tool } from '../src/interaction/commit';
import { hitTest } from '../src/interaction/hitTest';
import { COLUMN_HALF, S } from '../src/layout/constants';
import { computeLayout, posY } from '../src/layout/layout';
import { newComposition } from '../src/model/defaults';
import { pitchLabel } from '../src/model/pitch';
import { ImportError, parseFile, serialize } from '../src/model/schema';
import type { ChordEvent, Composition } from '../src/model/types';

const tool: Tool = { mode: 'note', duration: { base: 'quarter', dots: 0 }, alter: null, tie: false, barStyle: 'single', placement: 'auto' };
let n = 0;
const ids = () => ({ eventId: `e${++n}`, noteId: `n${n}` });

/** Drop the current tool at staff position `pos`, at x, on system 0. */
function dropAt(comp: Composition, x: number | 'end', pos: number, opts: { shift?: boolean; t?: Tool } = {}) {
  const layout = computeLayout(comp, 900, true);
  const sys = layout.systems[0];
  const px = x === 'end' ? sys.staffX1 - 4 * S : x;
  const target = hitTest(layout, px, posY(sys.staffTop, pos), { mode: (opts.t ?? tool).mode === 'note' ? 'note' : 'insert', forceNew: !!opts.shift });
  const res = commitDrop(comp, { kind: 'palette', tool: opts.t ?? tool }, target, ids());
  if (!res || 'error' in res) return { comp, target, res };
  return { comp: res.comp, target, res };
}

const centerOf = (comp: Composition, eventIndex: number) => {
  const layout = computeLayout(comp, 900, true);
  const [s, i] = layout.itemOf.get(eventIndex)!;
  return layout.systems[s].items[i].center;
};

describe('drop targeting (AC-3..AC-7)', () => {
  it('inserts into the empty staff, builds a chord, appends, and Shift forces insert', () => {
    let c = newComposition();
    c = dropAt(c, 'end', 2).comp; // G4
    expect(c.events).toHaveLength(1);

    const cx = centerOf(c, 0);
    c = dropAt(c, cx, 0).comp; // E4 into the chord
    c = dropAt(c, cx + COLUMN_HALF * 0.8, 5).comp; // C5, still within the column
    expect(c.events).toHaveLength(1);
    expect((c.events[0] as ChordEvent).notes.map((x) => pitchLabel(x))).toEqual(['E4', 'G4', 'C5']);

    c = dropAt(c, 'end', 4, { t: { ...tool, duration: { base: 'half', dots: 0 } } }).comp;
    expect(c.events).toHaveLength(2);
    expect((c.events[1] as ChordEvent).duration.base).toBe('half');

    const r = dropAt(c, centerOf(c, 0) + 1, 3, { shift: true });
    expect(r.target.kind).toBe('gap');
    expect(r.comp.events).toHaveLength(3);
    expect(r.comp.events[1].type).toBe('chord');
    expect((r.comp.events[0] as ChordEvent).notes).toHaveLength(3);
  });

  it('inserts before an event when dropped left of it', () => {
    let c = dropAt(newComposition(), 'end', 2).comp;
    const r = dropAt(c, centerOf(c, 0) - 3 * S, 4);
    expect(r.target).toMatchObject({ kind: 'gap', insertIndex: 0 });
    c = r.comp;
    expect(pitchLabel((c.events[0] as ChordEvent).notes[0])).toBe('B4');
  });

  it('clamps to four ledger lines', () => {
    const r = dropAt(newComposition(), 'end', 19);
    expect(pitchLabel((r.comp.events[0] as ChordEvent).notes[0])).toBe('G6');
    const low = dropAt(newComposition(), 'end', -11);
    expect(pitchLabel((low.comp.events[0] as ChordEvent).notes[0])).toBe('D3');
  });

  it('rejects a duplicate note in a chord', () => {
    const c = dropAt(newComposition(), 'end', 2).comp;
    const r = dropAt(c, centerOf(c, 0), 2);
    expect(r.res && 'error' in r.res).toBe(true);
  });

  it('places bar lines only in gaps, and rests never join chords', () => {
    let c = dropAt(newComposition(), 'end', 2).comp;
    c = dropAt(c, 'end', 3).comp;
    const barTool: Tool = { ...tool, mode: 'barline' };
    const r = dropAt(c, (centerOf(c, 0) + centerOf(c, 1)) / 2, 4, { t: barTool });
    expect(r.comp.events.map((e) => e.type)).toEqual(['chord', 'barline', 'chord']);
    const restTool: Tool = { ...tool, mode: 'rest' };
    const r2 = dropAt(r.comp, centerOf(r.comp, 0), 4, { t: restTool });
    expect(r2.comp.events.map((e) => e.type)).toEqual(['chord', 'rest', 'barline', 'chord']);
  });

  it('replaces a rest with a note dropped on it', () => {
    const c = dropAt(newComposition(), 'end', 4, { t: { ...tool, mode: 'rest', duration: { base: 'half', dots: 0 } } }).comp;
    const r = dropAt(c, centerOf(c, 0), 2);
    expect(r.comp.events[0]).toMatchObject({ type: 'chord', duration: { base: 'half' } });
  });

  it('deletes a dragged note (AC-15)', () => {
    const c = dropAt(newComposition(), 'end', 2).comp;
    const noteId = (c.events[0] as ChordEvent).notes[0].id;
    const res = commitDrop(c, { kind: 'note', noteId, eventId: c.events[0].id }, { kind: 'delete' }, ids());
    expect(res && 'comp' in res && res.comp.events).toEqual([]);
  });

  it('wraps long scores into several systems', () => {
    let c = newComposition();
    for (let i = 0; i < 60; i++) c = dropAt(c, 'end', i % 9).comp;
    // dropAt always hits system 0's end; just check layout of a long composition
    const layout = computeLayout(c, 600, true);
    expect(layout.systems.length).toBeGreaterThan(2);
    const last = layout.systems[layout.systems.length - 1];
    expect(last.endIndex).toBe(c.events.length);
  });
});

describe('file format (AC-12, AC-13)', () => {
  const example = readFileSync(new URL('../public/examples/ode-to-joy.smp.json', import.meta.url), 'utf8');

  it('parses the example and round-trips', () => {
    const c = parseFile(example);
    expect(c.title).toBe('Ode to Joy (excerpt)');
    expect(parseFile(serialize(c))).toEqual(c);
  });

  it('reports the path of the first problem', () => {
    const doc = JSON.parse(example);
    doc.composition.events[5].notes[0].octave = 12;
    expect(() => parseFile(JSON.stringify(doc))).toThrow(/composition\.events\[5\]\.notes\[0\]\.octave: expected 0\.\.8/);
  });

  it('rejects newer versions, wrong formats and broken invariants', () => {
    const doc = JSON.parse(example);
    expect(() => parseFile(JSON.stringify({ ...doc, version: 99 }))).toThrow(/newer version/);
    expect(() => parseFile(JSON.stringify({ ...doc, format: 'x' }))).toThrow(ImportError);
    expect(() => parseFile('{nope')).toThrow(/not valid JSON/);
    const bad = JSON.parse(example);
    bad.composition.events.unshift({ type: 'barline', style: 'single' });
    expect(() => parseFile(JSON.stringify(bad))).toThrow(/first event/);
  });

  it('generates missing ids and ignores unknown properties', () => {
    const c = parseFile(
      JSON.stringify({
        format: 'sheet-music-pad',
        version: 1,
        extra: true,
        composition: { ...newComposition(), events: [{ type: 'chord', duration: { base: 'half', dots: 0 }, notes: [{ step: 'A', octave: 4, alter: null, colour: 'red' }] }] },
      }),
    );
    const ev = c.events[0] as ChordEvent;
    expect(ev.id).toBeTruthy();
    expect(ev.notes[0].id).toBeTruthy();
    expect(ev.notes[0]).not.toHaveProperty('colour');
  });
});
