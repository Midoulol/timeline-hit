// Shared subtitle data model. Imported by BOTH the Electron main process
// (bundled by esbuild) and the React renderer (bundled by Vite).

// HSV→BGR helpers for ASS override tags (&\c&HBBGGRR&).
export type AssColor =
  | 'red'
  | 'green'
  | 'blue'
  | 'yellow'
  | 'cyan'
  | 'purple'
  | 'white';

export interface AssStyle {
  name: string;
  fontname: string;
  fontsize: number;
  primaryColour: string;
  secondaryColour: string;
  outlineColour: string;
  backColour: string;
  bold: number;
  italic: number;
  underline: number;
  strikeOut: number;
  scaleX: number;
  scaleY: number;
  spacing: number;
  angle: number;
  borderStyle: number;
  outline: number;
  shadow: number;
  alignment: number;
  marginL: number;
  marginR: number;
  marginV: number;
  encoding: number;
}

export interface SubtitleRow {
  /** Stable id in the loaded document. */
  id: number;
  layer: number;
  /** Start time, milliseconds. Internal representation is ALWAYS ms. */
  startMs: number;
  /** End time, milliseconds. */
  endMs: number;
  style: string;
  character: string;
  marginL: number;
  marginR: number;
  marginV: number;
  effect: string;
  /** Raw ASS text (may embed {\...} override tags). */
  text: string;
  /** User flag → shown with a red marker in the table. */
  flagged: boolean;
}

export interface SubtitleDoc {
  fileName: string;
  scriptInfo: Record<string, string>;
  projectGarbage: string[];
  wrapStyle: number;
  playResX: number;
  playResY: number;
  styles: AssStyle[];
  rows: SubtitleRow[];
}

/** One Whisper/STT transcription result, ready to be inserted as subtitle rows. */
export interface TranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  task: string;
  workspace: string;
}

/** CPS = characters per second, computed on the visible (tag-stripped) text. */
export function cpsForRow(row: SubtitleRow): number {
  const durationSec = (row.endMs - row.startMs) / 1000;
  if (durationSec <= 0) return 0;
  return Math.round(stripAssTags(row.text).length / durationSec);
}

/** Strip {\...} override tags from ASS text for display / CPS counting. */
export function stripAssTags(text: string): string {
  return text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\h/g, ' ');
}

/** Remove ASS line-break tags, producing a single-line display string. */
export function singleLineText(text: string): string {
  return stripAssTags(text).replace(/[\r\n]+/g, ' ');
}

export const DEFAULT_DURATION_MS = 2000;
