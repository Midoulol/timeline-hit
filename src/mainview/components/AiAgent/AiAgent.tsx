import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge";
import { singleLineText } from "../../../shared/types";
import { useStore } from "../../store/useStore";
import "./AiAgent.css";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function AiAgent() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "没问题" },
    { role: "user", content: "帮我翻译" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const deepseek = useStore((s) => s.deepseek);
  const setDeepseek = useStore((s) => s.setDeepseek);
  const activeRowId = useStore((s) => s.activeRowId);
  const doc = useStore((s) => s.doc);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, streaming]);

  const activeText = doc?.rows.find((r) => r.id === activeRowId)?.text ?? "";
  const contextText = activeText ? `当前选中字幕：${singleLineText(activeText)}` : "";

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setStreaming("");
    const includeContext = contextText ? [contextText] : [];
    const payload = [
      ...messages,
      { role: "user" as const, content: text },
      ...includeContext.map((c) => ({ role: "user" as const, content: c })),
    ];
    let acc = "";
    // Push the current API key / task / workspace to the main process so it
    // can authenticate and build the system prompt.
    try {
      await bridge.setDeepseek(deepseek);
    } catch {
      /* settings persistence is best-effort */
    }
    await bridge.aiChat(payload, { model: deepseek.model, task: deepseek.task, workspace: deepseek.workspace }, {
      onToken: (t) => {
        acc += t;
        setStreaming(acc);
      },
      onDone: ({ ok, error }) => {
        if (ok) {
          setMessages((m) => [...m, { role: "assistant", content: acc }]);
        } else {
          setMessages((m) => [...m, { role: "assistant", content: `⚠ ${error}` }]);
        }
        setStreaming(null);
        setBusy(false);
      },
    });
  }

  return (
    <div className="ai">
      <div className="ai-messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`ai-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {streaming != null && <div className="ai-bubble assistant">{streaming || "…"}</div>}
      </div>

      <div className="ai-input-row">
        <input
          className="ai-input"
          placeholder="有什么问题直接问吧"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          发送
        </button>
      </div>

      <div className="ai-settings">
        <label>
          任务
          <input value={deepseek.task} onChange={(e) => setDeepseek({ ...deepseek, task: e.target.value })} />
        </label>
        <label>
          工作区
          <input value={deepseek.workspace} onChange={(e) => setDeepseek({ ...deepseek, workspace: e.target.value })} />
        </label>
        <label>
          模型名
          <input value={deepseek.model} onChange={(e) => setDeepseek({ ...deepseek, model: e.target.value })} />
        </label>
        <label className="ai-key" title="DeepSeek API Key（存于主进程，不出渲染层）">
          Key
          <input type="password" value={deepseek.apiKey} onChange={(e) => setDeepseek({ ...deepseek, apiKey: e.target.value })} />
        </label>
      </div>
    </div>
  );
}
