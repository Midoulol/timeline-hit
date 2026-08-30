// Millisecond <-> timestamp conversions. Internal representation is ALWAYS
// milliseconds; formatting to ASS / SRT / display happens only at the edges.

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "0:00:19.19" (ASS centiseconds) -> ms */
export function parseAssTimestamp(s: string): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const fracRaw = m[4] ?? '';
  // Fraction digits are centiseconds (2) typically; scale by digit count.
  const fracMs = fracRaw
    ? Math.round(Number(fracRaw) * 10 ** (2 - fracRaw.length))
    : 0;
  return h * 3600_000 + min * 60_000 + sec * 1000 + fracMs * 10;
}

/** ms -> "0:00:19.19" */
export function formatAssTimestamp(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const cs = Math.floor(t / 10) % 100;
  const s = Math.floor(t / 1000) % 60;
  const min = Math.floor(t / 60_000) % 60;
  const h = Math.floor(t / 3_600_000);
  return `${h}:${pad(min)}:${pad(s)}.${pad(cs)}`;
}

/** "00:00:19,190" (SRT) -> ms */
export function parseSrtTimestamp(s: string): number {
  const m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(s.trim());
  if (!m) return 0;
  return (
    Number(m[1]) * 3600_000 +
    Number(m[2]) * 60_000 +
    Number(m[3]) * 1000 +
    Number(m[4].padEnd(3, '0'))
  );
}

/** ms -> "00:00:19,190" */
export function formatSrtTimestamp(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(
    Math.floor(t / 1000) % 60,
  )},${pad(t % 1000, 3)}`;
}

/** Compact UI display: "0:00:08.79" */
export function formatDisplayTime(ms: number): string {
  return formatAssTimestamp(ms);
}

/** ms -> frame number at given fps (frame-accurate editing mode). */
export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/** frame number -> ms at given fps. */
export function frameToMs(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000);
}

export function formatClock(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const s = Math.floor(t / 1000) % 60;
  const min = Math.floor(t / 60_000) % 60;
  const h = Math.floor(t / 3_600_000);
  return h > 0 ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}
