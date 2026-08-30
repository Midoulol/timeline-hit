import { useEffect, useState } from "react";
import { bridge } from "./bridge";
import { useStore } from "./store/useStore";
import VideoPlayer from "./components/VideoPlayer/VideoPlayer";
import SubtitleTable from "./components/SubtitleTable/SubtitleTable";
import ProcessFlow from "./components/ProcessFlow/ProcessFlow";
import AiAgent from "./components/AiAgent/AiAgent";
import SpectrumControl from "./components/SpectrumControl/SpectrumControl";
import SubtitleEditor from "./components/SubtitleEditor/SubtitleEditor";

export default function App() {
  const setDoc = useStore((s) => s.setDoc);
  const setDeepseek = useStore((s) => s.setDeepseek);
  const setActiveRow = useStore((s) => s.setActiveRow);
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Boot: confirm the main-process server, load default settings + the sample
  // subtitle (the completion mock loads the test ASS so the table is populated).
  useEffect(() => {
    (async () => {
      try {
        await bridge.info();
        setServerUp(true);
      } catch {
        setServerUp(false);
        return;
      }
      try {
        const ds = await bridge.getDeepseek();
        setDeepseek(ds);
      } catch {
        /* settings are optional */
      }
      try {
        const { path } = await bridge.getDefaultSubtitle();
        if (path) {
          const { ok, doc, error } = await bridge.loadAss(path);
          if (ok && doc) {
            setDoc(doc, path);
            setActiveRow(doc.rows[0]?.id ?? null);
          }
          else if (error) setError(error);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [setDoc, setDeepseek, setActiveRow]);

  if (serverUp === false) {
    return <div className="boot-error">无法连接主进程服务（{bridge.baseUrl}）。请用 `hutch run dev` 启动。</div>;
  }
  if (serverUp === null) {
    return <div className="boot-loading">正在启动字幕工具…</div>;
  }

  return (
    <div className="app">
      <section className="left">
        <div className="video-slot panel">
          <VideoPlayer />
        </div>
        <div className="table-slot panel">
          <SubtitleTable />
        </div>
      </section>

      <section className="right">
        <div className="flow-slot panel">
          <ProcessFlow />
        </div>
        <div className="ai-slot panel">
          <AiAgent />
        </div>
        <div className="lower-slot panel">
          <SpectrumControl />
          <SubtitleEditor />
        </div>
      </section>
    </div>
  );
}
