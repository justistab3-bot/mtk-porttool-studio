//! MTK 移植工作室 —— Tauri 后端（UI 外壳侧）
//!
//! 设计约束：**本文件只做进程编排，不复制任何后端逻辑**。
//! 全部移植 / LK 去警告 / 文件系统自查能力都通过 `porttool_cli.py`
//! 这个既有 CLI 桥接接口调用（规范见 tools/mtk-garbage-porttool-master/TASK_UI_SHELL.md）。
//!
//! 数据流：
//!   React 前端  --invoke-->  本模块  --std::process-->  python porttool_cli.py
//!              <--event---          <--stdout 逐行---
//!
//! 退出码语义（与 CLI 规范一致）：0=成功 / 1=参数·校验错误 / 2=执行失败

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

mod theme;

/// Windows 下隐藏子进程控制台窗口（避免黑框闪现）。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ============================================================
// 工具目录定位
// ============================================================

/// 剥掉 Windows 扩展长度路径前缀（`\\?\` / `\\?\UNC\`），
/// 否则该前缀会被当作参数传给 Python，导致路径解析失败。
fn strip_extended_prefix(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = p.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    p.to_string()
}

fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p)
        .map(|c| PathBuf::from(strip_extended_prefix(&c.to_string_lossy())))
        .unwrap_or_else(|_| p.to_path_buf())
}

/// 候选工具目录（按优先级）：
///   1. 环境变量 `MTK_PORTTOOL_HOME` 指向的目录（可指向 `.../mtk-garbage-porttool-master`）
///   2. 开发态：`src-tauri/../tools/mtk-garbage-porttool-master`
///   3. 发布态：`<exe>/tools/mtk-garbage-porttool-master`（resources 解包位置）
///   4. 发布态：`<exe>/resources/tools/mtk-garbage-porttool-master`
///   5. 任意可用的 Tauri resource_dir 下的 `tools/...`
fn tool_dir_candidates(app: &AppHandle) -> Vec<PathBuf> {
    const REL: &str = "mtk-garbage-porttool-master";
    let mut out: Vec<PathBuf> = Vec::new();

    if let Ok(home) = std::env::var("MTK_PORTTOOL_HOME") {
        let h = PathBuf::from(home);
        // 允许直接指向工具目录，或指向其父目录
        out.push(h.join(REL));
        out.push(h.clone());
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest.parent() {
        out.push(root.join("tools").join(REL));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("tools").join(REL));
            out.push(dir.join("resources").join("tools").join(REL));
        }
    }

    if let Ok(res) = app.path().resource_dir() {
        out.push(res.join("tools").join(REL));
    }

    out
}

/// 解析出的运行环境快照，注入 Tauri 状态供各命令复用。
struct EnvState {
    tool_dir: PathBuf,
    python: String,
    /// 工具目录是从只读安装位置复制过来的（用于在界面上提示用户）
    relocated: bool,
}

/// 目录是否可写：实际建一个临时文件来验证，比看只读属性更可靠。
fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".mtk-write-probe");
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 递归复制工具目录（跳过上一次运行产生的产物与缓存）。
fn copy_tool_dir(src: &Path, dst: &Path) -> Result<(), String> {
    const SKIP: [&str; 3] = ["out", "base", "tmp"];
    std::fs::create_dir_all(dst).map_err(|e| format!("创建 {} 失败：{e}", dst.display()))?;
    let entries = std::fs::read_dir(src).map_err(|e| format!("读取 {} 失败：{e}", src.display()))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        let from = entry.path();
        let to = dst.join(&name);
        if from.is_dir() {
            if SKIP.contains(&name_str.as_str()) {
                continue;
            }
            copy_tool_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("复制 {} 失败：{e}", from.display()))?;
        }
    }
    Ok(())
}

/// 若工具目录不可写（典型场景：安装到 Program Files），把它复制到用户可写目录，
/// 之后所有解包与产物都写在那里。复制是幂等的：目标已存在且版本一致时跳过。
fn ensure_writable_tool_dir(app: &AppHandle, src: &Path, version: &str) -> (PathBuf, bool) {
    if is_writable(src) {
        return (src.to_path_buf(), false);
    }

    let base = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("MTKPorttoolStudio"));
    let dst = base.join("tools").join("mtk-garbage-porttool-master");

    // 版本标记：源目录 + 工具版本，二者任一变化才重新复制
    let stamp = dst.join(".copied-from");
    let want = format!("{}\n{}", src.display(), version);
    if dst.join("porttool_cli.py").is_file() {
        if let Ok(existing) = std::fs::read_to_string(&stamp) {
            if existing.trim() == want.trim() {
                return (dst, true);
            }
        }
    }

    match copy_tool_dir(src, &dst) {
        Ok(()) => {
            let _ = std::fs::write(&stamp, &want);
            (dst, true)
        }
        Err(e) => {
            // 复制失败则退回原目录：至少查询类功能仍可用，写入会在 CLI 侧报错
            eprintln!("[MTK Studio] 工具目录复制失败，回退到只读目录：{e}");
            (src.to_path_buf(), false)
        }
    }
}

fn resolve_tool_dir(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    for cand in tool_dir_candidates(app) {
        let cli = cand.join("porttool_cli.py");
        if cli.is_file() {
            let dir = canon(&cand);
            // 先读版本号（查询接口不写盘），再决定是否需要搬到可写位置
            let version = read_tool_version(&dir).unwrap_or_default();
            return Ok(ensure_writable_tool_dir(app, &dir, &version));
        }
    }
    Err("未找到后端工具目录（缺少 porttool_cli.py）。请确认 tools/mtk-garbage-porttool-master 随应用一同分发。".into())
}

/// 读取工具版本（`--version`），用于复制标记。
fn read_tool_version(tool_dir: &Path) -> Option<String> {
    let python = detect_python();
    let mut parts = python.split_whitespace();
    let exe = parts.next()?;
    let mut cmd = Command::new(exe);
    cmd.args(parts)
        .arg("porttool_cli.py")
        .arg("--version")
        .current_dir(tool_dir);
    cmd.env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Python 解释器探测：`python` → `python3` → `py -3`（Windows launcher）。
fn detect_python() -> String {
    let probes: [&[&str]; 3] = [&["python"], &["python3"], &["py", "-3"]];
    for probe in probes {
        let mut cmd = Command::new(probe[0]);
        cmd.args(&probe[1..]).arg("--version");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let text = if text.is_empty() {
                    String::from_utf8_lossy(&out.stderr).trim().to_string()
                } else {
                    text
                };
                if text.starts_with("Python") {
                    return probe.join(" ");
                }
            }
        }
    }
    "python".to_string()
}

// ============================================================
// 子进程构造
// ============================================================

/// 构造一个已 chdir 到工具目录、隐藏窗口、管道化的 CLI 进程。
/// `python` 可能是 `py -3` 这种带空格的启动器，故按空格拆分。
fn build_cli(env: &EnvState, args: &[String]) -> Result<Command, String> {
    let mut parts = env.python.split_whitespace();
    let exe = parts
        .next()
        .ok_or_else(|| "Python 解释器未配置".to_string())?;
    let mut cmd = Command::new(exe);
    cmd.args(parts);
    cmd.arg("porttool_cli.py");
    cmd.args(args);
    cmd.current_dir(&env.tool_dir);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // 强制 UTF-8：CLI 侧已 reconfigure stdout/stderr，这里同时固定 PYTHONIOENCODING
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

/// 以 GBK 兜底解码：部分 Python 异常输出在 Windows 上仍是本地代码页。
fn decode_utf8_lossy_else_gbk(bytes: &[u8]) -> String {
    match String::from_utf8(bytes.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            let (cow, _, _) = encoding_rs::GBK.decode(bytes);
            cow.into_owned()
        }
    }
}

// ============================================================
// 查询命令（短进程，同步返回）
// ============================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub code: i32,
    pub lines: Vec<String>,
    pub stderr: String,
}

fn run_query(env: &EnvState, args: &[String]) -> QueryResult {
    let mut cmd = match build_cli(env, args) {
        Ok(c) => c,
        Err(e) => {
            return QueryResult {
                code: -1,
                lines: Vec::new(),
                stderr: e,
            }
        }
    };
    match cmd.output() {
        Ok(out) => QueryResult {
            code: out.status.code().unwrap_or(-1),
            lines: decode_utf8_lossy_else_gbk(&out.stdout)
                .lines()
                .map(|l| l.trim_end().to_string())
                .collect(),
            stderr: decode_utf8_lossy_else_gbk(&out.stderr).trim().to_string(),
        },
        Err(e) => QueryResult {
            code: -1,
            lines: Vec::new(),
            stderr: format!("无法启动 Python 进程：{e}"),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    pub tool_dir: String,
    pub python: String,
    pub version: String,
    pub ready: bool,
    /// 工具目录不可写时已复制到用户目录（安装版常见情形）
    pub relocated: bool,
    pub error: Option<String>,
}

/// 环境自检：定位工具目录、探测解释器、读取工具版本。
#[tauri::command]
fn env_info(state: State<'_, Arc<EnvState>>) -> EnvInfo {
    let version = run_query(&state, &["--version".into()]);
    EnvInfo {
        tool_dir: state.tool_dir.to_string_lossy().to_string(),
        python: state.python.clone(),
        version: version.lines.first().cloned().unwrap_or_default(),
        ready: version.code == 0 && !version.lines.is_empty(),
        relocated: state.relocated,
        error: if version.code == 0 {
            None
        } else if version.stderr.is_empty() {
            Some("后端 CLI 未返回版本号，请确认 Python 环境可用".into())
        } else {
            Some(version.stderr)
        },
    }
}

/// 方案列表（壳动态构建"芯片类型"选择器）。
#[tauri::command]
fn list_chipsets(state: State<'_, Arc<EnvState>>) -> QueryResult {
    run_query(&state, &["--chipsets".into()])
}

/// 某方案的移植条目默认值（`KEY=true|false` 每行一条）。
#[tauri::command]
fn list_items(state: State<'_, Arc<EnvState>>, chipset: String) -> QueryResult {
    run_query(&state, &["--items".into(), "--chipset".into(), chipset])
}

// ============================================================
// 长任务命令（流式日志 → 事件）
// ============================================================

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent {
    job_id: String,
    /// "stdout" | "stderr"
    stream: String,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneEvent {
    job_id: String,
    /// 0=成功 / 1=参数·校验错误 / 2=执行失败 / -1=进程启动失败 / -2=被中止
    code: i32,
}

/// 运行中的子进程句柄表，供 `cancel_job` 终止。
/// 内层 Arc 让等待线程可以持有自己的引用，不必借用 `State`。
#[derive(Default)]
struct JobRegistry(Mutex<HashMap<String, u32>>);

type SharedRegistry = Arc<JobRegistry>;

#[tauri::command]
fn start_job(
    app: AppHandle,
    state: State<'_, Arc<EnvState>>,
    registry: State<'_, SharedRegistry>,
    job_id: String,
    args: Vec<String>,
) -> Result<(), String> {
    let mut cmd = build_cli(&state, &args)?;
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 Python 进程（{}）：{e}", state.python))?;

    let pid = child.id();
    // 取出共享句柄表：State 的借用无法跨线程，Arc 可以。
    let registry: SharedRegistry = (*registry).clone();
    registry.0.lock().unwrap().insert(job_id.clone(), pid);

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_out = app.clone();
    let job_out = job_id.clone();
    let out_thread = stdout.map(|s| {
        std::thread::spawn(move || {
            for line in BufReader::new(s).split(b'\n') {
                match line {
                    Ok(bytes) => {
                        let text = decode_utf8_lossy_else_gbk(&bytes);
                        let _ = app_out.emit(
                            "job://line",
                            LogEvent {
                                job_id: job_out.clone(),
                                stream: "stdout".into(),
                                line: text.trim_end_matches('\r').to_string(),
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        })
    });

    let app_err = app.clone();
    let job_err = job_id.clone();
    let err_thread = stderr.map(|s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut reader = BufReader::new(s);
            let _ = reader.read_to_end(&mut buf);
            let text = decode_utf8_lossy_else_gbk(&buf);
            for line in text.lines() {
                let _ = app_err.emit(
                    "job://line",
                    LogEvent {
                        job_id: job_err.clone(),
                        stream: "stderr".into(),
                        line: line.trim_end().to_string(),
                    },
                );
            }
        })
    });

    // 等待子进程结束后回收，再广播完成事件（保证日志先于完成抵达前端）。
    std::thread::spawn(move || {
        let code = match child.wait() {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };
        if let Some(t) = out_thread {
            let _ = t.join();
        }
        if let Some(t) = err_thread {
            let _ = t.join();
        }
        registry.0.lock().unwrap().remove(&job_id);
        let _ = app.emit("job://done", DoneEvent { job_id, code });
    });

    Ok(())
}

/// 终止运行中的任务（tkinter 版靠禁用按钮防重复点击，这里提供真正的取消能力）。
#[tauri::command]
fn cancel_job(registry: State<'_, SharedRegistry>, job_id: String) -> Result<(), String> {
    let registry: SharedRegistry = (*registry).clone();
    let pid = registry.0.lock().unwrap().remove(&job_id);
    match pid {
        Some(pid) => {
            let mut cmd = Command::new("taskkill");
            #[cfg(windows)]
            cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
            #[cfg(not(windows))]
            cmd.args(["-TERM", &pid.to_string()]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let _ = cmd.status();
            Ok(())
        }
        None => Err("该任务已结束".into()),
    }
}

/// 后端工具目录（供前端展示、以及定位 out/ 时间戳目录）。
#[tauri::command]
fn tool_root(state: State<'_, Arc<EnvState>>) -> String {
    state.tool_dir.to_string_lossy().to_string()
}

/// 列出 out/ 下最新的产物目录（移植/LK 产物按时间戳落盘）。
#[tauri::command]
fn latest_out_dir(state: State<'_, Arc<EnvState>>) -> Option<String> {
    let out = state.tool_dir.join("out");
    let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(&out)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let m = e.metadata().ok()?.modified().ok()?;
            Some((m, e.path()))
        })
        .collect();
    dirs.sort_by(|a, b| b.0.cmp(&a.0));
    dirs.first().map(|(_, p)| p.to_string_lossy().to_string())
}

/// 从当前桌面壁纸提取主色并生成 MD3 色彩系统（前端主题的默认来源）。
#[tauri::command]
fn wallpaper_palette() -> Result<theme::WallpaperPalette, String> {
    theme::palette_from_wallpaper()
}

/// 由用户指定的色相生成同一套 MD3 色彩系统（设置页的"自定义主色"）。
/// 复用壁纸取色的同一实现，保证两种来源产出的色板结构完全一致。
#[tauri::command]
fn hue_palette(hue: f64, chroma: Option<f64>) -> theme::WallpaperPalette {
    theme::palette_from_hue(hue, chroma.unwrap_or(0.15))
}

// ============================================================
// 启动
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(JobRegistry::default()) as SharedRegistry)
        .setup(|app| {
            // 取色结果缓存到应用数据目录：4K 壁纸首次解码要数秒，缓存后重复启动秒开
            if let Ok(dir) = app.path().app_local_data_dir() {
                theme::set_cache_dir(dir);
            }

            // 工具目录定位失败不阻塞启动：前端会通过 env_info 展示诊断信息。
            let handle = app.handle().clone();
            let state = match resolve_tool_dir(&handle) {
                Ok((dir, relocated)) => EnvState {
                    tool_dir: dir,
                    python: detect_python(),
                    relocated,
                },
                Err(msg) => {
                    eprintln!("[MTK Studio] {msg}");
                    EnvState {
                        tool_dir: PathBuf::from("."),
                        python: detect_python(),
                        relocated: false,
                    }
                }
            };
            println!(
                "[MTK Studio] tool_dir = {} | python = {} | relocated = {}",
                state.tool_dir.display(),
                state.python,
                state.relocated
            );
            app.manage(Arc::new(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            env_info,
            list_chipsets,
            list_items,
            start_job,
            cancel_job,
            tool_root,
            latest_out_dir,
            wallpaper_palette,
            hue_palette,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ============================================================
// 测试：验证外壳与后端 CLI 的真实交互契约
//
// 这些测试直接运行 `porttool_cli.py`（需要本机 Python），因此能覆盖
// 「进程编排 + 退出码裁决 + 编码回退」这条外壳最关键的链路。
// 不产生任何移植产物：只用查询命令与必然失败的参数校验。
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("crate 应位于项目子目录中")
            .join("tools")
            .join("mtk-garbage-porttool-master")
    }

    fn env() -> EnvState {
        EnvState {
            tool_dir: tool_dir(),
            python: detect_python(),
            relocated: false,
        }
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn writable_probe_matches_reality() {
        // 项目内的工具目录应当可写
        assert!(is_writable(&tool_dir()), "项目内工具目录应可写");
        // 不存在的目录不可写（create 会失败）
        assert!(!is_writable(&tool_dir().join("__no_such_subdir__")));
    }

    #[test]
    fn copy_tool_dir_skips_runtime_outputs() {
        let src = std::env::temp_dir().join("mtk-copy-test-src");
        let dst = std::env::temp_dir().join("mtk-copy-test-dst");
        let _ = std::fs::remove_dir_all(&src);
        let _ = std::fs::remove_dir_all(&dst);

        std::fs::create_dir_all(src.join("porttool")).unwrap();
        std::fs::create_dir_all(src.join("out")).unwrap();
        std::fs::create_dir_all(src.join("base")).unwrap();
        std::fs::create_dir_all(src.join("tmp")).unwrap();
        std::fs::write(src.join("porttool_cli.py"), b"# cli").unwrap();
        std::fs::write(src.join("porttool").join("__init__.py"), b"# pkg").unwrap();
        std::fs::write(src.join("out").join("boot.img"), b"artifact").unwrap();

        copy_tool_dir(&src, &dst).expect("复制应成功");

        assert!(dst.join("porttool_cli.py").is_file());
        assert!(dst.join("porttool").join("__init__.py").is_file());
        // 运行产物与缓存不应被搬过去
        assert!(!dst.join("out").exists(), "out/ 不应被复制");
        assert!(!dst.join("base").exists(), "base/ 不应被复制");
        assert!(!dst.join("tmp").exists(), "tmp/ 不应被复制");

        let _ = std::fs::remove_dir_all(&src);
        let _ = std::fs::remove_dir_all(&dst);
    }

    #[test]
    fn tool_dir_contains_cli() {
        let dir = tool_dir();
        assert!(
            dir.join("porttool_cli.py").is_file(),
            "缺少 porttool_cli.py：{}",
            dir.display()
        );
        assert!(dir.join("porttool").is_dir(), "缺少 porttool 包目录");
    }

    #[test]
    fn detect_python_reports_usable_interpreter() {
        let py = detect_python();
        assert!(!py.is_empty());
        let out = Command::new(py.split_whitespace().next().unwrap())
            .arg("--version")
            .output();
        assert!(out.is_ok(), "Python 解释器不可用：{py}");
    }

    #[test]
    fn version_query_returns_semver() {
        let r = run_query(&env(), &args(&["--version"]));
        assert_eq!(r.code, 0, "stderr={}", r.stderr);
        let v = r.lines.first().expect("应返回一行版本号");
        assert!(v.starts_with("1."), "意外的版本号：{v}");
    }

    #[test]
    fn chipsets_query_returns_presets() {
        let r = run_query(&env(), &args(&["--chipsets"]));
        assert_eq!(r.code, 0, "stderr={}", r.stderr);
        assert!(r.lines.len() >= 8, "方案数量异常：{}", r.lines.len());
        assert!(
            r.lines.iter().any(|l| l.contains("mt6572")),
            "方案列表缺少 mt6572 系列"
        );
        assert!(r.lines.iter().any(|l| l.contains("LK")), "方案列表缺少 LK 方案");
    }

    #[test]
    fn items_query_parses_key_value_lines() {
        let r = run_query(
            &env(),
            &args(&["--items", "--chipset", "mt6572/mt6582/mt6592 kernel-3.4.67"]),
        );
        assert_eq!(r.code, 0, "stderr={}", r.stderr);
        assert!(r.lines.len() > 10, "条目数量异常：{}", r.lines.len());
        assert!(
            r.lines.iter().all(|l| l.contains('=')),
            "条目行必须形如 KEY=true/false"
        );
        assert!(
            r.lines.iter().any(|l| l.starts_with("replace_kernel=")),
            "缺少 replace_kernel 条目"
        );
    }

    #[test]
    fn unknown_chipset_is_argument_error() {
        let r = run_query(
            &env(),
            &args(&[
                "port",
                "--chipset",
                "不存在的方案",
                "--base-boot",
                "x.img",
                "--donor-boot",
                "y.img",
            ]),
        );
        assert_eq!(r.code, 1, "未知方案必须返回退出码 1");
    }

    #[test]
    fn missing_image_is_argument_error() {
        let r = run_query(
            &env(),
            &args(&[
                "port",
                "--chipset",
                "mt6572/mt6582/mt6592 kernel-3.4.67",
                "--base-boot",
                "D:\\__no_such_boot__.img",
                "--donor-boot",
                "D:\\__no_such_boot2__.img",
            ]),
        );
        assert_eq!(r.code, 1, "缺失文件必须返回退出码 1");
        assert!(
            r.lines.iter().any(|l| l.contains("【参数错误】")),
            "日志应含【参数错误】标记"
        );
    }

    #[test]
    fn zip_output_requires_zip_source() {
        let r = run_query(
            &env(),
            &args(&[
                "port",
                "--chipset",
                "mt6572/mt6582/mt6592 kernel-3.4.67",
                "--base-boot",
                "D:\\__no_such_boot__.img",
                "--donor-boot",
                "D:\\__no_such_boot2__.img",
                "--out-type",
                "zip",
            ]),
        );
        assert_eq!(r.code, 1, "zip 输出 + img 源必须被拒绝");
    }

    #[test]
    fn missing_lk_folder_is_argument_error() {
        let r = run_query(&env(), &args(&["lk", "scan", "--folder", "D:\\__no_such_dir__"]));
        assert_eq!(r.code, 1, "LK 目录缺失必须返回退出码 1");
    }

    #[test]
    fn extended_path_prefix_is_stripped() {
        assert_eq!(strip_extended_prefix(r"\\?\D:\a\b"), r"D:\a\b");
        assert_eq!(strip_extended_prefix(r"\\?\UNC\srv\share"), r"\\srv\share");
        assert_eq!(strip_extended_prefix(r"D:\plain"), r"D:\plain");
    }

    #[test]
    fn decoding_handles_utf8_and_gbk() {
        assert_eq!(decode_utf8_lossy_else_gbk("中文日志".as_bytes()), "中文日志");
        let (gbk, _, _) = encoding_rs::GBK.encode("中文日志");
        assert_eq!(decode_utf8_lossy_else_gbk(&gbk), "中文日志");
    }

    #[test]
    fn build_cli_targets_tool_directory() {
        let env = env();
        let cmd = build_cli(&env, &args(&["--version"])).expect("构造命令");

        // 程序名 = 探测到的 Python 解释器，第一个参数 = CLI 入口
        let program = cmd.get_program().to_string_lossy().to_lowercase();
        assert!(
            program.contains("python") || program == "py",
            "程序名应为 Python 解释器：{program}"
        );
        let argv: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(argv.first().map(String::as_str), Some("porttool_cli.py"));
        assert!(argv.iter().any(|a| a == "--version"));

        // 工作目录必须锁定在工具目录，否则 CLI 的相对路径解析会错位
        let cwd = cmd.get_current_dir().expect("必须显式设置工作目录");
        assert_eq!(cwd, env.tool_dir);
        assert!(cwd.join("porttool_cli.py").is_file());
    }
}
