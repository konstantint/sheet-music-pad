import { useCallback, useEffect, useRef, useState } from 'react';
import { HEAD_W, WHOLE_HEAD_W } from '../layout/constants';
import type { Layout } from '../layout/layout';
import { findNote } from '../model/operations';
import { pitchAtStaffPos, pitchLabel } from '../model/pitch';
import type { Composition } from '../model/types';
import type { Ghost, Overlay } from '../components/score/ScoreView';
import { hitModeFor, type DragSource, type DropTarget } from './commit';
import { hitTest } from './hitTest';
import type { Tool } from './commit';

const DRAG_THRESHOLD = 4;
const EDGE = 40;

interface Gesture {
  source: DragSource;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  /** Place the current tool on a plain click (canvas gestures). */
  clickPlaces: boolean;
  lastTarget: DropTarget;
}

export interface Chip {
  x: number;
  y: number;
  deleting: boolean;
}

interface Options {
  comp: Composition;
  layout: Layout;
  tool: Tool;
  svgRef: React.RefObject<SVGSVGElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onDrop: (source: DragSource, target: DropTarget) => void;
  /** Release without movement. */
  onClick: (source: DragSource, e: PointerEvent, target: DropTarget, clickPlaces: boolean) => void;
  /** Staff position under the pointer changed during a drag. */
  onPositionChange: (source: DragSource, target: DropTarget) => void;
}

/** Pointer-event state machine for palette drags, note/event drags, click-to-place and hover preview. */
export function useDrag(opts: Options) {
  const [overlay, setOverlay] = useState<Overlay>({});
  const [chip, setChip] = useState<Chip | null>(null);
  const [dragging, setDragging] = useState<DragSource | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const lastPointer = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const targetAt = useCallback((source: DragSource, clientX: number, clientY: number, shift: boolean): DropTarget => {
    const { layout, svgRef, viewportRef, tool } = optsRef.current;
    const vp = viewportRef.current?.getBoundingClientRect();
    const svg = svgRef.current?.getBoundingClientRect();
    if (!vp || !svg) return { kind: 'none' };
    const inside = clientX >= vp.left && clientX <= vp.right && clientY >= vp.top && clientY <= vp.bottom;
    if (!inside) return source.kind === 'palette' ? { kind: 'none' } : { kind: 'delete' };
    return hitTest(layout, clientX - svg.left, clientY - svg.top, {
      mode: hitModeFor(source),
      forceNew: shift || tool.placement === 'new',
    });
  }, []);

  const overlayFor = useCallback((source: DragSource, target: DropTarget): Overlay => {
    const { comp } = optsRef.current;
    const faded: Overlay =
      source.kind === 'note' ? { fadedNoteId: source.noteId } : source.kind === 'event' ? { fadedEventId: source.eventId } : {};
    if (target.kind === 'none' || target.kind === 'delete') return faded;

    let ghost: Ghost;
    const targetEvent = target.kind === 'gap' ? null : comp.events[target.eventIndex];
    if (source.kind === 'palette') {
      const t = source.tool;
      const dur = targetEvent && targetEvent.type !== 'barline' ? targetEvent.duration : t.duration;
      ghost = { system: target.system, x: 0, pos: target.pos, kind: t.mode, base: dur.base, dots: dur.dots, alter: t.alter, barStyle: t.barStyle };
    } else if (source.kind === 'note') {
      const found = findNote(comp, source.noteId);
      if (!found) return {};
      const dur = targetEvent && targetEvent.type !== 'barline' ? targetEvent.duration : found.chord.duration;
      ghost = { system: target.system, x: 0, pos: target.pos, kind: 'note', base: dur.base, dots: dur.dots, alter: found.note.alter, barStyle: 'single' };
    } else {
      const ev = comp.events.find((e) => e.id === source.eventId);
      if (!ev) return {};
      // A whole chord dragged by its stem: show only the insertion caret.
      if (ev.type === 'chord') return target.kind === 'gap' ? { ...faded, caret: { system: target.system, x: target.x } } : faded;
      ghost =
        ev.type === 'barline'
          ? { system: target.system, x: 0, pos: 4, kind: 'barline', base: 'quarter', dots: 0, alter: null, barStyle: ev.style }
          : { system: target.system, x: 0, pos: 4, kind: 'rest', base: ev.type === 'rest' ? ev.duration.base : 'quarter', dots: ev.type === 'rest' ? ev.duration.dots : 0, alter: null, barStyle: 'single' };
    }
    const headW = ghost.base === 'whole' ? WHOLE_HEAD_W : HEAD_W;
    if (ghost.kind === 'note') ghost.label = pitchLabel(pitchAtStaffPos(target.pos, comp.clef), ghost.alter);
    if (target.kind === 'gap') {
      ghost.x = ghost.kind === 'barline' ? target.x : target.x - headW / 2;
      return { ...faded, ghost, caret: { system: target.system, x: target.x } };
    }
    ghost.x = target.x;
    return { ...faded, ghost, targetEventId: targetEvent?.id };
  }, []);

  const update = useCallback(
    (clientX: number, clientY: number, shift: boolean) => {
      const g = gestureRef.current;
      if (!g) return;
      const target = targetAt(g.source, clientX, clientY, shift);
      const prev = g.lastTarget;
      g.lastTarget = target;
      setOverlay(overlayFor(g.source, target));
      setChip(target.kind === 'none' || target.kind === 'delete' ? { x: clientX, y: clientY, deleting: target.kind === 'delete' } : null);
      const prevPos = 'pos' in prev ? prev.pos : null;
      const pos = 'pos' in target ? target.pos : null;
      if (pos !== null && (pos !== prevPos || prev.kind === 'none')) optsRef.current.onPositionChange(g.source, target);
    },
    [targetAt, overlayFor],
  );

  const end = useCallback(() => {
    gestureRef.current = null;
    setDragging(null);
    setOverlay({});
    setChip(null);
  }, []);

  const start = useCallback((e: React.PointerEvent, source: DragSource, clickPlaces = false) => {
    if (e.button !== 0) return;
    gestureRef.current = {
      source,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      clickPlaces,
      lastTarget: { kind: 'none' },
    };
    lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      lastPointer.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
      if (!g.active) {
        if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return;
        g.active = true;
        setDragging(g.source);
      }
      e.preventDefault();
      update(e.clientX, e.clientY, e.shiftKey);
    };
    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (g.active) {
        const target = targetAt(g.source, e.clientX, e.clientY, e.shiftKey);
        end();
        optsRef.current.onDrop(g.source, target);
      } else {
        const target = targetAt(g.source, e.clientX, e.clientY, e.shiftKey);
        end();
        optsRef.current.onClick(g.source, e, target, g.clickPlaces);
      }
    };
    const onCancel = (e: PointerEvent) => {
      if (gestureRef.current?.pointerId === e.pointerId) end();
    };
    const onKey = (e: KeyboardEvent) => {
      const g = gestureRef.current;
      if (!g?.active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        end();
      } else if (e.key === 'Shift' && lastPointer.current) {
        update(lastPointer.current.x, lastPointer.current.y, e.type === 'keydown');
      }
    };
    // Auto-scroll the score while dragging near its top/bottom edge.
    const scrollTimer = setInterval(() => {
      const g = gestureRef.current;
      const vp = optsRef.current.viewportRef.current;
      const p = lastPointer.current;
      if (!g?.active || !vp || !p) return;
      const r = vp.getBoundingClientRect();
      if (p.x < r.left || p.x > r.right) return;
      let dy = 0;
      if (p.y < r.top + EDGE && p.y > r.top - EDGE) dy = -12;
      else if (p.y > r.bottom - EDGE && p.y < r.bottom + EDGE) dy = 12;
      if (dy) {
        vp.scrollTop += dy;
        update(p.x, p.y, p.shift);
      }
    }, 30);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      clearInterval(scrollTimer);
    };
  }, [update, targetAt, end]);

  /** Mouse hover preview of the current tool over the staff (no button pressed). */
  const hover = useCallback(
    (e: React.PointerEvent) => {
      if (gestureRef.current || e.pointerType !== 'mouse' || e.buttons !== 0) return;
      const source: DragSource = { kind: 'palette', tool: optsRef.current.tool };
      const target = targetAt(source, e.clientX, e.clientY, e.shiftKey);
      setOverlay(overlayFor(source, target));
    },
    [targetAt, overlayFor],
  );
  const clearHover = useCallback(() => {
    if (!gestureRef.current) setOverlay({});
  }, []);

  return { overlay, chip, dragging, start, hover, clearHover };
}
