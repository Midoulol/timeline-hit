// Catppuccin Latte palette + ASS color-tag helpers shared by components.
export const theme = {
  bg: '#F2EAE8',
  bgPanel: 'rgba(255,255,255,0.4)',
  fg: '#4C4F69',
  muted: '#8C8FA1',
  selectionBg: '#ACB0BE',
  red: '#D20F39',
  green: '#40A02B',
  blue: '#1E66F5',
  yellow: '#DF8E1D',
  cyan: '#179299',
  purple: '#EA76CB',
  black: '#5C5F77',
  white: '#ACB0BE',
  brightWhite: '#BCC0CC',
  cursor: '#DC8A78',
  border: '#CCD0DA',
  activeRow: '#B8E3C9',
  flagRow: '#F3B8BE',
};

export interface ColorToken {
  name: string;
  label: string;
  hex: string;
}

/** The handful of per-token accent colours offered by the AB色标 row. */
export const COLOR_TOKENS: ColorToken[] = [
  { name: 'red', label: '红', hex: theme.red },
  { name: 'green', label: '绿', hex: theme.green },
  { name: 'blue', label: '蓝', hex: theme.blue },
  { name: 'yellow', label: '黄', hex: theme.yellow },
  { name: 'cyan', label: '青', hex: theme.cyan },
  { name: 'purple', label: '紫', hex: theme.purple },
];

/**
 * "#RRGGBB" -> ASS override \c tag "{\c&HBBGGRR&}" (ASS stores colours BGR).
 */
export function hexToAssColor(hex: string): string {
  const h = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '';
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `{\\c&H${b}${g}${r}&}`;
}

/** Wrap the selected substring in a colour override, resetting after it. */
export function wrapWithColor(hex: string, selection: string): string {
  const tag = hexToAssColor(hex);
  if (!tag) return selection;
  return `${tag}${selection}{\\r}`;
}
