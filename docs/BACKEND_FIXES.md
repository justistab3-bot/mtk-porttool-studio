# 后端修复记录 / Backend Fixes

本文件记录对 `tools/mtk-garbage-porttool-master/`（上游后端工具）所做的**必要修复**。

原则：默认不动后端（见 `DESIGN.md` 第 1 节），只有在**功能完全不可用**时才修，且改动最小、
不改动任何移植逻辑，只修崩溃点。每处修复都在此登记，便于与上游同步。

---

## 2026-09-26 · ZIP 卡刷包作移植源时必然崩溃

### 现象

用 ZIP 卡刷包作移植源（最常见的用法）时，移植在**打印输入概览阶段**就中断：

```
【开始移植】MTK低端机移植工具启动...
  ├─ 工具版本：1.3-beta2p1
  ├─ 输出类型：img镜像
  ├─ 移植源类型：zip卡刷包
  ├─ 底包 boot：...（16.0 MB）
  ├─ 底包 system：...（4.09 GB）
【移植异常】执行过程出错：cannot access local variable 'pb' where it is not associated with a value

Traceback (most recent call last):
  File "porttool_cli.py", line 175, in cmd_port
    pu.start()
  File "porttool/utils.py", line 1698, in start
    print(f"  ├─ 移植用 boot：{pb}（{_fmt_size(Path(pb).stat().st_size)}）", file=self.std)
UnboundLocalError: cannot access local variable 'pb' where it is not associated with a value
```

退出码 `2`（执行失败）。**任何** ZIP 源移植都无法进行，与芯片方案、输出类型无关。

### 根因

`porttool/utils.py` 的 `portutils.start()` 中，输入概览的打印逻辑缩进错误：

```python
if self.source_type == 'zip':
    print(f"  └─ 移植包：{self.port_source}（...）", file=self.std)
else:
    pb, ps = self.port_source          # ← 赋值在 else 分支内
print(f"  ├─ 移植用 boot：{pb}（...）", file=self.std)   # ← 缩进少了 4 格，跑到分支外
if ps:
    print(f"  └─ 移植用 system：{ps}（...）", file=self.std)
else:
    print(f"  └─ 移植用 system：不参与（本方案无需 system）", file=self.std)
```

后 4 行本应属于 `else` 分支（只有"独立镜像"源才有 `pb` / `ps` 这两个值），
但因为少缩进 4 格，变成了无条件执行；ZIP 源下 `pb` 从未被赋值，直接抛 `UnboundLocalError`。

### 修复

纯缩进调整（4 行），**不改任何逻辑**：

```python
            if self.source_type == 'zip':
                print(f"  └─ 移植包：{self.port_source}（{_fmt_size(Path(self.port_source).stat().st_size)}）", file=self.std)
            else:
                pb, ps = self.port_source
                print(f"  ├─ 移植用 boot：{pb}（{_fmt_size(Path(pb).stat().st_size)}）", file=self.std)
                if ps:
                    print(f"  └─ 移植用 system：{ps}（{_fmt_size(Path(ps).stat().st_size)}）", file=self.std)
                else:
                    print(f"  └─ 移植用 system：不参与（本方案无需 system）", file=self.std)
```

- 文件：`tools/mtk-garbage-porttool-master/porttool/utils.py`
- 位置：`start()` 内，约 1694–1702 行
- 补丁：`docs/patches/zip-source-unbound-pb.patch`

### 验证

用真实素材（底包 4.09 GB system.img + 378.6 MB ZIP 移植源，方案 G79）复跑：

1. **修复前**：在打印阶段即 `UnboundLocalError`（与用户报告一致）
2. **修复后**：顺利越过打印阶段，继续执行
   `【解压移植包】→【解包boot.img】→【信息】底包 boot.img：内核版本 3.18.19 …`
   说明崩溃点已消除

补充多场景回归（每个场景运行约 18 秒后中断，检查是否出现 `UnboundLocalError`）：

| 场景 | 结果 | 执行到 |
|---|---|---|
| 独立镜像源 + img 输出 | 正常 | 【复制镜像】正在复制移植用镜像文件到 tmp/rom |
| ZIP 源 + zip 输出 | 正常 | 解包 system.img 阶段 |
| ZIP 源 + kernel-only | 正常 | 【清理完成】临时文件已删除 |

### 影响范围

- 只影响"输入概览"的打印分支，不涉及解包/替换/打包逻辑，产物不受影响
- 修复后 ZIP 源与 img 源的输出信息各自完整：
  - ZIP 源：`└─ 移植包：<路径>（大小）`
  - img 源：`├─ 移植用 boot：<路径>（大小）` + `└─ 移植用 system：…`

### 上游同步建议

该缺陷在上游 `LJY-33684/mtk-garbage-porttool-master` 中同样存在（本目录是其原样副本，
修复前的 `git status` 为空）。建议向上游提 issue/PR：把上述 4 行补上缩进即可。
