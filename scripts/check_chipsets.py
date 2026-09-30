import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")
from porttool.configs import support_chipset_portstep as S

names = list(S.keys())
print("方案总数:", len(names))
for i, n in enumerate(names):
    cfg = S[n]
    print("  [%d] %r partitions=%d flags=%d" % (i, n, len(cfg.get("partitions", {})), len(cfg.get("flags", {}))))

print()
norm = {}
for n in names:
    norm.setdefault(n.strip().lower(), []).append(n)
dups = {k: v for k, v in norm.items() if len(v) > 1}
print("规范化后完全重复:", dups if dups else "无")

# 检查是否有内容完全相同但名字不同的方案（这才是“重复选项”的可能来源）
import hashlib
sig = {}
for n in names:
    h = hashlib.md5(repr(sorted(S[n].get("flags", {}).items())).encode()).hexdigest()[:8]
    sig.setdefault(h, []).append(n)
same = {k: v for k, v in sig.items() if len(v) > 1}
print("flags 完全相同的方案组:", same if same else "无")
