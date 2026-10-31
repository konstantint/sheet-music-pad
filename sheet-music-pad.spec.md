# Sheet Music Pad — Requirements Specification

**Status:** Draft v1 · **Date:** 2026-10-31
**Audience:** an AI coding agent (or developer) who will build the app from this document.

Requirement priorities follow MoSCoW: **MUST** = required for v1, **SHOULD** = expected unless it causes large delays, **COULD** = nice to have, **WON'T** = explicitly out of scope for v1. Each requirement has an ID (e.g. `FR-DRAG-3`) so that code, tests, and commit messages can refer to it.

---

## 1. Product summary

Sheet Music Pad is a single-page React web app for writing down short pieces of music on one staff. The user starts with an empty staff, sets the clef and time signature, and then adds notes one at a time by dragging them onto the staff. A drop either **adds the note to an existing chord** or **inserts a new chord/rest** at that point, depending on where the pointer is. Notes can go on ledger lines above or below the staff. The user can add bar lines by hand. A **Play/Pause** control plays the piece on a piano, either the built-in sampled piano or an external MIDI device. The piece can be **exported to a JSON file and imported again**.

### 1.1 Goals
- Writing a melody or chord sequence feels direct and needs no knowledge of notation software.
- What the user sees is what they hear: playback follows the notation exactly (clef, key, accidentals, ties, durations).
- The file format is plain, versioned and documented, so other tools can read and write it.

### 1.2 Non-goals (v1)
- Multiple staves, multiple voices on one staff, lyrics, dynamics, articulations, slurs, tuplets, grace notes, repeats with playback jumps.
- Printing/PDF engraving quality, MusicXML/MIDI-file export (see COULD list), collaboration, accounts, back end.

---

## 2. Technology constraints

| ID | Requirement | Priority |
|---|---|---|
| TC-1 | React 18+ with TypeScript (strict mode), built with Vite. The output is a static one-page bundle with no server-side code. | MUST |
| TC-2 | Notation is drawn **by the app itself as SVG** inside React components. Do not use VexFlow, OSMD, abcjs or any other notation renderer: the drag interaction needs exact control over geometry and hit testing. | MUST |
| TC-3 | Music glyphs come from the **Bravura** SMuFL font (SIL OFL), bundled as a local `woff2` under `src/assets/` and drawn as SVG `<text>`. Staff lines, stems, ledger lines, bar lines and beams are SVG `<line>`/`<rect>`/`<path>`. | SHOULD |
| TC-4 | State is managed with `useReducer` (or Zustand) around a **pure, serializable** composition model. All edits are pure functions `(composition, action) → composition`, so undo/redo and tests are simple. | MUST |
| TC-5 | Audio: built-in piano through the Web Audio API using a sampled grand piano (recommended: the `smplr` package, `SplendidGrandPiano` or `Soundfont` "acoustic_grand_piano"). External output through the **Web MIDI API**. | MUST |
| TC-6 | JSON import is validated with a runtime schema (recommended: `zod`). | MUST |
| TC-7 | Unit tests with Vitest. End-to-end tests with Playwright for the main flows in §10. | SHOULD |
| TC-8 | Supported browsers: current Chrome, Edge, Firefox and Safari, desktop and tablet. Web MIDI output only works where the browser supports it; elsewhere the app hides or disables the option (see FR-PLAY-8). | MUST |
| TC-9 | Use Pointer Events (not separate mouse/touch handlers), so dragging works with mouse, pen and touch. | MUST |

---

## 3. Domain model

### 3.1 Concepts
- **Composition**: one staff, with global settings and an ordered list of **events**.
- **Event**: one of
  - `chord`: one or more notes that sound together and share one duration (a single note is a chord with one note);
  - `rest`: silence with a duration;
  - `barline`: a manually placed bar line (takes no time).
- **Pitch**: `step` (C–B), `octave` (scientific pitch notation: middle C = C4) and `alter` (−2..+2 semitones, the written accidental). `alter: null` means no accidental is written, and the sounding pitch comes from the key signature and earlier accidentals in the measure (see §3.4).
- **Duration**: base value plus 0–2 augmentation dots.

### 3.2 TypeScript types (normative)

```ts
type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
type Alter = -2 | -1 | 0 | 1 | 2;          // 0 = explicit natural
type BaseDuration = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
type ClefType = 'treble' | 'bass' | 'alto' | 'tenor';
type BarlineStyle = 'single' | 'double' | 'final';

interface Duration { base: BaseDuration; dots: 0 | 1 | 2; }

interface Note {
  id: string;                 // stable unique id (e.g. nanoid)
  step: Step;
  octave: number;             // 0..8
  alter: Alter | null;        // null = no written accidental
  tieToNext?: boolean;        // tie to same pitch in the next chord
}

interface ChordEvent   { id: string; type: 'chord';   duration: Duration; notes: Note[]; }
interface RestEvent    { id: string; type: 'rest';    duration: Duration; }
interface BarlineEvent { id: string; type: 'barline'; style: BarlineStyle; }
type ScoreEvent = ChordEvent | RestEvent | BarlineEvent;

interface TimeSignature { beats: number; beatType: 1 | 2 | 4 | 8 | 16; symbol?: 'common' | 'cut'; }

interface Composition {
  title: string;
  tempo: number;              // quarter-note BPM, 20..300
  clef: ClefType;
  timeSignature: TimeSignature;
  keySignature: number;       // fifths, -7 (7 flats) .. +7 (7 sharps), 0 = C major
  events: ScoreEvent[];
}
```

Invariants (enforced by the reducer and by import validation):
- A chord has at least 1 note and never two notes at the same staff position (same `step` + `octave`).
- Notes inside a chord are kept sorted by pitch, lowest first.
- Two `barline` events are never adjacent. A barline is never the first event.
- `timeSignature.beats` is in 1..16.

### 3.3 Duration arithmetic
- Ticks per quarter note (PPQ) = 480. whole = 1920, half = 960, quarter = 480, eighth = 240, 16th = 120, 32nd = 60.
- One dot multiplies by 1.5, two dots by 1.75.
- One measure lasts `beats × (1920 / beatType)` ticks.

### 3.4 Pitch and staff position
- **Staff position** `p` is an integer: `0` = bottom staff line, `1` = first space, … `8` = top line. Negative values are below the staff and values above 8 are above it.
- Allowed range: `p ∈ [-8, 16]`, i.e. **up to 4 ledger lines below and above** the staff (`-2,-4,-6,-8` and `10,12,14,16` are ledger lines). (SHOULD: make the range a constant, `LEDGER_LIMIT = 4`.)
- Diatonic index `d = octave × 7 + stepIndex` (C=0 … B=6). Bottom-line reference per clef:

| Clef | Bottom line | Bottom line d | Clef glyph anchor |
|---|---|---|---|
| treble | E4 | 30 | G4 line (p=2) |
| bass | G2 | 18 | F3 line (p=6) |
| alto | F3 | 24 | C4 line (p=4) |
| tenor | D3 | 22 | C4 line (p=6) |

  `p = d − bottomLineD(clef)` and the reverse `d = p + bottomLineD(clef)`.
- **Sounding pitch (for playback):** for each note, take the effective alteration in this order:
  1. the note's own `alter` if it is not null;
  2. otherwise the most recent written accidental on the **same step and octave** earlier in the **same measure**;
  3. otherwise the key signature's alteration for that step.
  MIDI number = `12 × (octave + 1) + [0,2,4,5,7,9,11][stepIndex] + effectiveAlter`.
- A **measure** for the accidental rule is the span between bar lines: manual bar lines if any exist, otherwise automatically computed bar lines (§FR-BAR-4).
- Tied notes: a note that continues through a tie keeps the alteration of the note it is tied from.

### 3.5 Changing the clef
Changing the clef **keeps the pitches** (notes move on the staff). If notes would fall outside `[-8, 16]` they are still kept and drawn with extra ledger lines. The range limit only applies when the user places or moves notes.

---

## 4. User interface

### 4.1 Layout (desktop, ≥ 1024 px wide)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Header: [Title (editable)]        [New] [Import] [Export]   [Undo] [Redo] │
├───────────────────────────────────────────────────────────────────────────┤
│ Settings: Clef [▼]  Time [4]/[4] [C][¢]  Key [▼]  Tempo [100] BPM         │
│ Transport: [▶ Play / ❚❚ Pause] [■ Stop]  Output [Built-in piano ▼]         │
├──────────┬────────────────────────────────────────────────────────────────┤
│ Palette  │                                                                │
│ Note/Rest│        Score canvas (SVG, wraps into systems, scrolls          │
│ 𝅝 𝅗𝅥 ♩ ♪ 𝅘𝅥𝅯 𝅘𝅥𝅰 │        vertically)                                              │
│ Dots .  ..│                                                               │
│ ♭♭ ♭ ♮ ♯ 𝄪│                                                               │
│ Tie      │                                                                │
│ Barlines │                                                                │
├──────────┴────────────────────────────────────────────────────────────────┤
│ Status bar: selection info · measure warnings · hints                     │
└───────────────────────────────────────────────────────────────────────────┘
```

- Below 1024 px the palette becomes a horizontal toolbar above the score. Touch targets are ≥ 40 × 40 px.
- The palette is the "current tool" state: **mode** (note/rest), **duration**, **dots**, **accidental** (none / 𝄫 / ♭ / ♮ / ♯ / 𝄪), and **tie**. The palette always shows the current tool clearly (pressed state).

### 4.2 Score canvas rendering

| ID | Requirement | Priority |
|---|---|---|
| FR-RND-1 | A new composition shows an empty five-line staff with the clef, key signature and time signature at the start, and enough empty space to drop notes. | MUST |
| FR-RND-2 | The score **wraps into systems (lines)** to fit the canvas width. Each system starts with the clef and key signature. The time signature appears only on the first system. Prefer breaking at bar lines; break between events only if a measure is wider than a system. | MUST |
| FR-RND-3 | Horizontal spacing depends on duration (e.g. width ∝ `log2` of ticks, with a minimum width so accidentals and dots fit). It does not have to be engraving quality, but noteheads must never overlap from one event to the next. | MUST |
| FR-RND-4 | Noteheads: whole, half (hollow), filled for quarter and shorter. Stems for half and shorter; flags for eighth and shorter. Stem direction: up if the note farthest from the middle line (p=4) is below the middle line, otherwise down. Stem length is about 3.5 staff spaces, extended so it reaches the middle line for notes far from the staff. | MUST |
| FR-RND-5 | Chords: a single stem; notes a second apart are placed on opposite sides of the stem. Accidentals in a chord are stacked in columns so they do not collide. | MUST |
| FR-RND-6 | Ledger lines are drawn for every note outside the staff, and only as far as needed. | MUST |
| FR-RND-7 | Augmentation dots go in the space to the right of the notehead (a note on a line puts its dot in the space above). | MUST |
| FR-RND-8 | Rests use the standard glyphs at the standard vertical positions. | MUST |
| FR-RND-9 | Ties are drawn as curves between noteheads, including across system breaks (two half-ties). | SHOULD |
| FR-RND-10 | Eighth notes and shorter are beamed automatically inside a beat group (by beat for x/4, by dotted quarter for 6/8, 9/8, 12/8). Beaming is display-only and does not change the model. | COULD |
| FR-RND-11 | Measures whose content does not equal the time signature (except a first-measure pickup that is shorter) are shown with a subtle warning tint, and the status bar explains it ("Measure 3: 3½ beats of 4"). | SHOULD |
| FR-RND-12 | Selected notes/events are drawn in the accent color. The event currently playing is highlighted during playback. | MUST |
| FR-RND-13 | All colors come from CSS custom properties. Light and dark themes follow `prefers-color-scheme`. | SHOULD |

### 4.3 Glyph reference (SMuFL code points in Bravura — check against the SMuFL spec)
gClef `U+E050`, fClef `U+E062`, cClef `U+E05C`; noteheadWhole `U+E0A2`, noteheadHalf `U+E0A3`, noteheadBlack `U+E0A4`; flag8thUp/Down `U+E240/E241`, flag16th `U+E242/E243`, flag32nd `U+E244/E245`; restWhole `U+E4E3`, restHalf `U+E4E4`, restQuarter `U+E4E5`, rest8th `U+E4E6`, rest16th `U+E4E7`, rest32nd `U+E4E8`; accidentalFlat `U+E260`, Natural `U+E261`, Sharp `U+E262`, DoubleSharp `U+E263`, DoubleFlat `U+E264`; timeSig0–9 `U+E080–E089`, common `U+E08A`, cut `U+E08B`; augmentationDot `U+E1E7`.

---

## 5. Functional requirements

### 5.1 Composition settings

| ID | Requirement | Priority |
|---|---|---|
| FR-SET-1 | Clef selector: treble (default), bass, alto, tenor. Changing it redraws right away and keeps pitches (§3.5). | MUST |
| FR-SET-2 | Time signature: numerator 1–16, denominator 1/2/4/8/16; default 4/4. Shortcut buttons for common time (𝄴 = 4/4) and cut time (𝄵 = 2/2), which are drawn with their symbols. | MUST |
| FR-SET-3 | Key signature selector: C major/A minor through 7 sharps and 7 flats; default none. Drawn after the clef in standard order and positions for each clef. | SHOULD |
| FR-SET-4 | Tempo input: 20–300 quarter-note BPM, default 100. Can be changed during playback and takes effect from the next scheduled note. | MUST |
| FR-SET-5 | Editable title, default "Untitled". Used as the export file name. | MUST |
| FR-SET-6 | Clef, key and time signature changes in the middle of the piece. | WON'T (v1) |

### 5.2 Adding notes by dragging (core interaction)

**Definitions used below**
- **Column** of a chord/rest event: the horizontal band centered on its notehead, ±0.9 notehead widths.
- **Gap**: any horizontal space that is not a column, including the space after the last event of each system and the empty staff.
- **Insertion index**: the index in `events` where a new event goes, i.e. between the events on the left and right of the gap. A gap next to a bar line puts the insertion on the matching side of the bar line.

| ID | Requirement | Priority |
|---|---|---|
| FR-DRAG-1 | The user starts a drag by pressing on any palette note or rest button and moving it, or by pressing and dragging the "current tool" preview. After a 4 px movement threshold, a **ghost** glyph (current duration, dots and accidental, semi-transparent) follows the pointer. | MUST |
| FR-DRAG-2 | **Vertical snapping:** while the pointer is over a staff (its system's vertical band, including the ledger area), the ghost's notehead snaps to the nearest staff position `p` and stays within `[-8, 16]`. Temporary ledger lines are drawn for the ghost when `p` is outside the staff. A small pitch label (e.g. "F♯5") is shown next to the ghost. | MUST |
| FR-DRAG-3 | **Horizontal target:** if the pointer is inside the column of an existing **chord**, the drop target is *add to chord*: that chord is highlighted and the ghost snaps horizontally to the chord's column. If the pointer is in a gap, the drop target is *insert new event*: a vertical insertion caret is shown at the gap and the ghost sits at the caret. | MUST |
| FR-DRAG-4 | **Modifier override:** holding **Shift** during the drag forces *insert new event*, even over a chord column (the new event goes after the chord if the pointer is right of the column center, otherwise before it). On touch devices, a palette toggle "Chord / New" does the same job (default: Auto). | MUST |
| FR-DRAG-5 | **Drop, add to chord:** the note is added to the chord with the chord's existing duration. The palette duration is ignored, and if it differs the status bar briefly says "Added to chord (keeps ♩ duration)". If a note already exists at that staff position, the drop does nothing and the chord's notehead briefly shakes. | MUST |
| FR-DRAG-6 | **Drop, insert:** a new chord with one note (or a new rest in rest mode) is inserted at the insertion index with the palette duration, dots, accidental and tie settings. The new event becomes the selection. | MUST |
| FR-DRAG-7 | **Rest mode:** the ghost is a rest and ignores vertical snapping (it shows at the standard rest position). Rests can only be inserted. Dropping a rest over a chord column inserts it next to the chord as in FR-DRAG-4. | MUST |
| FR-DRAG-8 | **Dropping a note onto a rest's column** replaces the rest with a chord of the same duration that contains the dropped note. | SHOULD |
| FR-DRAG-9 | Dropping outside any staff, or pressing **Escape** during the drag, cancels it without changing anything. | MUST |
| FR-DRAG-10 | **Click-to-place:** a single click/tap on the staff (no drag) places the current tool there using the same targeting rules (FR-DRAG-2…8). While hovering with a mouse, the ghost preview is shown before clicking. | MUST |
| FR-DRAG-11 | **Pitch preview:** when the snapped staff position changes during a drag/hover and on drop, the pitch sounds briefly (≈ 300 ms) through the current output. On *add to chord* drops the whole resulting chord sounds. It can be turned off in the transport bar ("Preview sound"). | SHOULD |
| FR-DRAG-12 | **Auto-scroll:** while dragging near the top/bottom edge of the score viewport, the viewport scrolls. | SHOULD |
| FR-DRAG-13 | While a drag is in progress, the pointer never selects text, and the page does not scroll on touch (`touch-action: none` on the canvas). | MUST |

### 5.3 Editing existing notes and events

| ID | Requirement | Priority |
|---|---|---|
| FR-EDIT-1 | **Selection:** click a notehead to select that note. Click a rest or bar line to select that event. Click the stem/empty part of a chord column to select the whole chord. Shift-click adds to the selection. Click on empty canvas clears the selection. | MUST |
| FR-EDIT-2 | **Moving a note vertically:** dragging a notehead up/down changes its pitch with the same snapping and range limits as FR-DRAG-2, and plays a preview. Dropping it at a position already taken in the chord cancels the move. | MUST |
| FR-EDIT-3 | **Moving a note horizontally:** dragging a notehead into another chord's column moves it into that chord. Dragging it into a gap moves it out into a new chord (keeping the duration of its original chord). If the source chord becomes empty it is removed. | SHOULD |
| FR-EDIT-4 | **Deleting:** the Delete/Backspace key removes the selected notes/events. Removing the last note of a chord removes the chord. Dragging a selected note or event off the staff (more than 1.5 staff heights away) and dropping it there deletes it; a "trash" indication is shown while the pointer is in the delete zone. | MUST |
| FR-EDIT-5 | **Changing properties of a selection:** while something is selected, clicking a palette duration/dot changes the duration of the selected chords/rests; clicking an accidental sets `alter` on the selected notes (clicking the active accidental again sets it back to `null`); the Tie toggle switches `tieToNext` on the selected notes. The palette shows the selection's values (or a mixed state). | MUST |
| FR-EDIT-6 | Toggling between rest and chord for a selected event (rest → chord puts a note on the middle line). | COULD |
| FR-EDIT-7 | Copy/paste (Ctrl/Cmd+C/V) of selected events, pasted after the current selection. | COULD |

### 5.4 Bar lines

| ID | Requirement | Priority |
|---|---|---|
| FR-BAR-1 | The palette has bar line items (single, double, final). They are dragged or click-placed into gaps the same way as rests (insert only). The caret snaps to gaps only. | MUST |
| FR-BAR-2 | Keyboard: with an event selected, pressing `|` inserts a single bar line after it. | SHOULD |
| FR-BAR-3 | A selected bar line can be deleted (FR-EDIT-4), and its style changed by clicking another bar line item in the palette. | MUST |
| FR-BAR-4 | **Automatic bar lines (display only):** a toggle "Auto bar lines" (default **on**). While it is on and the composition contains **no manual bar lines**, bar lines are drawn every full measure based on the time signature (dashed or lighter, so they can be told apart from manual ones). Once the user adds any manual bar line, only manual bar lines are shown and used. A command "Convert auto bar lines to manual" turns the computed ones into real `barline` events. | SHOULD |
| FR-BAR-5 | A final bar line is always drawn at the end of the piece in display only, unless the last event is already a bar line. | COULD |

### 5.5 Keyboard shortcuts (SHOULD)

| Key | Action |
|---|---|
| `1`–`6` | Duration whole … 32nd |
| `.` | Cycle dots 0 → 1 → 2 → 0 |
| `R` | Switch note/rest mode |
| `-` / `=` / `0` | Flat / sharp / natural for the next note or the selection |
| `T` | Toggle tie |
| `A`–`G` | Insert a note with that letter after the selection (nearest octave to the previous note); with `Shift`, add it to the selected chord |
| `↑` / `↓` | Move the selected notes one staff step; with `Ctrl/Cmd`, one octave |
| `←` / `→` | Move the selection to the previous/next event |
| `Space` | Play/Pause |
| `Delete`/`Backspace` | Delete selection |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y` | Undo / Redo |
| `Esc` | Cancel drag or clear selection |

Shortcuts are disabled while a text input has focus.

### 5.6 Undo/redo and persistence

| ID | Requirement | Priority |
|---|---|---|
| FR-HIST-1 | Undo/redo of every model change (settings, insertions, edits, deletions, imports), at least 200 steps. A whole drag gesture counts as one step. | MUST |
| FR-HIST-2 | Autosave the composition to `localStorage` (debounced ≈ 500 ms) and restore it on reload. If storage is not available, the app keeps working without it. | SHOULD |
| FR-HIST-3 | "New" asks for confirmation if the composition has events, then resets to defaults (undoable). | MUST |

### 5.7 Playback

| ID | Requirement | Priority |
|---|---|---|
| FR-PLAY-1 | A **Play/Pause** toggle button. Play starts from the paused position, or from the selected event if the selection changed since the pause, or from the beginning otherwise. Pause stops all sounding notes right away and remembers the position. | MUST |
| FR-PLAY-2 | A **Stop** button stops playback and resets the position to the start. | SHOULD |
| FR-PLAY-3 | Playback follows the model: tempo (quarter = BPM), durations with dots, rests, sounding pitch per §3.4 (key signature + measure accidentals), and ties (tied notes sound as one longer note with no new attack). Bar lines take no time. | MUST |
| FR-PLAY-4 | Timing uses a look-ahead scheduler on `AudioContext.currentTime` (schedule ~100 ms ahead, timer every ~25 ms) so it stays steady when the UI is busy. Notes are released slightly before their full length (≈ 95 %) for clear articulation; tied notes are not shortened. | MUST |
| FR-PLAY-5 | The current event is highlighted while it plays, and the score scrolls to keep it in view. | MUST |
| FR-PLAY-6 | Playback stops by itself at the end and the button returns to "Play". Pressing Play again starts from the beginning. | MUST |
| FR-PLAY-7 | **Output: built-in piano** (default): a sampled acoustic grand piano. The samples load lazily on the first Play or preview, with a loading indicator. If loading fails (offline), it falls back to a simple Web Audio synth and shows a warning. The AudioContext is created/resumed on a user gesture. | MUST |
| FR-PLAY-8 | **Output: Web MIDI device:** if `navigator.requestMIDIAccess` exists, the output menu lists the available MIDI outputs (and updates on connect/disconnect). The app sends Program Change 0 (Acoustic Grand Piano) on channel 1 when the output is chosen, Note On/Off velocity 80 with timestamps based on `performance.now()`, and "All Notes Off" (CC 123) on Pause/Stop. If permission is denied or there is no support, the option is disabled with an explanation in a tooltip. | MUST |
| FR-PLAY-9 | Editing during playback is allowed. The scheduler reads the latest model for events not yet scheduled. | SHOULD |
| FR-PLAY-10 | A volume slider for the built-in piano. | COULD |
| FR-PLAY-11 | A metronome click and count-in. | COULD |

### 5.8 Export and import (JSON)

| ID | Requirement | Priority |
|---|---|---|
| FR-IO-1 | **Export** downloads the composition as `<slugified-title>.smp.json` (UTF-8, 2-space indented) in the format in §6. | MUST |
| FR-IO-2 | **Import** opens a file picker (`.json`, `.smp.json`). Dragging a file onto the window also imports it. If the current composition has events, the user is asked to confirm replacing it. Import is undoable. | MUST |
| FR-IO-3 | Import validates the file against the schema. Invalid files are rejected with a readable error that names the first problem and its JSON path (e.g. "events[4].notes[0].octave: expected 0..8"); the current composition stays unchanged. | MUST |
| FR-IO-4 | Files with a higher `version` than supported are rejected with the message "This file was made by a newer version of Sheet Music Pad". Older versions are migrated by functions `migrate_vN_to_vN+1`. | MUST |
| FR-IO-5 | Unknown extra properties are ignored on import (forward compatibility). Missing `id`s are generated. | SHOULD |
| FR-IO-6 | **Round trip:** `import(export(c))` is deeply equal to `c` (ignoring regenerated ids, if any were missing). | MUST |
| FR-IO-7 | Export to a Standard MIDI File (`.mid`) and MusicXML. | COULD |

---

## 6. File format (normative)

```json
{
  "format": "sheet-music-pad",
  "version": 1,
  "composition": {
    "title": "Ode to Joy (excerpt)",
    "tempo": 100,
    "clef": "treble",
    "timeSignature": { "beats": 4, "beatType": 4 },
    "keySignature": 0,
    "events": [
      { "id": "e1", "type": "chord", "duration": { "base": "quarter", "dots": 0 },
        "notes": [ { "id": "n1", "step": "E", "octave": 4, "alter": null } ] },
      { "id": "e2", "type": "chord", "duration": { "base": "quarter", "dots": 0 },
        "notes": [ { "id": "n2", "step": "C", "octave": 4, "alter": null },
                   { "id": "n3", "step": "E", "octave": 4, "alter": null },
                   { "id": "n4", "step": "G", "octave": 4, "alter": null } ] },
      { "id": "e3", "type": "rest", "duration": { "base": "half", "dots": 0 } },
      { "id": "e4", "type": "barline", "style": "single" },
      { "id": "e5", "type": "chord", "duration": { "base": "half", "dots": 1 },
        "notes": [ { "id": "n5", "step": "F", "octave": 4, "alter": 1, "tieToNext": true } ] },
      { "id": "e6", "type": "chord", "duration": { "base": "quarter", "dots": 0 },
        "notes": [ { "id": "n6", "step": "F", "octave": 4, "alter": null } ] },
      { "id": "e7", "type": "barline", "style": "final" }
    ]
  }
}
```

- `format` must be exactly `"sheet-music-pad"`. `version` is an integer and is `1` for this spec.
- The `composition` object follows the `Composition` type in §3.2 and its invariants.
- The schema lives in one module (`src/model/schema.ts`) and is the only place the format is defined. The TypeScript types are derived from it (`z.infer`) or checked against it.
- A JSON Schema file (`docs/sheet-music-pad.schema.json`) generated from the zod schema is a COULD.

---

## 7. Non-functional requirements

| ID | Requirement | Priority |
|---|---|---|
| NFR-1 | Dragging stays at 60 fps with 500 events. Layout is a pure, memoized function of `(composition, viewportWidth)`; during a drag only the ghost/caret overlay re-renders. | MUST |
| NFR-2 | Playback timing jitter < 10 ms with the built-in piano under normal load. | SHOULD |
| NFR-3 | Accessibility: all controls are reachable by keyboard and have accessible names. The score SVG has `role="img"` and an `aria-label` that sums up the content (e.g. "Treble clef, 4/4, 12 events"). The selected event is announced through an `aria-live` region (e.g. "Chord C4 E4 G4, quarter"). Color contrast meets WCAG AA. | SHOULD |
| NFR-4 | No network calls except loading the piano samples (and the app's own assets). No analytics. | MUST |
| NFR-5 | The first load of the app (without samples) is < 500 KB gzipped JS+CSS. | SHOULD |
| NFR-6 | No runtime errors or React warnings in the console during the e2e flows. | MUST |

---

## 8. Suggested architecture

```
src/
  main.tsx, App.tsx
  model/
    types.ts            # §3.2 types (or z.infer from schema.ts)
    schema.ts           # zod schema, parse/validate, migrations (§6)
    pitch.ts            # clef mapping, staff position <-> pitch, MIDI number, sounding pitch (§3.4)
    duration.ts         # ticks, measure length, measure-fill analysis (§3.3)
    operations.ts       # pure edit functions: insertEvent, addNoteToChord, moveNote, deleteSelection, setDuration…
    reducer.ts          # actions -> operations, undo/redo history
  layout/
    layout.ts           # (composition, width) -> systems, positioned glyphs, columns, gaps (pure)
    constants.ts        # staff space px, ledger limit, column half-width…
  interaction/
    hitTest.ts          # pointer (x,y) -> { system, staffPosition, target: chord|gap|rest|none, insertionIndex }
    useDragPlacement.ts # pointer-event state machine for palette drags, note drags, click-to-place
  audio/
    scheduler.ts        # look-ahead scheduler, play/pause/stop, position tracking
    timeline.ts         # composition -> [{ startTick, durationTicks, midi[], eventId }] with ties/accidentals resolved
    outputs/builtinPiano.ts, outputs/webMidi.ts, outputs/fallbackSynth.ts
  components/
    Header.tsx, SettingsBar.tsx, Transport.tsx, Palette.tsx, StatusBar.tsx
    score/ScoreView.tsx, Staff.tsx, ClefGlyph.tsx, KeySignature.tsx, TimeSignature.tsx,
          ChordGlyph.tsx, RestGlyph.tsx, Barline.tsx, Tie.tsx, DragOverlay.tsx
  io/
    exportJson.ts, importJson.ts
  styles/
src/assets/Bravura.woff2
```

Design rules:
- `model/`, `layout/`, `interaction/hitTest.ts` and `audio/timeline.ts` are pure TypeScript with no React or DOM, and fully unit tested.
- Hit testing uses the layout output (columns and gaps per system), not DOM element lookups, so it is deterministic and testable.
- Pointer coordinates are converted to SVG user space with `getScreenCTM().inverse()`.
- The drag state machine states: `idle → pressing → dragging(source: palette|note|event) → idle`, plus `hovering` for click-to-place preview. The pointer is captured with `setPointerCapture` on drag start.

---

## 9. Edge cases the implementation must handle

1. Dropping on the empty staff inserts at index 0.
2. Dropping in the gap after the last event of a system that is not the last system inserts before the first event of the next system.
3. Dropping right next to a bar line: left half of the gap → before the bar line, right half → after it.
4. Adding a note that is a second away from an existing chord note → the notehead goes on the other side of the stem; adding a third note between them reflows correctly.
5. A tie whose next chord does not contain the same pitch is drawn as a short "dangling" tie and ignored in playback (no error).
6. Changing a selected chord's duration so that measures overflow → the measure warning (FR-RND-11) shows; nothing is moved automatically.
7. Changing the clef with ledger notes (e.g. treble C6 → bass) → notes go far outside the staff and are still drawn and played correctly.
8. Importing a file with 0 events → shows the empty staff.
9. Pause in the middle of a long note, then Play → playback continues from the start of the **next** event (do not restart the cut note). Document this in the code.
10. The Web MIDI device is disconnected during playback → switch to the built-in piano, keep playing, and show a notice.
11. The browser tab is hidden during playback → playback continues (the scheduler works off audio time; it may catch up when the timer is throttled, but must not play a burst of overdue notes. Skip notes that are more than 100 ms late).

---

## 10. Acceptance scenarios (basis for e2e tests)

**AC-1 Empty start.** Given a fresh load with no saved data, then a treble staff with 4/4 and no notes is shown, and Play is disabled or does nothing.

**AC-2 Settings.** When the user picks bass clef and 3/4, then the staff shows the F clef and 3/4. After export, the JSON has `"clef": "bass"` and `timeSignature {3,4}`.

**AC-3 Insert by drag.** Given the quarter note is selected in the palette, when the user drags it to the second staff line (treble) in the empty staff and drops it, then one chord with G4 quarter exists.

**AC-4 Build a chord.** Given AC-3, when the user drops a note into the G4 chord's column on the bottom line (p=0) and then another on the third space (p=5), then the event is one chord {E4, G4, C5} and keeps the quarter duration.

**AC-5 Next event.** When the user drops a half note in the gap to the right of the chord, then there are 2 events, and the second is a half-note chord.

**AC-6 Shift forces new.** When the user drops a note over the chord's column while holding Shift, then a new event is inserted instead of extending the chord.

**AC-7 Ledger lines.** When the user drags to the third ledger line above the treble staff (p=14), then the ghost shows 3 ledger lines and the label "E6". After dropping, the note is drawn with 3 ledger lines and plays MIDI 88. Dragging higher than the 4th ledger line (p=16, G6) stays at that limit.

**AC-8 Bar lines.** When the user click-places a single bar line between events 2 and 3, then a barline event is at index 2, auto bar lines disappear, and the accidental-in-measure rule restarts after it.

**AC-9 Accidentals in a measure.** Given key C, F♯4 then F4 (no accidental) in the same measure, then both play MIDI 66. After a bar line, F4 plays 65.

**AC-10 Playback.** When the user presses Play, then the notes sound in order at the set tempo with the current event highlighted. Pause stops the sound immediately. Play resumes. At the end, the button returns to Play.

**AC-11 MIDI output.** Given a browser with Web MIDI and a virtual MIDI port, when the user chooses that port and presses Play, then Note On/Off messages for the expected MIDI numbers are sent (e2e may mock `requestMIDIAccess`).

**AC-12 Export/import round trip.** When the user exports, presses New, and imports the exported file, then the score looks the same and the model is deeply equal (§FR-IO-6).

**AC-13 Invalid import.** When the user imports a JSON file with `"octave": 12`, then an error with the path is shown and the score does not change.

**AC-14 Undo.** After AC-3…AC-6, pressing Undo 4 times returns to the empty staff, and Redo 4 times restores it.

**AC-15 Delete by drag.** When the user drags a note far below the staff and drops it, then the note is removed. If it was the only note of its chord, the chord is removed.

> Reference (treble): p=0 E4, 2 G4, 3 A4, 4 B4, 5 C5, 8 F5, 10 A5, 14 E6, 16 G6, −2 C4. Tests should compute expected pitches with `pitch.ts` and check them against this table.

---

## 11. Unit test checklist (minimum)

- `pitch.ts`: staff position ↔ pitch for all four clefs (including negative `p`); MIDI numbers for C4=60, A4=69, with alters; key-signature alterations; measure-accidental rule; tie carry-over.
- `duration.ts`: ticks for all bases × dots; measure fill for full, short, overfull and pickup measures.
- `operations.ts`: insert at every index, add to chord (sorting, duplicate rejection), move note between chords, delete (empty chord removal, adjacent bar line merge), duration change on mixed selection.
- `hitTest.ts`: column vs gap, Shift override, bar line sides, system boundaries, staff-position clamping.
- `timeline.ts`: ties merged, rests produce gaps, bar lines take no time, tempo conversion.
- `schema.ts`: valid sample parses; each invariant violation is reported with the right path; version handling; round trip.

---

## 12. Definition of done (v1)

- All MUST requirements are implemented. SHOULD requirements are implemented or listed in `README.md` under "Known gaps" with a reason.
- `npm run build`, `npm run test` and `npm run e2e` pass. `npm run lint` (ESLint + TypeScript strict) has no errors.
- `README.md` covers how to run the app, the interaction model (drag rules, Shift override, shortcuts) and a link to the file format (§6).
- The sample file in §6 imports, displays and plays correctly. It ships as `public/examples/ode-to-joy.smp.json` and can be loaded from the "Import" menu ("Load example").
