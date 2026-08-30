import { useStore } from "../../store/useStore";
import "./ProcessFlow.css";

const STEPS = [
  { label: "步骤1", desc: "打开字幕模板" },
  { label: "步骤2", desc: "导入 / 校对字幕" },
  { label: "步骤3", desc: "AI 翻译 / 润色" },
  { label: "步骤4", desc: "导出 / 审校" },
];

export default function ProcessFlow() {
  const flowStep = useStore((s) => s.flowStep);
  const setFlowStep = useStore((s) => s.setFlowStep);
  const current = STEPS[flowStep] ?? STEPS[0];

  return (
    <div className="pf">
      <div className="pf-label">{current.label}</div>
      <div className="pf-desc">{current.desc}</div>
      <div className="pf-actions">
        <button onClick={() => setFlowStep(Math.max(0, flowStep - 1))} disabled={flowStep === 0}>
          上一步
        </button>
        <button onClick={() => setFlowStep(Math.min(STEPS.length - 1, flowStep + 1))} disabled={flowStep === STEPS.length - 1}>
          下一步
        </button>
      </div>
    </div>
  );
}
