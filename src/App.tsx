import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import BrightnessAutoOutlinedIcon from "@mui/icons-material/BrightnessAutoOutlined";
import TerminalOutlinedIcon from "@mui/icons-material/TerminalOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import MenuOpenOutlinedIcon from "@mui/icons-material/MenuOpenOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import CircularProgress from "@mui/material/CircularProgress";

import Sidebar from "./components/Sidebar";
import LogPanel from "./components/LogPanel";
import PortPage from "./pages/PortPage";
import LkPage from "./pages/LkPage";
import ToolsPage from "./pages/ToolsPage";
import Toasts from "./components/Toasts";
import { useApp, type NavKey } from "./store";
import { openPath } from "./api";

const TITLES: Record<NavKey, string> = {
  port: "移植工作台",
  lk: "LK 去警告",
  tools: "工具与自查",
};

export default function App() {
  const nav = useApp((s) => s.nav);
  const logsOpen = useApp((s) => s.logsOpen);
  const setLogsOpen = useApp((s) => s.setLogsOpen);
  const running = useApp((s) => s.running);
  const envError = useApp((s) => s.envError);
  const refreshEnv = useApp((s) => s.refreshEnv);
  const lastOutDir = useApp((s) => s.lastOutDir);
  const refreshOutDir = useApp((s) => s.refreshOutDir);
  const themeMode = useApp((s) => s.themeMode);
  const setThemeMode = useApp((s) => s.setThemeMode);
  const themeLoading = useApp((s) => s.themeLoading);
  const refreshWallpaperTheme = useApp((s) => s.refreshWallpaperTheme);
  const sidebarCollapsed = useApp((s) => s.sidebarCollapsed);
  const toggleSidebar = useApp((s) => s.toggleSidebar);

  const theme = useTheme();
  // 三档自适应：宽屏常驻日志面板 / 中屏抽屉 / 窄屏收起侧栏
  const roomy = useMediaQuery(theme.breakpoints.up("xl")); // ≥1536
  const compact = useMediaQuery(theme.breakpoints.up("md")); // ≥900
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    void refreshEnv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", h);
    return () => document.removeEventListener("contextmenu", h);
  }, []);

  useEffect(() => {
    if (!running) void refreshOutDir();
  }, [running, refreshOutDir]);

  const ThemeIcon =
    themeMode === "light"
      ? LightModeOutlinedIcon
      : themeMode === "dark"
        ? DarkModeOutlinedIcon
        : BrightnessAutoOutlinedIcon;
  const themeLabel = themeMode === "light" ? "浅色" : themeMode === "dark" ? "深色" : "跟随系统";

  const cycleTheme = () => {
    setThemeMode(themeMode === "light" ? "dark" : themeMode === "dark" ? "auto" : "light");
  };

  const body = useMemo(() => {
    if (nav === "port") return <PortPage />;
    if (nav === "lk") return <LkPage />;
    return <ToolsPage />;
  }, [nav]);

  const logPane = <LogPanel />;
  const showInlineLogs = roomy && logsOpen;

  return (
    <Box sx={{ height: "100vh", display: "flex", bgcolor: "background.default" }}>
      {compact && (
        <Sidebar
          active={nav}
          onNavigate={useApp.getState().setNav}
          collapsed={sidebarCollapsed}
        />
      )}

      {!compact && (
        <Drawer
          open={navOpen}
          onClose={() => setNavOpen(false)}
          slotProps={{ paper: { sx: { bgcolor: "background.paper" } } }}
        >
          <Sidebar active={nav} onNavigate={(k) => { useApp.getState().setNav(k); setNavOpen(false); }} />
        </Drawer>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* ---------- 顶栏：只放标题与全局动作 ---------- */}
        <Paper
          square
          sx={{
            px: { xs: 1.5, md: 2.5 },
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
            bgcolor: "background.default",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Tooltip
            title={
              compact
                ? sidebarCollapsed
                  ? "展开侧边栏"
                  : "收起侧边栏"
                : "打开导航菜单"
            }
          >
            <IconButton onClick={() => (compact ? toggleSidebar() : setNavOpen(true))}>
              {compact && sidebarCollapsed ? (
                <MenuOutlinedIcon fontSize="small" />
              ) : (
                <MenuOpenOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>

          <Typography variant="h5" sx={{ flex: 1, minWidth: 0 }} noWrap>
            {TITLES[nav]}
          </Typography>

          {running && (
            <Button
              size="small"
              variant="text"
              onClick={() => void refreshOutDir()}
              sx={{ bgcolor: "action.hover", color: "text.secondary", minWidth: 0 }}
            >
              任务进行中
            </Button>
          )}

          <Tooltip title={lastOutDir ? `打开输出目录：${lastOutDir}` : "暂无输出目录"}>
            <span>
              <IconButton disabled={!lastOutDir} onClick={() => lastOutDir && void openPath(lastOutDir)}>
                <FolderOpenOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={`外观：${themeLabel}（点击切换）`}>
            <IconButton onClick={cycleTheme}>
              <ThemeIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={themeLoading ? "正在从壁纸取色…" : "重新从壁纸取色（主色跟随桌面壁纸）"}>
            <span>
              <IconButton
                disabled={themeLoading}
                onClick={() => void refreshWallpaperTheme()}
                color={themeLoading ? "primary" : "default"}
              >
                {themeLoading ? (
                  <CircularProgress size={16} thickness={5} color="inherit" />
                ) : (
                  <PaletteOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={showInlineLogs ? "收起日志面板" : "展开日志面板"}>
            <IconButton
              onClick={() => (roomy ? setLogsOpen(!logsOpen) : setDrawerOpen(true))}
              color={showInlineLogs ? "primary" : "default"}
            >
              <TerminalOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Paper>

        {envError && (
          <Paper
            square
            sx={{
              px: { xs: 1.5, md: 2.5 },
              py: 0.75,
              bgcolor: "error.main",
              color: "error.contrastText",
              display: "flex",
              alignItems: "center",
              gap: 1.5,
            }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {envError}
            </Typography>
            <Button size="small" onClick={() => void refreshEnv()} sx={{ color: "inherit" }}>
              重试
            </Button>
          </Paper>
        )}

        {/* ---------- 内容 + 日志 ---------- */}
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1.5, p: { xs: 1.5, md: 2 }, pt: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto" }}>{body}</Box>

          {showInlineLogs && (
            <Box sx={{ width: 380, flexShrink: 0, minHeight: 0 }}>{logPane}</Box>
          )}
        </Box>
      </Box>

      {!roomy && (
        <Drawer
          anchor="right"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          slotProps={{
            paper: {
              sx: { width: "min(94vw, 520px)", p: 1.5, bgcolor: "background.default" },
            },
          }}
        >
          <Box sx={{ height: "100%", minHeight: 0 }}>{logPane}</Box>
        </Drawer>
      )}

      <Toasts />
    </Box>
  );
}
