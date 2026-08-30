// Aegisub-style audio spectrum following the reference `spectrum/AudioSpectrum.tsx`:
// 64 real-time frequency bars (from the AnalyserNode), each eased toward its
// target with `data += (target-data)*0.15`, coloured `hsl(hue,70%,60%)` with
// hue = 200..260 (blue→purple), on a dark canvas. Below: a toolbar (播放/暂停,
// 平滑).
import { useEffect, useRef, useState } from "react";
import { audioBus } from "../../audioBus";
import { useStore } from "../../store/useStore";
import "./SpectrumControl.css";

const BARS = 64;

export default function SpectrumControl() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [smooth, setSmooth] = useState(true);
  const isPlaying = useStore((s) => s.isPlaying);
  const setPlaying = useStore((s) => s.setPlaying);
  const dataRef = useRef<number[]>([]);
  const targetRef = useRef<number[]>([]);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!dataRef.current.length) dataRef.current = new Array(BARS).fill(0);
    if (!targetRef.current.length) targetRef.current = new Array(BARS).fill(0);
    if (!freqRef.current) freqRef.current = audioBus.makeFrequencyData();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const animate = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const data = dataRef.current;
      const target = targetRef.current;

      // real frequency data -> bar targets (up to ~80% of the height)
      const got = freqRef.current && audioBus.getFrequency(freqRef.current);
      for (let i = 0; i < BARS; i++) {
        const v = got
          ? (freqRef.current![Math.floor((i / BARS) * freqRef.current!.length)] ?? 0) / 255
          : 0;
        target[i] = isPlaying ? v * h * 0.8 : v * h * 0.08;
      }

      // smooth transition (0.15 like the reference)
      const k = smooth ? 0.15 : 0.4;
      for (let i = 0; i < BARS; i++) data[i] += (target[i] - data[i]) * k;

      const barWidth = w / BARS;
      const gap = 1;
      for (let i = 0; i < BARS; i++) {
        const barHeight = Math.max(1, data[i]);
        const hue = (i / BARS) * 60 + 200; // 蓝紫色调
        ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
        ctx.fillRect(i * (barWidth + gap) + gap / 2, h - barHeight, barWidth - gap, barHeight);
      }

      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [smooth, isPlaying]);

  const togglePlay = () => {
    const v = useStore.getState().videoEl;
    if (!v) return;
    if (isPlaying) v.pause();
    else {
      audioBus.resume(); // within the click gesture so the graph runs
      v.play();
    }
    setPlaying(!isPlaying);
  };

  return (
    <div className="sp">
      <canvas ref={canvasRef} className="sp-canvas" />
      <div className="sp-toolbar">
        <button className="sp-btn" title="播放/暂停" onClick={togglePlay}>
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <label className="sp-decay">
          <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
          平滑
        </label>
      </div>
    </div>
  );
}
