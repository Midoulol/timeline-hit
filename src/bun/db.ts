// bun:sqlite persistence for the MAIN process. Owns settings, recent files,
// window state, and a crash-safe snapshot of the in-progress subtitle document.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DeepSeekSettings, SubtitleDoc } from "../shared/types";

const DEFAULT_DEEPSEEK: DeepSeekSettings = {
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  task: "",
  workspace: "",
};

class KeyValueStore {
  private db: Database;
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new Database(join(dir, "subtitle-tool.db"));
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }

  get(key: string): unknown {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, JSON.stringify(value));
  }

  close(): void {
    this.db.close();
  }
}

export class AppStore {
  private kv: KeyValueStore;
  constructor(dir: string) {
    this.kv = new KeyValueStore(dir);
  }

  getDeepseek(): DeepSeekSettings {
    const saved = this.kv.get("deepseek") as Partial<DeepSeekSettings> | undefined;
    return { ...DEFAULT_DEEPSEEK, ...(saved ?? {}) };
  }
  setDeepseek(s: DeepSeekSettings): void {
    this.kv.set("deepseek", s);
  }
  getAll(): { recentSubtitles: string[]; lastSaveDir: string; windowBounds: unknown } {
    return {
      recentSubtitles: (this.kv.get("recentSubtitles") as string[] | undefined) ?? [],
      lastSaveDir: (this.kv.get("lastSaveDir") as string | undefined) ?? "",
      windowBounds: this.kv.get("windowBounds") ?? null,
    };
  }
  set(key: string, value: unknown): void {
    this.kv.set(key, value);
  }
  getDocSnapshot(): SubtitleDoc | null {
    return (this.kv.get("docSnapshot") as SubtitleDoc | null) ?? null;
  }
  setDocSnapshot(doc: SubtitleDoc | null): void {
    this.kv.set("docSnapshot", doc ?? null);
  }
  pushRecent(path: string): void {
    const recent = (this.kv.get("recentSubtitles") as string[] | undefined) ?? [];
    this.kv.set("recentSubtitles", [path, ...recent.filter((p) => p !== path)].slice(0, 10));
  }
}
