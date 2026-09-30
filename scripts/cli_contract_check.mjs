/**
 * 接口契约校验（开发辅助，不参与打包）。
 *
 * 直接用 Node 调用后端 `porttool_cli.py`，验证 UI 外壳依赖的每一项契约：
 *   · --version / --chipsets / --items 的输出格式与解析结果
 *   · 非法组合的退出码是否为 1（参数·校验错误）
 *   · 未知方案是否被拒绝
 * 不产生任何移植产物，也不需要真实镜像。
 *
 * 用法：node scripts/cli_contract_check.mjs [工具目录]
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const TOOL_DIR = resolve(
  process.argv[2] ?? join(import.meta.dirname, "..", "tools", "mtk-garbage-porttool-master"),
);
const CLI = join(TOOL_DIR, "porttool_cli.py");

if (!existsSync(CLI)) {
  console.error(`未找到 CLI：${CLI}`);
  process.exit(2);
}

/** 与 src/store.ts 的 parseItems 保持一致的解析实现。 */
function parseItems(lines) {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [k, v = "false"] = l.split("=");
      return { key: k.trim(), enabled: v.trim() === "true" };
    })
    .filter((it) => !["lk_patch_mode", "recovery_only_mode", "kernel_only_mode"].includes(it.key));
}

async function cli(args, opts = {}) {
  try {
    const { stdout, stderr } = await run("python", [CLI, ...args], {
      cwd: TOOL_DIR,
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      timeout: 60000,
      ...opts,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. --version
const ver = await cli(["--version"]);
record(
  "--version 返回单行版本号",
  ver.code === 0 && /^\d+\.\d+/.test(ver.stdout.trim()),
  JSON.stringify(ver.stdout.trim()),
);

// 2. --chipsets
const chips = await cli(["--chipsets"]);
const chipList = chips.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
record("--chipsets 返回方案列表", chips.code === 0 && chipList.length > 0, `${chipList.length} 个方案`);

// 3. --items 全方案
// 说明：LK 方案只有 lk_patch_mode 一个 flag，被 UI 过滤后条目为 0 —— 这是预期行为。
let itemTotal = 0;
let itemFail = 0;
for (const name of chipList) {
  const res = await cli(["--items", "--chipset", name]);
  const items = parseItems(res.stdout.split("\n"));
  itemTotal += items.length;
  const expectEmpty = name.includes("LK去警告");
  const bad = res.code !== 0 || (expectEmpty ? false : items.length === 0) || items.some((i) => !i.key);
  if (bad) {
    itemFail++;
    record(`--items "${name}"`, false, `code=${res.code} 条目=${items.length}`);
  }
}
record(
  "--items 全部方案可解析",
  itemFail === 0,
  `${chipList.length} 个方案共 ${itemTotal} 个条目，失败 ${itemFail}`,
);

// 4. 未知方案的退出码必须是 1
const unknown = await cli(["port", "--chipset", "不存在的方案", "--base-boot", "x.img", "--donor-boot", "y.img"]);
record("未知方案 → 退出码 1", unknown.code === 1, `code=${unknown.code}`);

// 5. 文件缺失的退出码必须是 1
const missing = await cli([
  "port",
  "--chipset",
  chipList[0],
  "--base-boot",
  "D:\\__no_such_boot.img",
  "--donor-boot",
  "D:\\__no_such_boot2.img",
]);
record("底包缺失 → 退出码 1", missing.code === 1, `code=${missing.code}`);

// 6. zip 输出 + img 源必须被拒绝（退出码 1）
const badCombo = await cli([
  "port",
  "--chipset",
  chipList[0],
  "--base-boot",
  "D:\\__no_such_boot.img",
  "--donor-boot",
  "D:\\__no_such_boot2.img",
  "--out-type",
  "zip",
]);
record(
  "zip 输出 + img 源 → 退出码 1 且日志含【参数错误】",
  badCombo.code === 1 && /【参数错误】/.test(badCombo.stdout),
  `code=${badCombo.code}`,
);

// 7. kernel-only 方案 + zip 输出必须被拒绝
const kernelOnly = chipList.find((c) => c.includes("仅移植内核"));
if (kernelOnly) {
  const r = await cli([
    "port",
    "--chipset",
    kernelOnly,
    "--base-boot",
    "D:\\__no_such_boot.img",
    "--donor-boot",
    "D:\\__no_such_boot2.img",
    "--out-type",
    "zip",
  ]);
  record("kernel-only + zip → 退出码 1", r.code === 1, `code=${r.code}`);
}

// 8. lk 子命令目录缺失必须被拒绝
const lk = await cli(["lk", "scan", "--folder", "D:\\__no_such_dir"]);
record("lk scan 目录缺失 → 退出码 1", lk.code === 1, `code=${lk.code}`);

// 9. 用法错误（缺子命令）退出码为 1
const noCmd = await cli([]);
record("无子命令 → 退出码 1", noCmd.code === 1, `code=${noCmd.code}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 项通过`);
process.exit(failed.length === 0 ? 0 : 1);
