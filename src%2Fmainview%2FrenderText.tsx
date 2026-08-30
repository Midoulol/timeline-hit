// Renders ASS text with per-token colour overrides ({\c&HBBGGRR&} ... {\r})
// as inline coloured spans in the table. Other override tags are stripped.
// `findRanges` (optional) returns [start, end) offsets in the tag-stripped
// plain text whose characters should be highlighted (Ctrl+F style).
import type { ReactNode } from "react";

const TAG_RE = /\{([^}]*)\}/g;

function bgrToHex(bgr: string): string {
  // "BBGGRR" -> "#RRGGBB"
  const r = bgr.slice(4, 6);
  const g = bgr.slice(2, 4);
  const b = bgr.slice(0, 2);
  return `#${r}${g}${b}`;
}

type Range = [number, number];

export function renderColoredText(text: string, findRanges?: (plain: string) => Range[]): ReactNode {
  // Pass 1: strip tags into plain text + per-char colour.
  const plain: string[] = [];
  const colors: (string | null)[] = [];
  let color: string | null = null;
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    for (let i = last; i < m.index; i++) {
      plain.push(text[i]);
      colors.push(color);
    }
    const tag = m[1];
    const c = /\bc&H([0-9A-Fa-f]{6})&/.exec(tag);
    if (c) color = bgrToHex(c[1]);
    else if (/\br\b/.test(tag)) color = null;
    last = m.index + m[0].length;
  }
  for (let i = last; i < text.length; i++) {
    plain.push(text[i]);
    colors.push(color);
  }
  const plainStr = plain.join("");

  // Highlight bitmap.
  const hl = new Array<boolean>(plainStr.length).fill(false);
  if (findRanges) {
    for (const [s, e] of findRanges(plainStr)) {
      for (let i = Math.max(0, s); i < Math.min(plainStr.length, e); i++) hl[i] = true;
    }
  }

  // Pass 2: group equal (color, highlight) runs into spans.
  const out: ReactNode[] = [];
  let key = 0;
  let i = 0;
  while (i < plainStr.length) {
    const color0 = colors[i];
    const hl0 = hl[i];
    let j = i + 1;
    while (j < plainStr.length && colors[j] === color0 && hl[j] === hl0) j++;
    const seg = plainStr.slice(i, j);
    let node: ReactNode = color0 ? <span key={key++} style={{ color: color0 }}>{seg}</span> : seg;
    if (hl0) node = <mark key={key++} className="t-hl">{node}</mark>;
    out.push(node);
    i = j;
  }
  return out;
}
