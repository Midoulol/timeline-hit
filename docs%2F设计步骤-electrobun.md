# 字幕工具 — Electrobun 设计步骤

> 技术底座：**Electrobun v2**（Hutch 构建 / Cottontail 主进程）+ **React + Vite**（webview UI）+ **bun:sqlite**（主进程持久化）+ **zustand**（渲染层状态）。
> 风格：Catppuccin Latte，极简扁平（无阴影 / 无渐变 / 4–6px 圆角）。
> 前提：以下结构、API 均按 Electrobun v2 官方文档（`framework.blackboard.sh/electrobun`）核实，主进程用 `electrobun/main`，渲染层用 `electrobun/view`。

---

## 〇、结论先行

- **主进程**（`src/bun/index.ts`，跑在 Cottontail）负责一切特权操作：创建窗口、文件对话框、`bun:sqlite` 持久化、DeepSeek/Whisper 网络请求；通过 **Typed RPC（`createRPC`）** 暴露给 webview。
- **渲染层**（`src/mainview/`，普通 webview + React）只做 UI 与交互，一切 IO 走 RPC，不直接跨域。
- **窗口尺寸不写死**：`BrowserWindow` 只给初始尺寸 + 最小尺寸，允许缩放/最大化；CSS 全弹性布局，**视频区 `flex:1`**，最大化时视频自动增大。
- 六个组件各占一个独立文件夹，方便后续扩展。

---

## 一、环境准备与自检（开发前必做）

1. **Bun**（系统级，已就绪）：`bun --version` → `1.4.0`。
2. **安装 Hutch**（Electrobun 的构建/工作区 CLI），Windows PowerShell：
   ```powershell
   & ([scriptblock]::Create((irm https://hutch.blackboard.sh/hutch/install.ps1)))
   ```
3. 自检：`hutch --version`，应打印 Hutch 版本。
4. **拉取 Electrobun 对应 release**：`hutch electrobun sync`（或 `hutch run dev` 自动准备）。Hutch 会把该 release 的运行时与 SDK 装到 `~/.hutch/releases/electrobun`，并把 SDK **投影**进项目 `.hutch/devkit`。
5. **自检通过标准**：存在 `.hutch/devkit/{api,tsconfig.json,projection.json}`，且 `tsconfig.json` 能解析 `electrobun/main`、`electrobun/view`。

> ⚠️ 本机实测：Electrobun 的 release 托管在 `github.com/blackboardsh/electrobun/releases/download`，该域名大文件下载被限速/重置（Electron 实测 ~16KB/s，随后连接被重置；ghproxy 失效、npmmirror 未镜像）。**这是唯一的硬阻塞**。
> 解决途径（三选一）：
> - 设置镜像基址：`ELECTROBUN_RELEASES_BASE_URL=<镜像>/`（Hutch bootstrap 从 `${base}/v<version>/hutch-artifacts.json` 取索引与归档）。
> - 本机已有可用 hutch：`ELECTROBUN_HUTCH_BINARY=<hutch路径>`（需版本与 `HUTCH_DEFAULT_CLI=0.24.3` 匹配）。
> - 使用网络代理/换时间段重试 GitHub，直到 `sync` 成功。
> 在 `sync` 成功前无法启动/验证运行态，但代码骨架可按文档先行搭建。

---

## 二、项目结构（Electrobun v2 布局）

```
subtitle-tool/
├── hutch.config.ts        # 任务 + electrobun.version 钉版本
├── electrobun.config.ts   # app 标识 + build（主进程入口 / 视图 copy）
├── package.json           # 仅普通 JS 依赖（React 等）；不装 electrobun SDK
├── hutch.lock             # Hutch 内建 resolver 生成
├── tsconfig.json          # extends ./.hutch/devkit/tsconfig.json
├── vite.config.ts         # resolve.alias = electrobunViteAliases(.hutch/devkit)
├── src/
│   ├── bun/               # ★ 主进程（Cottontail）
│   │   ├── index.ts       # 窗口 + 生命周期
│   │   ├── rpc.ts         # createRPC 处理器（字幕读写/对话框/设置）
│   │   ├── db.ts          # bun:sqlite 持久化
│   │   ├── deepseek.ts    # DeepSeek 流式（main 侧 fetch，无 CORS）
│   │   └── whisper.ts     # ★ 预留 STT 接口
│   ├── mainview/          # ★ 渲染层 webview（React）
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── index.css      # Catppuccin Latte 变量 + 弹性布局
│   │   ├── components/    # ← 六个组件，各自独立文件夹
│   │   │   ├── VideoPlayer/
│   │   │   ├── SubtitleTable/
│   │   │   ├── ProcessFlow/
│   │   │   ├── AiAgent/
│   │   │   ├── SpectrumControl/
│   │   │   └── SubtitleEditor/
│   │   ├── store/useStore.ts    # zustand 全局状态
│   │   ├── audioBus.ts          # Web Audio 单例（主进程无、仅渲染层）
│   │   └── theme.ts             # 色值 + ASS 色标工具
│   └── shared/            # 主进程与渲染层共享（纯函数，无平台依赖）
│       ├── types.ts       # SubtitleDoc / SubtitleRow / 样式类型
│       ├── time.ts        # ms ⇄ ASS/SRT/帧
│       ├── ass.ts         # ASS 解析/序列化
│       └── ops.ts         # 行操作库（插入/合并/断开/交换/时间连续/复制粘贴）
└── ziliao/                # 测试素材（夺还篇pv1.mp4 / 夺还篇pv1.ass）
```

**为什么这样分**：`src/bun` == 主进程（跑 Cottontail），`src/mainview` == webview UI，`src/shared` == 两侧共用的纯逻辑（无 IO），`hutch.config.ts` 管任务、`electrobun.config.ts` 管打包。

### 关键配置文件

`hutch.config.ts`
```ts
export default {
  electrobun: { version: "2.0.0" },   // 精确钉版本
  scripts: {
    install: ["hutch", "install"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
  },
};
```

`electrobun.config.ts`
```ts
import type { ElectrobunConfig } from "electrobun";
export default {
  app: { name: "Subtitle Tool", identifier: "dev.bundev.subtitle-tool", version: "0.1.0" },
  build: {
    mainProcess: "cottontail",
    cottontail: { entrypoint: "src/bun/index.ts" },
    copy: {  // 把构建后的 webview 产物放进 bundle 的 views/ 路径
      "src/mainview/index.html": "views/mainview/index.html",
    },
  },
} satisfies ElectrobunConfig;
```

`vite.config.ts`（webview 侧，需要 Hutch 已在项目准备过）
```ts
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: electrobunViteAliases(resolve(__dirname, ".hutch/devkit")) },
  base: "./",
});
```

---

## 三、窗口与布局（尺寸不写死，最大化保证视频尺寸）

主进程开窗口（允许缩放/最大化）：
```ts
// src/bun/index.ts
import { BrowserWindow } from "electrobun/main";
const win = new BrowserWindow({
  title: "Subtitle Tool",
  url: "views://mainview/index.html",
  frame: { width: 1568, height: 784, minWidth: 1024, minHeight: 600 },
  // 可缩放：无 fixed/resizable:false。最大化后视口变宽，视频随之变大。
});
```

CSS 弹性布局（不写死像素）：
```css
.app {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); /* 左1/3 右2/3 */
  grid-template-rows: 100%;
  gap: 8px;
  height: 100vh;
  padding: 8px;
}
.left  { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.right { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
/* 视频区 flex:1 → 最大化时自动放大；字幕表/流程条/AI 区给固定或弹性高度 */
.video  { flex: 1 1 auto; min-height: 220px; }
.table  { flex: 0 0 240px; }
.flow   { flex: 0 0 44px; }
.ai     { flex: 1 1 auto; min-height: 160px; }
.lower  { flex: 0 0 380px; }  /* 频谱 + 编辑区 */
```

> 关键：视频区与 AI 区都 `flex:1`，窗口放大时二者自动增长；字幕表/流程条/编辑区保持稳定高度，从而“最大化时保证视频尺寸（变大）”。

---

## 四、主题：Catppuccin Latte 极简扁平

`index.css` 变量：
```css
:root {
  --bg: #F2EAE8; --fg: #4C4F69; --selection-bg: #ACB0BE;
  --red: #D20F39; --green: #40A02B; --blue: #1E66F5; --yellow: #DF8E1D;
  --cyan: #179299; --purple: #EA76CB; --black: #5C5F77;
  --white: #ACB0BE; --bright-white: #BCC0CC; --cursor: #DC8A78;
  --border: #CCD0DA;
  --panel: rgba(255,255,255,.4);     /* 面板浅底*/
  --active-row: #B8E3C9;             /* 当前编辑行绿底 */
  --flag-row: #F3B8BE;               /* 标记/搜索红底 */
  --radius: 6px;
}
```
- 面板/输入框/按钮：`background: var(--panel)`，`border:1px solid var(--border)`，圆角 4–6px，**无阴影、无渐变**。
- 表格网格线 `--border`；选中行绿底、标记/搜索红底，与 accent 红/绿区分开。

---

## 五、六个组件（各占一个文件夹）

| # | 组件（文件夹） | 职责 | 关键交互 |
|---|---|---|---|
| 1 | `VideoPlayer` | `<video>` + 橙色进度条 + 控制条（1–5 数字键 + ⏯ + 6–9） | `timeupdate` 同步 store 时间、当前行、频谱；进度条可拖 seek；数字键跳转到对应分块 |
| 2 | `SubtitleTable` | 左栏下方表格：`#/开始/停止/CPS/样式/角色/文本` | 点行选中→绿底载入编辑器；`Enter` 新增行；**右键菜单**（见第七节）；搜索命中红底；文本列 `ellipsis`；**载入字幕按钮** |
| 3 | `ProcessFlow` | 顶部流程条：`步骤n \| 描述 \| 上一步 \| 下一步` | 数据驱动，切换仅更新文案/高亮，不重载 |
| 4 | `AiAgent` | AI 聊天区（气泡左右分列 + 输入框“有什么问题直接问吧” + 底部 `任务/工作区/模型名`） | 走主进程 RPC 流式 DeepSeek，渲染层不跨域 |
| 5 | `SpectrumControl` | 音频频谱（Canvas + AnalyserNode） | 参考 `spectrum/AudioSpectrum.tsx` 观感，但用真实 `getByteFrequencyData`；随播放/暂停平滑过渡 |
| 6 | `SubtitleEditor` | 编辑区合并块：工具栏（角色/样式/编辑样式 + B I U S + 彩色 AB 色标 + ✓ + 字数）+ `☐时间 ☐帧` + 时间面板（标记红块 + 开始/结束/时长）+ 正文 textarea | 编辑实时写回 store 并落库；时间用 ms 内部计算、仅编辑框格式化 |

> 说明：第 5、6 组件把“右下编辑区”拆成“频谱/控制”与“字幕编辑”两块，均放在右栏下方 `.lower` 容器内（上频谱、下编辑），与完成图一致。

---

## 六、数据模型与持久化

渲染层与主进程共用 `src/shared` 模型（内部时间一律**毫秒**）：
```ts
interface SubtitleRow {
  id: number; startMs: number; endMs: number;
  style: string; character: string;
  text: string;               // 原始 ASS 文本（可含 {\...} 覆盖标签）
  flagged: boolean;           // 标记行（红底）
  layer: number; marginL/R/V: number; effect: string;
}
// CPS = Math.round(stripAssTags(text).length / ((endMs-startMs)/1000))
```

**主进程持久化（bun:sqlite）**——主进程跑在 Cottontail，可直接 `require("bun:sqlite")`：
```ts
// src/bun/db.ts
import { Database } from "bun:sqlite";
const db = new Database(join(Utils.paths().userData, "subtitle-tool.db"));
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
// subtitles 快照键值 + 最近文件 + 窗口尺寸，进出 RPC
```

**写后自动保存**：渲染层编辑 → 更新 zustand store → 触发 RPC `doc:save`，主进程写 ASS 文件 + 写 db 快照，返回刷新。

---

## 七、交互逻辑要点

**播放同步**：`timeupdate` → 更新 store 时间 → 当前字幕行高亮 + 表格滚动到活动行 + 频谱刷新 + 橙色进度条移动。

**右键字幕工具（Aegisub 语义，实现在 `SubtitleTable` 的 ContextMenu）**，全部基于 `src/shared/ops.ts` 的纯函数（不可变、返回新数组 + 受影响的“选中位”）：
- 插入行：在选中行**之前** / 之后；在当前视频时间**之前** / 之后。
- 合并行（≥2 行）：取首行 start、末行 end，文本用 `\N` 连接。
- 断开当前行：在当前视频时间处拆成两行（文本保留前段、后段留空待编）。
- 交换行：交换两行位置。
- 时间连续：①以开始时间连续（后行 start=前行 end）②以结束时间连续（前行 end=后行 start）。
- 复制行 / 粘贴行 / 指定列粘贴（start/end/style/character/text 单列粘到选中行）。

> 说明：这些操作在 Aegisub 是原生功能；未找到可直接移植到本项目数据模型的现成 JS 库（`timedtext`/`subtitle` 等只做解析或时间平移，不做这些行操作），故在 `src/shared/ops.ts` 以纯函数实现，行为对照 Aegisub。若后续发现更贴合库可替换，接口保持不变。

**补齐**：
- 数字键 1–9 → 跳到对应字幕分块（表格行序分块）。
- 色标按钮 → 用 `{\c&HBBGGRR&}...{\r}` 包裹选中文本 token 上色。
- 时间全程 ms 计算，仅编辑框格式化，避免字符串比较/光标问题。

---

## 八、音频频谱（真实数据）

沿用 `spectrum/AudioSpectrum.tsx` 的“64 条、平滑过渡、rAF 绘制”观感，但把“随机 `Math.random()`”替换为真实频谱：
```ts
// src/mainview/audioBus.ts —— 单例 Web Audio 图
new AudioContext() → createMediaElementSource(video) → createAnalyser() → destination
// src/mainview/components/SpectrumControl/SpectrumControl.tsx
const data = new Uint8Array(analyser.frequencyBinCount);
analyser.getByteFrequencyData(data);   // 真实频率
// 播放中取真实值，暂停时向小基线平滑衰减；bar 填充 HSL 蓝紫→Catppuccin 蓝色系
```
> 前提：媒体以支持 CORS 的方式提供给 webview（Electrobun 的 `views://` 打包资源通常同源；本地开发用 `file://` 或本地托管需确保 `crossOrigin` 能读到数据，否则 AnalyserNode 输出被置零）。

## 九、AI：对接 DeepSeek（主进程 RPC 流式）

主进程持有 `DEEPSEEK_API_KEY`（或设置项），渲染层不接触 key、不跨域：
```ts
// 主进程 deepseek.ts
fetch(`${baseUrl}/chat/completions`, { headers: { Authorization: `Bearer ${key}` } })
// SSE 解析 choices[0].delta.content → 通过 RPC 事件逐 token 推给 webview
```
- `AiAgent` 发 `ai:chat({ messages, model, task, workspace })`，接收流式 `ai:stream` 事件追加到气泡，`ai:done` 结束。
- 底部 `任务 | 工作区 | 模型名` 作为 system prompt 上下文与可选附加上下文（如当前选中字幕文本）。

---

## 十、Whisper（预留接口）

主进程暴露 `whisper:transcribe(audioPath)`；对接方式二选一（均可通过环境变量/设置开启）：
- `WHISPER_ENDPOINT`：HTTP 后端（faster-whisper-server 等，OpenAI `/audio/transcriptions` 形态），解析 `<segments>`（start/end/text）后插入字幕。
- `WHISPER_COMMAND`：本地 CLI，stdout 输出 JSON `{segments:[…]}`。
- 未配置时返回明确“未配置”结果。渲染层 `SubtitleTable` 新增“导入识别”入口：调用 RPC → 得到 `TranscriptionSegment[]` → `insertTranscription` 排入表格。

---

## 十一、ASS 导入/编辑/保存 + 载入按钮

- **载入字幕按钮**（`SubtitleTable` 头部）：主进程 `dialog:open`（过滤 `.ass/.ssa/.srt`）→ 读文件 → `src/shared/ass.ts` `parseAss()` → `setDoc`。
- **编辑保真**：`parseAss` 保留 `[Script Info]`、`[V4+ Styles]` 全部样式、`[Events]` 每行原始字段（layer/margins/effect）；仅当用户改 start/end/style/name/text 时更新对应字段，`serializeAss()` 尽量还原头信息，实现“载入→编辑→保存”round-trip 不丢信息。
- 支持 `.ass`（及可兼容的 `.ssa/.srt`）。测试素材：`ziliao/夺还篇pv1.ass`（含 2 行对白 + 6 个样式）；视频 `ziliao/夺还篇pv1.mp4`。

---

## 十二、里程碑

1. **环境**：hutch 装好，`sync` 成功出现 `.hutch/devkit`，`hutch run dev` 能开一个空窗口。
2. **骨架**：六组件文件夹 + 布局 + Latte 主题 + 共享模型/工具，加载测试 .ass 并显示。
3. **播放与同步**：视频 + 进度条 + `timeupdate` 同步 + 数字键跳转 + 频谱。
4. **编辑与操作**：表格选择/新增/右键全套操作 + 编辑器写回 + `bun:sqlite` 保存。
5. **AI 与识别**：DeepSeek 流式对话 + Whisper 预留接口导入。
6. **打磨**：搜索红底/标记、色标、`☐时间/☐帧`、最大化适配、导出校验。

## 十三、验证方式

- 运行态：`hutch run dev` 拉起窗口 → 肉眼核对布局与最大化适配（视频变大）。
- 数据：载入 `夺还篇pv1.ass` → 编辑某行时间/文本 → 保存 → 重新载入确认数值一致（round-trip）。
- 操作：右键插入/合并/断开/交换/时间连续，逐项断言 start/end/text 结果。
- 频谱：播放时视频有声音且频谱随内容变化；暂停后衰减。
- AI：设置 key 后发送消息，观察流式增量输出（无 key 时给出明确提示）。
- 确认本机 `hutch --version`、`tsconfig` 能解析 `electrobun/main`、`electrobun/view`。
