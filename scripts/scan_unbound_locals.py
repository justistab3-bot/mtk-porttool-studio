# -*- coding: utf-8 -*-
"""扫描 porttool 包中「局部变量在条件分支内赋值、却在分支外使用」的模式。

这类写法在运行时就是 UnboundLocalError（本次修复的 pb 就是这个坑）。
静态数据流分析过于复杂，这里用近似规则找出可疑点供人工确认：

  1. 收集函数内所有被赋值的名字（含 for 目标、with as、except as、解包赋值）
  2. 找出「赋值语句整体位于 if/else/for/while/try 体内」的名字
  3. 若该名字在同一函数的语句列表（同一层）中被当作 Name 读取，
     且读取语句不在任何条件块内 → 标记为可疑

用法：python scripts/scan_unbound_locals.py <工具目录>
"""
import ast
import io
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else (
    r"D:\worker\mtk-porttool-master-ui\tools\mtk-garbage-porttool-master"
)

COND_NODES = (ast.If, ast.For, ast.While, ast.Try, ast.With)


def assigned_names(node):
    """收集一个语句（或语句列表）里被赋值的名字。"""
    names = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and isinstance(sub.ctx, (ast.Store,)):
            names.add(sub.id)
        elif isinstance(sub, (ast.For, ast.comprehension)) and isinstance(sub.target, ast.Name):
            names.add(sub.target.id)
        elif isinstance(sub, ast.arg):
            names.add(sub.arg)
    return names


def scan_function(fn, path, findings):
    # 函数内所有赋值名字（用于判断是否为局部变量）
    all_assigned = set()
    for sub in ast.walk(fn):
        if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store):
            all_assigned.add(sub.id)
        elif isinstance(sub, ast.ExceptHandler) and sub.name:
            all_assigned.add(sub.name)
        elif isinstance(sub, (ast.Import, ast.ImportFrom)):
            for a in sub.names:
                all_assigned.add((a.asname or a.name).split(".")[0])

    # 参数名
    args = fn.args
    for a in list(args.args) + list(args.posonlyargs) + list(args.kwonlyargs):
        all_assigned.add(a.arg)
    if args.vararg:
        all_assigned.add(args.vararg.arg)
    if args.kwarg:
        all_assigned.add(args.kwarg.arg)

    # 收集「在条件块内赋值」的名字
    conditional = set()

    def walk_conditional(body, in_cond):
        for stmt in body:
            if isinstance(stmt, COND_NODES):
                for field in ("body", "orelse", "finalbody"):
                    inner = getattr(stmt, field, None)
                    if inner:
                        for s in inner:
                            conditional.update(assigned_names(s))
                        walk_conditional(inner, True)
                for handler in getattr(stmt, "handlers", []):
                    conditional.update(assigned_names(handler))
                    walk_conditional(handler.body, True)
                continue
            walk_conditional(getattr(stmt, "body", []) or [], in_cond)

    walk_conditional(fn.body, False)

    # 找出在函数顶层语句列表中被读取、但只出现在条件块赋值里的名字
    top_level_reads = {}
    for stmt in fn.body:
        if isinstance(stmt, COND_NODES):
            continue
        for sub in ast.walk(stmt):
            if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load):
                top_level_reads.setdefault(sub.id, sub.lineno)

    for name, lineno in sorted(top_level_reads.items(), key=lambda kv: kv[1]):
        if name in conditional and name in all_assigned:
            findings.append((path, fn.name, name, lineno))


def scan_file(path):
    findings = []
    with io.open(path, "r", encoding="utf-8", errors="replace") as f:
        src = f.read()
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        return [("SYNTAX", path, str(e), getattr(e, "lineno", 0) or 0)]
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            scan_function(node, path, findings)
    return findings


def main():
    all_findings = []
    scanned = 0
    for dirpath, _dirnames, filenames in os.walk(ROOT):
        if os.sep + "bin" in dirpath or os.sep + "out" in dirpath:
            continue
        for fn in filenames:
            if fn.endswith(".py"):
                full = os.path.join(dirpath, fn)
                scanned += 1
                all_findings.extend(scan_file(full))

    print("扫描 %d 个 .py 文件" % scanned)
    if not all_findings:
        print("未发现可疑的「条件块内赋值、块外使用」模式")
        return 0

    print("可疑点（需人工确认是否为真实缺陷）：")
    for path, fname, name, lineno in all_findings:
        rel = os.path.relpath(path, ROOT)
        print("  %s:%d  函数 %s()  变量 %s" % (rel, lineno, fname, name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
