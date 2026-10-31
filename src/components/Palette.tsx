import type { Tool } from '../interaction/commit';
import { ACCIDENTAL_GLYPH, MUSIC_FONT, PALETTE_NOTE_GLYPH, REST_GLYPH } from '../layout/glyphs';
import { DURATION_LABEL } from '../model/duration';
import { BASE_DURATIONS, type Alter, type BarlineStyle, type BaseDuration, type Dots } from '../model/types';

/** What the palette shows as pressed: the selection's values when something is selected, else the tool. */
export interface PaletteView {
  mode: Tool['mode'];
  base: BaseDuration | 'mixed' | null;
  dots: Dots | 'mixed' | null;
  alter: Alter | null | 'mixed';
  tie: boolean | 'mixed';
  barStyle: BarlineStyle | null;
  placement: Tool['placement'];
}

interface Props {
  view: PaletteView;
  tool: Tool;
  onDragStart: (e: React.PointerEvent, tool: Tool) => void;
  onMode: (mode: 'note' | 'rest') => void;
  onDuration: (base: BaseDuration) => void;
  onDots: (dots: Dots) => void;
  onAlter: (alter: Alter) => void;
  onTie: () => void;
  onBarline: (style: BarlineStyle) => void;
  onPlacement: (p: Tool['placement']) => void;
}

const ACC_NAMES: Record<number, string> = { [-2]: 'Double flat', [-1]: 'Flat', 0: 'Natural', 1: 'Sharp', 2: 'Double sharp' };
const ACC_KEYS: Record<number, string> = { [-1]: ' (-)', 0: ' (0)', 1: ' (=)' };
const DURATION_KEYS: Record<BaseDuration, string> = { whole: '1', half: '2', quarter: '3', eighth: '4', '16th': '5', '32nd': '6' };

function BarlineIcon({ style }: { style: BarlineStyle }) {
  return (
    <svg width="18" height="26" viewBox="0 0 18 26" aria-hidden="true">
      {style === 'single' && <rect x="8" y="1" width="2" height="24" fill="currentColor" />}
      {style === 'double' && (
        <>
          <rect x="5" y="1" width="2" height="24" fill="currentColor" />
          <rect x="11" y="1" width="2" height="24" fill="currentColor" />
        </>
      )}
      {style === 'final' && (
        <>
          <rect x="4" y="1" width="2" height="24" fill="currentColor" />
          <rect x="9" y="1" width="5" height="24" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

export function Palette({ view, tool, onDragStart, onMode, onDuration, onDots, onAlter, onTie, onBarline, onPlacement }: Props) {
  const isRest = view.mode === 'rest';
  return (
    <aside className="palette" aria-label="Note palette">
      <section>
        <h3>Type</h3>
        <div className="seg" role="group" aria-label="Note or rest">
          <button aria-pressed={view.mode === 'note'} onClick={() => onMode('note')} title="Notes (R toggles)">
            Note
          </button>
          <button aria-pressed={isRest} onClick={() => onMode('rest')} title="Rests (R toggles)">
            Rest
          </button>
        </div>
      </section>

      <section>
        <h3>Duration</h3>
        <div className="grid3">
          {BASE_DURATIONS.map((base) => (
            <button
              key={base}
              className="glyph-btn draggable"
              aria-pressed={view.base === base}
              aria-label={`${DURATION_LABEL[base]} ${isRest ? 'rest' : 'note'}`}
              title={`${DURATION_LABEL[base]} ${isRest ? 'rest' : 'note'} (${DURATION_KEYS[base]}) — drag onto the staff`}
              onPointerDown={(e) => onDragStart(e, { ...tool, mode: isRest ? 'rest' : 'note', duration: { ...tool.duration, base } })}
              onClick={() => onDuration(base)}
            >
              <span style={{ fontFamily: MUSIC_FONT }} className={isRest ? 'rest-glyph' : 'note-glyph'}>
                {isRest ? REST_GLYPH[base] : PALETTE_NOTE_GLYPH[base]}
              </span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Dots">
          <button aria-pressed={view.dots === 1} onClick={() => onDots(view.dots === 1 ? 0 : 1)} title="Dotted (.)">
            ♩. Dot
          </button>
          <button aria-pressed={view.dots === 2} onClick={() => onDots(view.dots === 2 ? 0 : 2)} title="Double-dotted (. twice)">
            ♩.. Double
          </button>
        </div>
      </section>

      <section>
        <h3>Accidental</h3>
        <div className="grid5">
          {([-2, -1, 0, 1, 2] as Alter[]).map((a) => (
            <button
              key={a}
              className="glyph-btn small"
              aria-pressed={view.alter === a}
              aria-label={ACC_NAMES[a]}
              title={`${ACC_NAMES[a]}${ACC_KEYS[a] ?? ''} — click again to remove`}
              disabled={isRest}
              onClick={() => onAlter(a)}
            >
              <span style={{ fontFamily: MUSIC_FONT }} className="acc-glyph">
                {ACCIDENTAL_GLYPH[a]}
              </span>
            </button>
          ))}
        </div>
        <button className="wide" aria-pressed={view.tie === true} disabled={isRest} onClick={onTie} title="Tie to the next note (T)">
          ‿ Tie
        </button>
      </section>

      <section>
        <h3>Drop onto chord</h3>
        <div className="seg" role="group" aria-label="Placement">
          <button aria-pressed={view.placement === 'auto'} onClick={() => onPlacement('auto')} title="Over a chord: add to it; in a gap: new note">
            Auto
          </button>
          <button aria-pressed={view.placement === 'new'} onClick={() => onPlacement('new')} title="Always insert a new note (same as holding Shift)">
            New
          </button>
        </div>
        <p className="hint">Hold Shift while dragging to always insert a new note.</p>
      </section>

      <section>
        <h3>Bar lines</h3>
        <div className="grid3">
          {(['single', 'double', 'final'] as BarlineStyle[]).map((style) => (
            <button
              key={style}
              className="glyph-btn draggable"
              aria-pressed={view.barStyle === style}
              aria-label={`${style} bar line`}
              title={`${style} bar line — drag into a gap or click then click the staff`}
              onPointerDown={(e) => onDragStart(e, { ...tool, mode: 'barline', barStyle: style })}
              onClick={() => onBarline(style)}
            >
              <BarlineIcon style={style} />
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
