/** Staff space in px. All other dimensions are expressed in staff spaces (S). */
export const S = 12;
export const STAFF_HEIGHT = 4 * S;
/** Space above the top line / below the bottom line inside a system band (fits 4 ledger lines + stems). */
export const SYSTEM_MARGIN = 6 * S;
export const SYSTEM_HEIGHT = STAFF_HEIGHT + 2 * SYSTEM_MARGIN;
export const SYSTEM_GAP = 1 * S;
export const PAGE_PADDING_X = 1 * S;
export const PAGE_PADDING_TOP = 0.5 * S;

export const HEAD_W = 1.18 * S;
export const WHOLE_HEAD_W = 1.69 * S;
export const REST_W = 1.2 * S;
export const STEM_LEN = 3.5 * S;
export const STEM_W = 0.12 * S;
export const LINE_W = 0.13 * S;
export const LEDGER_EXT = 0.4 * S;

/** Half-width of a chord's column for drop targeting, measured from the notehead center. */
export const COLUMN_HALF = 1.0 * HEAD_W;
/** Minimum trailing space at the end of the last system for appending. */
export const TRAILING_SPACE = 8 * S;
