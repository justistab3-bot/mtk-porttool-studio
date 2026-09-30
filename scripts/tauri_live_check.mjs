/**
 * 真实运行时联调校验（开发辅助，不参与打包）。
 *
 * 连接由 scripts/tauri_dev_debug.ps1 打开的 WebView2 调试端口，
 * 在真实 Tauri 运行时里验证：
 *   1. 前端能否访问 Tauri IPC（__TAURI_INTERNALS__）
 *   2. env_info / list_chipsets / list_items 是否返回预期数据
 *   3. 切换方案后 UI 条目是否正确重建
 *   4. 发起一次必然失败的移植任务，验证日志流、退出码与界面反馈
 *
 * 用法：node scripts/tauri_live_check.mjs [port]
 */
const PORT = Number(process.argv[2] ?? 9334);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findFrontendTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find(
        (t) =>
          t.type === "page" &&
          (t.url.includes("localhost:1420") || t.url.startsWith("tauri://") || t.url.includes("index.html")),
      );
      if (page) return page;
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  throw new Error("未找到前端页面目标（Tauri 窗口可能还没起来）");
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

async function main() {
  const page = await findFrontendTarget();
  console.log(`[target] ${page.url}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });

  const { send, events } = cdp(ws);
  await send("Runtime.enable");
  await send("Log.enable");

  const evaluate = async (expr) => {
    const res = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      return {
        __error: res.exceptionDetails.text + " :: " + (res.exceptionDetails.exception?.description ?? ""),
      };
    }
    return res.result.value;
  };

  const report = {};

  // ---- 1. Tauri 运行时 ----
  report.tauriAvailable = await evaluate(`"__TAURI_INTERNALS__" in window`);

  // ---- 2. env_info ----
  report.envInfo = await evaluate(`(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("env_info");
  })()`);

  // ---- 3. list_chipsets ----
  report.chipsets = await evaluate(`(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const r = await invoke("list_chipsets");
    return { code: r.code, count: r.lines.length, first: r.lines[0], stderr: r.stderr };
  })()`);

  // ---- 4. list_items ----
  report.items = await evaluate(`(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const r = await invoke("list_items", { chipset: "mt6572/mt6582/mt6592 kernel-3.4.67" });
    return { code: r.code, count: r.lines.length, sample: r.lines.slice(0, 4), stderr: r.stderr };
  })()`);

  // ---- 5. 等待 UI 完成启动自检，读取真实 DOM 状态 ----
  await sleep(2500);
  report.initialUi = await evaluate(`(() => {
    const txt = (el) => (el?.textContent ?? "").trim().replace(/\\s+/g, " ");
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const chipSelect = document.querySelector(".MuiSelect-select");
    return {
      sidebarVersion: q("nav .MuiTypography-body2").map(txt).slice(0, 6),
      chipsetLabel: chipSelect ? txt(chipSelect) : null,
      itemCount: q("input[type=checkbox]").length,
      checkboxesChecked: q("input[type=checkbox]:checked").length,
      errorBanner: q(".MuiAlert-message").map(txt),
      startButtonDisabled: !!Array.from(q("button")).find((b) => txt(b) === "开始移植")?.disabled,
    };
  })()`);

  // ---- 6. 通过 UI 切换到「仅移植内核」方案，验证条目重建 ----
  report.switchChipset = await evaluate(`(async () => {
    const txt = (el) => (el?.textContent ?? "").trim();
    const select = document.querySelector(".MuiSelect-select");
    if (!select) return { ok: false, reason: "未找到方案选择器" };
    select.click();
    await new Promise((r) => setTimeout(r, 400));
    const opts = Array.from(document.querySelectorAll('[role="option"]'));
    const target = opts.find((o) => txt(o).includes("仅移植内核"));
    if (!target) return { ok: false, reason: "未找到目标方案", options: opts.map(txt) };
    target.click();
    await new Promise((r) => setTimeout(r, 1500));
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    return {
      ok: true,
      chipsetLabel: txt(document.querySelector(".MuiSelect-select")),
      itemCount: q("input[type=checkbox]").length,
      zipOutDisabled: !!Array.from(q("button")).find((b) => txt(b) === "ZIP 卡刷包")?.disabled,
      baseSystemPresent: document.body.innerText.includes("底包 system.img"),
    };
  })()`);

  // ---- 7. 发起一次必然失败的移植，验证日志流与退出码 ----
  report.jobRun = await evaluate(`(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    const lines = [];
    const jobId = "probe-" + Date.now();
    const unlistenLine = await listen("job://line", (e) => {
      if (e.payload.jobId === jobId) lines.push(e.payload.line);
    });
    const done = new Promise((resolve) => {
      listen("job://done", (e) => {
        if (e.payload.jobId === jobId) resolve(e.payload.code);
      });
    });
    try {
      await invoke("start_job", {
        jobId,
        args: ["port", "--chipset", "mtk6572", "--base-boot", "D:\\\\__missing__.img"],
      });
    } catch (e) {
      return { startError: String(e) };
    }
    const doneCode = await Promise.race([done, new Promise((r) => setTimeout(() => r("timeout"), 25000))]);
    unlistenLine();
    return {
      doneCode,
      lineCount: lines.length,
      lines: lines.slice(0, 6),
      hasParamError: lines.some((l) => l.includes("【参数错误】")),
    };
  })()`);

  await sleep(1500);
  report.finalUi = await evaluate(`(() => {
    const txt = (el) => (el?.textContent ?? "").trim().replace(/\\s+/g, " ");
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const countCaption = q(".MuiTypography-caption").map(txt).find((t) => /^\\d+ 行$/.test(t));
    return {
      logLineCaption: countCaption ?? null,
      logText: (document.querySelector(".log-surface")?.innerText ?? "").slice(0, 700),
      chips: q(".MuiChip-label").map(txt),
    };
  })()`);

  const errors = events
    .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
    .map((e) => e.params.entry.text);
  const exceptions = events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params.exceptionDetails.text + " :: " + (e.params.exceptionDetails.exception?.description ?? ""));

  console.log(JSON.stringify({ ...report, consoleErrors: errors, exceptions }, null, 2));
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("联调校验失败：", e.message);
  process.exit(1);
});
