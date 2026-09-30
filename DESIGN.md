# UI 重构说明 / UI Refactor Notes

> 记录本次 Material Design 3 重构的**边界**与**决策依据**，便于后续维护者判断哪些能改、哪些不能动。

---

## 1. 边界：后端零修改

**唯一允许的耦合面是 `porttool_cli.py` 暴露的命令行契约**（规范见 `tools/mtk-garbage-porttool-master/TASK_UI_SHELL.md`）。

| 目录 | 状态 | 说明 |
|---|---|---|
| `tools/mtk-garbage-porttool-master/porttool/**` | 原样复制 + **1 处崩溃修复** | 移植核心、bootimg/ext4/LKPatch 等未改动；仅 `utils.py` 修了 ZIP 源的 `UnboundLocalError`（见 [docs/BACKEND_FIXES.md](docs/BACKEND_FIXES.md)） |
| `tools/mtk-garbage-porttool-master/porttool_cli.py` | 原样复制 | 外壳唯一调用入口 |
| `tools/mtk-garbage-porttool-master/configs.json` | 原样复制 | 方案配置由 CLI 查询接口读取 |
| `tools/mtk-garbage-porttool-master/bin/**` | 原样复制 | make_ext4fs / img2sdat 等平台工具 |
| `tools/mtk-garbage-porttool-master/main.py`、`porttool/ui.py` | 原样保留 | tkinter 版仍可独立运行，未删除 |

改动仅在**新增目录**：`src/`（前端）、`src-tauri/`（外壳）、`scripts/`（开发辅助脚本）、`docs/`（修复记录）。

**后端修复准则**：默认不动；只有功能**完全不可用**时才修，改动最小、不触碰移植逻辑、逐条登记在 `docs/BACKEND_FIXES.md` 并附补丁，便于与上游同步。

验证方式（可重复执行）：

```bash
node scripts/cli_contract_check.mjs      # 9 项接口契约
cd src-tauri && cargo test --lib         # 31 项外壳 + 色彩系统契约
```

---

## 2. 原版界面盘点 → 重构映射

tkinter 原版（`porttool/ui.py`）的界面元素与本次落点：

| 原版元素 | 原版行为 | 重构落点 |
|---|---|---|
| 芯片类型 OptionMenu | 切换时在同栏重建条目复选框 | 「移植工作台 → 芯片方案」卡片，能力标签 + 模式说明；**LK 方案已从此下拉移除**（左侧已有独立页面） |
| 支持的移植条目（Canvas + 复选框，22px/行，单列） | 滚轮滚动 + 三态全选 | 按语义分组 + **每项图标（颜色跟随配色方案）** + **悬停详细说明** + 搜索过滤 + 两列网格 + 全选/全不选/恢复默认 |
| 输出类型 Labelframe（zip/img 复选） | 非法组合由 CLI 拒绝 | 分段按钮；不支持的输出类型直接禁用并说明原因 |
| 修补 magisk（复选 + 架构 + APK） | 常驻显示 | 「高级选项」折叠卡片内，勾选后才展开架构与 APK |
| 完成后清除 base 目录 | 常驻复选框 | 「高级选项」折叠卡片内 |
| 一键移植按钮 → `FileChooser` 弹窗 | 点击后弹窗选 4 个路径 | **改为页面内常驻表单**：路径可见/可粘贴/可核对，与执行解耦 |
| LK 面板（选择 LK 方案时替换左栏） | 与移植表单共用一栏 | 独立「LK 去警告」页面（同时从芯片方案下拉中移除，避免两处入口） |
| LK 扫描结果 | 仅日志文本 | 解析为镜像卡片：适配状态、警告段数、补丁点、头部校验、内核参数 |
| 日志框（右栏 ScrolledText） | 与配置栏并排 | 右侧常驻日志面板（可折叠 / 分级着色 / 自动滚动 / 复制清空），窄窗口自动转为抽屉 |
| 版本号 + 仓库图标（左下角） | 常驻 | 侧栏底部环境摘要 + 仓库入口；详细环境信息移至「工具与自查」 |
| 检查更新按钮（标题栏） | 弹窗 | 「工具与自查 → 检查更新」卡片，含结论回显 |
| 单实例保护（singleton.py） | 后端实现 | 未触碰；CLI 无 UI 锁，外壳层不重复实现（多窗口不冲突） |

---

## 3. 交互逻辑优化清单

1. **校验前置**：`zip 输出必须 zip 源`、`recovery/kernel-only 仅 img`、`recovery 不支持 zip 源` 三条 CLI 规则前移到 UI；不满足时按钮禁用并显示「还差 N 项」及首条原因，避免白跑一次流程。
2. **底包/移植源表单化**：路径直接可编辑，支持从资源管理器复制粘贴；浏览按钮保留。
3. **移植源默认 ZIP 卡刷包**：ZIP 是最常见的分发形态；仅当方案不支持 ZIP 源（Recovery 模式）时自动回落为独立镜像。
4. **移植条目分组 + 图标 + 悬停说明**：198 个条目跨 9 个方案，单列长列表在 320px 高度里难以定位。现在每项带图标（勾选时用配色方案的 primary，未勾选用中性色）、悬停显示「中文名 + 完整说明 + 后端键名」。
5. **新增终止任务**：原版只能等待或强杀进程；现在 `cancel_job` 通过 `taskkill /T /F` 终止整棵进程树。
6. **任务结果显式化**：退出码 0/1/2 分别映射为「成功 / 参数错误 / 执行失败」并弹出提示，日志面板同步显示结论标签。
7. **日志分级**：按 `【】` 标记分类为 步骤/成功/警告/错误/stderr，分别着色；超长任务只渲染最近 1500 行，避免 webview 卡顿。
8. **输出目录可达**：顶栏与 LK 页、工具页均可一键打开最近产物目录（读取 `out/<时间戳>/` 中最新者）。
9. **LK 危险操作显式化**：勾选「直接覆盖原文件」时才显示风险提示，并要求确认自动备份已开启。
10. **启动不白屏**：`index.html` 内置骨架（图标脉冲 + 进度条，纯 CSS、无外部依赖），React 挂载时整体替换；窗口 `backgroundColor` 设为浅色 surface，进一步消除 WebView 初始化瞬间的白底。
11. **外观入口收敛**：主色跟随壁纸是默认行为，「工具与自查」里的外观卡片（主色来源切换、色相滑块、色板预览）已移除，只在顶栏保留一个「重新取色」图标按钮。
12. **侧边栏可收起**：顶栏最左侧按钮切换侧边栏 —— 展开态 232px（图标 + 文字 + 运行状态 + 环境摘要），收起态 60px 图标条（图标带 Tooltip、保留后端状态点与产物目录入口）。收起后内容区与日志面板自动占满剩余宽度。窄窗口（<900px）下该按钮改为打开导航抽屉。

> 条目元数据（`src/pages/itemMeta.ts`）里保留了 `risk` 字段与 `overallRisk()`，
> 用于描述"勾选越多越容易开不了机"的语义，但**当前版本不在界面上展示风险标签与整体评估**。

---

## 4. 设计系统落地

### 4.1 MD3 色彩系统（严格按规范实现）

色彩计算全部在 Rust 侧完成（`src-tauri/src/theme.rs`），前端只消费结果 —— 避免 JS 与 Rust 两套实现漂移。

**色板（tonal palette）**：每组关键色 **13 个色阶**，色阶值即感知亮度：

```
0  10  20  30  40  50  60  70  80  90  95  99  100
```

- 0 = 纯黑，100 = 纯白，**40 为浅色模式主色，80 为深色模式主色**。
- 亮度映射用 `L = (tone/100)^0.85`（OkLCh 的 L），使 tone 差 40/50/70 的两级
  对比度分别达到 **≥3:1 / ≥4.5:1 / ≥7:1**，即 M3 承诺的可访问性下界 —— 有单测锁定。
- 彩度按 sRGB 可达上限收敛（`max_chroma` 二分求解），因此色板两端自然更灰，与 M3 观感一致。

**关键色（key colors）** 5 组，由壁纸种子色派生：

| 关键色 | 色相 | 彩度 | 用途 |
|---|---|---|---|
| 主色 primary | 种子色相 | 种子彩度 | 最重要的元素：按钮、激活态 |
| 次要色 secondary | +12° | 主色 × 0.34 | 不突出的辅助元素：筛选卡片 |
| 第三色 tertiary | +60° | 主色 × 0.55 | 平衡主色的点缀 |
| 中性色 neutral | 种子色相 | 0.004 | 表面与背景、重点文本 |
| 中性色变体 neutralVariant | 种子色相 | 0.012 | 中等强度文本、表面变体、边框 |

**配色方案（color scheme）** 19 个颜色角色，每个角色固定映射到某个色阶；
浅色与深色**共用同一套色板**，仅映射关系不同：

| 角色 | 浅色 | 深色 | | 角色 | 浅色 | 深色 |
|---|---|---|---|---|---|---|
| primary | 40 | 80 | | surface | 98 | 6 |
| onPrimary | 100 | 20 | | surfaceDim | 87 | 6 |
| primaryContainer | 90 | 30 | | surfaceBright | 98 | 24 |
| onPrimaryContainer | 10 | 90 | | surfaceContainerLowest | 100 | 4 |
| secondary / tertiary / error 同构 | 40 | 80 | | surfaceContainerLow | 96 | 10 |
| onSecondary / onTertiary / onError | 100 | 20 | | surfaceContainer | 94 | 12 |
| *Container | 90 | 30 | | surfaceContainerHigh | 92 | 17 |
| on*Container | 10 | 90 | | surfaceContainerHighest | 90 | 22 |
| onSurface | — | — | | onSurface | 10 | 90 |
| onSurfaceVariant | — | — | | onSurfaceVariant | 30 | 80 |
| outline | — | — | | outline | 50 | 60 |
| outlineVariant | — | — | | outlineVariant | 80 | 30 |
| inverseSurface | — | — | | inverseSurface | 20 | 90 |
| inverseOnSurface | — | — | | inverseOnSurface | 95 | 20 |
| inversePrimary | — | — | | inversePrimary | 80 | 40 |

错误色是语义色，不随壁纸变化，使用标准 M3 错误色板。

### 4.2 主色来源

默认**跟随桌面壁纸**（Material You 的核心体验）：

1. 读 `HKCU\Control Panel\Desktop\Wallpaper`（回退 `TranscodedWallpaper`）定位壁纸；
2. 解码为 RGB；**不做整图缩略** —— 4K 壁纸的高质量缩放本身要 1 秒以上，而取色只需直方图；
3. 逐像素转 OkLCh，过滤近灰（C < 0.035）与过暗/过亮（L < 0.12 或 > 0.94）像素；
4. 按 15° 色相分桶、以 `C^1.6` 加权，取权重最高桶的加权平均色相与彩度作为种子。

**性能**：4K JPEG 解码约 4.5s、取色约 0.8s，因此

- 取色**按行切块并行**（`std::thread::scope`，最多 8 线程）——直方图可无锁累加，实测 0.94s → 0.85s 且免去 1.3s 的整图缩略；
- 结果按「壁纸路径 + 修改时间 + 文件大小」缓存到 `%LOCALAPPDATA%\com.mtkporttool.studio\wallpaper-palette.json`，命中后 **20ms** 返回；
- 取色在后台异步发起，**不阻塞窗口显示**：界面先用兜底色板渲染，取色完成后平滑切到壁纸配色。

用户可在「工具与自查 → 外观与主色」切换为**自定义色相**（0–359° 滑块，实时重算整套配色）
或**默认蓝**；卡片内直接预览 5 组 × 13 级色板。

### 4.3 形状与排版（紧凑取向）

- **圆角分级**：chip 6 / 控件 8 / 分组 10 / 卡片 12 / 容器 16；导航项保留 pill（MUI 的 MD3 惯例）。
- **表面分层**：`surface` → `surfaceContainerLowest…Highest` 五级，替代 MUI 默认 elevation 阴影堆叠。
- **排版**：MD3 type scale 整体收紧一档（正文 13px、caption 11.5px）；中文字体栈优先 MiSans / HarmonyOS Sans / Noto Sans SC / 微软雅黑。
- **外观模式**：浅色 / 深色 / 跟随系统，持久化到 `localStorage`，并跟随 `prefers-color-scheme` 实时切换。
- **响应式**：≥1536px 常驻日志面板；900–1536px 日志改为右侧抽屉；<900px 侧栏收起为抽屉 + 顶栏菜单按钮。条目网格 1/2/3 列随宽度变化。

---

## 5. 开发辅助脚本

这些脚本**不参与打包**，仅用于开发与回归验证：

| 脚本 | 用途 |
|---|---|
| `scripts/cli_contract_check.mjs` | 直接调用后端 CLI，校验 9 项接口契约（含退出码语义） |
| `scripts/dom_check.mjs` | 用 Chrome DevTools Protocol 打开页面，抓取真实 DOM 结构、主题令牌与圆角实测值 |
| `scripts/tauri_live_check.mjs` | 连接 Tauri WebView2 调试端口，验证真实运行时的 IPC 与任务流 |
| `scripts/tauri_dev_debug.ps1` | 带 `--remote-debugging-port` 启动 `tauri dev`（需 WebView2 支持） |
| `scripts/capture_window.ps1` | 捕获应用窗口截图，用于视觉回归 |
| `scripts/analyze_image.mjs` | 纯 Node 解码 PNG 并输出像素统计（平均色、密度网格） |
| `scripts/dominant_color.mjs` | 按色相分桶找出截图的主色簇，用于验证主题取色是否生效 |
| `scripts/wallpaper_seed.py` | 壁纸取色算法的 Python 对照实现（与 Rust 侧结果互验） |
| `scripts/gen_icon.py` | 生成应用图标母版（`tauri icon` 的输入） |
| `scripts/fetch_article.mjs` | 抓取微信文章正文（阅读参考资料用，一次性工具） |

---

## 6. 开发环境注意事项

1. **Vite 必须忽略 `src-tauri/`**：Rust 编译产物被 cargo 独占写入，一旦被 Vite 监视，
   Windows 上会抛 `EBUSY: resource busy or locked` 并让 dev server 直接退出。
   已在 `vite.config.ts` 的 `server.watch.ignored` 中排除 `src-tauri/`、`tools/`、`dist/`。
2. **`beforeDevCommand` 不依赖包管理器**：使用 `node ./node_modules/vite/bin/vite.js`
   而非 `pnpm run dev`，避免 PATH 中缺少 pnpm（或 pnpm 大版本差异）导致 `tauri dev` 起不来。
3. **构建脚本白名单**：pnpm 10+ 把该配置从 `package.json` 迁移到了 `pnpm-workspace.yaml`
   的 `allowBuilds`；esbuild 必须允许执行安装脚本，否则 vite 无法启动。

---

## 7. 打包与部署

```bash
pnpm tauri:build        # 前端 + release 编译 + NSIS 安装包
```

| 产物 | 路径 | 大小 |
|---|---|---|
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/MTK Porttool Studio_1.0.0_x64-setup.exe` | ≈5.2 MB |
| 免安装主程序 | `src-tauri/target/release/mtk-porttool-studio.exe` | ≈7.0 MB |

要点：

1. **后端工具随包分发**：`bundle.resources = ["../tools"]`，安装后落在
   `<安装目录>/_up_/tools/mtk-garbage-porttool-master`（Tauri 资源目录约定）。
2. **`productName` 用 ASCII**（`MTK Porttool Studio`）：WiX/NSIS 对中文产品名的处理不稳定
   （实测中文名会让 WiX 的 `light.exe` 打包失败）。**窗口标题仍是中文**「MTK 移植工作室」。
3. **安装模式 `both`**：管理员安装到 `Program Files`，普通用户安装到用户目录。
4. **只读安装位置的自动处理**：启动时实测工具目录可写性，不可写则复制到
   `%LOCALAPPDATA%\com.mtkporttool.studio\tools\` 运行（复制幂等，跳过 `out/`、`base/`、`tmp/`），
   并在「运行环境」里提示用户。

---

## 8. 已知限制

1. **工具目录需可写**：移植过程会在工具目录创建 `out/`、`tmp/`、`base/`。安装到只读位置时应用会自动复制到用户目录（见上）；也可用 `MTK_PORTTOOL_HOME` 手动指向可写副本。
2. **`lk` 子命令不支持单镜像选择**：CLI 未暴露 `selected` 参数，因此 LK 页面按目录整体处理，不做伪勾选交互。
3. **`fscheck` 输出为整块**：CLI 以子进程方式收集 `fscheck.py` 输出后一次性打印，该步骤日志不会逐行流式出现。
4. **首次构建耗时**：Tauri 首次编译需拉取并编译约 398 个 crate（实测约 3–8 分钟），后续增量构建为秒级。
5. **首次取色约 6 秒**：4K 壁纸 JPEG 解码约 4.5s + 取色 0.85s。取色在后台异步进行、不阻塞窗口，且结果会缓存（二次启动 20ms）。换壁纸后会有一次同样的等待。
6. **取色的主观性**：主色取"最突出的鲜艳色相"，与壁纸整体氛围未必一致（例如深色壁纸上的小面积亮色会被选中）。可在外观设置里改为自定义色相或默认蓝。
