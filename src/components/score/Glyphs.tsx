import type { ChordGeom } from '../../layout/chordGeometry';
import { LINE_W, S, STAFF_HEIGHT, STEM_W } from '../../layout/constants';
import { ACCIDENTAL_GLYPH, FLAG_GLYPH, G, MUSIC_FONT, REST_GLYPH } from '../../layout/glyphs';
import { posY } from '../../layout/layout';
import type { BarlineStyle, BaseDuration, Dots } from '../../model/types';

export const FONT_SIZE = 4 * S;

export function Glyph({ x, y, ch, className, anchor }: { x: number; y: number; ch: string; className?: string; anchor?: 'middle' }) {
  return (
    <text x={x} y={y} className={className} fontFamily={MUSIC_FONT} fontSize={FONT_SIZE} textAnchor={anchor}>
      {ch}
    </text>
  );
}

const noteheadGlyph = (base: BaseDuration) => (base === 'whole' ? G.noteheadWhole : base === 'half' ? G.noteheadHalf : G.noteheadBlack);

interface ChordGlyphProps {
  geom: ChordGeom;
  base: BaseDuration;
  headX: number;
  staffTop: number;
  /** Class per note id (e.g. selection). */
  noteClass?: (noteId: string) => string | undefined;
  /** Note ids to draw faded (being dragged). */
  fadedNoteId?: string | null;
  onNotePointerDown?: (e: React.PointerEvent, noteId: string) => void;
  onStemPointerDown?: (e: React.PointerEvent) => void;
}

export function ChordGlyph({ geom, base, headX, staffTop, noteClass, fadedNoteId, onNotePointerDown, onStemPointerDown }: ChordGlyphProps) {
  const y = (p: number) => posY(staffTop, p);
  const head = noteheadGlyph(base);
  return (
    <g>
      {geom.ledgers.map((l) => (
        <line key={`l${l.pos}`} className="staff-line" x1={headX + l.x1} x2={headX + l.x2} y1={y(l.pos)} y2={y(l.pos)} strokeWidth={LINE_W * 1.4} />
      ))}
      {geom.stem && (
        <line
          className="ink"
          x1={headX + geom.stem.x}
          x2={headX + geom.stem.x}
          y1={y(geom.stem.fromPos) + (geom.stem.up ? -0.15 * S : 0.15 * S)}
          y2={y(geom.stem.toPos)}
          strokeWidth={STEM_W}
        />
      )}
      {geom.flag && <Glyph className="ink-fill" x={headX + geom.flag.x} y={y(geom.flag.pos)} ch={FLAG_GLYPH[base]![geom.flag.up ? 0 : 1]} />}
      {geom.heads.map((h) => (
        <g key={h.noteId} className={noteClass?.(h.noteId)} opacity={fadedNoteId === h.noteId ? 0.25 : undefined}>
          <Glyph className="ink-fill" x={headX + h.x} y={y(h.pos)} ch={head} />
          {geom.accidentals
            .filter((a) => a.noteId === h.noteId)
            .map((a) => (
              <Glyph key="acc" className="ink-fill" x={headX + a.x} y={y(a.pos)} ch={ACCIDENTAL_GLYPH[a.alter]} />
            ))}
          {onNotePointerDown && (
            <rect
              className="hit"
              data-note-id={h.noteId}
              x={headX + h.x - 0.1 * S}
              y={y(h.pos) - 0.55 * S}
              width={geom.headW + 0.2 * S}
              height={1.1 * S}
              onPointerDown={(e) => onNotePointerDown(e, h.noteId)}
            />
          )}
        </g>
      ))}
      {geom.dots.map((d, i) => (
        <Glyph key={`d${i}`} className="ink-fill" x={headX + d.x} y={y(d.pos)} ch={G.augmentationDot} />
      ))}
      {geom.stem && onStemPointerDown && (
        <rect
          className="hit"
          x={headX + geom.stem.x - 0.4 * S}
          y={Math.min(y(geom.stem.fromPos), y(geom.stem.toPos)) + (geom.stem.up ? 0 : 0.6 * S)}
          width={0.8 * S}
          height={Math.abs(y(geom.stem.fromPos) - y(geom.stem.toPos)) - 0.6 * S}
          onPointerDown={onStemPointerDown}
        />
      )}
    </g>
  );
}

export function RestGlyph({ base, dots, x, staffTop }: { base: BaseDuration; dots: Dots; x: number; staffTop: number }) {
  const y = posY(staffTop, base === 'whole' ? 6 : 4);
  return (
    <g>
      <Glyph className="ink-fill" x={x} y={y} ch={REST_GLYPH[base]} />
      {Array.from({ length: dots }, (_, i) => (
        <Glyph key={i} className="ink-fill" x={x + 1.4 * S + i * 0.55 * S} y={posY(staffTop, 5)} ch={G.augmentationDot} />
      ))}
    </g>
  );
}

export function BarlineGlyph({ style, x, staffTop, className }: { style: BarlineStyle | 'auto'; x: number; staffTop: number; className?: string }) {
  const y1 = staffTop;
  const y2 = staffTop + STAFF_HEIGHT;
  const thin = 0.16 * S;
  if (style === 'auto') return <line className="autobar" x1={x} x2={x} y1={y1} y2={y2} strokeWidth={thin} />;
  return (
    <g className={className}>
      {style === 'single' && <line className="ink" x1={x} x2={x} y1={y1} y2={y2} strokeWidth={thin} />}
      {style === 'double' && (
        <>
          <line className="ink" x1={x - 0.4 * S} x2={x - 0.4 * S} y1={y1} y2={y2} strokeWidth={thin} />
          <line className="ink" x1={x - thin / 2} x2={x - thin / 2} y1={y1} y2={y2} strokeWidth={thin} />
        </>
      )}
      {style === 'final' && (
        <>
          <line className="ink" x1={x - 0.85 * S} x2={x - 0.85 * S} y1={y1} y2={y2} strokeWidth={thin} />
          <rect className="ink-fill" x={x - 0.5 * S} y={y1} width={0.5 * S} height={STAFF_HEIGHT} />
        </>
      )}
    </g>
  );
}
