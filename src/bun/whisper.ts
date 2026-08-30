// Whisper speech-to-text integration (RESERVED interface).
//
// The webview never talks to the STT backend directly. This module exposes a
// single `transcribe(audioPath)` entry point served over RPC. When a backend
// is configured it posts the audio and parses timed segments the SubtitleTable
// can insert directly.
//
// Backend selection:
//   - `WHISPER_ENDPOINT` env var (HTTP backend, OpenAI /v1/audio/transcriptions
//     shape — e.g. faster-whisper-server).
//   - `WHISPER_COMMAND` env var (local CLI emitting JSON segments on stdout).
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "node:child_process";
import type { TranscriptionSegment } from "../shared/types";

export interface TranscribeResult {
  ok: boolean;
  segments?: TranscriptionSegment[];
  error?: string;
}

export async function transcribe(audioPath: string): Promise<TranscribeResult> {
  if (!existsSync(audioPath)) return { ok: false, error: `音频不存在: ${audioPath}` };
  if (process.env.WHISPER_COMMAND) return transcribeViaCli(audioPath);
  if (process.env.WHISPER_ENDPOINT) return transcribeViaHttp(audioPath);
  return {
    ok: false,
    error:
      "Whisper 未配置：请设置 WHISPER_ENDPOINT（HTTP 后端）或 WHISPER_COMMAND（本地 CLI）。接口已预留，接入后即可导入。",
  };
}

async function transcribeViaHttp(audioPath: string): Promise<TranscribeResult> {
  const data = readFileSync(audioPath);
  const form = new FormData();
  form.append("file", new Blob([data]), basename(audioPath));
  form.append("response_format", "json");
  try {
    const res = await fetch(process.env.WHISPER_ENDPOINT!, { method: "POST", body: form });
    if (!res.ok) return { ok: false, error: `Whisper ${res.status}: ${await res.text()}` };
    const json = (await res.json()) as {
      text?: string;
      segments?: { start: number; end: number; text: string }[];
    };
    if (Array.isArray(json.segments) && json.segments.length) {
      return {
        ok: true,
        segments: json.segments.map((s) => ({
          startMs: Math.round(s.start * 1000),
          endMs: Math.round(s.end * 1000),
          text: s.text.trim(),
        })),
      };
    }
    if (json.text) return { ok: true, segments: [{ startMs: 0, endMs: 0, text: json.text }] };
    return { ok: false, error: "Whisper 响应缺少 segments/text" };
  } catch (e) {
    return { ok: false, error: `Whisper 请求失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function transcribeViaCli(audioPath: string): Promise<TranscribeResult> {
  return new Promise((resolve) => {
    const cmd = process.env.WHISPER_COMMAND!;
    const child = spawn(cmd, [audioPath], { shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ ok: false, error: `无法启动 ${cmd}: ${e.message}` }));
    child.on("close", (code) => {
      if (code !== 0) return resolve({ ok: false, error: stderr || `exit ${code}` });
      try {
        const json = JSON.parse(stdout) as {
          segments?: { start: number; end: number; text: string }[];
        };
        if (Array.isArray(json.segments) && json.segments.length) {
          return resolve({
            ok: true,
            segments: json.segments.map((s) => ({
              startMs: Math.round(s.start * 1000),
              endMs: Math.round(s.end * 1000),
              text: s.text.trim(),
            })),
          });
        }
        resolve({ ok: false, error: "CLI 输出缺少 segments 数组" });
      } catch {
        resolve({ ok: false, error: `CLI 输出不是合法 JSON: ${stdout.slice(0, 300)}` });
      }
    });
  });
}
