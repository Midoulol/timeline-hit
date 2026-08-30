// Subtitle editor: LEFT column = toolbar (role/style + B I U S + color tokens +
// ✓ + 字数) above the content textarea; RIGHT column = independent time panel
// (☐时间 ☐帧, 标记+色块, 开始/结束/时长). Edits write back to the active row.
import { useMemo, useRef, useState } from "react";
import { stripAssTags } from "../../../shared/types";
import { formatAssTimestamp, parseAssTimestamp, msToFrame, frameToMs } from "../../../shared/time";
import { wrapWithColor, COLOR_TOKENS } from "../../theme";
import { useStore } from "../../store/useStore";
import "./SubtitleEditor.css";

const ROLE_PRESET = "菜月昴";

export default function SubtitleEditor() {
  const doc = useStore((s) => s.doc);
  const activeRowId = useStore((s) => s.activeRowId);
  const timeEditable = useStore((s) => s.timeEditable);
  const frameMode = useStore((s) => s.frameMode);
  const fps = useStore((s) => s.fps);
  const updateRow = useStore((s) => s.updateRow);
  const toggleTimeEditable = useStore((s) => s.toggleTimeEditable);
  const toggleFrameMode = useStore((s) => s.toggleFrameMode);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const [editStyle, setEditStyle] = useState(false);

  const rows = doc?.rows ?? [];
  const active = useMemo(() => rows.find((r) => r.id === activeRowId) ?? null, [rows, activeRowId]);

  const roles = useMemo(() => {
    const set = new Set<string>([ROLE_PRESET]);
    rows.forEach((r) => r.character && set.add(r.character));
    return [...set];
  }, [rows]);

  const styles = useMemo(() => doc?.styles.map((s) => s.name) ?? ["对白 中文", "对白 日语"], [doc]);
  const activeStyle = doc?.styles.find((s) => s.name === active?.style);

  if (!active) {
    return <div className="se se-empty">选择一行字幕进行编辑（点击表格行，或播放时自动跟随）。</div>;
  }

  const patch = (p: Partial<typeof active>) => updateRow(active.id, p);

  const wrapSel = (open: string, close: string) => {
    const ta = taRef.current;
    if (!ta) {
      patch({ text: `${open}${active.text}${close}` });
      return;
    }
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = active.text.slice(s, e);
    const next = active.text.slice(0, s) + open + sel + close + active.text.slice(e);
    patch({ text: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + open.length, e + open.length);
    });
  };

  const applyColor = (hex: string) => {
    const ta = taRef.current;
    if (!ta || ta.selectionStart === ta.selectionEnd) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = active.text.slice(s, e);
    const next = active.text.slice(0, s) + wrapWithColor(hex, sel) + active.text.slice(e);
    patch({ text: next });
  };

  const fmtTime = (ms: number) => (frameMode ? String(msToFrame(ms, fps)) : formatAssTimestamp(ms));
  const parseTime = (v: string) => (frameMode ? frameToMs(Number(v) || 0, fps) : parseAssTimestamp(v));

  const setStart = (v: string) => patch({ startMs: parseTime(v) });
  const setEnd = (v: string) => patch({ endMs: parseTime(v) });
  const setDuration = (v: string) => patch({ endMs: active.startMs + parseTime(v) });

  return (
    <div className="se">
      <div className="se-main">
        <div className="se-toolbar">
          <label>
            角色
            <select value={active.character} onChange={(e) => patch({ character: e.target.value })}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label>
            样式
            <select value={active.style} onChange={(e) => patch({ style: e.target.value })}>
              {styles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button className="se-style-btn" title="编辑当前样式" onClick={() => setEditStyle((v) => !v)}>
            编辑样式
          </button>

          <span className="se-tags">
            <button className="tag" title="粗体" onClick={() => wrapSel("{\\b1}", "{\\b0}")}>B</button>
            <button className="tag" title="斜体" onClick={() => wrapSel("{\\i1}", "{\\i0}")}>I</button>
            <button className="tag" title="下划线" onClick={() => wrapSel("{\\u1}", "{\\u0}")}>U</button>
            <button className="tag" title="删除线" onClick={() => wrapSel("{\\s1}", "{\\s0}")}>S</button>
            <button className="tag" title="下标" onClick={() => wrapSel("{\\fs20}", "{\\fs46}")}>x₂</button>
            {COLOR_TOKENS.map((c) => (
              <button
                key={c.name}
                className="tag color-token"
                title={`${c.label}色`}
                style={{ background: c.hex }}
                onClick={() => applyColor(c.hex)}
              />
            ))}
            <button className="tag" title="确认（提交光标）" onClick={() => taRef.current?.blur()}>
              ✓
            </button>
          </span>

          <label className="se-count">
            字数
            <span>{stripAssTags(active.text).length}</span>
          </label>
        </div>

        {editStyle && activeStyle && (
          <div className="se-style-panel">
            样式「{activeStyle.name}」 字号
            <input
              type="number"
              defaultValue={Number(activeStyle.fontsize)}
              onBlur={(e) => updateStyle(activeStyle.name, "fontsize", Number(e.target.value) || 46.7)}
            />
            主色
            <input
              defaultValue={assColorToHex(activeStyle.primaryColour)}
              onBlur={(e) => updateStyle(activeStyle.name, "primaryColour", hexToAssColor(e.target.value))}
            />
          </div>
        )}

        <div className="se-content">
          <textarea
            ref={taRef}
            className="se-textarea"
            value={active.text}
            onChange={(e) => patch({ text: e.target.value })}
            placeholder="字幕编辑内容"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="se-side">
        <div className="se-checks">
          <label>
            <input type="checkbox" checked={timeEditable} onChange={toggleTimeEditable} />
            时间
          </label>
          <label>
            <input type="checkbox" checked={frameMode} onChange={toggleFrameMode} />
            帧
          </label>
        </div>

        <div className="se-mark">
          <button className={`se-flag-btn ${active.flagged ? "on" : ""}`} onClick={() => patch({ flagged: !active.flagged })}>
            标记
          </button>
          <span className={`se-flag-block ${active.flagged ? "on" : ""}`} />
        </div>

        <div className="se-time">
          <label>
            <input value={fmtTime(active.startMs)} disabled={!timeEditable} onChange={(e) => setStart(e.target.value)} />
            开始
          </label>
          <label>
            <input value={fmtTime(active.endMs)} disabled={!timeEditable} onChange={(e) => setEnd(e.target.value)} />
            结束
          </label>
          <label>
            <input value={fmtTime(active.endMs - active.startMs)} disabled={!timeEditable} onChange={(e) => setDuration(e.target.value)} />
            时长
          </label>
        </div>
      </div>
    </div>
  );
}

// ---- style helpers ----
function updateStyle(name: string, field: "fontsize" | "primaryColour", value: number | string): void {
  useStore.setState((s) =>
    s.doc
      ? {
          doc: {
            ...s.doc,
            styles: s.doc.styles.map((st) => (st.name === name ? { ...st, [field]: value } : st)),
          },
          dirty: true,
        }
      : {},
  );
}

function assColorToHex(ass: string): string {
  const m = /&H([0-9A-Fa-f]{6})&/.exec(ass);
  if (!m) return "#FFFFFF";
  const bgr = m[1];
  return `#${bgr.slice(4, 6)}${bgr.slice(2, 4)}${bgr.slice(0, 2)}`;
}

function hexToAssColor(hex: string): string {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return "&H00FFFFFF&";
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
}
