import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";

import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import GitHubIcon from "@mui/icons-material/GitHub";
import StorefrontOutlinedIcon from "@mui/icons-material/StorefrontOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

import { useApp, type NavKey } from "../store";
import { openPath, openUrl } from "../api";

const REPOS = [
  { label: "GitHub 仓库", url: "https://github.com/LJY-33684/mtk-garbage-porttool-master", icon: GitHubIcon },
  { label: "Gitee 镜像", url: "https://gitee.com/Q3368436451/mtk-garbage-porttool-master", icon: StorefrontOutlinedIcon },
];

interface NavItem {
  key: NavKey;
  label: string;
  icon: SvgIconComponent;
  hint: string;
}

const NAV: NavItem[] = [
  { key: "port", label: "移植工作台", icon: MemoryOutlinedIcon, hint: "底包与移植源适配" },
  { key: "lk", label: "LK 去警告", icon: ShieldOutlinedIcon, hint: "橙/红警告与 5s 延时" },
  { key: "tools", label: "工具与自查", icon: HandymanOutlinedIcon, hint: "自查 · 更新 · 外观" },
];

interface SidebarProps {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  /** 收起态：仅显示图标，宽度收窄到 60px */
  collapsed?: boolean;
}

export default function Sidebar({ active, onNavigate, collapsed = false }: SidebarProps) {
  const env = useApp((s) => s.env);
  const running = useApp((s) => s.running);
  const lastOutDir = useApp((s) => s.lastOutDir);
  const themeSeed = useApp((s) => s.themeSeed);
  const themeSource = useApp((s) => s.themeSource);
  const theme = useTheme();

  const busyLabel =
    running === "port"
      ? "移植进行中"
      : running?.startsWith("lk")
        ? "LK 处理中"
        : running === "fscheck"
          ? "自查中"
          : running === "check-update"
            ? "检查更新中"
            : null;

  const statusColor = busyLabel
    ? theme.md3.tertiary
    : env?.ready
      ? theme.palette.success.main
      : theme.palette.error.main;

  // ---------- 收起态：图标条 ----------
  if (collapsed) {
    return (
      <Box
        component="nav"
        sx={{
          width: 60,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 1.5,
          gap: 0.5,
          bgcolor: "background.paper",
          borderRight: 1,
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        <Tooltip title="MTK 移植工作室" placement="right">
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: 1.5,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              mb: 1,
              flexShrink: 0,
            }}
          >
            <MemoryOutlinedIcon sx={{ fontSize: 18 }} />
          </Box>
        </Tooltip>

        {NAV.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <Tooltip key={item.key} title={item.label} placement="right">
              <ListItemButton
                selected={selected}
                onClick={() => onNavigate(item.key)}
                sx={{ minHeight: 40, width: 40, px: 0, justifyContent: "center" }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    justifyContent: "center",
                    color: selected ? "onSecondaryContainer" : "text.secondary",
                  }}
                >
                  <Icon sx={{ fontSize: 20 }} />
                </ListItemIcon>
              </ListItemButton>
            </Tooltip>
          );
        })}

        <Box sx={{ flex: 1, minHeight: 8 }} />

        <Tooltip
          title={busyLabel ?? (env?.ready ? `空闲 · 后端就绪（${env.version || "—"}）` : "后端未就绪")}
          placement="right"
        >
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: statusColor, flexShrink: 0 }} />
        </Tooltip>

        {lastOutDir && (
          <Tooltip title="打开最近产物目录" placement="right">
            <IconButton
              onClick={() => void openPath(lastOutDir)}
              sx={{ color: "text.secondary", borderRadius: 1.5, width: 30, height: 30 }}
            >
              <FolderOpenOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }

  return (
    <Box
      component="nav"
      sx={{
        width: 232,
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        px: 1.5,
        py: 1.75,
        bgcolor: "background.paper",
        borderRight: 1,
        borderColor: "divider",
      }}
    >
      {/* 品牌 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1, mb: 2 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: 1.5,
            display: "grid",
            placeItems: "center",
            bgcolor: "primary.main",
            color: "primary.contrastText",
            flexShrink: 0,
          }}
        >
          <MemoryOutlinedIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap sx={{ lineHeight: 1.2 }}>
            MTK 移植工作室
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            ROM Porting Studio
          </Typography>
        </Box>
      </Box>

      {/* 主导航 */}
      <List disablePadding sx={{ display: "grid", gap: 0.25 }}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <ListItemButton
              key={item.key}
              selected={selected}
              onClick={() => onNavigate(item.key)}
              sx={{ px: 1.5, py: 0.75, minHeight: 40 }}
            >
              <ListItemIcon
                sx={{ minWidth: 30, color: selected ? "onSecondaryContainer" : "text.secondary" }}
              >
                <Icon sx={{ fontSize: 19 }} />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={item.hint}
                primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
                secondaryTypographyProps={{ fontSize: 10.5, noWrap: true }}
              />
            </ListItemButton>
          );
        })}
      </List>

      <Divider sx={{ my: 1.75 }} />

      {/* 运行状态 */}
      <Box sx={{ px: 1.5, display: "grid", gap: 0.25 }}>
        <Typography variant="overline" color="text.secondary">
          运行状态
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25 }}>
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              flexShrink: 0,
              bgcolor: statusColor,
            }}
          />
          <Typography variant="body2" color="text.secondary" noWrap>
            {busyLabel ?? (env?.ready ? "空闲 · 后端就绪" : "后端未就绪")}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 8 }} />

      {/* 最近产物 */}
      {lastOutDir && (
        <Tooltip title={lastOutDir}>
          <Box
            component="button"
            onClick={() => void openPath(lastOutDir)}
            sx={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 0.75,
              mb: 1,
              borderRadius: 1.5,
              color: "text.secondary",
              "&:hover": { bgcolor: "action.hover", color: "text.primary" },
            }}
          >
            <FolderOpenOutlinedIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>
              最近产物目录
            </Typography>
          </Box>
        </Tooltip>
      )}

      {/* 环境摘要 */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: 1.5,
          bgcolor: "action.hover",
          display: "grid",
          gap: 0.25,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            后端版本
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
            {env?.version || "—"}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            主色来源
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: 0.5,
                bgcolor: themeSeed ?? "primary.main",
                border: 1,
                borderColor: "divider",
              }}
            />
            <Typography variant="caption" noWrap>
              {themeSource === "wallpaper" ? "壁纸" : themeSource === "custom" ? "自定义" : "默认"}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* 仓库入口 */}
      <Box sx={{ display: "flex", gap: 0.5, mt: 1, px: 0.5 }}>
        {REPOS.map((r) => {
          const Icon = r.icon;
          return (
            <Tooltip key={r.url} title={r.label}>
              <IconButton
                onClick={() => void openUrl(r.url)}
                sx={{ color: "text.secondary", borderRadius: 1.5, width: 28, height: 28 }}
              >
                <Icon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
