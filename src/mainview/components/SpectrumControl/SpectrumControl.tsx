// Aegisub-style audio spectrum display (borrows Aegisub's design):
// an STFT spectrogram (time × frequency) coloured with Aegisub's "Icy Blue"
// scheme (Hue 191-63, Sat 127-255, Lightness 0-255 scaled by magnitude), shown
// in a 30s window that scrolls with the playhead, with a time ruler and a
// toolbar (播放/暂停). Diagnostic globals (__phase/__errInfo) help debug.
import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge";
import { audioBus } from "../../audioBus";
import { useStore } from "../../store/useStore";
import { formatClock } from "../../../shared/time";
import "./SpectrumControl.css";

const FFT_SIZE = 4096; // higher resolution -> clearer vocal formants
const HOP = 1024;
const ROWS = 96;
const RULER_H = 26;
 const VIEW = 15; // seconds visible at once (Aegisub horizontal zoom 2 => ~15s)
 const PH = 0.3; // playhead fixed at 30% from the left

 // Visible time window centred on a stable focus (ms). The focus is snap-shotted
// when a row is selected and can be panned with the wheel; it is NOT derived
// from the live row start, so dragging the red/blue lines never moves the view.
function windowFor(focusMs: number, videoDuration: number): { dur: number; startT: number; viewDur: number } {
  const dur = (videoDuration || 1000) / 1000;
  let startT = focusMs / 1000 - PH * VIEW;
  startT = Math.max(0, Math.min(startT, Math.max(0, dur - VIEW)));
  return { dur, startT, viewDur: VIEW };
}

// Debug hook kept as a no-op (all call sites are harmless).
const DBG = (..._args: unknown[]) => {};

// iterative radix-2 FFT (in-place)
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// Aegisub "Icy Blue" normal scheme -> RGB (0-255) via the byte-HSL mapping.
function icyToRgb(v: number): [number, number, number] {
  const hB = 191 + v * -128;
  const sB = 127 + v * 128;
  const lB = 0 + v * 255;
  const h = ((hB / 255) * 360) % 360;
  const s = Math.max(0, Math.min(100, (sB / 255) * 100));
  const l = Math.max(0, Math.min(100, (lB / 255) * 100));
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l / 100 - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// 256-entry colour lookup (fast render).
const LUT: Uint8Array = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = icyToRgb(i / 255);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
})();
 interface SpecData {
   img: HTMLCanvasElement;
  wave: HTMLCanvasElement;
   spec: Float32Array;
 }

function buildSpec(audio: AudioBuffer): SpecData {
  const mono = new Float32Array(audio.length);
  const chans = Math.min(audio.numberOfChannels, 2);
  for (let c = 0; c < chans; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < audio.length; i++) mono[i] += d[i] / chans;
  }

  const cols = Math.max(1, Math.floor((mono.length - FFT_SIZE) / HOP));
  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const spec = new Float32Array(cols * ROWS);
  const invNorm = 1 / Math.sqrt(2 * FFT_SIZE); // Aegisub: value = log10(9·x+1), x=mag*invNorm

  for (let cIdx = 0; cIdx < cols; cIdx++) {
    const off = cIdx * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const half = FFT_SIZE / 2;
    for (let b = 0; b < ROWS; b++) {
      const f0 = Math.pow(0.005, 1 - b / ROWS);
      const f1 = Math.pow(0.005, 1 - (b + 1) / ROWS);
      const i0 = Math.max(1, Math.floor(f0 * half));
      const i1 = Math.max(1, Math.floor(f1 * half));
      let m = 0;
      for (let k = i0; k < i1 && k < half; k++) {
        const mag = Math.hypot(re[k], im[k]);
        if (mag > m) m = mag;
      }
      const v = Math.min(1, Math.log10(9 * m * invNorm + 1));
      spec[cIdx * ROWS + b] = v;
    }
  }

  // Per-row normalisation: each frequency band scaled to its own peak so the
  // full harmonic structure reads as dense bright bands, not just the bass.
  for (let r = 0; r < ROWS; r++) {
    let mx = 1e-6;
    for (let c = 0; c < cols; c++) mx = Math.max(mx, spec[c * ROWS + r]);
    // gamma < 1 brightens the mid/low content so the spectrogram reads dense.
    for (let c = 0; c < cols; c++) {
      const v = Math.min(1, spec[c * ROWS + r] / mx);
      spec[c * ROWS + r] = Math.pow(v, 0.35);
    }
  }

  // render to an offscreen canvas (2048 wide) using the LUT
  const W = 2048;
  const img = document.createElement("canvas");
  img.width = W;
  img.height = ROWS;
  const ictx = img.getContext("2d")!;
  const id = ictx.createImageData(W, ROWS);
  for (let x = 0; x < W; x++) {
    const sx = Math.min(cols - 1, Math.floor((x / W) * cols));
    for (let y = 0; y < ROWS; y++) {
      const idx = Math.min(255, Math.round(spec[sx * ROWS + y] * 255));
      const p = (y * W + x) * 4;
      id.data[p] = LUT[idx * 3];
      id.data[p + 1] = LUT[idx * 3 + 1];
      id.data[p + 2] = LUT[idx * 3 + 2];
      id.data[p + 3] = 255;
    }
  }
   ictx.putImageData(id, 0, 0);
    // ---- waveform: peak amplitude envelope per column (Aegisub style) ----
  const wave = new Float32Array(cols);
  for (let cIdx = 0; cIdx < cols; cIdx++) {
    let peak = 0;
    for (let i = 0; i < HOP && cIdx * HOP + i < mono.length; i++) {
      const a = Math.abs(mono[cIdx * HOP + i]);
      if (a > peak) peak = a;
    }
    wave[cIdx] = peak;
  }
  let wmax = 1e-6;
  for (let c = 0; c < cols; c++) wmax = Math.max(wmax, wave[c]);
  for (let c = 0; c < cols; c++) wave[c] = Math.min(1, wave[c] / wmax);

  const wimg = document.createElement("canvas");
  wimg.width = W;
  wimg.height = ROWS;
  const wctx = wimg.getContext("2d")!;
  wctx.fillStyle = "#0a0a12";
  wctx.fillRect(0, 0, W, ROWS);
  for (let x = 0; x < W; x++) {
    const sx = Math.min(cols - 1, Math.floor((x / W) * cols));
    const a = wave[sx];
    const h = Math.max(1, a * ROWS * 0.5);
    const g = Math.round(140 + a * 115);
    wctx.fillStyle = `rgba(${40}, ${g}, ${150}, 1)`;
    wctx.fillRect(x, ROWS / 2 - h / 2, 1, h);
  }
  return { img, wave: wimg, spec };
 }
export default function SpectrumControl() {
     const canvasRef = useRef<HTMLCanvasElement>(null);
   const [analyzing, setAnalyzing] = useState(true);
   const [mode, setMode] = useState<"spectrum" | "waveform">("spectrum");
   const [nStart, setNStart] = useState(100); // ms step to move the red (start) line
   const [nEnd, setNEnd] = useState(100); // ms step to move the blue (end) line
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);
     const videoTimeMs = useStore((s) => s.videoTimeMs);
   const videoDuration = useStore((s) => s.videoDuration);
   const requestSeek = useStore((s) => s.requestSeek);
   const activeRowId = useStore((s) => s.activeRowId);
   const dataRef = useRef<SpecData | null>(null);
   const focusRef = useRef<number | null>(null); // stable view focus (ms)

  useEffect(() => {
    let cancelled = false;
    setAnalyzing(true);
    (async () => {
      let spec: SpecData | null = null;
      try {
        DBG("__phase", "get-video");
        const { path } = await bridge.getDefaultVideo();
        if (!path) {
          DBG("__errInfo", "no-default-video");
          return;
        }
        DBG("__phase", "fetch");
        const resp = await fetch(bridge.mediaUrl(path));
        const buf = await resp.arrayBuffer();
        DBG("__phase", "decode");
        const ac = new AudioContext();
        let audio: AudioBuffer | null = null;
        try {
          audio = await ac.decodeAudioData(buf.slice(0));
        } catch {
          DBG("__errInfo", "decode-failed");
        }
        void ac.close();
        if (!audio || cancelled) {
          if (!audio) DBG("__errInfo", "no-audio");
          return;
        }
        DBG("__phase", "build");
        spec = buildSpec(audio);
        DBG("__phase", "done");
      } catch {
        DBG("__errInfo", "exception");
        spec = null;
      }
      if (!cancelled) {
        dataRef.current = spec;
        if (spec) {
          let mn = 1, mx = 0, avg = 0;
          for (const v of spec.spec) { mn = Math.min(mn, v); mx = Math.max(mx, v); avg += v; }
          DBG("__specInfo", { min: +mn.toFixed(3), max: +mx.toFixed(3), avg: +(avg / spec.spec.length).toFixed(3) });
        }
        setAnalyzing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const specH = h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(8,10,16,0.55)"; // translucent ruler (transparent feel)
      ctx.fillRect(0, 0, w, RULER_H);

       const ct = videoTimeMs / 1000;
       const st = useStore.getState();
      const { dur, startT, viewDur } = windowFor(focusRef.current ?? videoTimeMs, videoDuration);

      const d = dataRef.current;
      DBG("__drawState", { hasData: !!d, analyzing });
      if (d) {
        ctx.imageSmoothingEnabled = true;
        const srcX = (startT / dur) * d.img.width;
        const srcW = Math.max(1, (viewDur / dur) * d.img.width);
        const img = mode === "spectrum" ? d.img : d.wave;
        ctx.drawImage(img, srcX, 0, srcW, img.height, 0, 0, w, h);
      } else {
        ctx.fillStyle = "#101018";
        ctx.fillRect(0, 0, w, specH);
        ctx.fillStyle = "#8a8a9a";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(analyzing ? "分析音频中…" : "无法分析音频", w / 2, h / 2);
      }

      // ruler
      ctx.fillStyle = "#c8c8d0";
      ctx.font = "11px monospace";
      ctx.textBaseline = "middle";
      const interval = tickInterval(viewDur);
      ctx.strokeStyle = "#3a3a4a";
      ctx.beginPath();
      for (let t = Math.ceil(startT / interval) * interval; t <= startT + viewDur; t += interval) {
        const x = ((t - startT) / viewDur) * w;
        ctx.fillText(formatClock(t * 1000), x + 2, RULER_H / 2);
        ctx.moveTo(x, RULER_H - 4);
        ctx.lineTo(x, RULER_H);
      }
      ctx.stroke();

      // playhead
      const px = ((ct - startT) / viewDur) * w;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();

      // subtitle timing overlay: prev row (white), active row start(red)/end(blue)
      {
        const rows = st.doc?.rows ?? [];
        const ai = rows.findIndex((r) => r.id === st.activeRowId);
        const active = ai >= 0 ? rows[ai] : null;
        const prev = ai > 0 ? rows[ai - 1] : null;
        const xFor = (ms: number) => ((ms / 1000 - startT) / viewDur) * w;
        const vline = (ms: number, color: string, width: number, handle: boolean) => {
          const x = xFor(ms);
          if (x < -12 || x > w + 12) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
          if (handle) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(x - 7, RULER_H);
            ctx.lineTo(x + 7, RULER_H);
            ctx.lineTo(x, RULER_H + 11);
            ctx.closePath();
            ctx.fill();
          }
        };
        if (prev) {
          vline(prev.startMs, "#ffffff", 1, false);
          vline(prev.endMs, "#ffffff", 1, false);
        }
        if (active) {
          const sx = xFor(active.startMs);
          const ex = xFor(active.endMs);
          if (ex > 0 && sx < w) {
            ctx.fillStyle = "rgba(90,60,160,0.25)";
            ctx.fillRect(Math.max(0, Math.min(sx, ex)), 0, Math.abs(ex - sx), h);
          }
          vline(active.startMs, "#d80f39", 2, true); // red start
          vline(active.endMs, "#1e66f5", 2, true); // blue end
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [analyzing, videoTimeMs, videoDuration, mode]);

  // Snap the view to a newly selected row (paused only) so its timing lines
  // come into view; kept stable so dragging the lines never moves the view.
  useEffect(() => {
    if (useStore.getState().isPlaying) return;
    const st = useStore.getState();
    const r = st.doc?.rows.find((x) => x.id === st.activeRowId);
    focusRef.current = r?.startMs ?? st.videoTimeMs;
  }, [activeRowId, isPlaying]);

  // Pan the view with the mouse wheel (moving the spectrum is manual).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useStore.getState();
      const durMs = st.videoDuration || 1000;
      const base = focusRef.current ?? st.videoTimeMs;
      focusRef.current = Math.max(0, Math.min(base + e.deltaY * 60, durMs));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Drag the red (start) / blue (end) line to retime the active row.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Drag is delta-based and slowed by DRAG_SCALE so micro-adjustments are
    // precise (a full-width drag only moves by viewDur / DRAG_SCALE).
    const DRAG_SCALE = 2.5;
    let drag: { kind: "start" | "end"; startX: number; startMs: number } | null = null;
    let downX = 0;
    let downY = 0;
    let moved = false;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
      const st = useStore.getState();
      const r = st.doc?.rows.find((x) => x.id === st.activeRowId);
      if (!r) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const wnd = windowFor(focusRef.current ?? st.videoTimeMs, st.videoDuration);
      const sx = ((r.startMs / 1000 - wnd.startT) / wnd.viewDur) * rect.width;
      const ex = ((r.endMs / 1000 - wnd.startT) / wnd.viewDur) * rect.width;
      if (Math.abs(x - sx) < 8) drag = { kind: "start", startX: x, startMs: r.startMs };
      else if (Math.abs(x - ex) < 8) drag = { kind: "end", startX: x, startMs: r.endMs };
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        const st = useStore.getState();
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const wnd = windowFor(focusRef.current ?? st.videoTimeMs, st.videoDuration);
        const dxSec = ((x - drag.startX) / rect.width) * wnd.viewDur; // seconds moved
        const ms = Math.max(
          0,
          Math.min(drag.startMs + (dxSec / DRAG_SCALE) * 1000, wnd.dur * 1000),
        );
        if (st.activeRowId != null) {
          st.updateRow(st.activeRowId, drag.kind === "start" ? { startMs: ms } : { endMs: ms });
        }
      } else if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) {
        moved = true; // a wander, not a click
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag && !moved) {
        // Click on the spectrum: with the blue (end) line as boundary, a click
        // to its LEFT snaps the red (start) line there; to its RIGHT snaps the
        // blue (end) line there. Fast timing (打轴).
        const st = useStore.getState();
        const r = st.doc?.rows.find((x) => x.id === st.activeRowId);
        if (r) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const wnd = windowFor(focusRef.current ?? st.videoTimeMs, st.videoDuration);
          const ms = Math.max(
            0,
            Math.min((wnd.startT + (x / rect.width) * wnd.viewDur) * 1000, wnd.dur * 1000),
          );
          const blueX = ((r.endMs / 1000 - wnd.startT) / wnd.viewDur) * rect.width;
          if (x < blueX) st.updateRow(r.id, { startMs: ms });
          else st.updateRow(r.id, { endMs: ms });
        }
      }
      drag = null;
      moved = false;
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const togglePlay = () => {
    const v = useStore.getState().videoEl;
    if (!v) return;
    if (isPlaying) v.pause();
    else {
      audioBus.resume();
      v.play();
    }
    setPlaying(!isPlaying);
  };

  const stopAudio = () => {
    useStore.getState().videoEl?.pause();
    requestSeek(0);
    setPlaying(false);
  };

     const seekBy = (delta: number) => {
     const v = useStore.getState().videoEl;
     if (v) requestSeek(v.currentTime * 1000 + delta);
   };

   const moveStart = (deltaMs: number) => {
     const st = useStore.getState();
     const r = st.doc?.rows.find((x) => x.id === st.activeRowId);
     if (r) st.updateRow(r.id, { startMs: Math.max(0, Math.min(r.startMs - deltaMs, r.endMs)) });
   };

   const moveEnd = (deltaMs: number) => {
     const st = useStore.getState();
     const r = st.doc?.rows.find((x) => x.id === st.activeRowId);
     if (r) {
       const max = st.videoDuration || r.endMs + deltaMs;
       st.updateRow(r.id, { endMs: Math.min(max, Math.max(r.startMs, r.endMs + deltaMs)) });
     }
   };

  return (
    <div className="sp">
      <canvas ref={canvasRef} className="sp-canvas" />
             <div className="sp-toolbar">
         <button className="sp-btn" onClick={() => requestSeek(0)}>到0</button>
         <button className="sp-btn" onClick={() => seekBy(-5000)}>后退</button>
         <button className="sp-btn" onClick={stopAudio}>停止</button>
         <button className="sp-btn" onClick={togglePlay}>{isPlaying ? "暂停" : "播放"}</button>
         <button className="sp-btn" onClick={() => seekBy(5000)}>前进</button>
         <button className="sp-btn" onClick={() => setMode((m) => (m === "spectrum" ? "waveform" : "spectrum"))}>
           {mode === "spectrum" ? "波形" : "频谱"}
         </button>
         <span className="sp-sep" />
         <label className="sp-move">
           开始-
           <input type="number" value={nStart} step={10} onChange={(e) => setNStart(Number(e.target.value) || 0)} />
           ms
           <button className="sp-btn" onClick={() => moveStart(nStart)}>&lt;</button>
         </label>
         <label className="sp-move">
           结束+
           <input type="number" value={nEnd} step={10} onChange={(e) => setNEnd(Number(e.target.value) || 0)} />
           ms
           <button className="sp-btn" onClick={() => moveEnd(nEnd)}>&gt;</button>
         </label>
       </div>
    </div>
  );
}

function tickInterval(duration: number): number {
  for (const i of [30, 15, 10, 5, 2, 1]) {
    const n = duration / i;
    if (n >= 5 && n <= 13) return i;
  }
  return duration > 120 ? 30 : 10;
}
