import { nanoid } from 'nanoid';
import type { Composition } from './types';

export const newId = (): string => nanoid(10);

export function newComposition(): Composition {
  return {
    title: 'Untitled',
    tempo: 100,
    clef: 'treble',
    timeSignature: { beats: 4, beatType: 4 },
    keySignature: 0,
    events: [],
  };
}
