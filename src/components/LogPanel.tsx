import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import { alpha, useTheme, type Theme } from "@mui/material/styles";

import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import VerticalAlignBottomOutlinedIcon from "@mui/icons-material/VerticalAlignBottomOutlined";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import TerminalOutlinedIcon from "@mui/icons-material/TerminalOutlined";

import { useApp, type LogLevel } from "../store";

/** 一次最多渲染的日志行数：避免长任务（上万行）拖慢 webview。 */
const RENDER_LIMIT = 1500;

const LEVEL_COLOR: Record<LogLevel, (t: Theme) => string> = {
  info: (t) => t.palette.text.secondary,
  step: (t) => t.md3.tertiary,
  success: (t) => (t.palette.mode === "light" ? "#1B6E3C" : "#7DDBA0"),
  warn: (t) => (t.palette.mode === "light" ? "#8A5A00" : "#F2C46B"),
  error: (t) => t.palette.error.main,
  stderr: (t) => (t.palette.mode === "light" ? "#8A3A00" : "#FFB077"),
};

const TAG_BG: Partial<Record<LogLevel, number>> = {
  step: 0.14,
  success: 0.14,
  warn: 0.16,
  error: 0.14,
  stderr: 0.14,
};

export default function LogPanel() {
  const logs = useApp((s) => s.logs);
  const clearLogs = useApp((s) => s.clearLogs);
  const copyLogs = useApp((s) => s.copyLogs);
  const pushToast = useApp((s) => s.pushToast);
  const autoScroll = useApp((s) => s.autoScroll);
  const setAutoScroll = useApp((s) => s.setAutoScroll);
  const running = useApp((s) => s.running);
  const lastResult = useApp((s) => s.lastResult);
  const cancelRunning = useApp((s) => s.cancelRunning);
  const theme = useTheme();

  const surfaceRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const visible = useMemo(() => logs.slice(-RENDER_LIMIT), [logs]);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || !autoScroll || !stickRef.current) return;
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, autoScroll]);

  const onScroll = () => {
    const el = surfaceRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    stickRef.current = near;
    setAtBottom(near);
  };

  const jumpToBottom = () => {
    const el = surfaceRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setAtBottom(true);
  };

  const statusChip = () => {
    if (running) {
      return (
        <Chip
          size="small"
          icon={<CircularProgress size={10} thickness={6} color="inherit" />}
          label="执行中"
          sx={{ bgcolor: alpha(theme.md3.tertiary, 0.16), color: theme.md3.tertiary }}
        />
      );
    }
    if (!lastResult) return null;
    const ok = lastResult.code === 0;
    const label = ok ? "成功" : lastResult.code === 1 ? "参数错误" : `失败 ${lastResult.code}`;
    return (
      <Chip
        size="small"
        label={label}
        sx={{
          bgcolor: ok
            ? alpha("#1B6E3C", 0.16)
            : alpha(theme.palette.error.main, 0.16),
          color: ok
            ? theme.palette.mode === "light"
              ? "#1B6E3C"
              : "#7DDBA0"
            : theme.palette.error.main,
        }}
      />
    );
  };

  return (
    <Paper
      elevation={0}
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 1.5,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        overflow: "hidden",
      }}
    >
      {/* 头部 */}
      <Box sx={{ px: 1.5, py: 0.75, display: "flex", alignItems: "center", gap: 0.75 }}>
        <TerminalOutlinedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          任务日志
        </Typography>
        {statusChip()}
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {logs.length}
        </Typography>
      </Box>
      <Divider />

      {/* 日志正文 */}
      <Box
        ref={surfaceRef}
        onScroll={onScroll}
        className="log-surface"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          px: 1.5,
          py: 0.75,
          bgcolor: "background.default",
        }}
      >
        {logs.length === 0 && (
          <Box sx={{ display: "grid", placeItems: "center", height: "100%" }}>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", px: 2 }}>
              尚无日志。发起一次移植或 LK 处理，输出会实时出现在这里。
            </Typography>
          </Box>
        )}

        {logs.length > RENDER_LIMIT && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            （仅显示最近 {RENDER_LIMIT} 行，完整内容可用「复制」导出）
          </Typography>
        )}

        {visible.map((l) => {
          const color = LEVEL_COLOR[l.level](theme);
          const bg = TAG_BG[l.level];
          return (
            <Box key={l.id} className="log-line" sx={{ display: "flex", gap: 0.75 }}>
              <Box component="span" sx={{ color: "text.disabled", flexShrink: 0 }}>
                {l.time}
              </Box>
              {l.tag && (
                <Box
                  component="span"
                  sx={{
                    flexShrink: 0,
                    color,
                    fontWeight: 700,
                    borderRadius: 0.5,
                    px: 0.5,
                    bgcolor: bg !== undefined ? alpha(color, bg) : "transparent",
                  }}
                >
                  【{l.tag}】
                </Box>
              )}
              <Box
                component="span"
                sx={{ color: l.level === "info" ? "text.primary" : color, flex: 1, minWidth: 0 }}
              >
                {l.tag ? l.text.replace(/^【[^】]*】/, "") : l.text}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Divider />

      {/* 工具栏 */}
      <Box sx={{ px: 1, py: 0.5, display: "flex", alignItems: "center", gap: 0.25 }}>
        <Tooltip title="清空日志">
          <span>
            <IconButton disabled={logs.length === 0} onClick={clearLogs}>
              <DeleteSweepOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="复制全部日志">
          <span>
            <IconButton
              disabled={logs.length === 0}
              onClick={async () => {
                const ok = await copyLogs();
                pushToast(ok ? "日志已复制到剪贴板" : "复制失败，请手动选择日志文本", ok ? "success" : "error");
              }}
            >
              <ContentCopyOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={autoScroll ? "自动滚动：开" : "自动滚动：关"}>
          <IconButton
            color={autoScroll ? "primary" : "default"}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <VerticalAlignBottomOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {!atBottom && (
          <Tooltip title="回到底部">
            <IconButton onClick={jumpToBottom}>
              <VerticalAlignBottomOutlinedIcon sx={{ fontSize: 16, transform: "translateY(2px)" }} />
            </IconButton>
          </Tooltip>
        )}

        {running && (
          <Tooltip title="终止任务">
            <IconButton color="error" onClick={cancelRunning}>
              <StopCircleOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Paper>
  );
}
