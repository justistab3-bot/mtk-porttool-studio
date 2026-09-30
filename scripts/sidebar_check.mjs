/**
 * 验证侧边栏收起/展开（开发辅助）。
 *
 * 点击顶栏的收起按钮，检查侧栏宽度、内容区宽度、导航图标是否仍可用，
 * 再点一次确认能恢复。
 *
 * 用法：node scripts/sidebar_check.mjs [url]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_TARGET = process.argv[2] ?? "http://localhost:1420/";
const PORT = 9338;

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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "mtk-side-"))}`,
    `--remote-debugging-port=${PORT}`,
    "--window-size=1440,900",
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
  await sleep(5000);

  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text };
    return r.result?.value;
  };

  const measure = `(() => {
    const nav = document.querySelector("nav");
    const main = document.querySelector(".MuiBox-root > .MuiBox-root");
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const navItems = document.querySelectorAll("nav .MuiListItemButton-root").length;
    const navTexts = Array.from(document.querySelectorAll("nav .MuiListItemText-primary")).map((e) => e.textContent.trim());
    // 顶栏第一个按钮（收起/展开）
    const firstBtn = document.querySelector("header button, .MuiPaper-root button");
    return {
      navWidth: navRect ? Math.round(navRect.width) : null,
      navItems,
      navTexts,
      collapsed: navRect ? Math.round(navRect.width) < 100 : null,
    };
  })()`;

  // 等顶栏按钮真正渲染出来再测量
  for (let i = 0; i < 20; i++) {
    const ok = await evaluate(`!!document.querySelector("nav")`);
    if (ok) break;
    await sleep(300);
  }
  const before = await evaluate(measure);

  // 点击顶栏第一个按钮（Tooltip 包裹的 IconButton）
  const clickToggle = await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    // 顶栏第一个按钮：位于页面最上方，且不是导航项
    const top = btns
      .filter((b) => !b.closest("nav"))
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter((x) => x.r.top < 60 && x.r.width > 0)
      .sort((a, c) => a.r.left - c.r.left);
    if (!top.length) return { ok: false };
    top[0].b.click();
    return { ok: true, label: top[0].b.getAttribute("aria-label") ?? top[0].b.textContent.trim() };
  })()`);
  await sleep(700);
  const after = await evaluate(measure);

  // 收起态下点击导航图标，确认仍可切换页面
  const navClick = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll("nav .MuiListItemButton-root"));
    if (items.length < 2) return { ok: false, count: items.length };
    items[1].click();
    return { ok: true, count: items.length };
  })()`);
  await sleep(700);
  const afterNav = await evaluate(`(() => {
    const txt = (el) => (el?.textContent ?? "").trim();
    return { pageTitle: txt(document.querySelector(".MuiTypography-h5")) };
  })()`);

  // 再点一次恢复
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll("button"))
      .filter((b) => !b.closest("nav"))
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter((x) => x.r.top < 60 && x.r.width > 0)
      .sort((a, c) => a.r.left - c.r.left);
    if (btns.length) btns[0].b.click();
  })()`);
  await sleep(700);
  const restored = await evaluate(measure);

  const errors = events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  const exceptions = events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails.text);

  console.log(JSON.stringify({ before, clickToggle, after, navClick, afterNav, restored, errors, exceptions }, null, 2));
  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("失败：", e.message);
  child.kill();
  process.exit(1);
});
