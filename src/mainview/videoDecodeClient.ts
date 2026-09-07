// Renderer-side client for the ffmpeg frame-decode (HTTP polling). Draws decoded
// RGBA frames onto a <canvas>; the <video> element plays the AAC track and gives
// the clock, so play/pause/seek drive both. HTTP polling reaches ~25fps (vs the
// WebSocket large-frame path that capped near 10fps).
export class VideoDecodeClient {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private w = 0;
  private h = 0;
  private stopped = false;
  private timer: number | null = null;
  private baseUrl = "";
  private onInfo: ((info: { w: number; h: number; fps: number; duration: number }) => void) | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  /** Start decoding `path` (returns w/h) and begin polling frames. */
  async connect(baseUrl: string, path: string): Promise<{ w: number; h: number; fps: number; duration: number }> {
    this.baseUrl = baseUrl;
    const r = await fetch(baseUrl + "/api/video/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "start failed");
    this.w = j.w;
    this.h = j.h;
    if (this.canvas) { this.canvas.width = j.w; this.canvas.height = j.h; }
    const info = { w: j.w, h: j.h, fps: 0, duration: 0 };
    this.onInfo?.(info);
    return info;
  }

  /** Poll the frame endpoint and draw each frame until stopped. */
  begin() {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        const r = await fetch(this.baseUrl + "/api/video/frame");
        if (r.status === 200) {
          const buf = await r.arrayBuffer();
          const w = Number(r.headers.get("x-frame-w")) || this.w;
          const h = Number(r.headers.get("x-frame-h")) || this.h;
          if (this.ctx) {
            if (this.canvas && (this.canvas.width !== w || this.canvas.height !== h)) {
              this.canvas.width = w;
              this.canvas.height = h;
            }
            this.ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
          }
        }
      } catch { /* child not ready yet */ }
      if (!this.stopped) this.timer = setTimeout(tick, 20);
    };
    tick();
  }

  setOnInfo(fn: (info: { w: number; h: number; fps: number; duration: number }) => void) {
    this.onInfo = fn;
  }

  play() { this.control("play"); }
  seek(ms: number) { this.control("seek", ms); }
  pause() { this.control("pause"); }
  stop() { this.control("stop"); }
  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.control("stop");
  }

  private control(cmd: string, value?: number) {
    void fetch(this.baseUrl + "/api/video/control", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd, value }),
    }).catch(() => { /* ignore */ });
  }
}
