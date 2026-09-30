/** Tauri 运行时探测：浏览器直接打开 vite dev 时（无 Tauri IPC）降级为只读演示模式。 */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("未检测到 Tauri 运行时：请通过 `pnpm tauri:dev` 启动桌面外壳。");
  }
  const mod = await import("@tauri-apps/api/core");
  const invoke = mod.invoke as InvokeFn;
  return invoke<T>(cmd, args);
}

// ============================================================
// 后端查询接口（对应 porttool_cli.py 的查询子命令）
// ============================================================

export interface QueryResult {
  code: number;
  lines: string[];
  stderr: string;
}

export interface EnvInfo {
  toolDir: string;
  python: string;
  version: string;
  ready: boolean;
  /** 工具目录不可写时已复制到用户目录（安装版常见情形） */
  relocated: boolean;
  error: string | null;
}

export const getEnvInfo = () => call<EnvInfo>("env_info");
export const listChipsets = () => call<QueryResult>("list_chipsets");
export const listItems = (chipset: string) => call<QueryResult>("list_items", { chipset });
export const getToolRoot = () => call<string>("tool_root");
export const getLatestOutDir = () => call<string | null>("latest_out_dir");

// ============================================================
// 壁纸取色（MD3 主色调来源）
//
// 色彩计算全部在 Rust 侧完成（src-tauri/src/theme.rs），前端只消费结果：
// 13 级色板 × 5 组关键色 + 19 个颜色角色的浅色/深色配色方案。
// ============================================================

/** MD3 语义配色方案：19 个颜色角色。 */
export interface ColorScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
}

/** 5 组关键色，每组 13 个色阶（0 10 20 30 40 50 60 70 80 90 95 99 100）。 */
export interface KeyColors {
  primary: string[];
  secondary: string[];
  tertiary: string[];
  neutral: string[];
  neutralVariant: string[];
}

export interface PaletteResult {
  /** 壁纸文件路径（手动色相时为空） */
  path: string;
  /** 主色（色板 tone40） */
  seed: string;
  hue: number;
  chroma: number;
  coverage: number;
  keys: KeyColors;
  light: ColorScheme;
  dark: ColorScheme;
}

export const getWallpaperPalette = () => call<PaletteResult>("wallpaper_palette");

export const getHuePalette = (hue: number, chroma?: number) =>
  call<PaletteResult>("hue_palette", { hue, chroma: chroma ?? null });

// ============================================================
// 长任务接口（流式日志 + 完成事件）
// ============================================================

export interface JobLine {
  jobId: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface JobDone {
  jobId: string;
  code: number;
}

export interface JobHandle {
  jobId: string;
  done: Promise<number>;
  cancel: () => void;
}

export type UnlistenFn = () => void;

/**
 * 启动一个 CLI 任务并订阅其日志流。
 * 解析遵循 TASK_UI_SHELL.md：退出码是唯一判据（0 成功 / 1 参数错误 / 2 执行失败）。
 */
export async function runJob(
  args: string[],
  onLine: (line: JobLine) => void,
  jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<JobHandle> {
  if (!isTauri()) {
    throw new Error("未检测到 Tauri 运行时：请通过 `pnpm tauri:dev` 启动桌面外壳。");
  }
  const { listen } = await import("@tauri-apps/api/event");

  let resolveDone: (code: number) => void = () => {};
  const done = new Promise<number>((res) => {
    resolveDone = res;
  });

  const unlistenLine = await listen<JobLine>("job://line", (ev) => {
    if (ev.payload.jobId === jobId) onLine(ev.payload);
  });
  const unlistenDone = await listen<JobDone>("job://done", (ev) => {
    if (ev.payload.jobId !== jobId) return;
    unlistenLine();
    unlistenDone();
    resolveDone(ev.payload.code);
  });

  try {
    await call<void>("start_job", { jobId, args });
  } catch (e) {
    unlistenLine();
    unlistenDone();
    throw e;
  }

  return {
    jobId,
    done,
    cancel: () => {
      void call<void>("cancel_job", { jobId }).catch(() => {});
    },
  };
}

// ============================================================
// 桌面能力（对话框 / 打开器）
// ============================================================

export type FileFilter = { name: string; extensions: string[] };

export async function pickFile(filters?: FileFilter[]): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: false, directory: false, filters });
  return typeof res === "string" ? res : null;
}

export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: false, directory: true });
  return typeof res === "string" ? res : null;
}

export async function openPath(path: string): Promise<void> {
  if (!isTauri() || !path) return;
  const { openPath: open } = await import("@tauri-apps/plugin-opener");
  await open(path);
}

export async function openUrl(url: string): Promise<void> {
  if (!isTauri() || !url) return;
  const { openUrl: open } = await import("@tauri-apps/plugin-opener");
  await open(url);
}

// ============================================================
// 常用文件过滤器
// ============================================================

export const IMG_FILTER: FileFilter[] = [{ name: "镜像文件", extensions: ["img"] }];
export const ZIP_FILTER: FileFilter[] = [{ name: "卡刷包", extensions: ["zip"] }];
export const APK_FILTER: FileFilter[] = [{ name: "Magisk APK", extensions: ["apk"] }];
