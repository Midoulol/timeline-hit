// Direct HEVC decode via a persistent ffmpeg pipe (no re-encode). A background
// render loop decodes frames and caches the latest; the renderer polls an HTTP
// endpoint for it (HTTP polling is ~25fps, unlike the WS large-frame ~10fps).
import type { Subprocess } from "bun";

export interface VideoInfo {
  ok: boolean;
  w: number;
  h: number;
  fps: number;
  duration: number; // ms
  error?: string;
}

export function probeInfo(ffmpeg: string | null, path: string): VideoInfo {
  if (!ffmpeg) return { ok: false, w: 0, h: 0, fps: 0, duration: 0, error: "未找到 ffmpeg" };
  const res = Bun.spawnSync([ffmpeg, "-hide_banner", "-i", path]);
  const err = res.stderr?.toString() ?? "";
  const dim = /(\d{2,5})x(\d{2,5})/.exec(err);
  const w = dim ? parseInt(dim[1], 10) : 0;
  const h = dim ? parseInt(dim[2], 10) : 0;
  const fps = parseFloat(/([\d.]+) fps/.exec(err)?.[1] ?? "0") || 0;
  const dur = /Duration:\s*(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(err);
  const duration = dur
    ? (parseInt(dur[1], 10) * 3600 + parseInt(dur[2], 10) * 60 + parseFloat(dur[3])) * 1000
    : 0;
  return { ok: w > 0, w, h, fps, duration };
}

const OUT_W = 320;

interface State {
  proc: Subprocess | null;
  ffmpeg: string | null;
  path: string;
  w: number;
  h: number;
  killed: boolean;
  cached: { data: Buffer } | null;
}

let st: State = { proc: null, ffmpeg: null, path: "", w: OUT_W, h: 270, killed: false, cached: null };
let renderTimer: ReturnType<typeof setInterval> | null = null;

function stopPipe() {
  if (st.proc) { try { st.proc.kill(9); } catch { /* ignore */ } }
  if (renderTimer) { clearInterval(renderTimer); renderTimer = null; }
  if (st.proc) { try { st.proc.stdin?.end(); } catch { /* ignore */ } }
  st.proc = null;
  st.cached = null;
}

// Spawn ffmpeg decoding `path` (seek to seekMs if >=0) into 480-wide RGBA; a loop
// reads frames and caches the latest for the HTTP endpoint.
function spawnPipe(seekMs: number) {
  stopPipe();
  const ff = st.ffmpeg!;
  const frameSize = st.w * st.h * 4;
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-re",
    ...(seekMs > 0 ? ["-ss", String(seekMs / 1000)] : []),
    "-i", st.path,
    "-vf", `scale=${st.w}:-2`,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-an",
    "pipe:1",
  ];
  const proc = Bun.spawn([ff, ...args]);
  st.proc = proc;
  st.killed = false;
  const reader = proc.stdout.getReader();
  const chunk = Buffer.alloc(frameSize * 2);
  let len = 0;
  (async () => {
    try {
      for (;;) {
        while (len < frameSize && !st.killed && st.proc === proc) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) { chunk.set(value, len); len += value.length; }
        }
        if (len < frameSize || st.killed || st.proc !== proc) break;
        st.cached = { data: Buffer.from(chunk.subarray(0, frameSize)) };
        chunk.copyWithin(0, frameSize, len);
        len -= frameSize;
      }
    } catch { /* stream ended */ }
  })();
}

export function videoStart(ffmpeg: string | null, path: string, seekMs = 0): { ok: boolean; w?: number; h?: number; error?: string } {
  stopPipe();
  st = { proc: null, ffmpeg, path, w: OUT_W, h: Math.round((OUT_W * 9) / 16), killed: false, cached: null };
  const info = probeInfo(ffmpeg, path);
  st.h = info.ok ? Math.max(2, Math.round((info.h * OUT_W) / info.w)) : Math.round((OUT_W * 9) / 16);
  spawnPipe(seekMs);
  // Render loop keeps the pipe draining + cache fresh; also serves the pace.
  renderTimer = setInterval(() => { /* keep alive */ }, 500);
  return { ok: true, w: st.w, h: st.h };
}

export function videoFrame(): { w: number; h: number; data: Buffer } | null {
  return st.cached ? { w: st.w, h: st.h, data: st.cached.data } : null;
}
export function videoSeek(ms: number): void { spawnPipe(ms); }
export function videoPause(): void { st.killed = true; try { st.proc?.kill(9); } catch { /* ignore */ } }
export function videoPlay(): void { spawnPipe(0); }
export function videoStop(): void { stopPipe(); }
