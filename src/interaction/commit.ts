import { durationLabel } from '../model/duration';
import {
  addNoteToChord,
  findEventIndex,
  findNote,
  insertEvent,
  moveEvent,
  moveNoteToChord,
  moveNoteToNewChord,
  removeItems,
  replaceRestWithChord,
  type Selection,
} from '../model/operations';
import { pitchAtStaffPos } from '../model/pitch';
import type { Alter, BarlineStyle, Composition, Duration, Note } from '../model/types';
import type { Target } from './hitTest';

export type ToolMode = 'note' | 'rest' | 'barline';

export interface Tool {
  mode: ToolMode;
  duration: Duration;
  alter: Alter | null;
  tie: boolean;
  barStyle: BarlineStyle;
  /** 'new' always inserts (touch-friendly equivalent of holding Shift). */
  placement: 'auto' | 'new';
}

export type DragSource =
  | { kind: 'palette'; tool: Tool }
  | { kind: 'note'; noteId: string; eventId: string }
  | { kind: 'event'; eventId: string };

export type DropTarget = Target | { kind: 'delete' };

export interface CommitResult {
  comp: Composition;
  selection: Selection;
  message?: string;
}

export interface CommitFailure {
  error: string;
  /** Event to shake to show the rejection. */
  shakeEventId?: string;
}

export interface NewIds {
  eventId: string;
  noteId: string;
}

/** Hit-test mode for a drag source. */
export function hitModeFor(source: DragSource): 'note' | 'insert' {
  if (source.kind === 'palette') return source.tool.mode === 'note' ? 'note' : 'insert';
  return source.kind === 'note' ? 'note' : 'insert';
}

/** Apply a drop. Pure: ids for new objects are passed in. */
export function commitDrop(comp: Composition, source: DragSource, target: DropTarget, ids: NewIds): CommitResult | CommitFailure | null {
  if (target.kind === 'none') return null;

  if (source.kind === 'palette') {
    if (target.kind === 'delete') return null;
    const tool = source.tool;
    if (tool.mode === 'barline') {
      if (target.kind !== 'gap') return null;
      const next = insertEvent(comp, target.insertIndex, { id: ids.eventId, type: 'barline', style: tool.barStyle });
      if (!next) return { error: 'A bar line cannot go at the start or next to another bar line.' };
      return { comp: next, selection: { noteIds: [], eventIds: [ids.eventId] } };
    }
    if (tool.mode === 'rest') {
      if (target.kind !== 'gap') return null;
      const next = insertEvent(comp, target.insertIndex, { id: ids.eventId, type: 'rest', duration: tool.duration });
      return next && { comp: next, selection: { noteIds: [], eventIds: [ids.eventId] } };
    }
    const note: Note = {
      id: ids.noteId,
      ...pitchAtStaffPos(target.pos, comp.clef),
      alter: tool.alter,
      ...(tool.tie ? { tieToNext: true } : {}),
    };
    const selection = { noteIds: [ids.noteId], eventIds: [] };
    if (target.kind === 'chord') {
      const chord = comp.events[target.eventIndex];
      const next = addNoteToChord(comp, chord.id, note);
      if (!next) return { error: 'That chord already has a note there.', shakeEventId: chord.id };
      const keeps = chord.type === 'chord' && (chord.duration.base !== tool.duration.base || chord.duration.dots !== tool.duration.dots);
      return { comp: next, selection, message: keeps ? `Added to chord (keeps ${durationLabel((chord as { duration: Duration }).duration)} duration)` : undefined };
    }
    if (target.kind === 'rest') {
      const next = replaceRestWithChord(comp, comp.events[target.eventIndex].id, note);
      return next && { comp: next, selection };
    }
    const next = insertEvent(comp, target.insertIndex, { id: ids.eventId, type: 'chord', duration: tool.duration, notes: [note] });
    return next && { comp: next, selection };
  }

  if (source.kind === 'note') {
    const selection = { noteIds: [source.noteId], eventIds: [] };
    if (target.kind === 'delete') return { comp: removeItems(comp, { noteIds: [source.noteId], eventIds: [] }), selection: { noteIds: [], eventIds: [] } };
    const found = findNote(comp, source.noteId);
    if (!found) return null;
    if (target.kind === 'chord') {
      const targetChord = comp.events[target.eventIndex];
      const next = moveNoteToChord(comp, source.noteId, targetChord.id, target.pos);
      if (!next) return { error: 'That chord already has a note there.', shakeEventId: targetChord.id };
      return { comp: next, selection };
    }
    if (target.kind === 'rest') {
      // Treat as moving the note onto the rest: the rest becomes a chord.
      const rest = comp.events[target.eventIndex];
      const moved = { ...found.note, ...pitchAtStaffPos(target.pos, comp.clef) };
      const next = replaceRestWithChord(removeItems(comp, { noteIds: [source.noteId], eventIds: [] }), rest.id, moved);
      return next && { comp: next, selection };
    }
    // Dropping right next to its own single-note chord just changes pitch.
    const srcIndex = found.index;
    if (found.chord.notes.length === 1 && (target.insertIndex === srcIndex || target.insertIndex === srcIndex + 1)) {
      const next = moveNoteToChord(comp, source.noteId, found.chord.id, target.pos);
      return next && { comp: next, selection };
    }
    const next = moveNoteToNewChord(comp, source.noteId, target.insertIndex, target.pos, ids.eventId);
    return next && { comp: next, selection };
  }

  // Whole event (rest or bar line)
  if (target.kind === 'delete') return { comp: removeItems(comp, { noteIds: [], eventIds: [source.eventId] }), selection: { noteIds: [], eventIds: [] } };
  if (target.kind !== 'gap') return null;
  const from = findEventIndex(comp, source.eventId);
  if (target.insertIndex === from || target.insertIndex === from + 1) return null;
  const next = moveEvent(comp, source.eventId, target.insertIndex);
  if (!next) return { error: 'A bar line cannot go at the start or next to another bar line.' };
  return { comp: next, selection: { noteIds: [], eventIds: [source.eventId] } };
}
