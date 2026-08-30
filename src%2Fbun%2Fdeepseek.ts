// DeepSeek (OpenAI-compatible) chat completion with SSE streaming.
// Runs in the MAIN process: the API key never reaches the webview and there is
// no CORS restriction on the webview.
import type { AiMessage, DeepSeekSettings } from "../shared/types";

const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

export interface ChatOptions {
  model: string;
  task: string;
  workspace: string;
}

export async function streamChat(
  settings: DeepSeekSettings,
  options: ChatOptions,
  messages: AiMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = settings.apiKey;
  if (!apiKey) {
    return { ok: false, error: "未配置 DeepSeek API Key（设置中填入，或用 DEEPSEEK_API_KEY 环境变量）" };
  }
  const baseUrl = (settings.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const model = options.model || settings.model || DEFAULT_MODEL;
  const system = buildSystemPrompt(options.task, options.workspace);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], stream: true }),
      signal,
    });
  } catch (e) {
    return { ok: false, error: `请求失败: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    return { ok: false, error: `DeepSeek ${res.status}: ${detail.slice(0, 500) || res.statusText}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return { ok: true };
        try {
          const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            accumulated += delta;
            onToken(delta);
          }
        } catch {
          /* skip partial / keepalive frames */
        }
      }
    }
  } catch (e) {
    return { ok: false, error: `流式中断: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (accumulated.trim() === "") return { ok: false, error: "(空响应)" };
  return { ok: true };
}

function buildSystemPrompt(task: string, workspace: string): string {
  const lines = [
    "你是一名字幕组校对/翻译助手，帮助用户处理字幕文本（转录、翻译、润色、审查时间轴）。",
    "回答要简洁、直接、专业。除非用户要求，否则不要输出多余解释。",
  ];
  if (task) lines.push(`当前任务：${task}`);
  if (workspace) lines.push(`当前工作区：${workspace}`);
  return lines.join("\n");
}
