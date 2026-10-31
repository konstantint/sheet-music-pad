import { parseFile } from '../model/schema';
import type { Composition } from '../model/types';

const COMP_KEY = 'smp:composition';
const SETTINGS_KEY = 'smp:settings';

export interface StoredSettings {
  autoBarlines?: boolean;
  previewSound?: boolean;
  placement?: 'auto' | 'new';
}

// Storage may be unavailable (private mode, blocked site data); the app works without it.

export function loadStoredComposition(): Composition | null {
  try {
    const text = localStorage.getItem(COMP_KEY);
    return text ? parseFile(text) : null;
  } catch {
    return null;
  }
}

export function storeComposition(json: string): void {
  try {
    localStorage.setItem(COMP_KEY, json);
  } catch {
    /* ignore */
  }
}

export function loadSettings(): StoredSettings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as StoredSettings;
  } catch {
    return {};
  }
}

export function saveSettings(s: StoredSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
