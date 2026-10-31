import type { BaseDuration, Duration, TimeSignature } from './types';

export const PPQ = 480;

export const BASE_TICKS: Record<BaseDuration, number> = {
  whole: 1920,
  half: 960,
  quarter: 480,
  eighth: 240,
  '16th': 120,
  '32nd': 60,
};

const DOT_FACTOR = [1, 1.5, 1.75];

export const durationTicks = (d: Duration): number => BASE_TICKS[d.base] * DOT_FACTOR[d.dots];

export const measureTicks = (ts: TimeSignature): number => ts.beats * (1920 / ts.beatType);

export const DURATION_LABEL: Record<BaseDuration, string> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  '16th': '16th',
  '32nd': '32nd',
};

export function durationLabel(d: Duration): string {
  return `${d.dots === 2 ? 'double-dotted ' : d.dots === 1 ? 'dotted ' : ''}${DURATION_LABEL[d.base]}`;
}

/** Format ticks as beats of the time signature's beat unit, e.g. "3½". */
export function formatBeats(ticks: number, ts: TimeSignature): string {
  const beat = 1920 / ts.beatType;
  const whole = Math.floor(ticks / beat);
  const frac = (ticks - whole * beat) / beat;
  const fracs: [number, string][] = [
    [0.25, '¼'],
    [0.5, '½'],
    [0.75, '¾'],
  ];
  if (frac === 0) return String(whole);
  const f = fracs.find(([v]) => Math.abs(v - frac) < 1e-9);
  if (f) return `${whole || ''}${f[1]}`;
  return (ticks / beat).toFixed(2).replace(/0+$/, '');
}
