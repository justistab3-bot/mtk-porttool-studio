# MTK 移植工作室 / MTK Porting Studio

> 为 [mtk-garbage-porttool-master](https://github.com/LJY-33684/mtk-garbage-porttool-master) 重构的 **Material Design 3** 桌面外壳。
> Tauri 2 + React 19 + MUI 7（Material You），后端逻辑通过既有 CLI 桥接接口调用。

---

## 1. 设计原则

**默认不动后端逻辑。** 工具原有的 `porttool_cli.py`（CLI 桥接入口）与 `TASK_UI_SHELL.md`（接口规范）就是为"其它平台 UI 壳"准备的正式契约。本项目严格按该契约实现外壳：

| 能力 | 接口 | 本项目对应实现 |
|---|---|---|
| 方案列表 | `--chipsets` | `list_chipsets` → 方案下拉框 |
| 条目默认值 | `--items --chipset X` | `list_items` → 条目勾选树 |
| 版本号 | `--version` | `env_info` → 侧栏版本显示 |
| 移植 | `port ...` | `start_job` → 流式日志 |
| LK 去警告 | `lk scan/patch/verify/restore` | 同上 |
| 文件系统自查 | `fscheck <img>` | 同上 |
| 检查更新 | `check-update --url ...` | 同上 |

裁决只依据 **退出码**（`0=成功 / 1=参数·校验错误 / 2=执行失败`），stdout 仅用于展示 —— 与规范第 3 节一致。

```
React (src/)  --invoke-->  Rust 外壳 (src-tauri/src/lib.rs)  --std::process-->  python porttool_cli.py
              <--event---                                 <--stdout 逐行---
```

**唯一的例外**：上游有一个会让 ZIP 卡刷包移植源完全不可用的崩溃缺陷（`utils.py` 中
`UnboundLocalError: pb`，打印输入概览时触发），已按最小改动修复 —— 纯缩进调整，不触碰移植逻辑。
详见 [docs/BACKEND_FIXES.md](docs/BACKEND_FIXES.md)，补丁在 `docs/patches/`。

---

## 2. 相对 tkinter 原版的界面重构

原版是「左侧窄配置栏 + 右侧日志框」的单窗口布局，本版按 MD3 的信息层级重做：

**信息架构**
- 主导航拆为三个语义页面：**移植工作台 / LK 去警告 / 工具与自查**，替代原版"切换方案时在同一栏里换面板"的做法。
- 任务日志独立为右侧常驻面板，可折叠；窄窗口下自动变为抽屉。日志始终与操作同屏，不必来回切换。
- 方案能力（仅内核 / 仅 Recovery / LK）以标签直接标注，非法组合的控件**提前禁用并说明原因**，而不是等 CLI 返回退出码 1。

**移植工作台**
- 底包 / 移植源从"点按钮后弹窗选文件"改为**页面内常驻表单**：路径可见、可粘贴、可核对，选择与执行解耦。
- 移植条目按语义分组（引导与内核 / 系统属性 / 硬件驱动 / 音频与显示 / 打包与其他），**每项带图标**（颜色跟随当前配色方案），**鼠标悬停显示完整说明**（中文名 + 作用 + 后端键名），并支持搜索过滤。
- 移植源默认 **ZIP 卡刷包**；仅 Recovery 模式自动回落为独立镜像。
- 底部粘性操作栏实时显示「还差 N 项才能开始」与阻塞原因，替代原版点击后才报错。
- 新增**终止任务**能力（原版只能等或强杀进程）。
- 「芯片方案」下拉已移除 **LK 去警告**（左侧已有独立页面），避免两处入口。

**LK 去警告**
- 扫描结果结构化为镜像卡片：适配状态、警告文本段数、补丁点偏移、头部校验、内核参数一目了然。
- 补丁选项（A/B / 自动备份 / 生成报告 / 原地覆盖）以说明型复选组呈现；勾选"原地覆盖"时给出显式风险提示。
- 说明：CLI 的 `lk` 子命令对目录内全部 LK 镜像统一处理，不接受单镜像选择参数，因此本页**不做**伪交互的"镜像勾选"。

**主题与主色（Material You）**
- **主色默认跟随桌面壁纸**：读取当前壁纸 → 解码 → OkLCh 色相分桶加权取主色 →
  派生 5 组关键色 → 生成 19 个颜色角色的浅色/深色配色方案。全部在 Rust 侧完成。
- 色板严格按 M3 规范：**13 个色阶**（0 10 20 30 40 50 60 70 80 90 95 99 100），
  **40 为浅色主色、80 为深色主色**；色阶差 40/50/70 的对比度分别 ≥3:1 / ≥4.5:1 / ≥7:1（有单测锁定）。
- 顶栏提供**重新取色**按钮（换了壁纸后点一下即可）；取色结果有缓存，重复启动 20ms 内完成。
- 浅色 / 深色 / 跟随系统三态，持久化到 localStorage。

**启动体验**
- `index.html` 内置纯 CSS 启动骨架（图标脉冲 + 进度条），React 挂载时整体替换，消除白屏；
  窗口背景色也预设为浅色 surface，避免 WebView 初始化瞬间的白底。

**紧凑与自适应**
- 圆角按控件尺寸分级（chip 6 / 控件 8 / 分组 10 / 卡片 12 / 容器 16），正文 13px、日志 12px。
- **侧边栏可收起**：顶栏最左侧按钮在 232px（含文字）与 60px（纯图标条）之间切换，收起后内容区与日志面板自动变宽。
- 三档响应式：≥1536px 常驻日志面板；900–1536px 日志转为抽屉；<900px 侧栏收起为抽屉。
  移植条目网格 1/2/3 列随宽度变化。

---

## 3. 目录结构

```
mtk-porttool-master-ui/
├── index.html
├── package.json                 # 前端依赖与脚本
├── vite.config.ts               # Vite（固定 1420 端口，相对 base）
├── src/
│   ├── main.tsx                 # 主题根：订阅 effectiveTheme
│   ├── App.tsx                  # 应用框架：侧栏 + 顶栏 + 内容 + 日志面板
│   ├── theme.ts                 # MD3 色调板与 MUI 主题映射
│   ├── store.ts                 # 状态中枢与任务编排（zustand）
│   ├── api.ts                   # Tauri IPC 封装（查询 / 流式任务 / 对话框）
│   ├── index.css
│   ├── components/
│   │   ├── Sidebar.tsx          # 导航 + 运行状态 + 环境摘要
│   │   ├── LogPanel.tsx         # 日志流（分级着色 / 自动滚动 / 终止）
│   │   ├── PathField.tsx        # 路径输入 + 浏览
│   │   └── Toasts.tsx
│   └── pages/
│       ├── PortPage.tsx         # 移植工作台
│       ├── LkPage.tsx           # LK 去警告
│       └── ToolsPage.tsx        # 文件系统自查 / 更新 / 环境诊断
├── scripts/                     # 开发辅助脚本（不参与打包，详见 DESIGN.md）
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json          # 窗口 1280×820；tools/ 作为资源打包
    ├── capabilities/default.json
    ├── icons/                   # 由 `tauri icon` 生成
    └── src/
        ├── main.rs
        ├── lib.rs               # 工具目录定位 / Python 探测 / 流式任务
        └── theme.rs             # 壁纸取色 + MD3 色彩系统（色板/关键色/颜色角色）
```

后端工具原封不动地放在 `tools/mtk-garbage-porttool-master/`（含 `porttool_cli.py`、`porttool/`、`bin/`、`configs.json`）。界面重构的边界与决策依据见 [DESIGN.md](DESIGN.md)。

---

## 4. 开发与构建

前置：**Node ≥ 20**、**pnpm ≥ 9**（或 npm/yarn）、**Python ≥ 3.10**（后端 CLI 纯标准库，无需 pip 依赖）、**Rust stable** + **MSVC 生成工具**（Windows 上 Tauri 需要 `link.exe`）。

```bash
pnpm install
pnpm tauri:dev        # 开发模式（Vite 1420 + Tauri 窗口）
pnpm tauri:build      # 发布构建（产物在 src-tauri/target/release/bundle/）
```

若 PATH 中没有 pnpm，可直接调用本地 CLI（`beforeDevCommand` 已改为不依赖包管理器）：

```bash
node ./node_modules/@tauri-apps/cli/tauri.js dev
```

仅调前端界面（无后端能力，用于调样式）：

```bash
pnpm dev              # 浏览器打开会提示"未检测到 Tauri 运行时"
```

### 工具目录定位顺序

`lib.rs::tool_dir_candidates` 按以下顺序寻找含 `porttool_cli.py` 的目录：

1. 环境变量 `MTK_PORTTOOL_HOME`（可指向工具目录本身或其父目录）
2. 开发态：`src-tauri/../tools/mtk-garbage-porttool-master`
3. 发布态：`<exe>/tools/...`、`<exe>/resources/tools/...`、`<exe>/_up_/tools/...`（Tauri 资源解包目录）
4. Tauri `resource_dir()/tools/mtk-garbage-porttool-master`

Python 解释器按 `python` → `python3` → `py -3` 探测，可用 `--version` 成功返回 `Python ...` 者胜出。

> **可写性自动处理**：移植过程会在工具目录内创建 `out/`、`tmp/`、`base/`。
> 应用启动时会实测工具目录是否可写；若不可写（典型：安装到 `Program Files` 且以标准用户运行），
> 会把工具复制到 `%LOCALAPPDATA%\com.mtkporttool.studio\tools\` 并改在那里运行，
> 「工具与自查 → 运行环境」会显示提示与新的工具目录。
> 也可以手动指定：把 `tools/mtk-garbage-porttool-master` 复制到任意可写目录，用 `MTK_PORTTOOL_HOME` 指向它。

### 发布产物

```bash
pnpm tauri:build
```

产出：

| 文件 | 说明 |
|---|---|
| `src-tauri/target/release/bundle/nsis/MTK Porttool Studio_1.0.0_x64-setup.exe` | NSIS 安装包（含后端工具，约 5.2 MB） |
| `src-tauri/target/release/mtk-porttool-studio.exe` | 免安装主程序（需自行保证 `_up_/tools` 或 `tools/` 与之同级） |

安装包会把后端工具放到安装目录的 `_up_/tools/mtk-garbage-porttool-master`（Tauri 资源目录约定），
应用启动时按上面的顺序自动定位。

---

## 5. 验证

```bash
pnpm typecheck                                   # 前端类型检查
pnpm build                                       # 前端生产构建
pnpm check:contract                              # 后端 CLI 契约（9 项，含退出码语义）
pnpm check:rust                                  # 外壳 + 色彩系统单测（25 项，真实调用 Python CLI）
pnpm check:dom                                   # 浏览器渲染校验（需先 pnpm dev，需本机 Chrome）
```

`check:rust` 覆盖外壳最关键的那条链路：**定位工具目录 → 探测 Python → 构造进程 → 解析 stdout → 按退出码裁决**，以及 MD3 色彩系统的不变量（13 级色板、色阶-对比度下界、19 个角色的 tone 映射、深/浅色表面层级顺序、取色对纯灰图的拒绝）。它不产生任何移植产物，只跑查询命令与必然失败的参数校验。

---

## 6. 常见问题

**侧栏显示"后端未就绪"** —— 展开「工具与自查 → 运行环境」查看 `工具目录` 与 `Python` 两行；若工具目录为空，检查 `tools/mtk-garbage-porttool-master/porttool_cli.py` 是否存在。

**任务退出码 1** —— 参数/校验错误。移植工作台会在开始前列出缺失项；若仍出现，日志中必有 `【参数错误】` 行，按其内容修正输入。

**任务退出码 2** —— 流程执行失败（如镜像格式异常、磁盘空间不足），日志中必有 `【移植异常】`，其后是完整堆栈。

**窗口最小宽度 1040** —— 低于此宽度日志面板会自动切换为抽屉，不再挤压配置区。

---

## 7. 致谢与许可

- 后端工具作者：[LJY-33684](https://github.com/LJY-33684/mtk-garbage-porttool-master)（原始移植工具改进者）、[@affggh](https://github.com/affggh)（原文件作者）
- Recovery 移植参考 [@Xxinn034](https://github.com/Xxinn034/mtk-legacy-porttool)；LK 去警告整合自 [@justistab3-bot](https://github.com/justistab3-bot/mtk-lk-warning-patch)
- 技术栈与交互范式参考 [xinjiu-qwq/cloudtune](https://github.com/xinjiu-qwq/cloudtune)（Tauri 2 + Material Design 3）

本仓库仅重构界面外壳，后端工具及其许可条款遵循上游仓库。
