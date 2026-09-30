/**
 * 检查「芯片方案」下拉框的实际渲染条目（开发辅助）。
 * 用于确认是否存在重复选项、以及选项文本是否完整。
 *
 * 用法：node scripts/check_select.mjs [url]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_TARGET = process.argv[2] ?? "http://localhost:1420/";
const PORT = 9336;

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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "mtk-sel-"))}`,
    `--remote-debugging-port=${PORT}`,
    "--window-size=1280,900",
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
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve } = pending.get(m.id);
      pending.delete(m.id);
      resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, { resolve });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL_TARGET });
  await sleep(3500);

  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  // 打开方案下拉（MUI Select）
  const opened = await evaluate(`(async () => {
    const sel = document.querySelector(".MuiSelect-select");
    if (!sel) return false;
    sel.click();
    await new Promise(r => setTimeout(r, 700));
    return true;
  })()`);

  const data = await evaluate(`(() => {
    const txt = (el) => (el?.textContent ?? "").trim();
    const options = Array.from(document.querySelectorAll('[role="option"]')).map(txt);
    const allTexts = Array.from(document.querySelectorAll("li")).map(txt);
    return {
      optionCount: options.length,
      options,
      duplicates: options.filter((v, i) => options.indexOf(v) !== i),
      liCount: allTexts.length,
    };
  })()`);

  console.log(JSON.stringify({ opened, ...data }, null, 2));
  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("失败：", e.message);
  child.kill();
  process.exit(1);
});
