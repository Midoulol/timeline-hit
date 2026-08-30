// ASS (.ass / .ssa) parser and serializer. Preserves header, styles, and
// per-dialogue fields so a load -> edit -> save cycle round-trips cleanly.
import type { AssStyle, SubtitleDoc, SubtitleRow } from './types';
import { parseAssTimestamp } from './time';

interface ParsedSection {
  name: string;
  format: string[];
  items: string[][];
  meta: Record<string, string>;
}

function parseSection(lines: string[]): ParsedSection | null {
  let format: string[] = [];
  const items: string[][] = [];
  const meta: Record<string, string> = {};
  let header = '';
  for (const raw of lines) {
    const line = raw.replace(/^\uFEFF/, '').trimEnd();
    if (!line.trim() || line.startsWith(';')) continue;
    if (line.startsWith('Format:')) {
      format = line
        .slice(7)
        .split(',')
        .map((s) => s.trim());
      continue;
    }
    if (line.startsWith('Style:') || line.startsWith('Dialogue:') || line.startsWith('Comment:')) {
      const kind = line.slice(0, line.indexOf(':'));
      const payload = line.slice(line.indexOf(':') + 1).trim();
      const fields = splitCsv(payload, format.length);
      items.push([kind, ...fields]);
    } else if (line.startsWith('[')) {
      header = line;
    } else {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx)] = line.slice(idx + 1).trim();
    }
  }
  if (items.length === 0 && Object.keys(meta).length === 0) return null;
  return { name: header || '', format, items, meta };
}

/**
 * Split an ASS comma-separated payload into `limit` fields. The final field
 * (usually Text) keeps any embedded commas.
 */
function splitCsv(payload: string, limit: number): string[] {
  if (limit <= 1) return [payload];
  const parts = payload.split(',');
  if (parts.length <= limit) {
    while (parts.length < limit) parts.push('');
    return parts;
  }
  const head = parts.slice(0, limit - 1);
  const tail = parts.slice(limit - 1).join(',');
  return [...head, tail];
}

const STYLE_KEYS: (keyof AssStyle)[] = [
  'name',
  'fontname',
  'fontsize',
  'primaryColour',
  'secondaryColour',
  'outlineColour',
  'backColour',
  'bold',
  'italic',
  'underline',
  'strikeOut',
  'scaleX',
  'scaleY',
  'spacing',
  'angle',
  'borderStyle',
  'outline',
  'shadow',
  'alignment',
  'marginL',
  'marginR',
  'marginV',
  'encoding',
];

export function parseAss(content: string, fileName = 'untitled.ass'): SubtitleDoc {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const sections: ParsedSection[] = [];
  let current: string[] = [];

  // Navigate by section blocks ([...] headers).
  for (const line of lines) {
    if (line.startsWith('[')) {
      if (current.length) {
        const s = parseSection(current);
        if (s) sections.push(s);
      }
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) {
    const s = parseSection(current);
    if (s) sections.push(s);
  }

  let scriptInfo: Record<string, string> = {};
  let projectGarbage: string[] = [];
  let wrapStyle = 0;
  let playResX = 0;
  let playResY = 0;

  const styles: AssStyle[] = [];
  const rows: SubtitleRow[] = [];

  for (const sec of sections) {
    const name = sec.name;
    if (/^\s*\[?Script Info\]?\s*$/i.test(name) || sec.name === '') {
      if (sec.format.length === 0 && sec.items.length === 0) {
        scriptInfo = sec.meta;
      }
    }
    if (name.startsWith('[Script Info')) {
      scriptInfo = { ...scriptInfo, ...sec.meta };
      const wrap = parseInt(scriptInfo['WrapStyle'] ?? '0', 10);
      if (!Number.isNaN(wrap)) wrapStyle = wrap;
      playResX = parseInt(scriptInfo['PlayResX'] ?? '0', 10) || 0;
      playResY = parseInt(scriptInfo['PlayResY'] ?? '0', 10) || 0;
    } else if (name.startsWith('[Aegisub Project Garbage')) {
      projectGarbage = Object.values(sec.meta);
    } else if (name.startsWith('[V4+ Styles')) {
      const fmt = sec.format.length ? sec.format : ['Name', 'Fontname', 'Fontsize', 'PrimaryColour', 'SecondaryColour', 'OutlineColour', 'BackColour', 'Bold', 'Italic', 'Underline', 'StrikeOut', 'ScaleX', 'ScaleY', 'Spacing', 'Angle', 'BorderStyle', 'Outline', 'Shadow', 'Alignment', 'MarginL', 'MarginR', 'MarginV', 'Encoding'];
      for (const item of sec.items) {
        if (item[0] !== 'Style') continue;
        const values = item.slice(1);
        // STYLE_KEYS covers every AssStyle field; coerce() yields the correct
        // string|number type per field, so the conversion is structural.
        const raw: Record<string, string | number> = {};
        for (let i = 0; i < fmt.length; i++) raw[STYLE_KEYS[i]] = coerce(fmt[i], values[i] ?? '');
        const style = raw as unknown as AssStyle;
        style.name = style.name || `Style${styles.length + 1}`;
        styles.push(style);
      }
    } else if (name.startsWith('[Events')) {
      const fmt = sec.format.length
        ? sec.format
        : ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
      let id = 0;
      for (const item of sec.items) {
        const kind = item[0];
        if (kind !== 'Dialogue' && kind !== 'Comment') continue;
        const values = item.slice(1);
        // READ the row as a Dialogue; comments are loaded as flagged placeholder rows.
        const v = (key: string) => {
          const idx = fmt.indexOf(key);
          return idx >= 0 ? values[idx] ?? '' : '';
        };
        const row: SubtitleRow = {
          id: id++,
          layer: parseInt(v('Layer') || '0', 10) || 0,
          startMs: parseAssTimestamp(v('Start')),
          endMs: parseAssTimestamp(v('End')),
          style: v('Style') || 'Default',
          character: v('Name') || '',
          marginL: parseInt(v('MarginL') || '0', 10) || 0,
          marginR: parseInt(v('MarginR') || '0', 10) || 0,
          marginV: parseInt(v('MarginV') || '0', 10) || 0,
          effect: v('Effect') || '',
          text: v('Text') || '',
          flagged: kind === 'Comment',
        };
        rows.push(row);
      }
    }
  }

  return {
    fileName,
    scriptInfo,
    projectGarbage,
    wrapStyle,
    playResX,
    playResY,
    styles,
    rows,
  };
}

function coerce(key: string, value: string): string | number {
  const numeric = ['Fontsize', 'Bold', 'Italic', 'Underline', 'StrikeOut', 'ScaleX', 'ScaleY', 'Spacing', 'Angle', 'BorderStyle', 'Outline', 'Shadow', 'Alignment', 'MarginL', 'MarginR', 'MarginV', 'Encoding'];
  if (numeric.includes(key)) {
    const n = parseFloat(value);
    return Number.isNaN(n) ? 0 : n;
  }
  return value;
}

// ============================== Serialize ==============================

function styleToAss(s: AssStyle): string {
  return [
    s.name,
    s.fontname,
    s.fontsize,
    s.primaryColour,
    s.secondaryColour,
    s.outlineColour,
    s.backColour,
    s.bold,
    s.italic,
    s.underline,
    s.strikeOut,
    s.scaleX,
    s.scaleY,
    s.spacing,
    s.angle,
    s.borderStyle,
    s.outline,
    s.shadow,
    s.alignment,
    s.marginL,
    s.marginR,
    s.marginV,
    s.encoding,
  ].join(',');
}

import { formatAssTimestamp } from './time';

function rowToAss(r: SubtitleRow): string {
  const kind = r.flagged ? 'Comment' : 'Dialogue';
  return `${kind}: ${r.layer},${formatAssTimestamp(r.startMs)},${formatAssTimestamp(
    r.endMs,
  )},${r.style},${r.character},${r.marginL},${r.marginR},${r.marginV},${r.effect},${r.text}`;
}

export function serializeAss(doc: SubtitleDoc): string {
  const out: string[] = [];
  out.push('[Script Info]');
  out.push('; Script generated by Subtitle Tool');
  const infoPriority = [
    'Title',
    'ScriptType',
    'WrapStyle',
    'ScaledBorderAndShadow',
    'YCbCr Matrix',
    'PlayResX',
    'PlayResY',
  ];
  const seen = new Set<string>();
  for (const k of infoPriority) {
    if (doc.scriptInfo[k] !== undefined) {
      out.push(`${k}: ${doc.scriptInfo[k]}`);
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(doc.scriptInfo)) {
    if (!seen.has(k) && !['Title', 'ScriptType', 'WrapStyle', 'PlayResX', 'PlayResY'].includes(k)) {
      out.push(`${k}: ${v}`);
    }
  }
  out.push('');

  if (doc.projectGarbage.length) {
    out.push('[Aegisub Project Garbage]');
    for (const g of doc.projectGarbage) out.push(`${g}`);
    out.push('');
  }

  if (doc.styles.length) {
    out.push('[V4+ Styles]');
    out.push(
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    );
    for (const s of doc.styles) out.push(`Style: ${styleToAss(s)}`);
    out.push('');
  }

  out.push('[Events]');
  out.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  for (const r of doc.rows) out.push(rowToAss(r));

  return out.join('\n');
}
