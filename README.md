# Sheet Music Pad

A one-page React app for writing short pieces on a single staff: set the clef, time and key signature, drag notes onto the staff, add bar lines, play the piece on a piano (built-in samples or an external MIDI device), and export/import it as JSON.

The requirements are in [`sheet-music-pad.spec.md`](sheet-music-pad.spec.md).

## Running

```sh
npm install
npm run dev        # development server
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # unit tests (Vitest)
npm run e2e        # end-to-end smoke test in headless Chromium (needs `npm run build` first;
                   # first time: `npx playwright install chromium`)
npm run lint       # TypeScript strict check
```

## Using it

**Placing notes**
- Drag a duration from the palette onto the staff. While you drag, a ghost note snaps to the nearest line or space, shows its pitch (e.g. `F♯5`), draws ledger lines as needed (up to 4 above or below the staff), and plays a short preview.
- **Over an existing chord**, the chord is highlighted and the note is **added to it**. The chord keeps its duration.
- **In a gap** between notes, a dashed caret shows where a **new note is inserted**.
- Hold **Shift** while dragging, or switch *Drop onto chord* to **New**, to always insert a new note.
- Dropping a note on a **rest** turns the rest into a note of the same length.
- **Clicking** the staff places the current tool (the pressed duration, plus note/rest mode, accidental and tie) using the same rules. With a mouse, a preview of it follows the pointer.
- **Bar lines**: drag a single, double or final bar line into a gap, or click one and then click the staff. Until you add one by hand, dashed *automatic* bar lines are drawn every full measure. *Make bar lines manual* turns them into real ones.

**Editing**
- Click a notehead to select it. Click a stem to select the whole chord. Shift-click adds to the selection.
- Drag a note up or down to change its pitch. Drag it onto another chord, or into a gap, to move it there.
- Rests, bar lines and whole chords (dragged by the stem) can be moved the same way.
- **Drag anything out of the score area and drop it to delete it**, or press Delete/Backspace.
- With a note you *clicked* selected, the palette shows its values, and clicking a duration, dot, accidental or tie changes it. Clicking the active accidental again removes it.

**Keyboard**

| Key | Action |
|---|---|
| `1`–`6` | whole … 32nd |
| `.` | cycle dots |
| `R` | note/rest mode |
| `-` `=` `0` | flat / sharp / natural |
| `T` | tie |
| `A`–`G` | insert that note after the selection, in the nearest octave (`Shift` adds it to the selected chord) |
| `↑` `↓` | move the selection one step (`Ctrl`/`Cmd`/`Alt`: one octave) |
| `←` `→` | select the previous/next event |
| `\|` | insert a bar line after the selection |
| `Space` | play/pause |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` | undo / redo |
| `Esc` | cancel drag / clear selection |

**Playback**
- *Play* starts from the beginning. After *Pause*, it resumes from the next note. If you click a note while stopped or paused, Play starts from that note.
- Playback follows the key signature, accidentals within the measure, and ties.
- *Output* chooses the built-in sampled grand piano (samples are fetched from the `smplr` CDN on first use; if that fails, a simple synth is used). Click *MIDI devices…* to grant Web MIDI access and pick an external device.

**Files**: *Export* saves `<title>.smp.json`. *Import*, or dropping a file onto the window, loads one; invalid files are rejected with the path of the first problem. The file format is described in spec §6 and defined in `src/model/schema.ts`. Your work is also saved to `localStorage` automatically.

## Code layout

```
src/model/        types, pitch & clef math, durations, measures/accidentals, pure edit operations, file schema
src/layout/       pure layout: line breaking, spacing, chord geometry (seconds, accidental stacking, ledger lines)
src/interaction/  hit testing (chord column vs gap), drop commit logic, pointer gesture hook
src/audio/        timeline (ties/accidentals resolved), look-ahead scheduler, piano / Web MIDI / synth outputs
src/components/   React UI; score/ is the SVG renderer (Bravura SMuFL font in public/fonts)
src/state/        undo/redo reducer, localStorage persistence
tests/            Vitest unit tests      e2e/smoke.mjs   Playwright end-to-end checks of the acceptance scenarios
```

## Where the app differs from the spec

- **Deleting by drag**: a note is deleted when it is dropped *outside the score area*, not "1.5 staff heights away". Lines of music are stacked with no space between them, so there is no empty area inside the score to use as a delete zone.
- **Selection after placing a note**: the new note is selected (so Delete, the arrow keys and `Shift`+letter work on it). Clicking a palette button then changes the *tool*, not that note. Otherwise, choosing the next duration would silently change the note you just entered. To change a note with the palette, click the note first.
- **Pitch preview** sounds while dragging and on click/drop, not on mouse hover, which would be noisy.
- Moving a note up or down **keeps its written accidental** (dragging A♭4 up two steps gives C♭5).
- **Not implemented yet** (all marked COULD in the spec): beaming (eighths and shorter use flags), copy/paste, switching a selected event between rest and note, MIDI/MusicXML export, metronome/count-in, a generated JSON Schema file, and an automatic final bar line.
- The e2e suite is a plain Playwright script (`e2e/smoke.mjs`), not `@playwright/test`. It covers AC-1…AC-10 and AC-12…AC-15. AC-11 (Web MIDI output) was not tested automatically.
