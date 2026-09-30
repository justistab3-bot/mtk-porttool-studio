/**
 * 注入模拟数据以验证「移植条目」的渲染（开发辅助）。
 *
 * 浏览器直开时没有 Tauri 后端，方案与条目列表为空，无法检查图标/悬停说明。
 * 本脚本通过 CDP 调用 store 的动作注入一份与真实方案同构的数据，
 * 然后检查：条目图标是否渲染、悬停是否出现 Tooltip、风险横幅是否随勾选变化。
 *
 * 用法：node scripts/inject_check.mjs [url]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_TARGET = process.argv[2] ?? "http://localhost:1420/";
const PORT = 9337;

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => existsSync(p));
if (!CHROME) {
  console.error("未找到 Chrome");
  process.exit(2);
}

const child = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "mtk-inj-"))}`,
    `--remote-debugging-port=${PORT}`,
    "--window-size=1440,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) break;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });

  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result);
    } else if (m.method) events.push(m);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, { resolve });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL_TARGET });
  await sleep(3200);

  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      return { __error: r.exceptionDetails.text + " :: " + (r.exceptionDetails.exception?.description ?? "") };
    }
    return r.result?.value;
  };

  // 注入与真实方案同构的数据
  const injected = await evaluate(`(async () => {
    const m = await import("/src/store.ts");
    const keys = [
      "generate_script","replace_kernel","replace_fstab","selinux_permissive","enable_adb",
      "replace_firmware","replace_mddb","replace_malidriver","replace_audiodriver","replace_tfa",
      "replace_gralloc","replace_hwcomposer","replace_ril","replace_sensors","replace_gps",
      "replace_power","replace_bluetooth","replace_vibrator","replace_thermal","replace_wifi",
      "replace_camera","replace_audioengine","replace_libshowlogo","replace_mtk-kpd",
      "single_simcard","dual_simcard","fit_density","change_model","change_timezone","change_locale",
      "use_custom_update-binary","replace_init","change_platform","auto_replace"
    ];
    const items = keys.map((k) => ({ key: k, enabled: ["replace_kernel","selinux_permissive","enable_adb","fit_density"].includes(k) }));
    m.useApp.setState({
      chipsets: ["mt6572/mt6582/mt6592 kernel-3.4.67", "G79 (mt6735/mt6735m/mt6737) kernel-3.18.19"],
      chipset: "mt6572/mt6582/mt6592 kernel-3.4.67",
      items,
      itemDefaults: Object.fromEntries(items.map((i) => [i.key, i.enabled])),
      itemsLoading: false,
    });
    return { itemCount: items.length, enabled: items.filter((i) => i.enabled).length };
  })()`);

  await sleep(1200);

  const snapshot = await evaluate(`(() => {
    const txt = (el) => (el?.textContent ?? "").trim().replace(/\\s+/g, " ");
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const itemRows = q("input[type=checkbox]").length;
    // 条目行内的 MUI 图标（svg[data-testid$="Icon"]）
    const itemIcons = q("svg[data-testid$='Icon']").length;
    const riskBanner = q(".MuiTypography-body2").map(txt).find((t) => /已选 \\d+ 项/.test(t)) ?? null;
    const groupLabels = q(".MuiTypography-overline").map(txt);
    const firstItemText = q("label, .MuiBox-root")
      .map(txt)
      .find((t) => t.startsWith("替换内核"));
    return {
      checkboxes: itemRows,
      itemIcons,
      riskBanner,
      groupLabels,
      firstItemText: firstItemText?.slice(0, 60) ?? null,
      subtitle: q(".MuiTypography-caption").map(txt).find((t) => t.includes("悬停")) ?? null,
    };
  })()`);

  // 悬停到第一个条目，检查 Tooltip 是否出现（用真实鼠标事件，走命中测试）
  const hoverResult = await evaluate(`(async () => {
    const all = Array.from(document.querySelectorAll("p, span, div"));
    const label = all.find(
      (el) => el.textContent?.trim() === "替换内核" && el.children.length === 0
    );
    if (!label) {
      return { ok: false, reason: "未找到条目文本", sample: all.filter((e) => e.textContent?.includes("替换内核")).slice(0, 3).map((e) => e.tagName + ":" + (e.className || "").slice(0, 40)) };
    }
    const r = label.getBoundingClientRect();
    return { ok: true, tag: label.tagName, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  let tooltip = null;
  if (hoverResult.ok) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverResult.x, y: hoverResult.y });
    await sleep(900);
    tooltip = await evaluate(`(() => {
      const tip = document.querySelector(".MuiTooltip-tooltip");
      return tip ? tip.innerText.replace(/\\n+/g, " | ") : null;
    })()`);
  }

  // 全选后风险横幅应升级
  const afterSelectAll = await evaluate(`(async () => {
    const m = await import("/src/store.ts");
    m.useApp.getState().setAllItems(true);
    await new Promise((res) => setTimeout(res, 600));
    const txt = (el) => (el?.textContent ?? "").trim().replace(/\\s+/g, " ");
    const banner = Array.from(document.querySelectorAll(".MuiTypography-body2")).map(txt).find((t) => /已选 \\d+ 项/.test(t));
    return { banner: banner ?? null };
  })()`);

  // 图标配色验证：勾选项的图标颜色应等于当前配色方案的 primary
  const iconColors = await evaluate(`(async () => {
    const m = await import("/src/store.ts");
    const readIcons = () => {
      const svgs = Array.from(document.querySelectorAll("svg[data-testid$='Icon']"))
        .filter((s) => {
          const p = s.closest(".MuiBox-root");
          return p && p.querySelector("input[type=checkbox]");
        });
      const colors = new Set();
      for (const s of svgs) {
        const c = getComputedStyle(s).color;
        colors.add(c);
      }
      return Array.from(colors);
    };
    const schemeA = m.useApp.getState().themeScheme.primary;
    const colorsA = readIcons();
    // 切换到默认蓝配色（applyHue 走 Rust；浏览器里直接换色板）
    const { FALLBACK_SCHEME } = m;
    m.useApp.setState({ themeScheme: { ...FALLBACK_SCHEME, primary: "#0B57D0" } });
    await new Promise((res) => setTimeout(res, 500));
    const colorsB = readIcons();
    return { schemeA, colorsA, forcedPrimary: "#0B57D0", colorsB };
  })()`);

  const errors = events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  const exceptions = events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails.text);

  console.log(
    JSON.stringify(
      { injected, snapshot, hover: { ...hoverResult, tooltip }, afterSelectAll, iconColors, errors, exceptions },
      null,
      2,
    ),
  );
  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("失败：", e.message);
  child.kill();
  process.exit(1);
});
