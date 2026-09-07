# subtitle-hit

**Subtitle Timing** — A local Japanese-learning subtitle authoring & timing tool.

A desktop subtitle tool built on Bun + WebView2 (webview-bun), supporting ASS subtitle import/editing, embedded HEVC video decoding (libmpv), audio spectrum, AI chat (DeepSeek), subtitle style editing, and more.

---

## Why this exists

When I was learning Japanese, my listening comprehension was always **half-understood and full of doubt**, and I could never get my hands on the original text. *"I can hear every word he's saying — but what is he actually talking about?"* That was the sentence I kept finding myself saying. So I built this software.

Through **subtitle timing** (打轴) and **AI assistance**, the purpose is to make learning Japanese easier. Every design direction in this software exists to solve a specific difficulty in Japanese learning. It's worth saying plainly: **the software is only an aid — it can never replace the learner's own effort.**

### Why subtitle timing as the learning method

1. The process of timing **is** the process of listening. You have to hear what the speaker says, understand what they mean, and turn it into your own understanding.
2. Timing mostly asks you to do one thing: **break the sentence into segments**. Compared with analyzing and dissecting a whole sentence, this is more direct and lowers the pressure of learning.

### Why AI assistance

1. AI and agents are extremely good at processing information — quickly picking out where a sentence is tricky, providing the readings, and analyzing the grammar. This matters a lot to a learner.
2. AI can do **speech recognition**, which removes most of the tedious work of writing sentences out by hand — sparing learners the grind of mechanical typing.

### Why timing still needs translation

1. Translating inevitably produces a mismatch between character count / segmentation and the original text. By **pre-translating**, we keep the timeline readable — in subtitle workflows this is called *precise timing* (精轴).
2. After translation, the timer can make better **split decisions** on long, difficult sentences: some long sentences become very short once translated into Chinese, while others stay long — so they need to be split.
3. It reduces the timer's **misunderstandings**. A CV sometimes speaks with deliberate pauses that shift the meaning, and pre-translation cuts down on those mistakes.
4. This translation work serves the core idea: using timing to help the user understand the work itself more deeply, and so raise their own Japanese level. That is the original reason this software exists.
5. Translation here deliberately **skips polishing** (润色). Polishing is meant to make text pleasant for *other readers*; plain, everyday language is what makes a passage easier to understand.

### Why most translation steps are omitted

1. There are plenty of excellent translation tools already. **This software focuses on timing.**
2. Translation is a huge undertaking; it doesn't fit a project as small as this one.

---

## Features

- **Video playback**: Embedded decoding (libmpv) supports HEVC/H.264; subtitle line highlighting synced to the video;
- **Subtitle editing**: ASS import/save, right-click subtitle tools (insert line / merge / split / swap / make contiguous / copy / paste);
- **Audio spectrum**: Web Audio analysis + plotting;
- **AI assistant**: Connects to DeepSeek (the main process forwards the API; the key never enters the renderer);
- **Style editor**: SubtitleEdit style, manages all styles in the current file (add / delete / duplicate / properties / preview);
- **Loading progress**: Shows a progress dialog when loading a video (video + spectrum).

## Tech Stack

- **Bun** — Runtime / bundling / FFI (`bun:ffi` to call libmpv)
- **webview-bun** + **WebView2** — Desktop window
- **React 19 + Vite** — Renderer process
- **bun:sqlite** — Local storage
- **ffmpeg/ffprobe** — Media probing / indexing

## Build

```bash
bun install
bun run build        # vite build + embed assets + compile exe
# Output: release/SubtitleTool.exe (requires release/libmpv-2.dll + release/ffmpeg)
```

## Development

```bash
bun run dev:view     # vite dev (5173)
bun run dev:app      # webview-bun debug window
```
