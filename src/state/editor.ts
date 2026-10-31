import { EMPTY_SELECTION, type Selection } from '../model/operations';
import type { Composition } from '../model/types';

export const HISTORY_LIMIT = 200;

export interface EditorState {
  comp: Composition;
  selection: Selection;
  past: Composition[];
  future: Composition[];
  /** Key of the last edit; consecutive edits with the same key share one undo step (e.g. typing a title). */
  lastKey: string | null;
}

export type EditResult = { comp: Composition; selection?: Selection } | null;

export type EditorAction =
  | { type: 'apply'; fn: (comp: Composition, selection: Selection) => EditResult; key?: string }
  | { type: 'select'; selection: Selection }
  | { type: 'undo' }
  | { type: 'redo' };

export const initialEditor = (comp: Composition): EditorState => ({
  comp,
  selection: EMPTY_SELECTION,
  past: [],
  future: [],
  lastKey: null,
});

/** Drop selected ids that no longer exist. */
function pruneSelection(comp: Composition, sel: Selection): Selection {
  const eventIds = new Set(comp.events.map((e) => e.id));
  const noteIds = new Set(comp.events.flatMap((e) => (e.type === 'chord' ? e.notes.map((n) => n.id) : [])));
  const next = { noteIds: sel.noteIds.filter((id) => noteIds.has(id)), eventIds: sel.eventIds.filter((id) => eventIds.has(id)) };
  return next.noteIds.length === sel.noteIds.length && next.eventIds.length === sel.eventIds.length ? sel : next;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'apply': {
      const result = action.fn(state.comp, state.selection);
      if (!result || result.comp === state.comp) {
        return result?.selection ? { ...state, selection: result.selection } : state;
      }
      const coalesce = action.key !== undefined && action.key === state.lastKey;
      const past = coalesce ? state.past : [...state.past, state.comp].slice(-HISTORY_LIMIT);
      return {
        comp: result.comp,
        selection: pruneSelection(result.comp, result.selection ?? state.selection),
        past,
        future: [],
        lastKey: action.key ?? null,
      };
    }
    case 'select':
      return { ...state, selection: action.selection, lastKey: null };
    case 'undo': {
      if (!state.past.length) return state;
      const comp = state.past[state.past.length - 1];
      return {
        comp,
        selection: pruneSelection(comp, state.selection),
        past: state.past.slice(0, -1),
        future: [state.comp, ...state.future],
        lastKey: null,
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const comp = state.future[0];
      return {
        comp,
        selection: pruneSelection(comp, state.selection),
        past: [...state.past, state.comp],
        future: state.future.slice(1),
        lastKey: null,
      };
    }
  }
}
