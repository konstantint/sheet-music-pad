import { durationTicks } from '../model/duration';
import { analyzeMeasures, type MeasureAnalysis } from '../model/measures';
import { keySignaturePositions } from '../model/pitch';
import type { Composition } from '../model/types';
import { chordGeometry, chordShape, type ChordGeom } from './chordGeometry';
import {
  PAGE_PADDING_TOP,
  PAGE_PADDING_X,
  REST_W,
  S,
  SYSTEM_GAP,
  SYSTEM_HEIGHT,
  SYSTEM_MARGIN,
  TRAILING_SPACE,
} from './constants';

export type ItemKind = 'chord' | 'rest' | 'barline' | 'autobar';

export interface LaidItem {
  kind: ItemKind;
  /** Index into composition.events. For 'autobar', the index of the event it follows. */
  eventIndex: number;
  /** Slot left edge and width. */
  x: number;
  width: number;
  /** Chord/rest: x of the notehead column origin. Bar line: x of the line. */
  headX: number;
  /** Horizontal center used for targeting. */
  center: number;
  geom?: ChordGeom;
}

export interface LaidSystem {
  index: number;
  /** Top of the system band. */
  y: number;
  /** y of the top staff line. */
  staffTop: number;
  /** Left and right ends of the staff lines. */
  staffX0: number;
  staffX1: number;
  /** Where event content starts (after clef/key/time). */
  contentX0: number;
  clefX: number;
  keyX: number;
  timeX: number | null;
  items: LaidItem[];
  /** Insertion indices for the start and end of this system. */
  startIndex: number;
  endIndex: number;
  warnings: { x1: number; x2: number; measure: number }[];
}

export interface Layout {
  width: number;
  height: number;
  systems: LaidSystem[];
  analysis: MeasureAnalysis;
  /** Event index -> [system index, item index]. */
  itemOf: Map<number, [number, number]>;
}

/** y of a staff position within a system. */
export const posY = (staffTop: number, pos: number): number => staffTop + ((8 - pos) * S) / 2;

/** Nearest staff position for a y coordinate. */
export const yToPos = (staffTop: number, y: number): number => Math.round(8 - ((y - staffTop) * 2) / S);

const spacing = (ticks: number): number => S * Math.max(1.0, 2.0 + 1.2 * Math.log2(ticks / 120));

const BARLINE_W = { single: 1.5 * S, double: 2 * S, final: 2.3 * S } as const;

interface Proto {
  kind: ItemKind;
  eventIndex: number;
  width: number;
  /** Offset from slot left to the column origin / line. */
  offset: number;
  colW: number;
  geom?: ChordGeom;
  stretch: boolean;
}

function headerWidths(comp: Composition, withTime: boolean) {
  const clefX = PAGE_PADDING_X + 0.6 * S;
  const keyX = clefX + 3.3 * S;
  const keyW = keySignaturePositions(comp.keySignature, comp.clef).length * (comp.keySignature > 0 ? 1.05 : 0.95) * S;
  const timeX = withTime ? keyX + keyW + (keyW ? 0.6 : 0) * S : null;
  const ts = comp.timeSignature;
  const digits = Math.max(String(ts.beats).length, String(ts.beatType).length);
  const timeW = withTime ? (ts.symbol ? 1.8 : 1.9 * digits) * S : 0;
  const contentX0 = (timeX ?? keyX + keyW) + timeW + 1.4 * S;
  return { clefX, keyX, timeX, contentX0 };
}

export function computeLayout(comp: Composition, width: number, showAutoBarlines: boolean): Layout {
  const analysis = analyzeMeasures(comp);
  const protos: Proto[] = [];
  comp.events.forEach((ev, i) => {
    if (ev.type === 'chord') {
      const geom = chordGeometry(chordShape(ev, comp.clef));
      protos.push({
        kind: 'chord',
        eventIndex: i,
        width: geom.left + geom.right + spacing(durationTicks(ev.duration)),
        offset: geom.left,
        colW: geom.headW,
        geom,
        stretch: true,
      });
    } else if (ev.type === 'rest') {
      const dotsW = ev.duration.dots ? 0.4 * S + ev.duration.dots * 0.55 * S : 0;
      protos.push({
        kind: 'rest',
        eventIndex: i,
        width: REST_W + dotsW + spacing(durationTicks(ev.duration)),
        offset: 0,
        colW: REST_W,
        stretch: true,
      });
    } else {
      const w = BARLINE_W[ev.style];
      protos.push({ kind: 'barline', eventIndex: i, width: w, offset: w / 2, colW: 0, stretch: false });
    }
    if (showAutoBarlines && analysis.autoBarAfter.has(i)) {
      protos.push({ kind: 'autobar', eventIndex: i, width: BARLINE_W.single, offset: BARLINE_W.single / 2, colW: 0, stretch: false });
    }
  });

  // Greedy line breaking, preferring breaks right after a bar line.
  const lines: Proto[][] = [];
  let line: Proto[] = [];
  let used = 0;
  const avail = (first: boolean) => width - PAGE_PADDING_X - headerWidths(comp, first).contentX0;
  for (const p of protos) {
    const isBar = p.kind === 'barline' || p.kind === 'autobar';
    const room = avail(lines.length === 0);
    if (!isBar && line.length > 0 && used + p.width > room) {
      let lastBar = -1;
      line.forEach((q, j) => {
        if (q.kind === 'barline' || q.kind === 'autobar') lastBar = j;
      });
      if (lastBar >= 0 && lastBar < line.length - 1) {
        lines.push(line.slice(0, lastBar + 1));
        line = line.slice(lastBar + 1);
      } else {
        lines.push(line);
        line = [];
      }
      used = line.reduce((a, q) => a + q.width, 0);
    }
    line.push(p);
    used += p.width;
  }
  lines.push(line);

  const systems: LaidSystem[] = [];
  const itemOf = new Map<number, [number, number]>();
  let nextIndex = 0;
  lines.forEach((protoLine, si) => {
    const isLast = si === lines.length - 1;
    const hdr = headerWidths(comp, si === 0);
    const y = PAGE_PADDING_TOP + si * (SYSTEM_HEIGHT + SYSTEM_GAP);
    const staffTop = y + SYSTEM_MARGIN;
    const staffX1 = width - PAGE_PADDING_X;
    const total = protoLine.reduce((a, p) => a + p.width, 0);
    const stretchable = protoLine.filter((p) => p.stretch).length;
    const room = staffX1 - hdr.contentX0;
    // Justify all but the last system; never compress.
    const extra = !isLast && stretchable > 0 ? Math.max(0, room - total) / stretchable : 0;

    let x = hdr.contentX0;
    const items: LaidItem[] = protoLine.map((p, j) => {
      const w = p.width + (p.stretch ? extra : 0);
      const headX = x + p.offset;
      const isEndBar = !isLast && j === protoLine.length - 1 && (p.kind === 'barline' || p.kind === 'autobar');
      const item: LaidItem = {
        kind: p.kind,
        eventIndex: p.eventIndex,
        x,
        width: w,
        headX: isEndBar ? staffX1 : headX,
        center: isEndBar ? staffX1 : p.colW ? headX + p.colW / 2 : headX,
        geom: p.geom,
      };
      x += w;
      return item;
    });
    items.forEach((it, j) => {
      if (it.kind !== 'autobar') itemOf.set(it.eventIndex, [si, j]);
    });
    const eventItems = items.filter((it) => it.kind !== 'autobar');
    const startIndex = eventItems.length ? eventItems[0].eventIndex : nextIndex;
    const endIndex = eventItems.length ? eventItems[eventItems.length - 1].eventIndex + 1 : nextIndex;
    nextIndex = endIndex;

    const warnings: LaidSystem['warnings'] = [];
    analysis.measures.forEach((m, mi) => {
      if (!m.warning) return;
      const its = items.filter((it) => (it.kind === 'chord' || it.kind === 'rest') && analysis.measureOf.get(it.eventIndex) === mi);
      if (!its.length) return;
      warnings.push({ x1: its[0].x - 0.3 * S, x2: its[its.length - 1].x + its[its.length - 1].width - 0.3 * S, measure: m.number });
    });

    systems.push({
      index: si,
      y,
      staffTop,
      staffX0: PAGE_PADDING_X,
      staffX1,
      contentX0: hdr.contentX0,
      clefX: hdr.clefX,
      keyX: hdr.keyX,
      timeX: hdr.timeX,
      items,
      startIndex,
      endIndex,
      warnings,
    });
  });

  // Make sure the last system has room to append.
  const last = systems[systems.length - 1];
  const lastEnd = last.items.length ? last.items[last.items.length - 1].x + last.items[last.items.length - 1].width : last.contentX0;
  if (last.staffX1 - lastEnd < TRAILING_SPACE && last.items.length) {
    // Push a new empty system for appending.
    const y = last.y + SYSTEM_HEIGHT + SYSTEM_GAP;
    const hdr = headerWidths(comp, false);
    systems.push({
      ...last,
      index: last.index + 1,
      y,
      staffTop: y + SYSTEM_MARGIN,
      contentX0: hdr.contentX0,
      timeX: null,
      items: [],
      startIndex: last.endIndex,
      endIndex: last.endIndex,
      warnings: [],
    });
  }

  const height = PAGE_PADDING_TOP + systems.length * (SYSTEM_HEIGHT + SYSTEM_GAP);
  return { width, height, systems, analysis, itemOf };
}
