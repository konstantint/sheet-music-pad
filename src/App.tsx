import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { startTickOf } from './audio/player';
import { useAudio } from './audio/useAudio';
import { Palette, type PaletteView } from './components/Palette';
import { ScoreView } from './components/score/ScoreView';
import { Header, SettingsBar, Transport } from './components/Toolbars';
import { commitDrop, type DragSource, type DropTarget, type Tool } from './interaction/commit';
import { useDrag } from './interaction/useDrag';
import { SYSTEM_HEIGHT } from './layout/constants';
import { computeLayout } from './layout/layout';
import { newComposition, newId } from './model/defaults';
import { durationLabel, formatBeats } from './model/duration';
import { resolveAlters } from './model/measures';
import {
  EMPTY_SELECTION,
  findNote,
  insertEvent,
  removeItems,
  selectedEventIds,
  selectedNoteIds,
  setAlter,
  setBarlineStyle,
  setDuration,
  setTie,
  transposeNotes,
  addNoteToChord,
  type Selection,
} from './model/operations';
import { clampStaffPos, diatonicIndex, fromDiatonic, keyAlter, midiNumber, pitchAtStaffPos, pitchLabel, staffPosOf } from './model/pitch';
import { ImportError, parseFile, serialize } from './model/schema';
import type { Alter, BarlineStyle, BaseDuration, Composition, Dots, ScoreEvent, Step } from './model/types';
import { BASE_DURATIONS } from './model/types';
import { editorReducer, initialEditor, type EditResult } from './state/editor';
import { loadSettings, loadStoredComposition, saveSettings, storeComposition } from './state/storage';

const DEFAULT_TOOL: Tool = {
  mode: 'note',
  duration: { base: 'quarter', dots: 0 },
  alter: null,
  tie: false,
  barStyle: 'single',
  placement: 'auto',
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';

function describeSelection(comp: Composition, sel: Selection): string {
  const count = sel.noteIds.length + sel.eventIds.length;
  if (count === 0) return '';
  if (count > 1) return `${count} items selected`;
  if (sel.noteIds.length === 1) {
    const f = findNote(comp, sel.noteIds[0]);
    if (!f) return '';
    return `Note ${pitchLabel(f.note, f.note.alter)}${f.note.tieToNext ? ' (tied)' : ''}, ${durationLabel(f.chord.duration)}`;
  }
  const ev = comp.events.find((e) => e.id === sel.eventIds[0]);
  if (!ev) return '';
  if (ev.type === 'chord') return `Chord ${ev.notes.map((n) => pitchLabel(n, n.alter)).join(' ')}, ${durationLabel(ev.duration)}`;
  if (ev.type === 'rest') return `${durationLabel(ev.duration)} rest`;
  return `${ev.style} bar line`;
}

export default function App() {
  const [editor, dispatch] = useReducer(editorReducer, undefined, () => initialEditor(loadStoredComposition() ?? newComposition()));
  const { comp, selection } = editor;
  const initialSettings = useMemo(loadSettings, []);
  const [tool, setTool] = useState<Tool>({ ...DEFAULT_TOOL, placement: initialSettings.placement ?? 'auto' });
  const [autoBarlines, setAutoBarlines] = useState(initialSettings.autoBarlines ?? true);
  const [previewSound, setPreviewSound] = useState(initialSettings.previewSound ?? true);
  /** Selection made by clicking/navigating (palette clicks edit it) vs. the soft selection after placing a note. */
  const [explicitSel, setExplicitSel] = useState(false);
  const explicitSincePlay = useRef(false);
  const [message, setMessage] = useState<{ text: string; kind: 'info' | 'error' } | null>(null);
  const [shakeEventId, setShakeEventId] = useState<string | null>(null);
  const [width, setWidth] = useState(900);

  const compRef = useRef(comp);
  compRef.current = comp;
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setMessage({ text, kind });
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), kind === 'error' ? 8000 : 3500);
  }, []);

  const getComp = useCallback(() => compRef.current, []);
  const audio = useAudio(getComp, flash);

  const edit = useCallback((fn: (c: Composition, s: Selection) => EditResult, key?: string) => dispatch({ type: 'apply', fn, key }), []);
  const select = useCallback((sel: Selection, explicit: boolean) => {
    dispatch({ type: 'select', selection: sel });
    setExplicitSel(explicit);
    if (explicit) explicitSincePlay.current = true;
  }, []);

  const shake = useCallback((id?: string) => {
    if (!id) return;
    setShakeEventId(id);
    setTimeout(() => setShakeEventId(null), 450);
  }, []);

  // ---- layout ----
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, vp.clientWidth)));
    ro.observe(vp);
    setWidth(Math.max(320, vp.clientWidth));
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => computeLayout(comp, width, autoBarlines), [comp, width, autoBarlines]);

  // ---- persistence ----
  useEffect(() => {
    const t = setTimeout(() => storeComposition(serialize(comp)), 500);
    return () => clearTimeout(t);
  }, [comp]);
  useEffect(() => saveSettings({ autoBarlines, previewSound, placement: tool.placement }), [autoBarlines, previewSound, tool.placement]);

  // ---- sound helpers ----
  const chordMidis = useCallback((c: Composition, noteId: string): number[] => {
    const f = findNote(c, noteId);
    if (!f) return [];
    const alters = resolveAlters(c);
    return f.chord.notes.map((n) => midiNumber(n.step, n.octave, alters.get(n.id) ?? 0));
  }, []);
  const previewChord = useCallback(
    (c: Composition, noteId: string) => {
      if (previewSound) audio.preview(chordMidis(c, noteId));
    },
    [previewSound, audio, chordMidis],
  );

  // ---- drag & drop ----
  const onDrop = useCallback(
    (source: DragSource, target: DropTarget) => {
      if (target.kind === 'none') return;
      const c = compRef.current;
      const res = commitDrop(c, source, target, { eventId: newId(), noteId: newId() });
      if (!res) return;
      if ('error' in res) {
        flash(res.error, 'error');
        shake(res.shakeEventId);
        return;
      }
      edit(() => ({ comp: res.comp, selection: res.selection }));
      setExplicitSel(source.kind !== 'palette');
      if (res.message) flash(res.message);
      if (target.kind === 'delete') flash('Deleted');
      // Dragging a note/rest makes it the current tool; a dragged bar line leaves the tool alone.
      if (source.kind === 'palette' && source.tool.mode !== 'barline') {
        const t = source.tool;
        setTool((prev) => ({ ...prev, mode: t.mode, duration: t.duration }));
      }
      if (res.selection.noteIds.length) previewChord(res.comp, res.selection.noteIds[0]);
    },
    [edit, flash, shake, previewChord],
  );

  const onPositionChange = useCallback(
    (source: DragSource, target: DropTarget) => {
      if (!previewSound || !('pos' in target)) return;
      const c = compRef.current;
      let alter: Alter | null;
      if (source.kind === 'palette') {
        if (source.tool.mode !== 'note') return;
        alter = source.tool.alter;
      } else if (source.kind === 'note') {
        alter = findNote(c, source.noteId)?.note.alter ?? null;
      } else return;
      const p = pitchAtStaffPos(target.pos, c.clef);
      audio.preview([midiNumber(p.step, p.octave, alter ?? keyAlter(p.step, c.keySignature))], 0.25);
    },
    [previewSound, audio],
  );

  const onClick = useCallback(
    (source: DragSource, e: PointerEvent, target: DropTarget, clickPlaces: boolean) => {
      const sel = editor.selection;
      if (source.kind === 'palette') {
        if (!clickPlaces) return;
        if (target.kind === 'none') select(EMPTY_SELECTION, false);
        else onDrop(source, target);
        return;
      }
      const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
      if (source.kind === 'note') {
        select(e.shiftKey ? { ...sel, noteIds: toggle(sel.noteIds, source.noteId) } : { noteIds: [source.noteId], eventIds: [] }, true);
        previewChord(compRef.current, source.noteId);
      } else {
        select(e.shiftKey ? { ...sel, eventIds: toggle(sel.eventIds, source.eventId) } : { noteIds: [], eventIds: [source.eventId] }, true);
      }
    },
    [editor.selection, select, onDrop, previewChord],
  );

  const drag = useDrag({ comp, layout, tool, svgRef, viewportRef, onDrop, onClick, onPositionChange });

  const onNotePointerDown = useCallback(
    (e: React.PointerEvent, noteId: string, eventId: string) => {
      e.stopPropagation();
      drag.start(e, { kind: 'note', noteId, eventId });
    },
    [drag.start],
  );
  const onEventPointerDown = useCallback(
    (e: React.PointerEvent, eventId: string) => {
      e.stopPropagation();
      drag.start(e, { kind: 'event', eventId });
    },
    [drag.start],
  );
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => drag.start(e, { kind: 'palette', tool }, true), [drag.start, tool]);

  // ---- palette ----
  const paletteActive = explicitSel && (selection.noteIds.length > 0 || selection.eventIds.length > 0);
  const paletteView: PaletteView = useMemo(() => {
    if (!paletteActive) {
      return {
        mode: tool.mode,
        base: tool.mode === 'barline' ? null : tool.duration.base,
        dots: tool.mode === 'barline' ? null : tool.duration.dots,
        alter: tool.alter,
        tie: tool.tie,
        barStyle: tool.mode === 'barline' ? tool.barStyle : null,
        placement: tool.placement,
      };
    }
    const evIds = selectedEventIds(comp, selection);
    const events = comp.events.filter((e) => evIds.has(e.id));
    const timed = events.filter((e) => e.type !== 'barline') as Exclude<ScoreEvent, { type: 'barline' }>[];
    const noteIds = selectedNoteIds(comp, selection);
    const notes = comp.events.flatMap((e) => (e.type === 'chord' ? e.notes.filter((n) => noteIds.has(n.id)) : []));
    const bars = events.filter((e) => e.type === 'barline');
    const same = <T,>(xs: T[]): T | 'mixed' | null => (xs.length === 0 ? null : xs.every((x) => x === xs[0]) ? xs[0] : 'mixed');
    return {
      mode: tool.mode,
      base: same(timed.map((e) => e.duration.base)),
      dots: same(timed.map((e) => e.duration.dots)),
      alter: notes.length ? (same(notes.map((n) => n.alter)) ?? null) : null,
      tie: notes.length ? (same(notes.map((n) => !!n.tieToNext)) ?? false) : false,
      barStyle: bars.length ? (same(bars.map((b) => (b.type === 'barline' ? b.style : 'single'))) as BarlineStyle | null) : null,
      placement: tool.placement,
    };
  }, [paletteActive, tool, comp, selection]);

  const onDuration = useCallback(
    (base: BaseDuration) => {
      setTool((t) => ({ ...t, mode: t.mode === 'barline' ? 'note' : t.mode, duration: { ...t.duration, base } }));
      if (paletteActive) edit((c, s) => ({ comp: setDuration(c, s, { base }) }));
    },
    [paletteActive, edit],
  );
  const onDots = useCallback(
    (dots: Dots) => {
      setTool((t) => ({ ...t, mode: t.mode === 'barline' ? 'note' : t.mode, duration: { ...t.duration, dots } }));
      if (paletteActive) edit((c, s) => ({ comp: setDuration(c, s, { dots }) }));
    },
    [paletteActive, edit],
  );
  const onAlter = useCallback(
    (a: Alter) => {
      if (paletteActive) {
        const next = paletteView.alter === a ? null : a;
        edit((c, s) => ({ comp: setAlter(c, s, next) }));
      } else setTool((t) => ({ ...t, alter: t.alter === a ? null : a }));
    },
    [paletteActive, paletteView.alter, edit],
  );
  const onTie = useCallback(() => {
    if (paletteActive) edit((c, s) => ({ comp: setTie(c, s, paletteView.tie !== true) }));
    else setTool((t) => ({ ...t, tie: !t.tie }));
  }, [paletteActive, paletteView.tie, edit]);
  const onBarline = useCallback(
    (style: BarlineStyle) => {
      const barIds = selection.eventIds.filter((id) => comp.events.find((e) => e.id === id)?.type === 'barline');
      if (paletteActive && barIds.length) edit((c) => ({ comp: setBarlineStyle(c, barIds, style) }));
      else setTool((t) => ({ ...t, mode: 'barline', barStyle: style }));
    },
    [paletteActive, selection.eventIds, comp.events, edit],
  );
  const onMode = useCallback((mode: 'note' | 'rest') => setTool((t) => ({ ...t, mode })), []);

  // ---- transport ----
  const canPlay = comp.events.some((e) => e.type !== 'barline');
  const onPlayPause = useCallback(() => {
    if (audio.playState === 'playing') {
      audio.pause();
      return;
    }
    const c = compRef.current;
    const first = selectedEventIds(c, editor.selection);
    const firstId = c.events.find((e) => first.has(e.id))?.id;
    let from = 0;
    if (explicitSincePlay.current && firstId) from = startTickOf(c, firstId);
    else if (audio.pausedTick() !== null) from = audio.pausedTick()!;
    explicitSincePlay.current = false;
    audio.play(from);
  }, [audio, editor.selection]);

  useEffect(() => {
    // Keep the playing event in view.
    if (!audio.playingEventId) return;
    const idx = comp.events.findIndex((e) => e.id === audio.playingEventId);
    const loc = layout.itemOf.get(idx);
    const vp = viewportRef.current;
    if (!loc || !vp) return;
    const sys = layout.systems[loc[0]];
    if (sys.y < vp.scrollTop || sys.y + SYSTEM_HEIGHT > vp.scrollTop + vp.clientHeight) {
      vp.scrollTo({ top: Math.max(0, sys.y - 20), behavior: 'smooth' });
    }
  }, [audio.playingEventId, comp.events, layout]);

  // ---- file actions ----
  const onNew = useCallback(() => {
    if (compRef.current.events.length && !window.confirm('Start a new composition? The current one can be restored with Undo.')) return;
    audio.stop();
    edit(() => ({ comp: newComposition(), selection: EMPTY_SELECTION }));
  }, [audio, edit]);

  const loadText = useCallback(
    (text: string) => {
      try {
        const parsed = parseFile(text);
        if (compRef.current.events.length && !window.confirm('Replace the current composition? You can undo this.')) return;
        audio.stop();
        edit(() => ({ comp: parsed, selection: EMPTY_SELECTION }));
        flash(`Imported “${parsed.title}”`);
      } catch (err) {
        flash(err instanceof ImportError ? `Import failed — ${err.message}` : 'Import failed.', 'error');
      }
    },
    [audio, edit, flash],
  );
  const loadFile = useCallback((file: File) => file.text().then(loadText), [loadText]);

  const onExport = useCallback(() => {
    const blob = new Blob([serialize(compRef.current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(compRef.current.title)}.smp.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const onExample = useCallback(() => {
    fetch(`${import.meta.env.BASE_URL}examples/ode-to-joy.smp.json`)
      .then((r) => r.text())
      .then(loadText)
      .catch(() => flash('Could not load the example.', 'error'));
  }, [loadText, flash]);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      void loadFile(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [loadFile]);

  const convertBarlines = useCallback(() => {
    edit((c) => {
      const after = [...layout.analysis.autoBarAfter].sort((a, b) => b - a);
      let next = c;
      for (const i of after) next = insertEvent(next, i + 1, { id: newId(), type: 'barline', style: 'single' }) ?? next;
      return { comp: next };
    });
  }, [edit, layout.analysis.autoBarAfter]);

  // ---- keyboard ----
  const insertLetter = useCallback(
    (step: Step, intoChord: boolean) => {
      const c = compRef.current;
      const sel = editor.selection;
      const evIds = selectedEventIds(c, sel);
      const selIndices = c.events.map((e, i) => (evIds.has(e.id) ? i : -1)).filter((i) => i >= 0);
      const lastSel = selIndices.length ? selIndices[selIndices.length - 1] : -1;
      // Reference pitch: top note of the selected (or last) chord, else the middle line.
      const refEvent = [...c.events.slice(0, lastSel >= 0 ? lastSel + 1 : c.events.length)].reverse().find((e) => e.type === 'chord');
      const ref = refEvent?.type === 'chord' ? diatonicIndex(refEvent.notes[refEvent.notes.length - 1]) : diatonicIndex(pitchAtStaffPos(4, c.clef));
      const si = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(step);
      const candidates = [-1, 0, 1].map((o) => (Math.floor(ref / 7) + o) * 7 + si);
      const d = candidates.reduce((best, x) => (Math.abs(x - ref) < Math.abs(best - ref) ? x : best));
      const pos = clampStaffPos(staffPosOf(fromDiatonic(d), c.clef));
      const pitch = pitchAtStaffPos(pos, c.clef);
      const note = { id: newId(), ...pitch, alter: tool.alter, ...(tool.tie ? { tieToNext: true } : {}) };
      const target = intoChord ? c.events[lastSel] : undefined;
      let next: Composition | null;
      if (target?.type === 'chord') {
        next = addNoteToChord(c, target.id, note);
        if (!next) {
          flash('That chord already has that note.', 'error');
          shake(target.id);
          return;
        }
      } else {
        next = insertEvent(c, lastSel >= 0 ? lastSel + 1 : c.events.length, { id: newId(), type: 'chord', duration: tool.duration, notes: [note] });
      }
      if (!next) return;
      const result = next;
      edit(() => ({ comp: result, selection: { noteIds: [note.id], eventIds: [] } }));
      setExplicitSel(false);
      previewChord(result, note.id);
    },
    [editor.selection, tool, edit, flash, shake, previewChord],
  );

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const sel = editor.selection;
    const hasSel = sel.noteIds.length + sel.eventIds.length > 0;
    const key = e.key;
    let handled = true;
    if (mod && key.toLowerCase() === 'z') dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
    else if (mod && key.toLowerCase() === 'y') dispatch({ type: 'redo' });
    else if (mod) handled = false;
    else if (key === ' ') onPlayPause();
    else if (key >= '1' && key <= '6') onDuration(BASE_DURATIONS[Number(key) - 1]);
    else if (key === '.') onDots(((paletteView.dots === 'mixed' || paletteView.dots === null ? 0 : paletteView.dots) + 1) % 3 as Dots);
    else if (key === 'r' || key === 'R') onMode(tool.mode === 'rest' ? 'note' : 'rest');
    else if (key === '-') onAlter(-1);
    else if (key === '=' || key === '+') onAlter(1);
    else if (key === '0') onAlter(0);
    else if (key === 't' || key === 'T') onTie();
    else if (key === '|') {
      const evIds = selectedEventIds(compRef.current, sel);
      const idx = compRef.current.events.map((ev, i) => (evIds.has(ev.id) ? i : -1)).filter((i) => i >= 0).pop();
      if (idx !== undefined) {
        const id = newId();
        const next = insertEvent(compRef.current, idx + 1, { id, type: 'barline', style: 'single' });
        if (next) edit(() => ({ comp: next, selection: { noteIds: [], eventIds: [id] } }));
      }
    } else if (/^[a-gA-G]$/.test(key)) insertLetter(key.toUpperCase() as Step, e.shiftKey);
    else if ((key === 'ArrowUp' || key === 'ArrowDown') && hasSel) {
      const ids = [...selectedNoteIds(compRef.current, sel)];
      const steps = (key === 'ArrowUp' ? 1 : -1) * (e.ctrlKey || e.metaKey || e.altKey ? 7 : 1);
      const next = transposeNotes(compRef.current, ids, steps);
      if (next) {
        edit(() => ({ comp: next }));
        if (ids[0]) previewChord(next, ids[0]);
      }
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const c = compRef.current;
      if (!c.events.length) return;
      const evIds = selectedEventIds(c, sel);
      const idxs = c.events.map((ev, i) => (evIds.has(ev.id) ? i : -1)).filter((i) => i >= 0);
      let i: number;
      if (!idxs.length) i = key === 'ArrowLeft' ? c.events.length - 1 : 0;
      else i = key === 'ArrowLeft' ? Math.max(0, idxs[0] - 1) : Math.min(c.events.length - 1, idxs[idxs.length - 1] + 1);
      select({ noteIds: [], eventIds: [c.events[i].id] }, true);
    } else if ((key === 'Delete' || key === 'Backspace') && hasSel) {
      edit((c, s) => ({ comp: removeItems(c, s), selection: EMPTY_SELECTION }));
    } else if (key === 'Escape') select(EMPTY_SELECTION, false);
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---- status ----
  const selectedNotesSet = useMemo(() => new Set(selection.noteIds), [selection.noteIds]);
  const selectedEventsSet = useMemo(() => new Set(selection.eventIds), [selection.eventIds]);
  const selectionText = describeSelection(comp, selection);
  const warnings = layout.analysis.measures
    .filter((m) => m.warning)
    .map((m) => `Measure ${m.number}: ${formatBeats(m.ticks, comp.timeSignature)} beats of ${comp.timeSignature.beats}`);
  const timedCount = comp.events.filter((e) => e.type !== 'barline').length;
  const scoreLabel = `${comp.clef} clef, ${comp.timeSignature.beats}/${comp.timeSignature.beatType}, ${timedCount} ${timedCount === 1 ? 'event' : 'events'}`;
  const hint = drag.dragging
    ? drag.dragging.kind === 'palette'
      ? 'Over a chord: add to it · in a gap: insert · Shift: always insert · Esc: cancel'
      : 'Drop onto another chord or gap to move · drag out of the score to delete · Esc: cancel'
    : comp.events.length === 0
      ? 'Drag a note from the palette onto the staff, or click the staff to place the current note.'
      : 'Click a note to select · drag notes to change pitch · Delete removes · Space plays';

  return (
    <div className="app">
      <Header
        title={comp.title}
        canUndo={editor.past.length > 0}
        canRedo={editor.future.length > 0}
        onTitle={(title) => edit((c) => ({ comp: { ...c, title } }), 'title')}
        onNew={onNew}
        onImport={() => fileInputRef.current?.click()}
        onExample={onExample}
        onExport={onExport}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.smp.json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = '';
        }}
      />
      <SettingsBar
        comp={comp}
        autoBarlines={autoBarlines}
        canConvertBarlines={!layout.analysis.hasManualBarlines && layout.analysis.autoBarAfter.size > 0}
        onClef={(clef) => edit((c) => ({ comp: { ...c, clef } }))}
        onTime={(timeSignature) => edit((c) => ({ comp: { ...c, timeSignature } }), 'time')}
        onKey={(keySignature) => edit((c) => ({ comp: { ...c, keySignature } }))}
        onTempo={(tempo) => edit((c) => ({ comp: { ...c, tempo } }), 'tempo')}
        onAutoBarlines={setAutoBarlines}
        onConvertBarlines={convertBarlines}
      />
      <Transport
        playState={audio.playState}
        canPlay={canPlay}
        pianoStatus={audio.pianoStatus}
        outputId={audio.outputId}
        midiState={audio.midiState}
        midiPorts={audio.midiPorts}
        previewSound={previewSound}
        volume={audio.volume}
        onPlayPause={onPlayPause}
        onStop={audio.stop}
        onOutput={audio.setOutputId}
        onEnableMidi={() => void audio.enableMidi()}
        onPreviewSound={setPreviewSound}
        onVolume={audio.setVolume}
      />
      <main className="workspace">
        <Palette
          view={paletteView}
          tool={tool}
          onDragStart={(e, t) => drag.start(e, { kind: 'palette', tool: t })}
          onMode={onMode}
          onDuration={onDuration}
          onDots={onDots}
          onAlter={onAlter}
          onTie={onTie}
          onBarline={onBarline}
          onPlacement={(placement) => setTool((t) => ({ ...t, placement }))}
        />
        <div
          ref={viewportRef}
          className={`viewport${drag.dragging ? ' dragging' : ''}`}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) select(EMPTY_SELECTION, false);
          }}
        >
          <ScoreView
            ref={svgRef}
            comp={comp}
            layout={layout}
            selectedNotes={selectedNotesSet}
            selectedEvents={selectedEventsSet}
            playingEventId={audio.playingEventId}
            shakeEventId={shakeEventId}
            overlay={drag.overlay}
            label={scoreLabel}
            onNotePointerDown={onNotePointerDown}
            onEventPointerDown={onEventPointerDown}
            onCanvasPointerDown={onCanvasPointerDown}
            onCanvasPointerMove={drag.hover}
            onCanvasPointerLeave={drag.clearHover}
          />
        </div>
      </main>
      <footer className="status" aria-label="Status">
        <span className="status-sel">{selectionText}</span>
        {warnings.length > 0 && (
          <span className="status-warn" title={warnings.join('\n')}>
            ⚠ {warnings[0]}
            {warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}
          </span>
        )}
        <span className="status-hint">{hint}</span>
        <span className="sr-only" aria-live="polite">
          {selectionText}
        </span>
      </footer>
      {message && (
        <div className={`toast ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'} onClick={() => setMessage(null)}>
          {message.text}
        </div>
      )}
      {drag.chip && (
        <div className={`drag-chip${drag.chip.deleting ? ' deleting' : ''}`} style={{ left: drag.chip.x, top: drag.chip.y }}>
          {drag.chip.deleting ? '✕ Release to delete' : drag.dragging?.kind === 'palette' ? 'Drop on the staff' : ''}
        </div>
      )}
    </div>
  );
}
