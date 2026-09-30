# -*- coding: utf-8 -*-
"""修复 porttool/utils.py 中 ZIP 源分支的缩进 bug。

现象：用 ZIP 卡刷包作移植源时，start() 在打印输入概览阶段崩溃：
    UnboundLocalError: cannot access local variable 'pb' where it is not associated with a value

原因：`pb, ps = self.port_source` 位于 `else:` 分支内，但紧随其后的 4 行 print
     没有跟着缩进，于是无论 source_type 是 zip 还是 img 都会执行，
     zip 分支下 pb 从未被赋值。

修复：把这 4 行 print 缩进到 else 分支内（纯缩进调整，不改逻辑）。
"""
import io
import re
import sys

TARGET = sys.argv[1] if len(sys.argv) > 1 else (
    r"D:\worker\mtk-porttool-master-ui\tools\mtk-garbage-porttool-master\porttool\utils.py"
)

with io.open(TARGET, "r", encoding="utf-8") as f:
    lines = f.readlines()

# 定位 `pb, ps = self.port_source`
idx = None
for i, line in enumerate(lines):
    if line.strip() == "pb, ps = self.port_source":
        idx = i
        break
if idx is None:
    print("FAIL: 未找到 `pb, ps = self.port_source`")
    sys.exit(1)

assign_indent = len(lines[idx]) - len(lines[idx].lstrip())
print("赋值行 %d，缩进 %d 空格" % (idx + 1, assign_indent))

# 其后 4 行需要与赋值行同缩进
changed = []
for j in range(idx + 1, idx + 5):
    raw = lines[j]
    cur = len(raw) - len(raw.lstrip())
    if cur == assign_indent:
        print("  行 %d 缩进已正确，跳过" % (j + 1))
        continue
    if cur != 0:
        print("  行 %d 缩进异常（%d），跳过" % (j + 1, cur))
        continue
    lines[j] = " " * assign_indent + raw
    changed.append(j + 1)

if not changed:
    print("无需修改")
    sys.exit(0)

with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
    f.writelines(lines)

print("已修正缩进的行：", changed)

# 语法校验
import py_compile

try:
    py_compile.compile(TARGET, doraise=True)
    print("语法校验通过")
except py_compile.PyCompileError as e:
    print("语法校验失败：", e)
    sys.exit(2)
