import { clampStaffPos, noteKey, pitchAtStaffPos, sortNotes, staffPosOf } from './pitch';
import type { Alter, ChordEvent, Composition, Duration, Note, ScoreEvent } from './types';

/** Pure edit operations. Each returns a new composition, or null when the edit is not allowed. */

export interface Selection {
  noteIds: string[];
  eventIds: string[];
}

export const EMPTY_SELECTION: Selection = { noteIds: [], eventIds: [] };

/**
 * Restore invariants: no empty chords, notes sorted, no leading bar line,
 * no two adjacent bar lines.
 */
export function normalize(events: ScoreEvent[]): ScoreEvent[] {
  const out: ScoreEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'chord') {
      if (ev.notes.length === 0) continue;
      out.push({ ...ev, notes: sortNotes(ev.notes) });
    } else if (ev.type === 'barline') {
      if (out.length === 0 || out[out.length - 1].type === 'barline') continue;
      out.push(ev);
    } else {
      out.push(ev);
    }
  }
  return out;
}

const withEvents = (comp: Composition, events: ScoreEvent[]): Composition => ({ ...comp, events: normalize(events) });

export function findEventIndex(comp: Composition, eventId: string): number {
  return comp.events.findIndex((e) => e.id === eventId);
}

export function findNote(comp: Composition, noteId: string): { chord: ChordEvent; index: number; note: Note } | null {
  for (let i = 0; i < comp.events.length; i++) {
    const ev = comp.events[i];
    if (ev.type !== 'chord') continue;
    const note = ev.notes.find((n) => n.id === noteId);
    if (note) return { chord: ev, index: i, note };
  }
  return null;
}

const chordHasPosition = (chord: ChordEvent, note: Pick<Note, 'step' | 'octave'>, exceptId?: string) =>
  chord.notes.some((n) => n.id !== exceptId && noteKey(n) === noteKey(note));

/** Insert an event at index. Returns null if the result would violate bar line rules. */
export function insertEvent(comp: Composition, index: number, event: ScoreEvent): Composition | null {
  const events = [...comp.events];
  const i = Math.max(0, Math.min(index, events.length));
  if (event.type === 'barline') {
    if (i === 0) return null;
    if (events[i - 1]?.type === 'barline' || events[i]?.type === 'barline') return null;
  }
  events.splice(i, 0, event);
  return withEvents(comp, events);
}

export function addNoteToChord(comp: Composition, eventId: string, note: Note): Composition | null {
  const idx = findEventIndex(comp, eventId);
  const ev = comp.events[idx];
  if (!ev || ev.type !== 'chord' || chordHasPosition(ev, note)) return null;
  const events = [...comp.events];
  events[idx] = { ...ev, notes: [...ev.notes, note] };
  return withEvents(comp, events);
}

export function replaceRestWithChord(comp: Composition, eventId: string, note: Note): Composition | null {
  const idx = findEventIndex(comp, eventId);
  const ev = comp.events[idx];
  if (!ev || ev.type !== 'rest') return null;
  const events = [...comp.events];
  events[idx] = { id: ev.id, type: 'chord', duration: ev.duration, notes: [note] };
  return withEvents(comp, events);
}

/** Change a note's staff position (keeps its written accidental). */
export function setNotePosition(comp: Composition, noteId: string, staffPos: number): Composition | null {
  const found = findNote(comp, noteId);
  if (!found) return null;
  const pitch = pitchAtStaffPos(staffPos, comp.clef);
  if (chordHasPosition(found.chord, pitch, noteId)) return null;
  return mapNotes(comp, (n) => (n.id === noteId ? { ...n, ...pitch } : n));
}

/** Move selected notes by a number of staff steps, clamped to the ledger range. */
export function transposeNotes(comp: Composition, noteIds: string[], steps: number): Composition | null {
  const ids = new Set(noteIds);
  let blocked = false;
  const events = comp.events.map((ev) => {
    if (ev.type !== 'chord' || !ev.notes.some((n) => ids.has(n.id))) return ev;
    const notes = ev.notes.map((n) => {
      if (!ids.has(n.id)) return n;
      const pos = clampStaffPos(staffPosOf(n, comp.clef) + steps);
      return { ...n, ...pitchAtStaffPos(pos, comp.clef) };
    });
    if (new Set(notes.map(noteKey)).size !== notes.length) blocked = true;
    return { ...ev, notes };
  });
  if (blocked) return null;
  return withEvents(comp, events);
}

/** Move a note into another chord (removing it from its own chord). */
export function moveNoteToChord(comp: Composition, noteId: string, targetEventId: string, staffPos: number): Composition | null {
  const found = findNote(comp, noteId);
  if (!found) return null;
  if (found.chord.id === targetEventId) return setNotePosition(comp, noteId, staffPos);
  const moved = { ...found.note, ...pitchAtStaffPos(staffPos, comp.clef) };
  const removed = removeItems(comp, { noteIds: [noteId], eventIds: [] });
  return addNoteToChord(removed, targetEventId, moved);
}

/** Move a note out of its chord into a new chord inserted at index (index relative to the current events). */
export function moveNoteToNewChord(comp: Composition, noteId: string, index: number, staffPos: number, newEventId: string): Composition | null {
  const found = findNote(comp, noteId);
  if (!found) return null;
  const moved = { ...found.note, ...pitchAtStaffPos(staffPos, comp.clef) };
  const chord: ChordEvent = { id: newEventId, type: 'chord', duration: found.chord.duration, notes: [moved] };
  // Strip the note in place first (empty chords stay until normalize), so `index` remains valid.
  const events: ScoreEvent[] = comp.events.map((e) =>
    e.id === found.chord.id ? { ...found.chord, notes: found.chord.notes.filter((n) => n.id !== noteId) } : e,
  );
  events.splice(index, 0, chord);
  return withEvents(comp, events);
}

/** Move a whole event (rest or bar line) to a new insertion index. */
export function moveEvent(comp: Composition, eventId: string, index: number): Composition | null {
  const from = findEventIndex(comp, eventId);
  if (from < 0) return null;
  const ev = comp.events[from];
  const events = comp.events.filter((e) => e.id !== eventId);
  const to = index > from ? index - 1 : index;
  return insertEvent({ ...comp, events }, to, ev);
}

/** Remove selected notes and events. Chords left without notes disappear. */
export function removeItems(comp: Composition, sel: Selection): Composition {
  const noteIds = new Set(sel.noteIds);
  const eventIds = new Set(sel.eventIds);
  const events = comp.events
    .filter((e) => !eventIds.has(e.id))
    .map((e) => (e.type === 'chord' ? { ...e, notes: e.notes.filter((n) => !noteIds.has(n.id)) } : e));
  return withEvents(comp, events);
}

export function mapNotes(comp: Composition, fn: (n: Note, chord: ChordEvent) => Note): Composition {
  return withEvents(
    comp,
    comp.events.map((e) => (e.type === 'chord' ? { ...e, notes: e.notes.map((n) => fn(n, e)) } : e)),
  );
}

/** Event ids targeted by a selection: selected events plus the chords of selected notes. */
export function selectedEventIds(comp: Composition, sel: Selection): Set<string> {
  const ids = new Set(sel.eventIds);
  const noteIds = new Set(sel.noteIds);
  for (const e of comp.events) if (e.type === 'chord' && e.notes.some((n) => noteIds.has(n.id))) ids.add(e.id);
  return ids;
}

/** Note ids targeted by a selection: selected notes plus all notes of selected chords. */
export function selectedNoteIds(comp: Composition, sel: Selection): Set<string> {
  const ids = new Set(sel.noteIds);
  const eventIds = new Set(sel.eventIds);
  for (const e of comp.events) if (e.type === 'chord' && eventIds.has(e.id)) e.notes.forEach((n) => ids.add(n.id));
  return ids;
}

export function setDuration(comp: Composition, sel: Selection, duration: Partial<Duration>): Composition {
  const ids = selectedEventIds(comp, sel);
  return withEvents(
    comp,
    comp.events.map((e) => (e.type !== 'barline' && ids.has(e.id) ? { ...e, duration: { ...e.duration, ...duration } } : e)),
  );
}

export function setAlter(comp: Composition, sel: Selection, alter: Alter | null): Composition {
  const ids = selectedNoteIds(comp, sel);
  return mapNotes(comp, (n) => (ids.has(n.id) ? { ...n, alter } : n));
}

export function setTie(comp: Composition, sel: Selection, tie: boolean): Composition {
  const ids = selectedNoteIds(comp, sel);
  return mapNotes(comp, (n) => {
    if (!ids.has(n.id)) return n;
    const { tieToNext: _old, ...rest } = n;
    return tie ? { ...rest, tieToNext: true } : rest;
  });
}

export function setBarlineStyle(comp: Composition, eventIds: string[], style: 'single' | 'double' | 'final'): Composition {
  const ids = new Set(eventIds);
  return withEvents(
    comp,
    comp.events.map((e) => (e.type === 'barline' && ids.has(e.id) ? { ...e, style } : e)),
  );
}

export function changeClef(comp: Composition, clef: Composition['clef']): Composition {
  // Pitches are kept; only their staff positions change.
  return { ...comp, clef };
}
