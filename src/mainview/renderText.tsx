// Renders ASS text with per-token colour overrides ({\c&HBBGGRR&} ... {\r})
// as inline coloured spans in the table. Other override tags are stripped.
import type { ReactNode } from "react";

const TAG_RE = /\{([^}]*)\}/g;

function bgrToHex(bgr: string): string {
  // "BBGGRR" -> "#RRGGBB"
  const r = bgr.slice(4, 6);
  const g = bgr.slice(2, 4);
  const b = bgr.slice(0, 2);
  return `#${r}${g}${b}`;
}

export function renderColoredText(text: string): ReactNode {
  const out: ReactNode[] = [];
  let plain = "";
  let color: string | null = null;
  let key = 0;
  let last = 0;

  const flushPlain = () => {
    if (plain) {
      out.push(color ? <span key={key++} style={{ color }}>{plain}</span> : plain);
      plain = "";
    }
  };

  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    plain += text.slice(last, m.index);
    const tag = m[1];
    const c = /\bc&H([0-9A-Fa-f]{6})&/.exec(tag);
    if (c) {
      flushPlain();
      color = bgrToHex(c[1]);
    } else if (/\br\b/.test(tag)) {
      flushPlain();
      color = null;
    }
    last = m.index + m[0].length;
  }
  plain += text.slice(last);
  flushPlain();

  return out;
}
