// Subtitle area: the row table + right-click operation menu.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../../bridge";
import { singleLineText, stripAssTags, cpsForRow } from "../../../shared/types";
import { formatAssTimestamp } from "../../../shared/time";
import { parseAss } from "../../../shared/ass";
import { parseSrt } from "../../../shared/srt";
import { findRangesInPlain } from "../../../shared/find";
import { useStore } from "../../store/useStore";
import { renderColoredText } from "../../renderText";
import { ContextMenu, MenuItem } from "./ContextMenu";
import "./SubtitleTable.css";
import { runOp } from "./opDispatch";

function colorClass(row: { flagged: boolean }): string {
  return row.flagged ? "row-flag" : "";
}

export default function SubtitleTable() {
  const doc = useStore((s) => s.doc);
  const activeRowId = useStore((s) => s.activeRowId);
  const selectedIds = useStore((s) => s.selectedIds);
  const searchQuery = useStore((s) => s.searchQuery);
  const clipboard = useStore((s) => s.clipboard);
  const videoTimeMs = useStore((s) => s.videoTimeMs);

  const setActiveRow = useStore((s) => s.setActiveRow);
  const setSelected = useStore((s) => s.setSelected);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const setSearch = useStore((s) => s.setSearch);
  const highlightQuery = useStore((s) => s.highlightQuery);
  const highlightRegex = useStore((s) => s.highlightRegex);
  const setHighlight = useStore((s) => s.setHighlight);
  const setHighlightRegex = useStore((s) => s.setHighlightRegex);
  const setDoc = useStore((s) => s.setDoc);
  const applyOp = useStore((s) => s.applyOp);
  const insertTranscription = useStore((s) => s.insertTranscription);
  const updateRow = useStore((s) => s.updateRow);
  const setClipboard = useStore((s) => s.setClipboard);
  const requestSeek = useStore((s) => s.requestSeek);
  const replaceAll = useStore((s) => s.replaceAll);
  const filePath = useStore((s) => s.filePath);
  const setDirty = useStore((s) => s.setDirty);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sttBusy, setSttBusy] = useState(false);
   const [replaceMode, setReplaceMode] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rows = doc?.rows ?? [];
 
   // Auto-scroll to the active row (current edit / playback row).
  useEffect(() => {
    if (activeRowId == null || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-row-id="${activeRowId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeRowId, rows.length]);

  const q = searchQuery.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!q) return new Set<number>();
    return new Set(
      rows.filter((r) => singleLineText(r.text).toLowerCase().includes(q)).map((r) => r.id),
    );
  }, [rows, q]);

  const computeHighlightRanges = useCallback(
    (plain: string): Array<[number, number]> => findRangesInPlain(plain, highlightQuery, highlightRegex),
    [highlightQuery, highlightRegex],
  );

  const onFileChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = ""; // allow re-selecting the same file
      if (!f) return;
      const text = await f.text();
      const doc = /\.srt$/i.test(f.name) ? parseSrt(text, f.name) : parseAss(text, f.name);
      setDoc(doc, f.name);
    },
    [setDoc],
  );

  const save = useCallback(async () => {
    if (!doc) return;
    const res = filePath
      ? await bridge.saveAss(filePath, doc)
      : await bridge.saveAs("字幕.ass", doc);
    if (res.ok) setDirty(false);
    else alert(res.error ?? "保存失败");
  }, [doc, filePath, setDirty]);

  const onRowClick = (e: React.MouseEvent, id: number) => {
    if (e.ctrlKey || e.metaKey) toggleSelected(id);
    else {
      setSelected([id]);
      setActiveRow(id);
    }
  };

  const onRowDoubleClick = (id: number, row: (typeof rows)[number]) => {
    setActiveRow(id);
    requestSeek(row.startMs);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !doc) return;
    const anchor = activeRowId ?? rows[rows.length - 1]?.id;
    if (anchor == null) return;
    const idx = rows.findIndex((r) => r.id === anchor);
    runOp(
      "insertAfter",
      rows,
      { index: idx, currentMs: videoTimeMs, positions: [idx], clipboard, setClipboard, updateRow },
      applyOp,
    );
    e.preventDefault();
  };

  const onContextMenu = (e: React.MouseEvent, id: number) => {
    if (!selectedIds.includes(id)) setSelected([id]);
    setActiveRow(id);
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const selectedIdSet = new Set(selectedIds);

  const positionOf = (id: number) => rows.findIndex((r) => r.id === id);
  const selectedPositions = () =>
    (selectedIds.length ? selectedIds : activeRowId != null ? [activeRowId] : []).map(positionOf).filter((i) => i >= 0);

  const dispatch = (name: string) => {
    const sel = selectedPositions();
    const anchor = sel[0] ?? rows.length - 1;
    runOp(name, rows, { index: anchor, currentMs: videoTimeMs, positions: sel, clipboard, setClipboard, updateRow }, applyOp);
    setMenu(null);
  };

  return (
    <div className="st">
      <div className="st-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept=".ass,.srt"
          style={{ display: "none" }}
          onChange={onFileChosen}
        />
        <button onClick={() => fileInputRef.current?.click()} title="载入字幕文件（.ass/.srt）">
          载入字幕
        </button>
        <button onClick={save} title="保存当前字幕">
          保存
        </button>
        <button
          className={replaceMode ? "st-replace st-replace-on" : "st-replace"}
          onClick={() => setReplaceMode((m) => !m)}
          title="搜索 ↔ 替换切换"
        >
          {replaceMode ? "搜索" : "替换"}
        </button>
        <input
          className="st-search"
          placeholder="搜索文本…"
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          className="st-search st-highlight"
          placeholder="高亮文本 (Ctrl+F)…"
          value={highlightQuery}
          onChange={(e) => setHighlight(e.target.value)}
        />
        <button
          className={highlightRegex ? "st-regex st-regex-on" : "st-regex"}
          onClick={() => setHighlightRegex(!highlightRegex)}
          title="正则表达式开/关（作用于高亮栏）"
        >
          {highlightRegex ? "正则:开" : "正则:关"}
        </button>
        <button onClick={whisperImport} disabled={sttBusy} title="从 Whisper 导入识别结果">
          {sttBusy ? "识别中…" : "导入识别"}
        </button>
        <span className="st-count">{rows.length} 行</span>
      </div>
 
       {replaceMode && (
         <div className="st-replace-row">
           <span className="st-replace-label">替换为</span>
           <input
             className="st-search"
             value={replaceQuery}
             onChange={(e) => setReplaceQuery(e.target.value)}
             onKeyDown={(e) => {
               if (e.key === "Enter") replaceAll(highlightQuery, replaceQuery, highlightRegex);
             }}
             placeholder="替换为…"
           />
           <button onClick={() => replaceAll(highlightQuery, replaceQuery, highlightRegex)} title="替换所有匹配">
             替换
           </button>
         </div>
       )}
 
       <div className="st-scroll" ref={scrollRef} onKeyDown={onKeyDown} tabIndex={0}>
        {rows.length === 0 ? (
          <div className="st-empty">没有字幕。点击「载入字幕」或从 Whisper 导入。</div>
        ) : (
          <table className="st-table">
            <thead>
              <tr>
                <th className="c-num">#</th>
                <th>开始时间</th>
                <th>停止时间</th>
                <th className="c-cps">CPS</th>
                <th>样式</th>
                <th className="c-char">角色</th>
                <th className="c-text">文本</th>
                <th className="c-flag">◎</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isActive = r.id === activeRowId;
                const isSearch = matched.has(r.id);
                const isSel = selectedIdSet.has(r.id);
                const cls = [
                  isActive ? "row-active" : isSearch ? "row-search" : colorClass(r),
                  isSel && !isActive ? "row-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr
                    key={r.id}
                    data-row-id={r.id}
                    className={cls}
                    onClick={(e) => onRowClick(e, r.id)}
                    onDoubleClick={() => onRowDoubleClick(r.id, r)}
                    onContextMenu={(e) => onContextMenu(e, r.id)}
                  >
                    <td className="c-num">{i + 1}</td>
                    <td>{formatAssTimestamp(r.startMs)}</td>
                    <td>{formatAssTimestamp(r.endMs)}</td>
                    <td className="c-cps">{cpsForRow(r)}</td>
                    <td>{r.style}</td>
                    <td className="c-char">{r.character}</td>
                    <td className="c-text" title={stripAssTags(r.text)}>
                      {renderColoredText(r.text, computeHighlightRanges)}
                    </td>
                    <td className="c-flag">{r.flagged ? "⚑" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={buildMenu(dispatch, rows, selectedPositions(), !clipboard)}
        />
      )}
    </div>
  );

  async function whisperImport() {
    setSttBusy(true);
    try {
      // Prompt for an audio path (in a release this would be a file picker).
      const audioPath = window.prompt("Whisper 音频路径", "");
      if (!audioPath) return;
      const res = await bridge.transcribe(audioPath);
      if (res.ok && res.segments?.length) insertTranscription(res.segments);
      else alert(res.error ?? "未识别到内容");
    } finally {
      setSttBusy(false);
    }
  }
}

type MenuTree = (MenuItem | "sep")[];

function buildMenu(
  dispatch: (name: string) => void,
  rows: { id: number }[],
  sel: number[],
  noClip: boolean,
): MenuTree {
  const can = (n: number) => sel.length >= n && rows.length > 0;
  const item = (label: string, name: string, disabled = false): MenuItem => ({
    label,
    disabled,
    onClick: () => dispatch(name),
  });
  return [
    { label: "插入行：之前", onClick: () => dispatch("insertBefore") },
    { label: "插入行：之后", onClick: () => dispatch("insertAfter") },
    { label: "插入：当前视频时间之前", onClick: () => dispatch("insertBeforeVideoTime") },
    { label: "插入：当前视频时间之后", onClick: () => dispatch("insertAfterVideoTime") },
    "sep",
    item("合并行 (≥2)", "merge", !can(2)),
    item("断开当前行（在当前时间）", "split", !can(1)),
    item("交换行 (选2)", "swap", sel.length !== 2),
    "sep",
    { label: "时间连续：以开始时间", onClick: () => dispatch("consecutiveStart") },
    { label: "时间连续：以结束时间", onClick: () => dispatch("consecutiveEnd") },
    "sep",
    item("复制行", "copy", !can(1)),
    item("粘贴行（之后）", "paste", can(1) && noClip),
    "sep",
    { label: "指定列粘贴：开始时间 → 选中行", onClick: () => dispatch("pasteStart") },
    { label: "指定列粘贴：结束时间 → 选中行", onClick: () => dispatch("pasteEnd") },
    { label: "指定列粘贴：样式 → 选中行", onClick: () => dispatch("pasteStyle") },
    { label: "指定列粘贴：角色 → 选中行", onClick: () => dispatch("pasteCharacter") },
    { label: "指定列粘贴：文本 → 选中行", onClick: () => dispatch("pasteText") },
    "sep",
    { label: "标记当前行", onClick: () => dispatch("toggleFlag") },
    item("删除行", "delete", !can(1)),
  ];
}
