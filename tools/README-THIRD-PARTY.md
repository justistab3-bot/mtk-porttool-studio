# 第三方代码说明 / Third-Party Notice

本目录下的 `mtk-garbage-porttool-master/` 是**上游项目原样副本**，不是本仓库的原创代码。

| 项 | 内容 |
|---|---|
| 来源 | https://github.com/LJY-33684/mtk-garbage-porttool-master |
| 版本 | 1.3-beta2p1 |
| 许可证 | **GPL-3.0**（与本仓库根目录 `LICENSE` 一致） |
| 原始作者 | [@affggh](https://github.com/affggh)（原文件作者）、[LJY-33684](https://github.com/LJY-33684)（改进者） |
| 附带组件 | Recovery 移植参考 [@Xxinn034](https://github.com/Xxinn034/mtk-legacy-porttool)；LK 去警告整合自 [@justistab3-bot](https://github.com/justistab3-bot/mtk-lk-warning-patch) |

## 本仓库对其所做的修改

**只有一处**，且是为修复"ZIP 卡刷包移植源完全不可用"的崩溃缺陷，纯缩进调整、不触碰移植逻辑：

- 文件：`mtk-garbage-porttool-master/porttool/utils.py`
- 位置：`portutils.start()` 内约 1694–1702 行的输入概览打印
- 详情：见仓库根目录 [`../../docs/BACKEND_FIXES.md`](../../docs/BACKEND_FIXES.md)
- 补丁：[`../../docs/patches/zip-source-unbound-pb.patch`](../../docs/patches/zip-source-unbound-pb.patch)

## 为什么整个仓库是 GPL-3.0

本仓库分发并修改了上述 GPL-3.0 代码，因此作为衍生作品整体受 GPL-3.0 约束
（UI 外壳的源代码同样以 GPL-3.0 提供）。详见根目录 `README.md` 的「许可证」一节。
