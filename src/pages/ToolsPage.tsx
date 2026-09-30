/**
 * 工具与自查页：文件系统完整性自查、版本更新检查、运行环境诊断。
 */
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import { alpha, useTheme } from "@mui/material/styles";

import HealthAndSafetyOutlinedIcon from "@mui/icons-material/HealthAndSafetyOutlined";
import SystemUpdateAltOutlinedIcon from "@mui/icons-material/SystemUpdateAltOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import GitHubIcon from "@mui/icons-material/GitHub";

import PathField from "../components/PathField";
import { useApp } from "../store";
import { IMG_FILTER, openPath, openUrl } from "../api";
import type { ReactNode } from "react";

const UPDATE_SOURCES = [
  {
    label: "GitHub（主源）",
    url: "https://github.com/LJY-33684/mtk-garbage-porttool-master/raw/main/latest_version.txt",
  },
  {
    label: "Gitee（镜像）",
    url: "https://gitee.com/Q3368436451/mtk-garbage-porttool-master/raw/master/latest_version.txt",
  },
];

function Card({
  title,
  sub,
  icon,
  action,
  children,
}: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 1.5, md: 1.75 },
        borderRadius: 2,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: sub ? 1.25 : 1 }}>
        {icon && (
          <Box
            sx={{
              width: 26,
              height: 26,
              borderRadius: 1,
              display: "grid",
              placeItems: "center",
              bgcolor: "action.hover",
              color: "text.secondary",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ lineHeight: 1.25 }}>
            {title}
          </Typography>
          {sub && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {sub}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const pushToast = useApp((s) => s.pushToast);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.75 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 84, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          minWidth: 0,
          fontFamily: mono ? "monospace" : "inherit",
          fontSize: mono ? 12.5 : undefined,
          wordBreak: "break-all",
        }}
      >
        {value || "—"}
      </Typography>
      {value && (
        <Tooltip title="复制">
          <IconButton
            size="small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                pushToast("已复制", "success");
              } catch {
                pushToast("复制失败", "error");
              }
            }}
          >
            <ContentCopyOutlinedIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

export default function ToolsPage() {
  const theme = useTheme();
  const env = useApp((s) => s.env);
  const refreshEnv = useApp((s) => s.refreshEnv);
  const running = useApp((s) => s.running);
  const startFscheck = useApp((s) => s.startFscheck);
  const startCheckUpdate = useApp((s) => s.startCheckUpdate);
  const fscheckImage = useApp((s) => s.fscheckImage);
  const setFscheckImage = useApp((s) => s.setFscheckImage);
  const updateUrl = useApp((s) => s.updateUrl);
  const setUpdateUrl = useApp((s) => s.setUpdateUrl);
  const lastOutDir = useApp((s) => s.lastOutDir);
  const logs = useApp((s) => s.logs);
  const lastResult = useApp((s) => s.lastResult);

  // 从日志中取最近一次更新检查的结论
  const updateVerdict = [...logs]
    .reverse()
    .map((l) => l.text)
    .find((t) => /【更新检查】/.test(t));

  const fsBusy = running === "fscheck";
  const updBusy = running === "check-update";

  return (
    <Box
      sx={{
        maxWidth: 1180,
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: { xs: "1fr", lg: "7fr 5fr" },
        pb: 4,
      }}
    >
      {/* ---------------- 左列 ---------------- */}
      <Box sx={{ display: "grid", gap: 1.5, alignContent: "start" }}>

        <Card
          title="文件系统自查"
          sub="对生成的 system.img 做 ext4 完整性校验：GD 校验和、inode/block bitmap、extent 一致性"
          icon={<HealthAndSafetyOutlinedIcon sx={{ fontSize: 16 }} />}
        >
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <PathField
              label="待检查的 system.img"
              value={fscheckImage}
              onChange={setFscheckImage}
              filters={IMG_FILTER}
              required
              disabled={running !== null}
              hint="建议移植完成后对 out/<时间戳>/system.img 自查一次"
            />

            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Button
                variant="contained"
                disabled={!fscheckImage || running !== null}
                onClick={() => void startFscheck()}
                startIcon={<FactCheckOutlinedIcon />}
              >
                开始自查
              </Button>
              <Button
                variant="text"
                disabled={!lastOutDir}
                onClick={() => lastOutDir && void openPath(lastOutDir)}
                startIcon={<FolderOpenOutlinedIcon />}
              >
                打开最近输出目录
              </Button>
            </Box>

            {fsBusy && <LinearProgress />}
          </Box>
        </Card>

        <Card
          title="检查更新"
          sub="读取远程 latest_version.txt 并与本地后端版本比较（超时 30 秒）"
          icon={<SystemUpdateAltOutlinedIcon sx={{ fontSize: 16 }} />}
        >
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <TextField
              select
              size="small"
              label="更新源"
              value={updateUrl}
              onChange={(e) => setUpdateUrl(e.target.value)}
              disabled={running !== null}
              helperText="后端支持 GitHub / Gitee 双源"
            >
              {UPDATE_SOURCES.map((src) => (
                <MenuItem key={src.url} value={src.url}>
                  {src.label}
                </MenuItem>
              ))}
            </TextField>

            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Button
                variant="contained"
                disabled={!updateUrl || running !== null}
                onClick={() => void startCheckUpdate()}
                startIcon={<SystemUpdateAltOutlinedIcon />}
              >
                检查更新
              </Button>
              <Typography variant="body2" color="text.secondary">
                本地版本：
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700, color: "text.primary" }}>
                  {env?.version || "—"}
                </Box>
              </Typography>
            </Box>

            {updBusy && <LinearProgress />}

            {updateVerdict && !updBusy && (
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.md3.tertiary, 0.1),
                  border: 1,
                  borderColor: "divider",
                }}
              >
                <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: 12.5, wordBreak: "break-all" }}>
                  {updateVerdict}
                </Typography>
              </Paper>
            )}
          </Box>
        </Card>
      </Box>

      {/* ---------------- 右列 ---------------- */}
      <Box sx={{ display: "grid", gap: 2, alignContent: "start" }}>
        <Card
          title="运行环境"
          sub="UI 外壳只负责编排进程，全部移植逻辑由后端 CLI 承担"
          icon={<FactCheckOutlinedIcon sx={{ fontSize: 16 }} />}
          action={
            <Tooltip title="重新探测">
              <span>
                <IconButton size="small" disabled={running !== null} onClick={() => void refreshEnv()}>
                  <RefreshRoundedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
          }
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Chip
              size="small"
              label={env?.ready ? "后端就绪" : "后端未就绪"}
              sx={{
                bgcolor: env?.ready ? alpha("#1B6E3C", 0.16) : alpha(theme.palette.error.main, 0.16),
                color: env?.ready
                  ? theme.palette.mode === "light"
                    ? "#1B6E3C"
                    : "#7DDBA0"
                  : theme.palette.error.main,
                fontWeight: 700,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              CLI 桥接接口 · 退出码 0=成功 / 1=参数错误 / 2=执行失败
            </Typography>
          </Box>

          <Divider sx={{ mb: 1 }} />
          <InfoRow label="工具版本" value={env?.version || ""} mono />
          <InfoRow label="Python" value={env?.python || ""} mono />
          <InfoRow label="工具目录" value={env?.toolDir || ""} mono />
          {env?.relocated && (
            <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
              安装位置不可写，后端工具已复制到用户目录运行；移植产物会生成在上面的「工具目录 / out」下。
            </Alert>
          )}
          {env?.error && (
            <Typography variant="caption" color="error.main" sx={{ display: "block", mt: 1 }}>
              {env.error}
            </Typography>
          )}
        </Card>

        <Card title="产物与文档" sub="所有输出都落在后端工具目录下" icon={<FolderOpenOutlinedIcon sx={{ fontSize: 16 }} />}>
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                最近输出目录
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={!lastOutDir}
                onClick={() => lastOutDir && void openPath(lastOutDir)}
                startIcon={<FolderOpenOutlinedIcon sx={{ fontSize: 16 }} />}
                sx={{ borderColor: "divider", color: "text.primary" }}
              >
                打开
              </Button>
            </Box>
            {lastOutDir && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                {lastOutDir}
              </Typography>
            )}

            <Divider />

            <Button
              size="small"
              variant="text"
              startIcon={<GitHubIcon sx={{ fontSize: 15 }} />}
              endIcon={<OpenInNewOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={() => void openUrl("https://github.com/LJY-33684/mtk-garbage-porttool-master")}
              sx={{ justifyContent: "flex-start" }}
            >
              项目仓库
            </Button>
            <Button
              size="small"
              variant="text"
              endIcon={<OpenInNewOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={() =>
                void openUrl("https://github.com/LJY-33684/mtk-garbage-porttool-master/blob/main/TASK_UI_SHELL.md")
              }
              sx={{ justifyContent: "flex-start" }}
            >
              CLI 桥接接口规范
            </Button>
          </Box>
        </Card>

        <Card title="快捷键与提示" sub="桌面端交互约定" icon={<SystemUpdateAltOutlinedIcon sx={{ fontSize: 16 }} />}>
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              · 右侧日志面板可随时收起，任务在后台继续运行
            </Typography>
            <Typography variant="body2" color="text.secondary">
              · 移植与 LK 任务均可中途终止（原版只能等待完成）
            </Typography>
            <Typography variant="body2" color="text.secondary">
              · 底包 system 解包结果按 MD5 缓存，重复移植会跳过解包
            </Typography>
            <Typography variant="body2" color="text.secondary">
              · 非法参数组合会在开始前提示，不会白跑一次流程
            </Typography>
            {lastResult && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 1 }}>
                最近任务：{lastResult.kind} · 退出码 {lastResult.code}
              </Typography>
            )}
          </Box>
        </Card>
      </Box>
    </Box>
  );
}
