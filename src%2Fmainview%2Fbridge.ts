// Renderer-side bridge to the main-process HTTP server. The webview talks to
// the Bun main process over plain fetch (CORS-enabled), so there is no
// cross-process RPC dependency. The API base URL is injected by the main
// process via the `?api=` query param on the view URL.
import type { AiMessage, DeepSeekSettings, SubtitleDoc, TranscriptionSegment } from "../shared/types";

function apiBase(): string {
  const p = new URLSearchParams(location.search).get("api");
  return (p ?? "http://127.0.0.1:19030").replace(/\/+$/, "");
}
const BASE = apiBase();

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  return res.json() as Promise<T>;
}

export interface AiStreamHandlers {
  onToken: (token: string) => void;
  onDone: (result: { ok: boolean; error?: string }) => void;
}

export const bridge = {
  baseUrl: BASE,

  /** URL for a local media file, usable as a <video>/<audio> src. */
  mediaUrl(path: string): string {
    return `${BASE}/media?p=${encodeURIComponent(path)}`;
  },

  info(): Promise<{ ok: boolean; baseUrl: string }> {
    return getJSON("/api/info");
  },

  pickSubtitle(): Promise<{ canceled: boolean; path?: string; error?: string }> {
    return postJSON("/api/pick-subtitle", {});
  },
  pickVideo(): Promise<{ canceled: boolean; path?: string }> {
    return postJSON("/api/pick-video", {});
  },
    prepareVideo(path: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    return postJSON("/api/prepare-video", { path });
  },
  /** Decode the video frame at `tMs` (HEVC-capable) and return an object URL. */
  async frame(path: string, tMs: number): Promise<string | null> {
    const res = await fetch(`${BASE}/api/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, tMs }),
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },
  getDefaultVideo(): Promise<{ path: string | null }> {
    return getJSON("/api/default/video");
  },
  getDefaultSubtitle(): Promise<{ path: string | null }> {
    return getJSON("/api/default/subtitle");
  },

  loadAss(path: string): Promise<{ ok: boolean; doc?: SubtitleDoc; error?: string }> {
    return postJSON("/api/load-ass", { path });
  },
  saveAss(path: string, doc: SubtitleDoc): Promise<{ ok: boolean; path?: string; error?: string }> {
    return postJSON("/api/save-ass", { path, doc });
  },
  saveAs(name: string, doc: SubtitleDoc): Promise<{ ok: boolean; path?: string; error?: string }> {
    return postJSON("/api/save-as", { name, doc });
  },

  getSettings(): Promise<Record<string, unknown>> {
    return getJSON("/api/settings");
  },
  getDeepseek(): Promise<DeepSeekSettings> {
    return getJSON("/api/settings/deepseek");
  },
  setDeepseek(s: DeepSeekSettings): Promise<{ ok: boolean }> {
    return postJSON("/api/settings/deepseek", s);
  },

  /** Stream an AI completion over SSE; resolves on the terminal event. */
  async aiChat(
    messages: AiMessage[],
    opts: { model: string; task: string; workspace: string },
    handlers: AiStreamHandlers,
  ): Promise<void> {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, ...opts }),
    });
    const reader = res.body?.getReader();
    if (!reader) {
      handlers.onDone({ ok: false, error: "无响应流" });
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const evt = /^event:\s*(\S+)/m.exec(block)?.[1];
        const dataLine = /^data:\s*(.*)/m.exec(block)?.[1];
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine);
          if (evt === "token") handlers.onToken(data.token ?? "");
          else if (evt === "done") handlers.onDone(data);
        } catch {
          /* skip malformed frame */
        }
      }
    }
  },

  transcribe(audioPath: string): Promise<{ ok: boolean; segments?: TranscriptionSegment[]; error?: string }> {
    return postJSON("/api/whisper/transcribe", { audioPath });
  },
};
