import { clampStaffPos } from '../model/pitch';
import { COLUMN_HALF, S, SYSTEM_GAP, SYSTEM_HEIGHT } from '../layout/constants';
import { yToPos, type LaidItem, type LaidSystem, type Layout } from '../layout/layout';

export interface HitOptions {
  /** 'note' may target chords (add) and rests (replace); 'insert' only targets gaps. */
  mode: 'note' | 'insert';
  /** Force inserting a new event even when over a chord column (Shift / "New" placement). */
  forceNew: boolean;
}

export type Target =
  | { kind: 'chord'; system: number; eventIndex: number; pos: number; x: number }
  | { kind: 'rest'; system: number; eventIndex: number; pos: number; x: number }
  | { kind: 'gap'; system: number; insertIndex: number; pos: number; x: number }
  | { kind: 'none' };

export function systemAt(layout: Layout, y: number): LaidSystem | null {
  return layout.systems.find((s) => y >= s.y - SYSTEM_GAP / 2 && y < s.y + SYSTEM_HEIGHT + SYSTEM_GAP / 2) ?? null;
}

const isEventItem = (it: LaidItem) => it.kind !== 'autobar';

/** x of the insertion caret for an insertion index within a system. */
export function caretX(sys: LaidSystem, insertIndex: number): number {
  const items = sys.items.filter(isEventItem);
  const left = [...items].reverse().find((it) => it.eventIndex < insertIndex);
  const right = items.find((it) => it.eventIndex >= insertIndex);
  if (left && right) return (left.center + right.center) / 2;
  if (left) return Math.min(left.center + 3 * S, sys.staffX1 - S);
  if (right) return Math.max(sys.contentX0 + 0.2 * S, right.center - 2 * S);
  return sys.contentX0 + 1.5 * S;
}

export function hitTest(layout: Layout, x: number, y: number, opts: HitOptions): Target {
  const sys = systemAt(layout, y);
  if (!sys || x < sys.staffX0 - S || x > sys.staffX1 + S) return { kind: 'none' };
  const pos = clampStaffPos(yToPos(sys.staffTop, y));
  const gap = (insertIndex: number): Target => ({ kind: 'gap', system: sys.index, insertIndex, pos, x: caretX(sys, insertIndex) });

  const items = sys.items.filter(isEventItem);
  for (const it of items) {
    if (it.kind !== 'chord' && it.kind !== 'rest') continue;
    if (Math.abs(x - it.center) > COLUMN_HALF) continue;
    if (opts.mode === 'note' && !opts.forceNew) {
      return { kind: it.kind, system: sys.index, eventIndex: it.eventIndex, pos, x: it.headX };
    }
    return gap(x < it.center ? it.eventIndex : it.eventIndex + 1);
  }
  const right = items.find((it) => it.center > x);
  return gap(right ? right.eventIndex : sys.endIndex);
}
