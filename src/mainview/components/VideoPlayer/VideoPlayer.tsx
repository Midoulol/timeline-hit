import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge";
import { audioBus } from "../../audioBus";
import { useStore } from "../../store/useStore";
import { formatClock, msToFrame } from "../../../shared/time";
import "./VideoPlayer.css";

// Control bar per the design: 1播放 2当前字幕播放 3暂停 4停止 5音量(下拉)
// 6当前播放帧 7当前时间 8倍速播放 9加载视频. Icons are default (unicode).
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

export default function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [duration, setDuration] = useState(0);
  const [pos, setPos] = useState(0); // smooth current time (ms) via rAF
  const [vol, setVol] = useState(100);
  const [volOpen, setVolOpen] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1); // index into SPEEDS
  const [loaded, setLoaded] = useState(false);

  const isPlaying = useStore((s) => s.isPlaying);
  const activeRowId = useStore((s) => s.activeRowId);
  const fps = useStore((s) => s.fps);
  const doc = useStore((s) => s.doc);
  const setPlaying = useStore((s) => s.setPlaying);
  const setVideoTime = useStore((s) => s.setVideoTime);
  const setVideoDuration = useStore((s) => s.setVideoDuration);

  const loadDefault = useCallback(async () => {
    try {
      const { path } = await bridge.getDefaultVideo();
      if (path) setSrc(bridge.mediaUrl(path));
    } catch {
      /* no default video */
    }
  }, []);

  const loadVideo = useCallback(async () => {
    const { path } = await bridge.pickVideo();
    if (path) setSrc(bridge.mediaUrl(path));
  }, []);

  useEffect(() => {
    loadDefault();
  }, [loadDefault]);

  const video = videoRef.current;
  useEffect(() => {
    if (video && src) audioBus.connect(video);
  }, [video, src]);

  // Publish the <video> element so the spectrum toolbar can toggle playback.
  useEffect(() => {
    useStore.setState({ videoEl: videoRef.current });
  }, []);

  // Smooth progress / time / frame via rAF.
  useEffect(() => {
    if (!video) return;
    let raf = 0;
    const tick = () => {
      setPos(video.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, src]);

  const onTimeUpdate = () => {
    if (video) {
      setVideoTime(video.currentTime * 1000);
      setPos(video.currentTime * 1000);
    }
  };

  const seekTo = (ms: number) => {
    if (video && duration > 0) video.currentTime = Math.min(Math.max(0, ms) / 1000, duration / 1000);
  };

  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = progressRef.current;
    if (!el || !duration) return;
    const rect = el.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * duration);
  };

  // Button behaviors (1-5, 8-9).
    const play = () => {
    audioBus.resume(); // within the click gesture, so the graph runs and video advances
    video?.play();
  };
  const pause = () => video?.pause();
  const stop = () => {
    video?.pause();
    seekTo(0);
  };
  const playCurrentSubtitle = () => {
    const row = doc?.rows.find((r) => r.id === activeRowId);
        if (row) seekTo(row.startMs);
    audioBus.resume();
    video?.play();
  };
  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (video) video.playbackRate = SPEEDS[next];
  };

  const onVolumeChange = (v: number) => {
    setVol(v);
    if (video) video.volume = v / 100;
  };

  const pct = duration > 0 ? Math.min(100, (pos / duration) * 100) : 0;

  return (
    <div className="vp">
      <video
        ref={videoRef}
        className="vp-video"
        src={src}
                crossOrigin="anonymous"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration * 1000);
          setVideoDuration(e.currentTarget.duration * 1000);
          setLoaded(true);
        }}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        controls={false}
        preload="metadata"
      />

      {/* 进度条：默认设计 */}
      <div className="vp-progress" ref={progressRef} onClick={onProgressClick} title="进度条(点击定位)">
        <div className="vp-progress-fill" style={{ width: `${pct}%` }} />
        <div className="vp-progress-knob" style={{ left: `${pct}%` }} />
      </div>

      {/* 控制栏：9 个控件对应设计图 */}
      <div className="vp-controls">
        <button className="vp-btn" title="1.播放" onClick={play} disabled={!loaded}>▶</button>
        <button className="vp-btn" title="2.当前字幕播放" onClick={playCurrentSubtitle} disabled={!loaded || !doc?.rows.length}>▶¹</button>
        <button className="vp-btn" title="3.暂停" onClick={pause} disabled={!loaded}>❚❚</button>
        <button className="vp-btn" title="4.停止" onClick={stop} disabled={!loaded}>■</button>

        <div className="vp-vol" title="5.音量(下拉)">
          <button className="vp-btn" onClick={() => setVolOpen((v) => !v)}>🔊</button>
          {volOpen && (
            <input
              className="vp-vol-slider"
              type="range"
              min={0}
              max={100}
              value={vol}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
            />
          )}
        </div>

        <span className="vp-display" title="6.当前播放帧">帧 {Math.round(msToFrame(pos, fps))}</span>
        <span className="vp-display" title="7.当前时间">{formatClock(pos)}</span>

        <button className="vp-btn vp-speed" title="8.倍速播放" onClick={cycleSpeed} disabled={!loaded}>
          {SPEEDS[speedIdx]}x
        </button>
        <button className="vp-btn vp-load" title="9.加载视频" onClick={loadVideo}>加载视频</button>

        {!loaded && <span className="vp-hint">载入默认视频…</span>}
      </div>
    </div>
  );
}
