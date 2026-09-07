// Global application state (zustand). All cross-component state lives here:
// the subtitle document, playback time, selection, editor toggles, settings.
import { create } from 'zustand';
import type { DeepSeekSettings, SubtitleDoc, SubtitleRow, TranscriptionSegment } from '../../shared/types';
import type { OpResult } from '../../shared/ops';
import { replaceInText } from '../../shared/find';

interface AppState {
  // document
  doc: SubtitleDoc | null;
  filePath: string | null;
  dirty: boolean;

  // playback
  videoTimeMs: number;
  isPlaying: boolean;
  videoDuration: number;
  fps: number;
  /** One-shot seek request consumed by the VideoPlayer. */
  pendingSeekMs: number | null;
  /** The <video> element, set by VideoPlayer so other components (e.g. the
   *  spectrum toolbar) can toggle playback. */
  videoEl: HTMLVideoElement | null;

  // selection / current row
  activeRowId: number | null;
  selectedIds: number[];
  searchQuery: string;
  highlightQuery: string;
  highlightRegex: boolean;

  // flow
  flowStep: number;

  // editor toggles
  timeEditable: boolean;
  frameMode: boolean;

  // clip buffer
  clipboard: Partial<SubtitleRow> | null;

  // settings
  deepseek: DeepSeekSettings;

  // ------ actions ------
  setDoc: (doc: SubtitleDoc, path: string | null) => void;
  setDirty: (d: boolean) => void;
  updateRow: (id: number, patch: Partial<SubtitleRow>) => void;
  setRows: (rows: SubtitleRow[]) => void;
  replaceAll: (find: string, replacement: string, regex: boolean) => void;
  applyOp: (res: OpResult) => void;
  insertTranscription: (segments: TranscriptionSegment[]) => void;

  setVideoTime: (ms: number) => void;
  setPlaying: (b: boolean) => void;
  setVideoDuration: (ms: number) => void;
  setFps: (f: number) => void;
  requestSeek: (ms: number) => void;
  clearSeek: () => void;

  setActiveRow: (id: number | null) => void;
  setSelected: (ids: number[]) => void;
  toggleSelected: (id: number) => void;
  setSearch: (q: string) => void;
  setHighlight: (q: string) => void;
  setHighlightRegex: (b: boolean) => void;

  setFlowStep: (n: number) => void;
  toggleTimeEditable: () => void;
  toggleFrameMode: () => void;
  setClipboard: (row: Partial<SubtitleRow> | null) => void;

  setDeepseek: (s: DeepSeekSettings) => void;
}

const DEFAULT_DEEPSEEK: DeepSeekSettings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  task: '',
  workspace: '',
};

function replaceRow(rows: SubtitleRow[], id: number, patch: Partial<SubtitleRow>): SubtitleRow[] {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

export const useStore = create<AppState>((set, get) => ({
  doc: null,
  filePath: null,
  dirty: false,

  videoTimeMs: 0,
  isPlaying: false,
  videoDuration: 0,
  fps: 23.976,
  pendingSeekMs: null,
  videoEl: null,

  activeRowId: null,
  selectedIds: [],
  searchQuery: '',
  highlightQuery: '',
  highlightRegex: false,

  flowStep: 0,

  timeEditable: false,
  frameMode: false,

  clipboard: null,
  deepseek: DEFAULT_DEEPSEEK,

  setDoc: (doc, path) => set({ doc, filePath: path, dirty: false, selectedIds: [], activeRowId: null }),
  setDirty: (d) => set({ dirty: d }),

  updateRow: (id, patch) => {
    const s = get();
    if (!s.doc) return;
    set({ doc: { ...s.doc, rows: replaceRow(s.doc.rows, id, patch) }, dirty: true });
  },

  setRows: (rows) => {
    const s = get();
    if (!s.doc) return;
    set({ doc: { ...s.doc, rows }, dirty: true });
  },

  replaceAll: (find, replacement, regex) => {
    const s = get();
    if (!s.doc) return;
    const rows = s.doc.rows.map((r) => {
      const text = replaceInText(r.text, find, replacement, regex);
      return text === r.text ? r : { ...r, text };
    });
    set({ doc: { ...s.doc, rows }, dirty: true });
  },

  applyOp: (res) => {
    const s = get();
    if (!s.doc) return;
    const selectedIds = res.selected.map((i) => res.rows[i]?.id).filter((x): x is number => x != null);
    set({
      doc: { ...s.doc, rows: res.rows },
      dirty: true,
      selectedIds,
      activeRowId: selectedIds[0] ?? s.activeRowId,
    });
  },

  insertTranscription: (segments) => {
    const s = get();
    if (!s.doc) return;
    const doc = s.doc;
    let id = doc.rows.reduce((m, r) => Math.max(m, r.id), -1);
    const newRows = segments.map((seg) => ({
      id: ++id,
      layer: 0,
      startMs: seg.startMs,
      endMs: seg.endMs,
      style: doc.styles[0]?.name ?? 'Default',
      character: '',
      marginL: 0,
      marginR: 0,
      marginV: 0,
      effect: '',
      text: seg.text,
      flagged: false,
    }));
    const sorted = [...doc.rows, ...newRows].sort((a, b) => a.startMs - b.startMs);
    set({ doc: { ...doc, rows: sorted }, dirty: true });
  },

  setVideoTime: (ms) => {
    const s = get();
    set({ videoTimeMs: ms });
    // Track the current row for the playback highlight.
    const cur = s.doc
      ?.rows.find((r) => ms >= r.startMs && ms < r.endMs)
      ?.id ?? null;
    if (cur != null && cur !== get().activeRowId && s.isPlaying) {
      set({ activeRowId: cur });
    }
  },

  setPlaying: (b) => set({ isPlaying: b }),
  setVideoDuration: (ms) => set({ videoDuration: ms }),
  setFps: (f) => set({ fps: f }),
  requestSeek: (ms) => set({ pendingSeekMs: ms }),
  clearSeek: () => set({ pendingSeekMs: null }),

  setActiveRow: (id) => set({ activeRowId: id }),
  setSelected: (ids) => set({ selectedIds: ids }),
  toggleSelected: (id) => {
    const sel = get().selectedIds;
    set({ selectedIds: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
  },
  setSearch: (q) => set({ searchQuery: q }),
  setHighlight: (q) => set({ highlightQuery: q }),
  setHighlightRegex: (b) => set({ highlightRegex: b }),

  setFlowStep: (n) => set({ flowStep: n }),
  toggleTimeEditable: () => set({ timeEditable: !get().timeEditable }),
  toggleFrameMode: () => set({ frameMode: !get().frameMode }),
  setClipboard: (row) => set({ clipboard: row }),

  setDeepseek: (s) => set({ deepseek: s }),
}));

/** Convenience accessor for the current document rows. */
export function currentRows(): SubtitleRow[] {
  return useStore.getState().doc?.rows ?? [];
}
