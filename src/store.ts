/**
 * 应用状态中枢。
 *
 * 只承载 UI 状态与任务编排；所有移植/LK/自查能力都由后端 CLI 承担，
 * 本 store 仅负责拼参数、订阅日志流、按退出码裁决结果。
 */
import { create } from "zustand";
import {
  getEnvInfo,
  getHuePalette,
  getLatestOutDir,
  getWallpaperPalette,
  isTauri,
  listChipsets,
  listItems,
  runJob,
  type ColorScheme,
  type EnvInfo,
  type JobHandle,
  type PaletteResult,
} from "./api";

// ============================================================
// 类型
// ============================================================

export type ThemeMode = "light" | "dark" | "auto";

/** 主色来源：跟随桌面壁纸 / 手动指定色相 / 内置默认。 */
export type ThemeSource = "wallpaper" | "custom" | "default";

export type LogLevel = "info" | "step" | "success" | "warn" | "error" | "stderr";

export interface LogLine {
  id: number;
  time: string;
  text: string;
  /** 【】标记内容，用于着色与分组 */
  tag: string;
  level: LogLevel;
  stream: "stdout" | "stderr";
}

export interface PortItem {
  key: string;
  enabled: boolean;
}

/** 移植源形态：zip 卡刷包 / 独立镜像。 */
export type SourceKind = "zip" | "img";
export type OutType = "img" | "zip";

export type TaskKind =
  | "port"
  | "lk-scan"
  | "lk-patch"
  | "lk-verify"
  | "lk-restore"
  | "fscheck"
  | "check-update";

export interface PortPaths {
  baseBoot: string;
  baseSystem: string;
  donorBoot: string;
  donorSystem: string;
  donorZip: string;
  magiskApk: string;
}

export interface LkOptions {
  folder: string;
  patchA: boolean;
  patchB: boolean;
  autoBackup: boolean;
  genReport: boolean;
  inplace: boolean;
}

export interface Toast {
  id: number;
  message: string;
  severity: "success" | "error" | "warning" | "info";
}

/** 主导航页面（放在 store 中以便页面之间互相引导）。 */
export type NavKey = "port" | "lk" | "tools";

// ============================================================
// 日志行解析：按 TASK_UI_SHELL.md 的【】标记规范分类
// ============================================================

const STEP_TAGS = new Set([
  "开始移植",
  "解包boot.img",
  "解包system.img",
  "打包boot.img",
  "打包system.img",
  "打包完成",
  "移植项",
  "解包",
  "打包",
  "开始",
  "完成",
  "流程结束",
]);

function classify(text: string, stream: "stdout" | "stderr"): { tag: string; level: LogLevel } {
  if (stream === "stderr") return { tag: "stderr", level: "stderr" };

  const m = /^【([^】]+)】/.exec(text.trim());
  const tag = m ? m[1] : "";

  if (/异常|错误|失败|不存在|非法|未知/.test(tag)) return { tag, level: "error" };
  if (/警告|提示|注意|跳过/.test(tag)) return { tag, level: "warn" };
  if (/成功|完成|已是最新|结束/.test(tag)) return { tag, level: "success" };
  if (tag && (STEP_TAGS.has(tag) || /^(解包|打包|替换|同步|生成|写入)/.test(tag)))
    return { tag, level: "step" };
  if (tag === "CLI") return { tag, level: "info" };
  if (!tag) return { tag: "", level: "info" };
  return { tag, level: "info" };
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** CLI 输出的产物目录行：`【CLI】输出目录：<路径>` */
const OUT_DIR_RE = /【CLI】输出目录[:：]\s*(.+)$/;

// ============================================================
// Store
// ============================================================

interface AppState {
  // ---- 导航 ----
  nav: NavKey;
  setNav: (k: NavKey) => void;
  /** 侧边栏是否收起（宽屏下由顶栏按钮切换） */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // ---- 主题 ----
  themeMode: ThemeMode;
  effectiveTheme: "light" | "dark";
  setThemeMode: (m: ThemeMode) => void;
  resolveTheme: () => void;
  /** 当前生效的配色方案（按 effectiveTheme 从 palette 中取） */
  themeScheme: ColorScheme;
  /** 完整色板数据（5 组关键色 + 两套配色方案），来自 Rust 侧 M3 实现 */
  palette: PaletteResult | null;
  themeSource: ThemeSource;
  /** 手动模式下的色相（度） */
  themeHue: number;
  /** 壁纸取色得到的主色（用于设置页展示） */
  themeSeed: string | null;
  themeWallpaper: string | null;
  themeError: string | null;
  themeLoading: boolean;
  setThemeSource: (s: ThemeSource) => void;
  setThemeHue: (h: number) => void;
  /** 由色相生成整套 MD3 色彩系统（复用 Rust 侧实现） */
  applyHue: (h: number) => Promise<void>;
  refreshWallpaperTheme: () => Promise<void>;

  // ---- 环境 ----
  env: EnvInfo | null;
  envError: string | null;
  chipsets: string[];
  chipset: string;
  items: PortItem[];
  /** 方案默认条目（用于计算与默认值的差异，避免重复查询 CLI）。 */
  itemDefaults: Record<string, boolean>;
  itemsLoading: boolean;
  refreshEnv: () => Promise<void>;

  // ---- 移植参数 ----
  sourceKind: SourceKind;
  outType: OutType;
  paths: PortPaths;
  patchMagisk: boolean;
  targetArch: string;
  cleanBase: boolean;
  advancedOpen: boolean;
  itemFilter: string;
  setSourceKind: (k: SourceKind) => void;
  setOutType: (t: OutType) => void;
  setPath: (k: keyof PortPaths, v: string) => void;
  setChipset: (name: string) => Promise<void>;
  toggleItem: (key: string) => void;
  setAllItems: (on: boolean) => void;
  setPatchMagisk: (v: boolean) => void;
  setTargetArch: (v: string) => void;
  setCleanBase: (v: boolean) => void;
  setAdvancedOpen: (v: boolean) => void;
  setItemFilter: (v: string) => void;
  resetItemsToDefault: () => Promise<void>;

  // ---- LK ----
  lk: LkOptions;
  setLk: (patch: Partial<LkOptions>) => void;

  // ---- 自查 / 更新 ----
  fscheckImage: string;
  setFscheckImage: (v: string) => void;
  updateUrl: string;
  setUpdateUrl: (v: string) => void;

  // ---- 日志 ----
  logs: LogLine[];
  logsOpen: boolean;
  autoScroll: boolean;
  setLogsOpen: (v: boolean) => void;
  setAutoScroll: (v: boolean) => void;
  appendLog: (text: string, stream: "stdout" | "stderr") => void;
  clearLogs: () => void;
  copyLogs: () => Promise<boolean>;

  // ---- 任务 ----
  running: TaskKind | null;
  lastResult: { kind: TaskKind; code: number } | null;
  lastOutDir: string | null;
  startPort: () => Promise<void>;
  startLk: (op: "scan" | "patch" | "verify" | "restore") => Promise<void>;
  startFscheck: () => Promise<void>;
  startCheckUpdate: () => Promise<void>;
  cancelRunning: () => void;
  refreshOutDir: () => Promise<void>;

  // ---- 提示 ----
  toasts: Toast[];
  pushToast: (message: string, severity?: Toast["severity"]) => void;
  dismissToast: (id: number) => void;
}

const STORAGE_THEME = "mtk_studio_theme";
const STORAGE_UPDATE_URL =
  "https://github.com/LJY-33684/mtk-garbage-porttool-master/raw/main/latest_version.txt";

function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_THEME);
    if (raw === "light" || raw === "dark" || raw === "auto") return raw;
  } catch {
    /* ignore */
  }
  return "auto";
}

function mediaEffective(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 冷启动兜底配色方案（壁纸取色尚未返回时使用）。
 * 取中性蓝灰，与随后真实取色的结果差异最小，避免首帧跳色。
 */
export const FALLBACK_SCHEME: ColorScheme = {
  primary: "#415B90",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D9E2FF",
  onPrimaryContainer: "#001945",
  secondary: "#575E71",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#DBE2F9",
  onSecondaryContainer: "#141B2C",
  tertiary: "#715573",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#FBD7FC",
  onTertiaryContainer: "#29132D",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  surface: "#FAF9FF",
  surfaceDim: "#D9D9E0",
  surfaceBright: "#FAF9FF",
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#F3F3FA",
  surfaceContainer: "#EDEDF4",
  surfaceContainerHigh: "#E7E8EE",
  surfaceContainerHighest: "#E2E2E9",
  onSurface: "#1A1B20",
  onSurfaceVariant: "#44464F",
  outline: "#757780",
  outlineVariant: "#C5C6D0",
  inverseSurface: "#2F3036",
  inverseOnSurface: "#F1F0F7",
  inversePrimary: "#AEC6FF",
};

/** 兜底配色方案的深色变体。 */
export const FALLBACK_SCHEME_DARK: ColorScheme = {
  primary: "#AEC6FF",
  onPrimary: "#0A2E60",
  primaryContainer: "#274478",
  onPrimaryContainer: "#D9E2FF",
  secondary: "#BFC6DC",
  onSecondary: "#293041",
  secondaryContainer: "#3F4758",
  onSecondaryContainer: "#DBE2F9",
  tertiary: "#DEBCDF",
  onTertiary: "#402843",
  tertiaryContainer: "#583E5B",
  onTertiaryContainer: "#FBD7FC",
  error: "#FFB4AB",
  onError: "#690005",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD6",
  surface: "#111318",
  surfaceDim: "#111318",
  surfaceBright: "#37393F",
  surfaceContainerLowest: "#0C0E13",
  surfaceContainerLow: "#1A1B20",
  surfaceContainer: "#1E1F25",
  surfaceContainerHigh: "#282A2F",
  surfaceContainerHighest: "#33353A",
  onSurface: "#E2E2E9",
  onSurfaceVariant: "#C5C6D0",
  outline: "#8F9099",
  outlineVariant: "#44464F",
  inverseSurface: "#E2E2E9",
  inverseOnSurface: "#2F3036",
  inversePrimary: "#415B90",
};

/** 从色板数据中取当前外观对应的配色方案；无数据时用兜底方案。 */
function schemeFor(palette: PaletteResult | null, mode: "light" | "dark"): ColorScheme {
  if (!palette) return mode === "light" ? FALLBACK_SCHEME : FALLBACK_SCHEME_DARK;
  return mode === "light" ? palette.light : palette.dark;
}

function parseItems(lines: string[]): PortItem[] {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [k, v = "false"] = l.split("=");
      return { key: k.trim(), enabled: v.trim() === "true" };
    })
    .filter((it) => !["lk_patch_mode", "recovery_only_mode", "kernel_only_mode"].includes(it.key));
}

/** 方案能力（从 items 与方案名推导，用于 UI 提前禁用非法组合）。 */
export function chipsetCapabilities(chipset: string, items: PortItem[]) {
  const keys = new Set(items.map((i) => i.key));
  const isLk = /LK去警告/.test(chipset);
  const isRecovery = /仅移植Recovery/.test(chipset);
  const isKernelOnly = /仅移植内核/.test(chipset);
  const hasScript = keys.has("generate_script");
  return {
    isLk,
    isRecovery,
    isKernelOnly,
    /** recovery / kernel-only 仅支持 img 输出 */
    imgOnly: isRecovery || isKernelOnly,
    /** zip 输出需要 zip 源，且 recovery 模式禁止 */
    allowsZipOut: !isRecovery && !isKernelOnly,
    allowsZipSource: !isRecovery,
    supportsMagisk: !isRecovery,
    hasScript,
  };
}

let logSeq = 0;
let toastSeq = 0;
let activeJob: JobHandle | null = null;

const MAX_LOGS = 6000;

export const useApp = create<AppState>((set, get) => ({
  // ---- 导航 ----
  nav: "port",
  setNav(k) {
    set({ nav: k });
  },
  sidebarCollapsed: false,
  toggleSidebar() {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },

  // ---- 主题 ----
  themeMode: readStoredTheme(),
  effectiveTheme: readStoredTheme() === "auto" ? mediaEffective() : (readStoredTheme() as "light" | "dark"),
  themeScheme:
    (readStoredTheme() === "auto" ? mediaEffective() : readStoredTheme()) === "light"
      ? FALLBACK_SCHEME
      : FALLBACK_SCHEME_DARK,
  palette: null,
  themeSource: "wallpaper",
  themeHue: 252,
  themeSeed: null,
  themeWallpaper: null,
  themeError: null,
  themeLoading: true,
  setThemeMode(mode) {
    try {
      localStorage.setItem(STORAGE_THEME, mode);
    } catch {
      /* ignore */
    }
    const effective = mode === "auto" ? mediaEffective() : mode;
    set({ themeMode: mode, effectiveTheme: effective, themeScheme: schemeFor(get().palette, effective) });
  },
  resolveTheme() {
    const { themeMode, palette } = get();
    const effective = themeMode === "auto" ? mediaEffective() : themeMode;
    set({ effectiveTheme: effective, themeScheme: schemeFor(palette, effective) });
  },
  setThemeSource(source) {
    if (source === "custom") {
      void get().applyHue(get().themeHue);
      return;
    }
    if (source === "default") {
      set({ themeSource: "default", palette: null, themeSeed: null, themeWallpaper: null });
      set((s) => ({ themeScheme: schemeFor(null, s.effectiveTheme) }));
      return;
    }
    // 切回壁纸来源时重新取色（用户可能刚换过壁纸）
    void get().refreshWallpaperTheme();
  },
  setThemeHue(hue) {
    void get().applyHue(hue);
  },
  async applyHue(hue: number) {
    set({ themeHue: hue, themeSource: "custom", themeLoading: true, themeError: null });
    if (!isTauri()) {
      set({ themeLoading: false });
      return;
    }
    try {
      const p = await getHuePalette(hue);
      set((s) => ({
        themeLoading: false,
        palette: p,
        themeSeed: p.seed,
        themeScheme: schemeFor(p, s.effectiveTheme),
      }));
    } catch (e) {
      set({ themeLoading: false, themeError: e instanceof Error ? e.message : String(e) });
    }
  },
  async refreshWallpaperTheme() {
    if (!isTauri()) {
      set({ themeLoading: false, themeSource: "default", palette: null });
      set((s) => ({ themeScheme: schemeFor(null, s.effectiveTheme) }));
      return;
    }
    set({ themeLoading: true, themeError: null });
    try {
      const wp = await getWallpaperPalette();
      set((s) => ({
        themeLoading: false,
        themeSource: "wallpaper",
        palette: wp,
        themeSeed: wp.seed,
        themeWallpaper: wp.path,
        themeHue: Math.round(wp.hue),
        themeScheme: schemeFor(wp, s.effectiveTheme),
      }));
    } catch (e) {
      set((s) => ({
        themeLoading: false,
        themeSource: "default",
        palette: null,
        themeScheme: schemeFor(null, s.effectiveTheme),
        themeError: e instanceof Error ? e.message : String(e),
      }));
    }
  },

  // ---- 环境 ----
  env: null,
  envError: null,
  chipsets: [],
  chipset: "",
  items: [],
  itemDefaults: {},
  itemsLoading: false,

  async refreshEnv() {
    // 壁纸取色不依赖 Tauri 命令之外的任何东西，先起手，避免主题闪一下默认色
    void get().refreshWallpaperTheme();
    if (!isTauri()) {
      set({
        envError: "未检测到 Tauri 运行时。请用 `pnpm tauri:dev` 启动桌面外壳（浏览器直开无法访问本地后端）。",
      });
      return;
    }
    set({ envError: null });
    try {
      const env = await getEnvInfo();
      set({ env });
      const chips = await listChipsets();
      if (chips.code !== 0 || chips.lines.length === 0) {
        set({
          envError: chips.stderr || "未能读取方案列表，请确认后端工具目录完整。",
        });
        return;
      }
      // LK 去警告方案有独立的左侧页面，不出现在「芯片方案」下拉里
      const portable = chips.lines.filter((n) => !/LK\s*去警告/.test(n));
      const list = portable.length > 0 ? portable : chips.lines;
      set({ chipsets: list });
      const first = list.includes(get().chipset) ? get().chipset : list[0];
      await get().setChipset(first);
      const out = await getLatestOutDir().catch(() => null);
      set({ lastOutDir: out });
    } catch (e) {
      set({ envError: e instanceof Error ? e.message : String(e) });
    }
  },

  // ---- 移植参数 ----
  /** 默认用 ZIP 卡刷包作为移植源（最常用的分发形态） */
  sourceKind: "zip",
  outType: "img",
  paths: { baseBoot: "", baseSystem: "", donorBoot: "", donorSystem: "", donorZip: "", magiskApk: "" },
  patchMagisk: false,
  targetArch: "arm64",
  cleanBase: false,
  advancedOpen: false,
  itemFilter: "",

  setSourceKind(k) {
    set((s) => ({
      sourceKind: k,
      // 输出 zip 卡刷包要求 zip 源；切到 img 源时自动回落到 img 输出
      outType: k === "zip" ? s.outType : "img",
    }));
  },
  setOutType(t) {
    set((s) => {
      if (t === "zip" && !chipsetCapabilities(s.chipset, s.items).allowsZipOut) return s;
      return { outType: t, sourceKind: t === "zip" ? "zip" : s.sourceKind };
    });
  },
  setPath(k, v) {
    set((s) => ({ paths: { ...s.paths, [k]: v } }));
  },

  async setChipset(name) {
    set({ chipset: name, itemsLoading: true });
    try {
      const res = await listItems(name);
      if (res.code !== 0) {
        set({ itemsLoading: false, items: [] });
        get().pushToast(res.stderr || `无法加载方案「${name}」的移植条目`, "error");
        return;
      }
      const items = parseItems(res.lines);
      const cap = chipsetCapabilities(name, items);
      set({
        items,
        itemsLoading: false,
        itemDefaults: Object.fromEntries(items.map((it) => [it.key, it.enabled])),
        // 方案切换时校正输出/源类型，避免落入 CLI 会拒绝的组合
        outType: cap.imgOnly ? "img" : get().outType,
        // 默认用 ZIP 源；仅当方案不支持（Recovery）时回落到 img 源
        sourceKind: cap.allowsZipSource ? get().sourceKind : "img",
        patchMagisk: cap.supportsMagisk ? get().patchMagisk : false,
      });
    } catch (e) {
      set({ itemsLoading: false });
      get().pushToast(e instanceof Error ? e.message : String(e), "error");
    }
  },

  toggleItem(key) {
    set((s) => ({
      items: s.items.map((it) => (it.key === key ? { ...it, enabled: !it.enabled } : it)),
    }));
  },
  setAllItems(on) {
    set((s) => ({ items: s.items.map((it) => ({ ...it, enabled: on })) }));
  },
  setPatchMagisk(v) {
    set({ patchMagisk: v });
  },
  setTargetArch(v) {
    set({ targetArch: v });
  },
  setCleanBase(v) {
    set({ cleanBase: v });
  },
  setAdvancedOpen(v) {
    set({ advancedOpen: v });
  },
  setItemFilter(v) {
    set({ itemFilter: v });
  },
  async resetItemsToDefault() {
    await get().setChipset(get().chipset);
  },

  // ---- LK ----
  lk: { folder: "", patchA: true, patchB: true, autoBackup: true, genReport: true, inplace: false },
  setLk(patch) {
    set((s) => ({ lk: { ...s.lk, ...patch } }));
  },

  // ---- 自查 / 更新 ----
  fscheckImage: "",
  setFscheckImage(v) {
    set({ fscheckImage: v });
  },
  updateUrl: STORAGE_UPDATE_URL,
  setUpdateUrl(v) {
    set({ updateUrl: v });
  },

  // ---- 日志 ----
  logs: [],
  logsOpen: true,
  autoScroll: true,
  setLogsOpen(v) {
    set({ logsOpen: v });
  },
  setAutoScroll(v) {
    set({ autoScroll: v });
  },
  appendLog(text, stream) {
    const { tag, level } = classify(text, stream);
    set((s) => {
      const next = s.logs.concat({
        id: ++logSeq,
        time: nowStamp(),
        text,
        tag,
        level,
        stream,
      });
      return { logs: next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next };
    });
    const m = OUT_DIR_RE.exec(text);
    if (m) set({ lastOutDir: m[1].trim() });
  },
  clearLogs() {
    set({ logs: [] });
  },
  async copyLogs() {
    const text = get()
      .logs.map((l) => `[${l.time}] ${l.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },

  // ---- 任务 ----
  running: null,
  lastResult: null,
  lastOutDir: null,

  async startPort() {
    const s = get();
    if (s.running) return;
    const cap = chipsetCapabilities(s.chipset, s.items);
    const args = ["port", "--chipset", s.chipset, "--base-boot", s.paths.baseBoot];

    if (s.sourceKind === "zip") {
      args.push("--donor-zip", s.paths.donorZip);
    } else {
      args.push("--donor-boot", s.paths.donorBoot);
      if (!cap.isRecovery && !cap.isKernelOnly) args.push("--donor-system", s.paths.donorSystem);
    }
    if (!cap.isRecovery && !cap.isKernelOnly) args.push("--base-system", s.paths.baseSystem);
    args.push("--out-type", s.outType);

    // 条目回传：只回传与方案默认值不同的项，避免超长命令行
    const defaults = s.itemDefaults;
    for (const it of s.items) {
      const def = defaults[it.key];
      if (def === undefined) continue;
      if (it.enabled && !def) args.push("--item", it.key);
      if (!it.enabled && def) args.push("--no-item", it.key);
    }

    if (s.patchMagisk) {
      args.push("--patch-magisk");
      if (s.paths.magiskApk) args.push("--magisk-apk", s.paths.magiskApk);
      args.push("--target-arch", s.targetArch);
    }
    if (s.cleanBase) args.push("--clean-base");

    await launch("port", args, "移植");
  },

  async startLk(op) {
    const s = get();
    if (s.running) return;
    const args = ["lk", op, "--folder", s.lk.folder];
    if (op === "patch") {
      if (s.lk.patchA) args.push("--patch-a");
      if (s.lk.patchB) args.push("--patch-b");
      if (s.lk.autoBackup) args.push("--auto-backup");
      if (s.lk.genReport) args.push("--gen-report");
      if (s.lk.inplace) args.push("--inplace");
    }
    await launch(`lk-${op}` as TaskKind, args, `LK ${op}`);
  },

  async startFscheck() {
    const s = get();
    if (s.running) return;
    await launch("fscheck", ["fscheck", s.fscheckImage], "文件系统自查");
  },

  async startCheckUpdate() {
    const s = get();
    if (s.running) return;
    await launch("check-update", ["check-update", "--url", s.updateUrl], "检查更新");
  },

  cancelRunning() {
    if (activeJob) {
      activeJob.cancel();
      get().pushToast("已请求终止当前任务", "warning");
    }
  },

  async refreshOutDir() {
    const out = await getLatestOutDir().catch(() => null);
    set({ lastOutDir: out });
  },

  // ---- 提示 ----
  toasts: [],
  pushToast(message, severity = "info") {
    const id = ++toastSeq;
    set((s) => ({ toasts: s.toasts.concat({ id, message, severity }) }));
    window.setTimeout(() => get().dismissToast(id), 6000);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// ============================================================
// 任务执行器
// ============================================================

async function launch(kind: TaskKind, args: string[], label: string) {
  const store = useApp.getState();
  store.setLogsOpen(true);
  store.appendLog(`【UI】开始任务：${label}`, "stdout");
  store.appendLog(`【UI】命令行：porttool_cli.py ${args.join(" ")}`, "stdout");
  useApp.setState({ running: kind, lastResult: null });

  try {
    activeJob = await runJob(args, (l) => {
      useApp.getState().appendLog(l.line, l.stream);
    });
  } catch (e) {
    activeJob = null;
    useApp.setState({ running: null, lastResult: { kind, code: -1 } });
    useApp.getState().pushToast(e instanceof Error ? e.message : String(e), "error");
    return;
  }

  const code = await activeJob.done;
  activeJob = null;
  useApp.setState({ running: null, lastResult: { kind, code } });

  const st = useApp.getState();
  await st.refreshOutDir();
  if (code === 0) {
    st.pushToast(`${label}完成`, "success");
  } else if (code === 1) {
    st.pushToast(`${label}参数/校验错误，请检查输入（退出码 1）`, "error");
  } else {
    st.pushToast(`${label}执行失败，详见日志（退出码 ${code}）`, "error");
  }
}
