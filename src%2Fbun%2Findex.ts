// ============================================================================
// Subtitle Tool — main process (runs on Bun via Electrobun)
// ============================================================================
// Creates the window, starts the local HTTP server (media + API), and hands
// the webview its base URL. `electrobun/main` is provided by the Hutch devkit
// (`.hutch/devkit`), projected by `hutch electrobun sync` / `hutch run dev`.
import { BrowserWindow } from "electrobun/main";
import { join } from "node:path";
import { homedir } from "node:os";
import { startServer } from "./server";

function createWindow(apiBase: string): void {
  const win = new BrowserWindow({
    title: "Subtitle Tool",
    // Pass the local API base to the webview so it needs no hard-coded port.
    url: `views://mainview/index.html?api=${encodeURIComponent(apiBase)}`,
    frame: {
      // Initial size only — the window is resizable / maximizable. The CSS
      // layout is fully flexible, so no pixel size is hard-coded and the video
      // area grows when the window is maximized.
      width: 1568,
      height: 784,
      minWidth: 1024,
      minHeight: 600,
    },
  });
  void win;
}

const apiBase = startServer(join(homedir(), ".subtitle-tool")).baseUrl;
createWindow(apiBase);
