// Find (literal or regex) and replace utilities over ASS text.
// The searchable "plain" text is the text with {\...} override tags removed,
// which matches the coordinate space used by renderColoredText for highlighting.
const TAG_RE = /\{[^}]*\}/g;

function toPlain(text: string): string {
  return text.replace(TAG_RE, '');
}

/** Return [start, end) match ranges in `plain` (tag-stripped) text. */
export function findRangesInPlain(plain: string, query: string, regex: boolean): Array<[number, number]> {
  if (!query) return [];
  try {
    if (regex) {
      // Python/PCRE `\x{HHHH}` codepoint escapes aren't valid JS; translate to `\u{HHHH}`.
      const pattern = query.replace(/\\x\{([0-9A-Fa-f]{1,6})\}/g, '\\u{$1}');
      const re = new RegExp(pattern, 'gu');
      const ranges: Array<[number, number]> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(plain))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        ranges.push([m.index, m.index + m[0].length]);
      }
      return ranges;
    }
    const needle = query.toLowerCase();
    const hay = plain.toLowerCase();
    const ranges: Array<[number, number]> = [];
    let from = 0;
    for (;;) {
      const i = hay.indexOf(needle, from);
      if (i < 0) break;
      ranges.push([i, i + needle.length]);
      from = i + needle.length;
    }
    return ranges;
  } catch {
    return [];
  }
}

/** Replace the given plain-text ranges in `text`, preserving {\...} tags. */
export function applyReplaceToText(text: string, ranges: Array<[number, number]>, replacement: string): string {
  if (!ranges.length) return text;
  const plain = toPlain(text);
  const starts = new Set<number>();
  const inner = new Set<number>();
  for (const [s, e] of ranges) {
    const cs = Math.max(0, s);
    const ce = Math.min(plain.length, e);
    starts.add(cs);
    for (let p = cs + 1; p < ce; p++) inner.add(p);
  }
  let out = '';
  let plainIdx = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  const tagRe = /\{([^}]*)\}/g;
  tagRe.lastIndex = 0;
  while ((m = tagRe.exec(text))) {
    for (let i = last; i < m.index; i++) {
      const p = plainIdx++;
      if (starts.has(p)) out += replacement;
      else if (!inner.has(p)) out += text[i];
    }
    out += text.slice(m.index, m.index + m[0].length);
    last = m.index + m[0].length;
  }
  for (let i = last; i < text.length; i++) {
    const p = plainIdx++;
    if (starts.has(p)) out += replacement;
    else if (!inner.has(p)) out += text[i];
  }
  return out;
}

/** Convenience: find `find` in `text` and replace all occurrences with `replacement`. */
export function replaceInText(text: string, find: string, replacement: string, regex: boolean): string {
  return applyReplaceToText(text, findRangesInPlain(toPlain(text), find, regex), replacement);
}
