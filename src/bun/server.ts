// ============================================================================
// Local HTTP server (runs in the Bun MAIN process)
// ============================================================================
// Serves:
//   - local media (video/audio) with CORS + HTTP Range support, so the
//     <video>/<audio> elements in the webview can play and seek AND the Web
//     Audio AnalyserNode can read the audio (requires CORS on the media).
//   - a small JSON API for subtitle IO, settings, AI (SSE streaming), and the
//     reserved Whisper entry point.
// The webview talks to this server with plain `fetch` — no cross-process RPC
// dependency and no CORS restriction. Runs on 127.0.0.1 on a fixed dev port.
import { existsSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import type { DeepSeekSettings, SubtitleDoc } from "../shared/types";
import { parseAss, serializeAss } from "../shared/ass";
import { AppStore } from "./db";
import { streamChat } from "./deepseek";
import { transcribe } from "./whisper";
import { probeInfo, videoStart, videoFrame, videoSeek, videoPause, videoPlay, videoStop } from "./videoDecode";

const MEDIA_EXT: Record<string, true> = {
  ".mp4": true, ".webm": true, ".mkv": true, ".mov": true, ".avi": true, ".m4v": true,
  ".mp3": true, ".wav": true, ".ogg": true, ".aac": true, ".flac": true,
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEFAULT_VIDEO = ["D:\\bundev\\subtitle\\ziliao\\夺还篇pv1.mp4", process.env.SUBTITLE_TOOL_VIDEO ?? ""];
const DEFAULT_SUBTITLE = ["D:\\bundev\\subtitle\\ziliao\\夺还篇pv1.ass", process.env.SUBTITLE_TOOL_SUBTITLE ?? ""];

 function firstExisting(candidates: string[]): string | null {
   for (const c of candidates) if (c && existsSync(c)) return c;
   return null;
 }

  
  function contentTypeFor(p: string): string {
   switch (extname(p).toLowerCase()) {
     case ".mp4": case ".m4v": return "video/mp4";
     case ".mkv": return "video/x-matroska";
     case ".webm": return "video/webm";
     case ".mov": return "video/quicktime";
     case ".avi": return "video/x-msvideo";
     case ".ogv": return "video/ogg";
     case ".mp3": return "audio/mpeg";
     case ".wav": return "audio/wav";
     case ".ogg": return "audio/ogg";
     case ".aac": return "audio/aac";
     case ".flac": return "audio/flac";
     default: return "application/octet-stream";
   }
 }

 // ---- video codec handling (HEVC/other -> H.264 transcode so AV both play) ----
 function ffmpegPath(): string | null {
   const candidates = [
     process.env.FFMPEG_PATH ?? "",
     "D:\\bundev\\subtitle\\ziliao\\ffmpeg.exe",
     "ffmpeg",
   ];
   for (const c of candidates) {
     if (!c) continue;
     if (c.includes("\\") || c.includes("/")) {
       if (existsSync(c)) return c;
     } else {
       return c; // bare command -> resolved via PATH
     }
   }
   return null;
 }

 /** Detect the video codec from `ffmpeg -i` output (no ffprobe present). */
 function detectVideoCodec(ff: string, input: string): string {
   try {
     const res = Bun.spawnSync([ff, "-hide_banner", "-i", input]);
     const err = res.stderr?.toString() ?? "";
     const m = /Video:\s*([a-zA-Z0-9_]+)/.exec(err);
     return (m?.[1] ?? "").toLowerCase();
   } catch {
     return "";
   }
 }

 // Chromium/WebView2 can demux MP4/WebM/OGG directly; MKV plays only if the video
 // codec is H.264/VP9/AV1. Everything else (HEVC-10bit… ) -> transcode to H.264.
 const DIRECT_PLAY: Record<string, true> = { ".mp4": true, ".webm": true, ".ogv": true, ".ogg": true };
 let remuxSeq = 0;
 async function remuxToPlayable(input: string): Promise<{ ok: boolean; path?: string; error?: string }> {
   const e = extname(input).toLowerCase();
   if (DIRECT_PLAY[e]) return { ok: true, path: input };
   const ff = ffmpegPath();
   if (!ff) return { ok: false, error: "未找到 ffmpeg，无法转码 HEVC/其他编码的 MKV" };
   const out = join(tmpdir(), `subtitle-tool-v${Date.now()}-${remuxSeq++}.mp4`);
   const codec = detectVideoCodec(ff, input);
   const vArgs = codec === "h264" ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
   const args = ["-y", "-i", input, ...vArgs, "-c:a", "aac", "-b:a", "192k", "-sn", "-movflags", "+faststart", out];
   const proc = Bun.spawn([ff, ...args]);
   const exit = await proc.exited;
   if (exit !== 0) {
     const stderr = await new Response(proc.stderr).text();
     return { ok: false, error: `ffmpeg 转码失败: ${stderr.slice(0, 300)}` };
   }
   return { ok: true, path: out };
 }

 // ---- native file dialog (Windows; gets a real filesystem path) ----
 async function pickVideoPath(): Promise<string | null> {
   try {
     const ps = `
 Add-Type -AssemblyName System.Windows.Forms
 $f = New-Object System.Windows.Forms.OpenFileDialog
 $f.Filter = '视频文件 (*.mp4;*.mkv;*.webm;*.mov;*.avi;*.m4v;*.ogv)|*.mp4;*.mkv;*.webm;*.mov;*.avi;*.m4v;*.ogv'
 $f.Title = '选择视频'
 if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($f.FileName) }
 `;
     const tmp = join(tmpdir(), `subtitle-video-picker-${Date.now()}.ps1`);
     await Bun.write(tmp, ps);
     const res = Bun.spawnSync(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp]);
     rmSync(tmp, { force: true });
     const out = (res.stdout?.toString() ?? "").trim();
     if (res.exitCode === 0 && out) return out;
   } catch { /* fall through */ }
   return null;
 }

// ---- request-body validation (network boundary) ----
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function guardDeepseek(v: unknown): DeepSeekSettings | null {
  if (!isObj(v)) return null;
  const apiKey = readString(v.apiKey);
  const baseUrl = readString(v.baseUrl);
  const model = readString(v.model);
  const task = readString(v.task);
  const workspace = readString(v.workspace);
  if (apiKey === null || baseUrl === null || model === null || task === null || workspace === null) return null;
  return { apiKey, baseUrl, model, task, workspace };
}

function guardDoc(v: unknown): SubtitleDoc | null {
  if (!isObj(v)) return null;
  if (!Array.isArray(v.rows) || !Array.isArray(v.styles)) return null;
  if (!isObj(v.scriptInfo)) return null;
  return v as SubtitleDoc;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function serveMedia(req: Request, url: URL): Response {
  // URLSearchParams already decodes once; mediaUrl() single-encodes, so any
  // further decode would corrupt filenames containing a literal '%' (e.g. %3A).
  const raw = url.searchParams.get("p") ?? "";
  if (!raw || !existsSync(raw) || !MEDIA_EXT[extname(raw).toLowerCase()]) {
    return json({ ok: false, error: "media not found" }, 404);
  }
  const file = Bun.file(raw);
  const size = file.size;
  const range = req.headers.get("range");
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    return new Response(file.slice(start, Math.min(end, size - 1) + 1) as BodyInit, {
      status: 206,
      headers: {
        ...CORS,
        "Content-Type": contentTypeFor(raw),
        "Content-Range": `bytes ${start}-${Math.min(end, size - 1)}/${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }
  // Full-file response; let Bun compute Content-Length so the stream decodes cleanly.
  return new Response(file as BodyInit, {
    status: 200,
    headers: { ...CORS, "Content-Type": contentTypeFor(raw), "Accept-Ranges": "bytes" },
  });
}

async function aiStream(req: Request, store: AppStore): Promise<Response> {
  const b = await req.json();
  if (!isObj(b) || !Array.isArray(b.messages)) return json({ ok: false, error: "bad body" }, 400);
  const messages = b.messages as { role: string; content: string }[];
  const model = readString(b.model) ?? store.getDeepseek().model;
  const task = readString(b.task) ?? "";
  const workspace = readString(b.workspace) ?? "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      streamChat(store.getDeepseek(), { model, task, workspace }, messages, (token) =>
        send("token", { token }),
      )
        .then((r) => {
          send("done", { ok: r.ok, error: r.error });
          controller.close();
        })
        .catch((e) => {
          send("done", { ok: false, error: String(e) });
          controller.close();
        });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export interface ServerInfo {
  port: number;
  baseUrl: string;
  store: AppStore;
}

export function startServer(dataDir: string): ServerInfo {
  const store = new AppStore(dataDir);
  const port = 19030;

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      const url = new URL(req.url);
      try {
                 if (url.pathname === "/api/video/start") return json(await videoStartReq(req));
         if (url.pathname === "/api/video/frame") return videoFrameResp();
         if (url.pathname === "/api/video/control") return json(await videoControlReq(req));
         if (url.pathname === "/media") return serveMedia(req, url);
         if (url.pathname === "/api/info") return json({ ok: true, baseUrl: `http://127.0.0.1:${server.port}` });
         if (url.pathname === "/api/video/info")
           return json(probeInfo(ffmpegPath(), url.searchParams.get("p") ?? ""));
        if (url.pathname === "/api/pick-video") return json(await pickVideo(store));
        if (url.pathname === "/api/prepare-video") return json(await prepareVideo(req));
        if (url.pathname === "/api/frame") return frame(req);
        if (url.pathname === "/api/load-ass") return json(await loadAss(req));
        if (url.pathname === "/api/save-ass") return json(await saveAss(req, store));
        if (url.pathname === "/api/save-as") return json(await saveAs(req, store));
        if (url.pathname === "/api/settings") return json(store.getAll());
        if (url.pathname === "/api/settings/deepseek" && req.method === "GET")
          return json(store.getDeepseek());
        if (url.pathname === "/api/settings/deepseek" && req.method === "POST") {
          const s = guardDeepseek(await req.json());
          if (!s) return json({ ok: false, error: "bad deepseek settings" }, 400);
          store.setDeepseek(s);
          return json({ ok: true });
        }
        if (url.pathname === "/api/ai/chat") return aiStream(req, store);
        if (url.pathname === "/api/whisper/transcribe") return json(await whisper(req));
        if (url.pathname === "/api/default/video") return json({ path: firstExisting(DEFAULT_VIDEO) });
        if (url.pathname === "/api/default/subtitle") return json({ path: firstExisting(DEFAULT_SUBTITLE) });
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
             return json({ ok: false, error: "not found" }, 404);
     },
   });

  return { port: server.port, baseUrl: `http://127.0.0.1:${server.port}`, store };
}

async function pickSubtitle(store: AppStore) {
  const path = firstExisting(DEFAULT_SUBTITLE);
  if (!path) return { canceled: true, error: "未找到默认字幕文件，请接入原生文件对话框。" };
  store.pushRecent(path);
  return { canceled: false, path };
}

 async function pickVideo(store: AppStore) {
   const viaDialog = await pickVideoPath();
   if (viaDialog) return { canceled: false, path: viaDialog };
   return { canceled: true };
 }
 
  async function prepareVideo(req: Request) {
   const b = await req.json();
   const path = isObj(b) ? readString(b.path) : null;
   if (!path) return json({ ok: false, error: "path required" }, 400);
   return remuxToPlayable(path);
 }
 
 // 取帧：解码视频某时间点(s)的一帧，返回 JPEG 图片。Aegisub 打轴的"取帧"能力。
 async function frame(req: Request): Promise<Response> {
   const b = await req.json();
   const path = isObj(b) ? readString(b.path) : null;
   const tMs = isObj(b) ? Number(b.tMs) : 0;
   if (!path) return json({ ok: false, error: "path required" }, 400);
   const ff = ffmpegPath();
   if (!ff) return json({ ok: false, error: "未找到 ffmpeg" }, 400);
   const t = Math.max(0, tMs) / 1000;
   const args = [
     "-hide_banner", "-loglevel", "error",
     "-ss", String(t), "-i", path,
     "-frames:v", "1",
     "-vf", "scale=960:-2",
     "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3",
     "pipe:1",
   ];
   const proc = Bun.spawn([ff, ...args]);
   const buf = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
   const exit = await proc.exited;
       if (exit !== 0 || buf.byteLength === 0) {
      return json({ ok: false, error: "取帧失败" }, 500);
    }
    return new Response(buf, {
      headers: { ...CORS, "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  }
 
 async function videoStartReq(req: Request) {
  const b = await req.json();
  const path = isObj(b) ? readString(b.path) : null;
  const seekMs = isObj(b) ? Number(b.seekMs) || 0 : 0;
  if (!path) return json({ ok: false, error: "path required" }, 400);
  return videoStart(ffmpegPath(), path, seekMs);
}

function videoFrameResp() {
  const f = videoFrame();
  if (!f) return json({ ok: false, error: "no frame" }, 204);
  return new Response(new Uint8Array(f.data), {
    headers: { ...CORS, "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Frame-W": String(f.w), "X-Frame-H": String(f.h) },
  });
}

async function videoControlReq(req: Request) {
  const b = await req.json();
  const cmd = isObj(b) ? readString(b.cmd) : null;
  const value = isObj(b) ? Number(b.value) : undefined;
  if (cmd === "seek" && typeof value === "number") videoSeek(value);
  else if (cmd === "pause") videoPause();
  else if (cmd === "play") videoPlay();
  else if (cmd === "stop") videoStop();
  return { ok: true };
}

 async function loadAss(req: Request) {
  const b = await req.json();
  const path = isObj(b) ? readString(b.path) : null;
  if (!path) return json({ ok: false, error: "path required" }, 400);
  const content = await Bun.file(path).text();
  return { ok: true, doc: parseAss(content, path) };
}

async function saveAss(req: Request, store: AppStore) {
  const b = await req.json();
  const path = isObj(b) ? readString(b.path) : null;
  const doc = isObj(b) ? guardDoc(b.doc) : null;
  if (!path || !doc) return json({ ok: false, error: "path + doc required" }, 400);
  await Bun.write(path, serializeAss(doc));
  store.pushRecent(path);
  return { ok: true, path };
}

async function saveAs(req: Request, store: AppStore) {
  const b = await req.json();
  const name = isObj(b) ? readString(b.name) : null;
  const doc = isObj(b) ? guardDoc(b.doc) : null;
  if (!name || !doc) return json({ ok: false, error: "name + doc required" }, 400);
  const out = join(tmpdir(), "subtitle-tool", name);
  await Bun.write(out, serializeAss(doc));
  store.pushRecent(out);
  return { ok: true, path: out };
}

async function whisper(req: Request) {
  const b = await req.json();
  const audioPath = isObj(b) ? readString(b.audioPath) : null;
  if (!audioPath) return json({ ok: false, error: "audioPath required" }, 400);
  return transcribe(audioPath);
}
