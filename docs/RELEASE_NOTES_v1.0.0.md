## MTK 移植工作室 v1.0.0

基于 [mtk-garbage-porttool-master](https://github.com/LJY-33684/mtk-garbage-porttool-master) 的 **Material Design 3** 桌面外壳。
Tauri 2 + React 19 + MUI 7（Material You），后端复用其既有 CLI 桥接接口 `porttool_cli.py`。

---

### 主要特性

**Material You 动态色彩**
- 主色**默认跟随桌面壁纸**：读取壁纸 → OkLCh 色相分桶加权取色 → 派生 5 组关键色 → 生成 19 个颜色角色的浅色/深色配色
- 严格按 M3 规范：13 个色阶（0 10 20 30 40 50 60 70 80 90 95 99 100），40 为浅色主色、80 为深色主色；色阶差 40/50/70 的对比度分别 ≥3:1 / ≥4.5:1 / ≥7:1
- 取色结果带缓存，二次启动 20ms 内完成；顶栏一键重新取色

**三个语义页面**
- **移植工作台**：芯片方案 → 移植条目（分组 + 图标 + 悬停说明）→ 底包/移植源表单 → 输出选项；非法组合提交前即禁用并说明原因
- **LK 去警告**：扫描结果结构化为镜像卡片（适配状态、警告段数、补丁点、头部校验）
- **工具与自查**：文件系统完整性自查、版本更新检查、运行环境诊断

**体验**
- 侧边栏可收起（232px ↔ 60px 图标条）
- 三档响应式：≥1536px 常驻日志面板 / 900–1536px 日志抽屉 / <900px 侧栏抽屉
- 启动骨架屏，消除白屏
- 任务日志分级着色、可折叠、可终止（原版只能等或强杀进程）
- 移植源默认 ZIP 卡刷包；「芯片方案」下拉不再混入 LK 方案

**修复了上游的阻断性缺陷**
- `porttool/utils.py`：ZIP 卡刷包作移植源时在打印输入概览阶段崩溃（`UnboundLocalError: pb`），
  导致**任何** ZIP 源移植都无法进行。已按最小改动修复（纯缩进调整，不触碰移植逻辑）。
  详见 [docs/BACKEND_FIXES.md](https://github.com/justistab3-bot/mtk-porttool-studio/blob/main/docs/BACKEND_FIXES.md)

---

### 下载

| 文件 | 说明 |
|---|---|
| `MTK-Porttool-Studio-1.0.0-portable-x64.zip` | **免安装绿色版**（推荐）：解压后直接运行 `mtk-porttool-studio.exe` |
| `MTK-Porttool-Studio-1.0.0-x64-setup.exe` | NSIS 安装包（可选安装到当前用户或全机） |

两个包都已内含后端工具（`_up_/tools/mtk-garbage-porttool-master`），无需另外下载。

### 运行要求

- **Windows 10 / 11 x64**（依赖 WebView2，Win11 与较新的 Win10 已内置）
- **Python 3.10+**，且 `python` 在 PATH 中（后端工具是纯标准库，**不需要 pip 安装任何依赖**）
- 安装到 `Program Files` 且以标准用户运行时，应用会自动把后端工具复制到
  `%LOCALAPPDATA%\com.mtkporttool.studio\tools\` 再运行（移植过程需要可写目录）

### 校验值

```
SHA256
MTK-Porttool-Studio-1.0.0-x64-setup.exe           2F44B698F7DB510A320298B79A10F8C4CA40C5D34C9E3C364207DE6396CE39C1
MTK-Porttool-Studio-1.0.0-portable-x64.zip         E02DD12ACA236D9042AE2842EF8E13208F0AFCD1B6B8DC675508268D2017A289
```

---

### 注意事项

- 本工具面向 Android 7.1.2 及以下的老设备；Android 8.0+（有 VNDK/Treble）建议直接刷 GSI
- 底包与移植源的芯片架构必须一致，建议同平台/同芯片系列
- 移植条目勾选越多，与底包不匹配的面越大、能开机的概率越低；建议先小范围试
- 刷机有风险，请提前备份数据，仅在测试设备上使用

### 致谢

- 后端工具：[LJY-33684/mtk-garbage-porttool-master](https://github.com/LJY-33684/mtk-garbage-porttool-master)（改进者）、[@affggh](https://github.com/affggh)（原文件作者）
- Recovery 移植参考 [@Xxinn034](https://github.com/Xxinn034/mtk-legacy-porttool)
- LK 去警告整合自 [@justistab3-bot](https://github.com/justistab3-bot/mtk-lk-warning-patch)
- 技术栈与交互范式参考 [xinjiu-qwq/cloudtune](https://github.com/xinjiu-qwq/cloudtune)

### 许可证

**GPL-3.0** —— 本仓库分发并修改了上游 GPL-3.0 代码，衍生作品整体同受该许可约束。
本项目为**非官方**界面重构，与上游作者无隶属关系。
