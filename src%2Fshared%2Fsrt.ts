// SRT parser -> SubtitleDoc (minimal Default style).
import type { AssStyle, SubtitleDoc, SubtitleRow } from './types';
import { parseSrtTimestamp } from './time';

const DEFAULT_STYLE: AssStyle = {
  name: 'Default', fontname: 'Arial', fontsize: 20,
  primaryColour: '&H00FFFFFF', secondaryColour: '&H000000FF',
  outlineColour: '&H00000000', backColour: '&H80000000',
  bold: 0, italic: 0, underline: 0, strikeOut: 0,
  scaleX: 100, scaleY: 100, spacing: 0, angle: 0,
  borderStyle: 1, outline: 2, shadow: 0, alignment: 2,
  marginL: 10, marginR: 10, marginV: 10, encoding: 1,
};

export function parseSrt(content: string, fileName = 'untitled.srt'): SubtitleDoc {
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const rows: SubtitleRow[] = [];
  let id = 0;
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    if (/^\d+$/.test(lines[i].trim())) i++; // optional index line
    const ts = lines[i]?.trim() ?? '';
    const m = /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/.exec(ts);
    if (!m) { i++; continue; }
    const startMs = parseSrtTimestamp(m[1]);
    const endMs = parseSrtTimestamp(m[2]);
    i++;
    const textParts: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') { textParts.push(lines[i]); i++; }
    rows.push({
      id: id++, layer: 0, startMs, endMs, style: 'Default', character: '',
      marginL: 0, marginR: 0, marginV: 0, effect: '',
      text: textParts.join('\\N'), flagged: false,
    });
  }
  return {
    fileName,
    scriptInfo: { ScriptType: 'v4.00+' },
    projectGarbage: [],
    wrapStyle: 0,
    playResX: 0,
    playResY: 0,
    styles: [DEFAULT_STYLE],
    rows,
  };
}
