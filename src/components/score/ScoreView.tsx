import { forwardRef, memo, useMemo } from 'react';
import { chordGeometry, type ChordGeom, stemUp } from '../../layout/chordGeometry';
import { LINE_W, S, STAFF_HEIGHT, SYSTEM_HEIGHT } from '../../layout/constants';
import { ACCIDENTAL_GLYPH, G, timeSigDigits } from '../../layout/glyphs';
import { posY, type LaidSystem, type Layout } from '../../layout/layout';
import { keySignaturePositions, noteKey } from '../../model/pitch';
import type { Alter, BarlineStyle, BaseDuration, ClefType, Composition, Dots } from '../../model/types';
import { BarlineGlyph, ChordGlyph, Glyph, RestGlyph } from './Glyphs';

export interface Ghost {
  system: number;
  /** Column origin x (notehead left edge). */
  x: number;
  pos: number;
  kind: 'note' | 'rest' | 'barline';
  base: BaseDuration;
  dots: Dots;
  alter: Alter | null;
  barStyle: BarlineStyle;
  label?: string;
}

export interface Overlay {
  ghost?: Ghost;
  caret?: { system: number; x: number };
  targetEventId?: string;
  fadedNoteId?: string;
  fadedEventId?: string;
}

interface Props {
  comp: Composition;
  layout: Layout;
  selectedNotes: Set<string>;
  selectedEvents: Set<string>;
  playingEventId: string | null;
  shakeEventId: string | null;
  overlay: Overlay;
  label: string;
  onNotePointerDown: (e: React.PointerEvent, noteId: string, eventId: string) => void;
  onEventPointerDown: (e: React.PointerEvent, eventId: string) => void;
  onCanvasPointerDown: (e: React.PointerEvent) => void;
  onCanvasPointerMove: (e: React.PointerEvent) => void;
  onCanvasPointerLeave: () => void;
}

const CLEF_GLYPH: Record<ClefType, [string, number]> = {
  treble: [G.gClef, 2],
  bass: [G.fClef, 6],
  alto: [G.cClef, 4],
  tenor: [G.cClef, 6],
};

function SystemHeader({ comp, sys }: { comp: Composition; sys: LaidSystem }) {
  const [clefCh, clefPos] = CLEF_GLYPH[comp.clef];
  const keyPositions = keySignaturePositions(comp.keySignature, comp.clef);
  const keyGlyph = ACCIDENTAL_GLYPH[comp.keySignature > 0 ? 1 : -1];
  const keyStep = (comp.keySignature > 0 ? 1.05 : 0.95) * S;
  const ts = comp.timeSignature;
  const digits = Math.max(String(ts.beats).length, String(ts.beatType).length);
  const timeW = (ts.symbol ? 1.8 : 1.9 * digits) * S;
  return (
    <g>
      <Glyph className="ink-fill" x={sys.clefX} y={posY(sys.staffTop, clefPos)} ch={clefCh} />
      {keyPositions.map((p, i) => (
        <Glyph key={i} className="ink-fill" x={sys.keyX + i * keyStep} y={posY(sys.staffTop, p)} ch={keyGlyph} />
      ))}
      {sys.timeX !== null &&
        (ts.symbol ? (
          <Glyph className="ink-fill" anchor="middle" x={sys.timeX + timeW / 2} y={posY(sys.staffTop, 4)} ch={ts.symbol === 'common' ? G.timeSigCommon : G.timeSigCut} />
        ) : (
          <>
            <Glyph className="ink-fill" anchor="middle" x={sys.timeX + timeW / 2} y={posY(sys.staffTop, 6)} ch={timeSigDigits(ts.beats)} />
            <Glyph className="ink-fill" anchor="middle" x={sys.timeX + timeW / 2} y={posY(sys.staffTop, 2)} ch={timeSigDigits(ts.beatType)} />
          </>
        ))}
    </g>
  );
}

function tiePath(x1: number, x2: number, y: number, down: boolean) {
  const dir = down ? 1 : -1;
  const xm = (x1 + x2) / 2;
  const h1 = dir * Math.min(1.1 * S, 0.25 * (x2 - x1) + 0.4 * S);
  const h2 = h1 * 0.7;
  return `M${x1},${y} Q${xm},${y + h1} ${x2},${y} Q${xm},${y + h2} ${x1},${y} Z`;
}

/** Ties between consecutive chords sharing a pitch; across systems as two half ties. */
function Ties({ comp, layout }: { comp: Composition; layout: Layout }) {
  const paths: React.ReactNode[] = [];
  comp.events.forEach((ev, i) => {
    if (ev.type !== 'chord') return;
    const loc = layout.itemOf.get(i);
    if (!loc) return;
    const sys = layout.systems[loc[0]];
    const item = sys.items[loc[1]];
    const geom = item.geom!;
    const nextIdx = comp.events.findIndex((e, j) => j > i && e.type !== 'barline');
    const next = nextIdx >= 0 ? comp.events[nextIdx] : null;
    const down = geom.stem ? geom.stem.up : true;
    for (const n of ev.notes) {
      if (!n.tieToNext) continue;
      const head = geom.heads.find((h) => h.noteId === n.id)!;
      const y = posY(sys.staffTop, head.pos) + (down ? 0.55 * S : -0.55 * S);
      const x1 = item.headX + head.x + geom.headW + 0.1 * S;
      const target = next?.type === 'chord' ? next.notes.find((m) => noteKey(m) === noteKey(n)) : undefined;
      const nloc = target ? layout.itemOf.get(nextIdx) : undefined;
      if (!target || !nloc) {
        paths.push(<path key={n.id} className="ink-fill" d={tiePath(x1, x1 + 1.6 * S, y, down)} />);
        continue;
      }
      const nsys = layout.systems[nloc[0]];
      const nitem = nsys.items[nloc[1]];
      const nhead = nitem.geom!.heads.find((h) => h.noteId === target.id)!;
      const x2 = nitem.headX + nhead.x - 0.1 * S;
      if (nloc[0] === loc[0]) {
        paths.push(<path key={n.id} className="ink-fill" d={tiePath(x1, x2, y, down)} />);
      } else {
        const ny = posY(nsys.staffTop, nhead.pos) + (down ? 0.55 * S : -0.55 * S);
        paths.push(<path key={n.id} className="ink-fill" d={tiePath(x1, sys.staffX1, y, down)} />);
        paths.push(<path key={`${n.id}b`} className="ink-fill" d={tiePath(nsys.contentX0 - 1.2 * S, x2, ny, down)} />);
      }
    }
  });
  return <g>{paths}</g>;
}

function GhostGlyph({ ghost, sys }: { ghost: Ghost; sys: LaidSystem }) {
  if (ghost.kind === 'barline') return <BarlineGlyph style={ghost.barStyle} x={ghost.x} staffTop={sys.staffTop} />;
  if (ghost.kind === 'rest') return <RestGlyph base={ghost.base} dots={ghost.dots} x={ghost.x} staffTop={sys.staffTop} />;
  const geom: ChordGeom = chordGeometry({ duration: { base: ghost.base, dots: ghost.dots }, notes: [{ id: 'ghost', pos: ghost.pos, alter: ghost.alter }] });
  const up = stemUp([ghost.pos]);
  return (
    <g>
      <ChordGlyph geom={geom} base={ghost.base} headX={ghost.x} staffTop={sys.staffTop} />
      {ghost.label && (
        <text className="ghost-label" x={ghost.x + geom.right + 0.5 * S} y={posY(sys.staffTop, ghost.pos) + (up ? 1.6 * S : -0.9 * S)}>
          {ghost.label}
        </text>
      )}
    </g>
  );
}

export const ScoreView = memo(
  forwardRef<SVGSVGElement, Props>(function ScoreView(props, ref) {
    const { comp, layout, selectedNotes, selectedEvents, playingEventId, shakeEventId, overlay } = props;
    const { targetEventId, fadedNoteId, fadedEventId } = overlay;
    const { onNotePointerDown, onEventPointerDown } = props;
    // The score body only re-renders when content/selection/target change, not on every ghost move.
    const body = useMemo(
      () => (
        <>
        {layout.systems.map((sys) => (
          <g key={sys.index}>
            <rect className="band" x={0} y={sys.y} width={layout.width} height={SYSTEM_HEIGHT} />
            {sys.warnings.map((w) => (
              <rect key={w.measure} className="measure-warning" x={w.x1} y={sys.staffTop - S} width={w.x2 - w.x1} height={STAFF_HEIGHT + 2 * S} rx={S / 2}>
                <title>{`Measure ${w.measure} does not match the time signature`}</title>
              </rect>
            ))}
            {[0, 1, 2, 3, 4].map((l) => (
              <line key={l} className="staff-line" x1={sys.staffX0} x2={sys.staffX1} y1={sys.staffTop + l * S} y2={sys.staffTop + l * S} strokeWidth={LINE_W} />
            ))}
            <line className="ink" x1={sys.staffX0} x2={sys.staffX0} y1={sys.staffTop} y2={sys.staffTop + STAFF_HEIGHT} strokeWidth={0.16 * S} />
            <SystemHeader comp={comp} sys={sys} />
            {sys.items.map((it) => {
              if (it.kind === 'autobar') return <BarlineGlyph key={`a${it.eventIndex}`} style="auto" x={it.headX} staffTop={sys.staffTop} />;
              const ev = comp.events[it.eventIndex];
              const cls = [
                selectedEvents.has(ev.id) ? 'sel' : '',
                playingEventId === ev.id ? 'playing' : '',
                shakeEventId === ev.id ? 'shake' : '',
                targetEventId === ev.id ? 'target' : '',
              ].join(' ');
              const faded = fadedEventId === ev.id ? 0.25 : undefined;
              if (ev.type === 'chord') {
                return (
                  <g key={ev.id} className={cls} data-event-id={ev.id} opacity={faded}>
                    {(playingEventId === ev.id || targetEventId === ev.id) && (
                      <rect className="column-highlight" x={it.headX - 0.5 * S} y={sys.staffTop - 3 * S} width={it.geom!.headW + S} height={STAFF_HEIGHT + 6 * S} rx={S / 2} />
                    )}
                    <ChordGlyph
                      geom={it.geom!}
                      base={ev.duration.base}
                      headX={it.headX}
                      staffTop={sys.staffTop}
                      noteClass={(id) => (selectedNotes.has(id) ? 'sel' : undefined)}
                      fadedNoteId={fadedNoteId}
                      onNotePointerDown={(e, noteId) => onNotePointerDown(e, noteId, ev.id)}
                      onStemPointerDown={(e) => onEventPointerDown(e, ev.id)}
                    />
                  </g>
                );
              }
              if (ev.type === 'rest') {
                return (
                  <g key={ev.id} className={cls} opacity={faded}>
                    {playingEventId === ev.id && (
                      <rect className="column-highlight" x={it.headX - 0.5 * S} y={sys.staffTop - 3 * S} width={2.2 * S} height={STAFF_HEIGHT + 6 * S} rx={S / 2} />
                    )}
                    <RestGlyph base={ev.duration.base} dots={ev.duration.dots} x={it.headX} staffTop={sys.staffTop} />
                    <rect className="hit" x={it.headX - 0.3 * S} y={sys.staffTop} width={1.8 * S} height={STAFF_HEIGHT} onPointerDown={(e) => onEventPointerDown(e, ev.id)} />
                  </g>
                );
              }
              return (
                <g key={ev.id} className={cls} opacity={faded}>
                  <BarlineGlyph style={ev.style} x={it.headX} staffTop={sys.staffTop} />
                  <rect className="hit" x={it.headX - 0.7 * S} y={sys.staffTop - 0.5 * S} width={1.4 * S} height={STAFF_HEIGHT + S} onPointerDown={(e) => onEventPointerDown(e, ev.id)} />
                </g>
              );
            })}
          </g>
        ))}
          <Ties comp={comp} layout={layout} />
        </>
      ),
      [comp, layout, selectedNotes, selectedEvents, playingEventId, shakeEventId, targetEventId, fadedNoteId, fadedEventId, onNotePointerDown, onEventPointerDown],
    );
    return (
      <svg
        ref={ref}
        className="score"
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={props.label}
        onPointerDown={props.onCanvasPointerDown}
        onPointerMove={props.onCanvasPointerMove}
        onPointerLeave={props.onCanvasPointerLeave}
      >
        {body}
        {overlay.caret && layout.systems[overlay.caret.system] && (
          <line
            className="caret"
            x1={overlay.caret.x}
            x2={overlay.caret.x}
            y1={layout.systems[overlay.caret.system].staffTop - 2 * S}
            y2={layout.systems[overlay.caret.system].staffTop + STAFF_HEIGHT + 2 * S}
          />
        )}
        {overlay.ghost && layout.systems[overlay.ghost.system] && (
          <g className="ghost">
            <GhostGlyph ghost={overlay.ghost} sys={layout.systems[overlay.ghost.system]} />
          </g>
        )}
      </svg>
    );
  }),
);
