# Subtitle Tool — Release 说明（B2 HEVC 解码版）

## 当前版本
- **HEVC/MKV 直接解码**（不转码）：常驻 `ffmpeg -re -i <mkv> -vf scale=320:-2 -f rawvideo -pix_fmt rgba` 管道解码 HEVC 帧 → 渲染层 `<canvas>` 绘制。
- **音频**由 `<video>` 播 MKV 的 AAC 音轨（Chromium 能解 AAC），画面由 ffmpeg 管道取帧，音画同步（seek/play/pause 联动）。
- **传输**：HTTP 轮询（`/api/video/start|frame|control`），渲染循环缓存最新帧，渲染层每 20ms 轮询 `/api/video/frame` 画到 canvas。
- **兼容**：H.264 MP4 → `<video>` 原生播；MKV/HEVC → ffmpeg 管道解码。加载时自动判断（MKV 或 `videoWidth===0` 走解码路径）。

## 实测
| 项 | 结果 |
|---|---|
| 服务器帧率 | **133fps**（320×180，远超 25fps 目标） |
| 解码 | 软件 ffmpeg 解 HEVC-10bit，实时（`-re`） |
| app(WebView2) 画面 | ~**10fps**（见下方已知限制） |

## 已知限制（诚实说明）
- **WebView2 渲染层 ~10fps**：服务器/传输很快（133fps），但 **WebView2 的 `fetch 518KB 帧 + putImageData 绘制` 循环较慢**，实际画面更新 ~10fps。这是 WebView2/Chromium 渲染层的瓶颈，不是服务器问题。
- 要更高帧率需进一步优化（如减小帧、JPEG 压缩帧、或改 WebView2 GPU 渲染），本轮**未继续**。

## 目录/文件（相关）
- `src/bun/videoDecode.ts`：ffmpeg 管道解码 + HTTP 帧服务（渲染循环缓存）。
- `src/bun/server.ts`：`/api/video/start|frame|control` 端点。
- `src/mainview/videoDecodeClient.ts`：渲染层 HTTP 轮询 + canvas 绘图。
- `src/mainview/components/VideoPlayer/VideoPlayer.tsx`：接入解码路径、音频/时钟同步。
- `_backup_b2/`：B2 早期 WS 版备份（10fps），可回退。

## 运行
- 开发：`hutch run dev`（Windows）。
- 加载 HEVC-MKV → 音频 + canvas 解码帧（~10fps）。

## 备注
- 本轮曾探索「libmpv 内置播放器」方案（子进程），因 cottontail FFI 兼容 + 浏览器请求 `loadfile -4` 等问题**未采用**，已回退。
- 视频格式支持：MP4(H.264) 原生；MKV/HEVC 走解码；SRT/ASS 字幕已支持。
