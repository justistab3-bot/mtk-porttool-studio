/**
 * 无头浏览器渲染校验（开发辅助，不参与打包）。
 *
 * 用 Chrome DevTools Protocol 打开页面，收集真实 DOM 结构：
 * 导航项、卡片标题、按钮、控制台报错。用于在没有人眼观察窗口的情况下
 * 验证 React 渲染结果是否符合预期。
 *
 * 用法：node scripts/dom_check.mjs [url] [width] [height] [navLabel...]
 *   navLabel 为要依次点击的导航项文本，例如 "LK 去警告" "工具与自查"。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_TARGET = process.argv[2] ?? "http://localhost:1420/";
const WIDTH = Number(process.argv[3] ?? 1280);
const HEIGHT = Number(process.argv[4] ?? 820);
const NAV_STEPS = process.argv.slice(5);
const PORT = 9333;

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error("未找到 Chrome/Edge 可执行文件");
  process.exit(2);
}

const userDataDir = mkdtempSync(join(tmpdir(), "mtk-dom-check-"));
const child = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${PORT}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("DevTools 端点未就绪");
}

function cdp(ws) {
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, events };
}

const SNAPSHOT = `(() => {
  const txt = (el) => (el?.textContent ?? "").trim().replace(/\\s+/g, " ");
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const style = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop) : null);

  const primaryBtn = q("button").find((b) => b.className.includes("MuiButton-contained"));
  const card = q(".MuiPaper-root").find((p) => style(p, "border-radius") && style(p, "border-radius") !== "0px");
  const navItem = q("nav .MuiListItemButton-root")[0];
  const input = q(".MuiOutlinedInput-root")[0];

  return {
    pageTitle: txt(document.querySelector(".MuiTypography-h5")),
    headings: q(".MuiTypography-subtitle1").map(txt),
    buttons: Array.from(new Set(q("button").map(txt))).filter(Boolean),
    labels: Array.from(new Set(q("label").map(txt))).filter(Boolean),
    chips: q(".MuiChip-label").map(txt),
    checkboxes: q("input[type=checkbox]").length,
    textFields: q("input.MuiOutlinedInput-input, textarea").length,
    alerts: q(".MuiAlert-message").map(txt),
    theme: {
      bodyBg: style(document.body, "background-color"),
      bodyColor: style(document.body, "color"),
      primaryButtonBg: style(primaryBtn, "background-color"),
      primaryButtonRadius: style(primaryBtn, "border-radius"),
      cardRadius: style(card, "border-radius"),
      navItemRadius: style(navItem, "border-radius"),
      inputRadius: style(input, "border-radius"),
      navWidth: navItem ? style(navItem.closest("nav"), "width") : null,
    },
    bodyText: document.body.innerText.replace(/\\n{2,}/g, "\\n").slice(0, 2400),
  };
})()`;

async function main() {
  await waitForDevtools();

  const targetRes = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
  const target = await targetRes.json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });

  const { send, events } = cdp(ws);
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send("Page.navigate", { url: URL_TARGET });
  await sleep(3200);

  const evaluate = async (expr) => {
    const res = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        "页面脚本异常：" +
          res.exceptionDetails.text +
          " :: " +
          (res.exceptionDetails.exception?.description ?? ""),
      );
    }
    return res.result.value;
  };

  const shots = [];
  const snap = async (step, extra = {}) => {
    const raw = await evaluate(SNAPSHOT);
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    shots.push({ step, ...extra, ...data });
  };

  await snap("initial");

  for (const label of NAV_STEPS) {
    const clicked = await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll("nav .MuiListItemButton-root"))
        .find((el) => el.innerText.includes(${JSON.stringify(label)}));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(1200);
    await snap(label, { clicked });
  }

  const errors = events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  const exceptions = events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails.text + " :: " + (e.params.exceptionDetails.exception?.description ?? ""));

  console.log(JSON.stringify({ shots, consoleErrors: errors, exceptions }, null, 2));

  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("检查失败：", e.message);
  child.kill();
  process.exit(1);
});
