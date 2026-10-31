import { useCallback, useEffect, useRef, useState } from 'react';
import type { Composition } from '../model/types';
import { audioContext, BuiltinPiano, MidiOutput, midiSupported, type Output, type PianoStatus } from './outputs';
import { Player, type PlayState } from './player';

export interface MidiPortInfo {
  id: string;
  name: string;
}

export type MidiAccessState = 'unsupported' | 'idle' | 'granted' | 'denied';

export function useAudio(getComp: () => Composition, notify: (msg: string) => void) {
  const [playState, setPlayState] = useState<PlayState>('stopped');
  const [playingEventId, setPlayingEventId] = useState<string | null>(null);
  const [pianoStatus, setPianoStatus] = useState<PianoStatus>('idle');
  const [midiState, setMidiState] = useState<MidiAccessState>(midiSupported() ? 'idle' : 'unsupported');
  const [midiPorts, setMidiPorts] = useState<MidiPortInfo[]>([]);
  const [outputId, setOutputIdState] = useState<string>('builtin');
  const [volume, setVolumeState] = useState(0.8);

  const pianoRef = useRef<BuiltinPiano | null>(null);
  const playerRef = useRef<Player | null>(null);
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const midiOutRef = useRef<MidiOutput | null>(null);
  const outputIdRef = useRef(outputId);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const getOutput = useCallback((): Output => {
    if (outputIdRef.current !== 'builtin' && midiOutRef.current) return midiOutRef.current;
    return pianoRef.current!;
  }, []);

  /** Lazily create the AudioContext, piano and player (must run inside a user gesture). */
  const ensure = useCallback(() => {
    const ac = audioContext();
    if (!pianoRef.current) {
      pianoRef.current = new BuiltinPiano(ac, (s) => {
        setPianoStatus(s);
        if (s === 'failed') notifyRef.current('Piano samples could not be loaded — using a simple synth instead.');
      });
      pianoRef.current.volume = volume;
    }
    if (outputIdRef.current === 'builtin') void pianoRef.current.load();
    if (!playerRef.current) {
      playerRef.current = new Player(ac, getComp, getOutput, { onEvent: setPlayingEventId, onState: setPlayState });
    }
    return { ac, player: playerRef.current };
  }, [getComp, getOutput, volume]);

  useEffect(() => () => playerRef.current?.dispose(), []);

  const preview = useCallback(
    (midis: number[], duration = 0.3) => {
      const { ac } = ensure();
      const out = getOutput();
      for (const m of midis) out.play(m, ac.currentTime + 0.01, duration, 70);
    },
    [ensure, getOutput],
  );

  const play = useCallback(
    (fromTick: number) => {
      ensure().player.play(fromTick);
    },
    [ensure],
  );
  const pause = useCallback(() => playerRef.current?.pause(), []);
  const stop = useCallback(() => playerRef.current?.stop(), []);
  const pausedTick = () => playerRef.current?.pausedTick ?? null;

  const refreshPorts = useCallback((access: MIDIAccess) => {
    const ports: MidiPortInfo[] = [];
    access.outputs.forEach((o) => ports.push({ id: o.id, name: o.name ?? o.id }));
    setMidiPorts(ports);
    if (outputIdRef.current !== 'builtin' && !ports.some((p) => `midi:${p.id}` === outputIdRef.current)) {
      // Selected device disappeared: fall back to the built-in piano and keep playing.
      outputIdRef.current = 'builtin';
      midiOutRef.current = null;
      setOutputIdState('builtin');
      if (pianoRef.current) void pianoRef.current.load();
      notifyRef.current('MIDI device disconnected — switched to the built-in piano.');
    }
  }, []);

  const enableMidi = useCallback(async () => {
    if (!midiSupported() || midiAccessRef.current) return;
    try {
      const access = await navigator.requestMIDIAccess();
      midiAccessRef.current = access;
      setMidiState('granted');
      refreshPorts(access);
      access.onstatechange = () => refreshPorts(access);
    } catch {
      setMidiState('denied');
      notifyRef.current('MIDI access was denied.');
    }
  }, [refreshPorts]);

  const setOutputId = useCallback(
    (id: string) => {
      const { ac } = ensure();
      getOutput().allOff();
      if (id === 'builtin') {
        midiOutRef.current = null;
      } else {
        const port = midiAccessRef.current?.outputs.get(id.slice('midi:'.length));
        if (!port) return;
        midiOutRef.current = new MidiOutput(port, ac);
      }
      outputIdRef.current = id;
      setOutputIdState(id);
      if (id === 'builtin') void pianoRef.current?.load();
    },
    [ensure, getOutput],
  );

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    if (pianoRef.current) pianoRef.current.volume = v;
  }, []);

  return {
    playState,
    playingEventId,
    pianoStatus,
    midiState,
    midiPorts,
    outputId,
    volume,
    preview,
    play,
    pause,
    stop,
    pausedTick,
    enableMidi,
    setOutputId,
    setVolume,
  };
}
