import type { MidiAccessState, MidiPortInfo } from '../audio/useAudio';
import type { PianoStatus } from '../audio/outputs';
import type { PlayState } from '../audio/player';
import type { ClefType, Composition, TimeSignature } from '../model/types';

interface HeaderProps {
  title: string;
  canUndo: boolean;
  canRedo: boolean;
  onTitle: (t: string) => void;
  onNew: () => void;
  onImport: () => void;
  onExample: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function Header(p: HeaderProps) {
  return (
    <header className="header">
      <div className="brand" aria-hidden="true">
        𝄞
      </div>
      <input className="title-input" aria-label="Title" value={p.title} onChange={(e) => p.onTitle(e.target.value)} spellCheck={false} />
      <div className="spacer" />
      <div className="btn-row">
        <button onClick={p.onNew}>New</button>
        <button onClick={p.onImport} title="Import a .smp.json file (or drop it onto the window)">
          Import
        </button>
        <button onClick={p.onExample}>Load example</button>
        <button onClick={p.onExport}>Export</button>
        <span className="divider" />
        <button onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">
          ↶
        </button>
        <button onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">
          ↷
        </button>
      </div>
    </header>
  );
}

const KEY_NAMES: Record<number, string> = {
  [-7]: 'C♭ major / A♭ minor',
  [-6]: 'G♭ major / E♭ minor',
  [-5]: 'D♭ major / B♭ minor',
  [-4]: 'A♭ major / F minor',
  [-3]: 'E♭ major / C minor',
  [-2]: 'B♭ major / G minor',
  [-1]: 'F major / D minor',
  0: 'C major / A minor',
  1: 'G major / E minor',
  2: 'D major / B minor',
  3: 'A major / F♯ minor',
  4: 'E major / C♯ minor',
  5: 'B major / G♯ minor',
  6: 'F♯ major / D♯ minor',
  7: 'C♯ major / A♯ minor',
};

interface SettingsProps {
  comp: Composition;
  autoBarlines: boolean;
  canConvertBarlines: boolean;
  onClef: (c: ClefType) => void;
  onTime: (ts: TimeSignature) => void;
  onKey: (k: number) => void;
  onTempo: (t: number) => void;
  onAutoBarlines: (v: boolean) => void;
  onConvertBarlines: () => void;
}

export function SettingsBar(p: SettingsProps) {
  const ts = p.comp.timeSignature;
  return (
    <div className="bar settings" role="toolbar" aria-label="Composition settings">
      <label>
        Clef
        <select value={p.comp.clef} onChange={(e) => p.onClef(e.target.value as ClefType)}>
          <option value="treble">Treble</option>
          <option value="bass">Bass</option>
          <option value="alto">Alto</option>
          <option value="tenor">Tenor</option>
        </select>
      </label>
      <span className="group">
        <span className="label">Time</span>
        <input
          type="number"
          aria-label="Beats per measure"
          min={1}
          max={16}
          value={ts.beats}
          onChange={(e) => {
            const beats = Math.max(1, Math.min(16, Math.round(Number(e.target.value) || 1)));
            p.onTime({ beats, beatType: ts.beatType });
          }}
        />
        /
        <select aria-label="Beat unit" value={ts.beatType} onChange={(e) => p.onTime({ beats: ts.beats, beatType: Number(e.target.value) as TimeSignature['beatType'] })}>
          {[1, 2, 4, 8, 16].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button
          className="sym"
          aria-pressed={ts.symbol === 'common'}
          title="Common time (4/4)"
          onClick={() => p.onTime(ts.symbol === 'common' ? { beats: 4, beatType: 4 } : { beats: 4, beatType: 4, symbol: 'common' })}
        >
          𝄴
        </button>
        <button
          className="sym"
          aria-pressed={ts.symbol === 'cut'}
          title="Cut time (2/2)"
          onClick={() => p.onTime(ts.symbol === 'cut' ? { beats: 2, beatType: 2 } : { beats: 2, beatType: 2, symbol: 'cut' })}
        >
          𝄵
        </button>
      </span>
      <label>
        Key
        <select value={p.comp.keySignature} onChange={(e) => p.onKey(Number(e.target.value))}>
          {Array.from({ length: 15 }, (_, i) => 7 - i).map((k) => (
            <option key={k} value={k}>
              {k === 0 ? 'None' : `${Math.abs(k)}${k > 0 ? '♯' : '♭'}`} — {KEY_NAMES[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tempo
        <input
          type="number"
          min={20}
          max={300}
          value={p.comp.tempo}
          onChange={(e) => p.onTempo(Math.max(20, Math.min(300, Math.round(Number(e.target.value) || 20))))}
        />
        <span className="unit">BPM</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={p.autoBarlines} onChange={(e) => p.onAutoBarlines(e.target.checked)} />
        Auto bar lines
      </label>
      {p.canConvertBarlines && (
        <button onClick={p.onConvertBarlines} title="Turn the computed bar lines into real bar lines">
          Make bar lines manual
        </button>
      )}
    </div>
  );
}

interface TransportProps {
  playState: PlayState;
  canPlay: boolean;
  pianoStatus: PianoStatus;
  outputId: string;
  midiState: MidiAccessState;
  midiPorts: MidiPortInfo[];
  previewSound: boolean;
  volume: number;
  onPlayPause: () => void;
  onStop: () => void;
  onOutput: (id: string) => void;
  onEnableMidi: () => void;
  onPreviewSound: (v: boolean) => void;
  onVolume: (v: number) => void;
}

export function Transport(p: TransportProps) {
  const playing = p.playState === 'playing';
  const midiTitle =
    p.midiState === 'unsupported'
      ? 'This browser does not support Web MIDI'
      : p.midiState === 'denied'
        ? 'MIDI access was denied'
        : 'Send to an external MIDI device';
  return (
    <div className="bar transport" role="toolbar" aria-label="Playback">
      <button className="play" onClick={p.onPlayPause} disabled={!p.canPlay && !playing} aria-label={playing ? 'Pause' : 'Play'} title="Play / Pause (Space)">
        {playing ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button onClick={p.onStop} disabled={p.playState === 'stopped'} aria-label="Stop" title="Stop">
        ■ Stop
      </button>
      <label>
        Output
        <select value={p.outputId} onChange={(e) => p.onOutput(e.target.value)}>
          <option value="builtin">Built-in piano</option>
          {p.midiPorts.map((port) => (
            <option key={port.id} value={`midi:${port.id}`}>
              MIDI: {port.name}
            </option>
          ))}
        </select>
      </label>
      {p.midiState !== 'granted' && (
        <button onClick={p.onEnableMidi} disabled={p.midiState !== 'idle'} title={midiTitle}>
          MIDI devices…
        </button>
      )}
      {p.midiState === 'granted' && p.midiPorts.length === 0 && <span className="muted">No MIDI outputs</span>}
      {p.outputId === 'builtin' && (
        <label title="Built-in piano volume">
          Vol
          <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => p.onVolume(Number(e.target.value))} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={p.previewSound} onChange={(e) => p.onPreviewSound(e.target.checked)} />
        Preview sound
      </label>
      {p.pianoStatus === 'loading' && (
        <span className="muted loading" role="status">
          Loading piano…
        </span>
      )}
      {p.pianoStatus === 'failed' && p.outputId === 'builtin' && <span className="warn">Synth fallback</span>}
    </div>
  );
}
