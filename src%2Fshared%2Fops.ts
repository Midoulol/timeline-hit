// Pure subtitle editing operations backing the right-click context menu.
// Each returns a new rows array (immutable) plus the newly affected positions,
// so the store can refresh and re-select. All times are milliseconds.
import type { SubtitleRow } from './types';
import { DEFAULT_DURATION_MS } from './types';

export interface OpResult {
  rows: SubtitleRow[];
  selected: number[]; // affected row positions (for new selection)
}

function maxId(rows: SubtitleRow[]): number {
  return rows.reduce((m, r) => Math.max(m, r.id), -1);
}

function makeBlank(
  rows: SubtitleRow[],
  opts: Partial<SubtitleRow> & { text?: string },
): SubtitleRow {
  const base: SubtitleRow = {
    id: maxId(rows) + 1,
    layer: 0,
    startMs: 0,
    endMs: DEFAULT_DURATION_MS,
    style: 'Default',
    character: '',
    marginL: 0,
    marginR: 0,
    marginV: 0,
    effect: '',
    text: '',
    flagged: false,
  };
  return { ...base, ...opts, id: maxId(rows) + 1 };
}

const byStart = (a: SubtitleRow, b: SubtitleRow) => a.startMs - b.startMs;

/** Insert a blank row immediately BEFORE the row at `index`. */
export function insertBefore(rows: SubtitleRow[], index: number): OpResult {
  const ref = rows[index] ?? rows[rows.length - 1];
  const row = makeBlank(rows, {
    startMs: ref ? ref.startMs : 0,
    endMs: ref ? ref.startMs + DEFAULT_DURATION_MS : DEFAULT_DURATION_MS,
    style: ref?.style,
    character: ref?.character,
    layer: ref?.layer,
  });
  const next = [...rows];
  next.splice(Math.min(index, next.length), 0, row);
  return { rows: next, selected: [Math.min(index, next.length - 1)] };
}

/** Insert a blank row immediately AFTER the row at `index`. */
export function insertAfter(rows: SubtitleRow[], index: number): OpResult {
  const ref = rows[index] ?? rows[rows.length - 1];
  const at = index + 1;
  const row = makeBlank(rows, {
    startMs: ref ? ref.endMs : 0,
    endMs: ref ? ref.endMs + DEFAULT_DURATION_MS : DEFAULT_DURATION_MS,
    style: ref?.style,
    character: ref?.character,
    layer: ref?.layer,
  });
  const next = [...rows];
  next.splice(at, 0, row);
  return { rows: next, selected: [at] };
}

/** Insert a blank row spanning up to `currentMs` (placed just before the line under the playhead). */
export function insertBeforeVideoTime(rows: SubtitleRow[], currentMs: number): OpResult {
  const row = makeBlank(rows, {
    startMs: Math.max(0, currentMs - DEFAULT_DURATION_MS),
    endMs: currentMs,
  });
  let at = rows.findIndex((r) => r.startMs >= currentMs);
  if (at === -1) at = rows.length;
  const next = [...rows];
  next.splice(at, 0, row);
  return { rows: next, selected: [at] };
}

/** Insert a blank row starting at `currentMs` (placed just after the line under the playhead). */
export function insertAfterVideoTime(rows: SubtitleRow[], currentMs: number): OpResult {
  const row = makeBlank(rows, {
    startMs: currentMs,
    endMs: currentMs + DEFAULT_DURATION_MS,
  });
  let at = rows.findIndex((r) => r.startMs > currentMs);
  if (at === -1) at = rows.length;
  const next = [...rows];
  next.splice(at, 0, row);
  return { rows: next, selected: [at] };
}

/** Merge the rows at `indices` (any order) into a single row at the earliest position. */
export function mergeRows(rows: SubtitleRow[], indices: number[]): OpResult {
  const sorted = [...indices].sort((a, b) => a - b);
  if (sorted.length < 2) return { rows, selected: sorted };
  const picked = sorted.map((i) => rows[i]);
  const merged: SubtitleRow = {
    ...picked[0],
    id: maxId(rows) + 1,
    startMs: Math.min(...picked.map((r) => r.startMs)),
    endMs: Math.max(...picked.map((r) => r.endMs)),
    text: picked.map((r) => r.text).join('\\N'),
    flagged: picked.some((r) => r.flagged),
  };
  const remove = new Set(sorted);
  const next = rows.filter((_, i) => !remove.has(i));
  next.splice(sorted[0], 0, merged);
  const pos = sorted[0];
  return { rows: next, selected: [pos] };
}

/** Split the row at `index` at `currentMs` if the playhead is within it. */
export function splitRow(rows: SubtitleRow[], index: number, currentMs: number): OpResult {
  const r = rows[index];
  if (!r) return { rows, selected: [] };
  if (currentMs <= r.startMs || currentMs >= r.endMs) {
    // Not inside the row: place a break either before or after it.
    return currentMs <= r.startMs
      ? insertBefore(rows, index)
      : insertAfter(rows, index);
  }
  const first: SubtitleRow = { ...r, id: maxId(rows) + 2, endMs: currentMs };
  const second: SubtitleRow = {
    ...r,
    id: maxId(rows) + 3,
    startMs: currentMs,
    endMs: r.endMs,
    text: '',
  };
  const next = [...rows];
  next.splice(index, 1, first, second);
  return { rows: next, selected: [index, index + 1] };
}

/** Swap the rows at `i` and `j` (positions). */
export function swapRows(rows: SubtitleRow[], i: number, j: number): OpResult {
  if (i === j || i < 0 || j < 0 || i >= rows.length || j >= rows.length)
    return { rows, selected: [i] };
  const next = [...rows];
  [next[i], next[j]] = [next[j], next[i]];
  return { rows: next, selected: [j] };
}

/** Snap each row's START to the previous row's END over `[from..to]` (descending must be pre-sorted). */
export function timeConsecutiveByStart(rows: SubtitleRow[], from: number, to: number): OpResult {
  const next = rows.map((r) => ({ ...r }));
  for (let i = Math.max(1, from); i <= to && i < next.length; i++) {
    next[i].startMs = next[i - 1].endMs;
  }
  const sel: number[] = [];
  for (let i = Math.max(1, from); i <= to && i < next.length; i++) sel.push(i);
  return { rows: next, selected: sel };
}

/** Snap each row's END to the NEXT row's START over `[from..to]`. */
export function timeConsecutiveByEnd(rows: SubtitleRow[], from: number, to: number): OpResult {
  const next = rows.map((r) => ({ ...r }));
  for (let i = from; i < to && i < next.length - 1; i++) {
    next[i].endMs = next[i + 1].startMs;
  }
  const sel: number[] = [];
  for (let i = from; i < to && i < next.length - 1; i++) sel.push(i);
  return { rows: next, selected: sel };
}

export function deleteRows(rows: SubtitleRow[], indices: number[]): OpResult {
  const remove = new Set(indices);
  const next = rows.filter((_, i) => !remove.has(i));
  const anchor = Math.min(...indices, rows.length - 1);
  return { rows: next, selected: [Math.min(anchor, next.length - 1)] };
}

/** Copy a single row's payload for clipboard-style operations. */
export function copyRowData(row: SubtitleRow | undefined): Partial<SubtitleRow> | null {
  if (!row) return null;
  const { id: _id, ...rest } = row;
  return rest;
}

/** Paste copied row data after `index`. */
export function pasteAfter(rows: SubtitleRow[], index: number, data: Partial<SubtitleRow>): OpResult {
  const at = index + 1;
  const row = { ...makeBlank(rows, data), id: maxId(rows) + 1 };
  const next = [...rows];
  next.splice(at, 0, row);
  return { rows: next, selected: [at] };
}

/** Paste a single copied column value into the row at `index`. */
export function pasteColumn(
  rows: SubtitleRow[],
  index: number,
  column: keyof SubtitleRow,
  value: unknown,
): OpResult {
  if (!rows[index]) return { rows, selected: [index] };
  const next = rows.map((r, i) => (i === index ? { ...r, [column]: value } : r));
  return { rows: next, selected: [index] };
}

/** Reassign sequential display ids/order after any mutation (called by the store). */
export function reindex(rows: SubtitleRow[]): SubtitleRow[] {
  return rows.map((r, i) => ({ ...r }));
}

export function enumerate(rows: SubtitleRow[]): SubtitleRow[] {
  return rows.map((r) => ({ ...r }));
}

/** Sort a copy by start time (used when toggling "keep sorted"). */
export function sortByStart(rows: SubtitleRow[]): SubtitleRow[] {
  return [...rows].sort(byStart);
}
