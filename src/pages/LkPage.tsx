/**
 * LK 去警告面板。
 *
 * 说明：CLI 的 `lk` 子命令对目录内检测到的全部 LK 镜像（lk.img / lk2.img）统一处理，
 * 不接受单镜像选择参数，因此本页不做"勾选镜像"的伪交互 ——
 * 改为在扫描后按镜像汇总适配状态、警告文本段数与补丁点，让结果一目了然。
 */
import { useMemo, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Tooltip from "@mui/material/Tooltip";
import LinearProgress from "@mui/material/LinearProgress";
import Collapse from "@mui/material/Collapse";
import { alpha, useTheme } from "@mui/material/styles";

import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import BuildRoundedIcon from "@mui/icons-material/BuildRounded";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import RestoreOutlinedIcon from "@mui/icons-material/RestoreOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";

import PathField from "../components/PathField";
import { useApp } from "../store";
import { openPath } from "../api";

interface LkImage {
  name: string;
  size: string;
  md5: string;
  fit: string;
  headerOk: boolean;
  headerDetail: string;
  payload: string;
  warnings: number;
  patchOffset: string;
  patchState: "patchable" | "already" | "unknown";
  params: string[];
}

const NAME_RE = /^\s*【(.+?)】\s+(\S+)\s+MD5\s+(\S+)\s*$/;
const FIT_RE = /^\s*适配状态:\s*(.+?)\s*$/;
const HDR_RE = /^\s*头部:\s*(.+?)\s*$/;
const PAYLOAD_RE = /^\s*负载结束于\s*(.+?)\s*$/;
const WARN_RE = /^\s*警告文本\s*(\d+)\s*段/;
const PATCH_OFF_RE = /^\s*补丁点:\s*@(0x[0-9A-Fa-f]+)\s*(.*)$/;
const PARAM_RE = /^\s*内核参数:\s*(\S+)\s+(\d+)\s*项/;

/** 把 `lk scan` 的日志流还原成结构化结果。 */
function parseLkScan(lines: string[]): LkImage[] {
  const out: LkImage[] = [];
  let cur: LkImage | null = null;

  for (const raw of lines) {
    const m = NAME_RE.exec(raw);
    if (m) {
      cur = {
        name: m[1],
        size: m[2],
        md5: m[3],
        fit: "",
        headerOk: true,
        headerDetail: "",
        payload: "",
        warnings: 0,
        patchOffset: "",
        patchState: "unknown",
        params: [],
      };
      out.push(cur);
      continue;
    }
    if (!cur) continue;

    const fit = FIT_RE.exec(raw);
    if (fit) {
      cur.fit = fit[1];
      continue;
    }
    const hdr = HDR_RE.exec(raw);
    if (hdr) {
      cur.headerOk = /magic/i.test(hdr[1]);
      cur.headerDetail = hdr[1];
      continue;
    }
    const pl = PAYLOAD_RE.exec(raw);
    if (pl) {
      cur.payload = pl[1];
      continue;
    }
    const w = WARN_RE.exec(raw);
    if (w) {
      cur.warnings = Number(w[1]);
      continue;
    }
    const po = PATCH_OFF_RE.exec(raw);
    if (po) {
      cur.patchOffset = po[1];
      if (/未找到/.test(raw)) {
        cur.patchState = /已打补丁/.test(raw) ? "already" : "unknown";
      } else {
        cur.patchState = "patchable";
      }
      continue;
    }
    const pm = PARAM_RE.exec(raw);
    if (pm) {
      cur.params.push(`${pm[1]} (${pm[2]} 项)`);
    }
  }
  return out;
}

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

export default function LkPage() {
  const theme = useTheme();
  const lk = useApp((s) => s.lk);
  const setLk = useApp((s) => s.setLk);
  const logs = useApp((s) => s.logs);
  const running = useApp((s) => s.running);
  const lastResult = useApp((s) => s.lastResult);
  const lastOutDir = useApp((s) => s.lastOutDir);
  const startLk = useApp((s) => s.startLk);
  const cancelRunning = useApp((s) => s.cancelRunning);

  const [showDetail, setShowDetail] = useState(false);

  const scanned = useMemo(() => parseLkScan(logs.map((l) => l.text)), [logs]);
  const lkBusy = running?.startsWith("lk") ?? false;
  const folderOk = lk.folder.length > 0;

  return (
    <Box sx={{ maxWidth: 1180, display: "grid", gap: 1.5, pb: 4 }}>
      <Card
        title="固件目录"
        sub="GeekFlashTool readback 目录，工具会自动识别其中的 lk.img / lk2.img"
        icon={<ShieldOutlinedIcon sx={{ fontSize: 15 }} />}
        action={
          <Tooltip title="打开输出目录（补丁与备份产物）">
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!lastOutDir}
                onClick={() => lastOutDir && void openPath(lastOutDir)}
                startIcon={<FolderOpenOutlinedIcon sx={{ fontSize: 15 }} />}
                sx={{ borderColor: "divider", color: "text.primary" }}
              >
                输出目录
              </Button>
            </span>
          </Tooltip>
        }
      >
        <PathField
          label="固件目录"
          value={lk.folder}
          onChange={(v) => setLk({ folder: v })}
          placeholder="选择 readback 目录"
          required
          disabled={running !== null}
          hint="该目录内检测到的全部 LK 镜像都会被处理"
        />

        <Box sx={{ display: "flex", gap: 1, mt: 2, flexWrap: "wrap" }}>
          <Button
            variant="outlined"
            disabled={!folderOk || running !== null}
            onClick={() => void startLk("scan")}
            startIcon={<SearchRoundedIcon />}
            sx={{ borderColor: "divider", color: "text.primary" }}
          >
            扫描
          </Button>
          <Button
            variant="contained"
            disabled={!folderOk || running !== null}
            onClick={() => void startLk("patch")}
            startIcon={<BuildRoundedIcon />}
          >
            打补丁
          </Button>
          <Button
            variant="outlined"
            disabled={!folderOk || running !== null}
            onClick={() => void startLk("verify")}
            startIcon={<FactCheckOutlinedIcon />}
            sx={{ borderColor: "divider", color: "text.primary" }}
          >
            校验
          </Button>
          <Button
            variant="outlined"
            color="warning"
            disabled={!folderOk || running !== null}
            onClick={() => void startLk("restore")}
            startIcon={<RestoreOutlinedIcon />}
          >
            还原备份
          </Button>

          {lkBusy && (
            <Button variant="text" color="error" onClick={cancelRunning} sx={{ ml: "auto" }}>
              终止任务
            </Button>
          )}
        </Box>

        {lkBusy && <LinearProgress sx={{ mt: 2 }} />}
      </Card>

      <Card title="补丁选项" sub="仅在点击「打补丁」时生效" icon={<BuildRoundedIcon sx={{ fontSize: 15 }} />}>
        <Box sx={{ display: "grid", gap: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={lk.patchA}
                onChange={(e) => setLk({ patchA: e.target.checked })}
                disabled={running !== null}
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  补丁 A：去橙/红警告 + 追加 5 秒延时
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  修改启动流程中的警告分支，保留 5 秒延时以便进入 recovery
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={lk.patchB}
                onChange={(e) => setLk({ patchB: e.target.checked })}
                disabled={running !== null}
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  补丁 B：清空警告文本
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  清空镜像内的警告字符串，双管齐下更稳
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={lk.autoBackup}
                onChange={(e) => setLk({ autoBackup: e.target.checked })}
                disabled={running !== null}
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  自动备份原镜像
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  备份为 &lt;名字&gt;_original_backup，跨会话仍可还原
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={lk.genReport}
                onChange={(e) => setLk({ genReport: e.target.checked })}
                disabled={running !== null}
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  生成校验报告
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  输出补丁前后差异报告到产物目录
                </Typography>
              </Box>
            }
          />

          <Divider sx={{ my: 0.5 }} />

          <FormControlLabel
            control={
              <Checkbox
                size="small"
                color="warning"
                checked={lk.inplace}
                onChange={(e) => setLk({ inplace: e.target.checked })}
                disabled={running !== null}
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  直接覆盖原文件（危险）
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  不勾选时补丁写入输出目录，原文件保持不动
                </Typography>
              </Box>
            }
          />

          <Collapse in={lk.inplace} unmountOnExit>
            <Alert severity="warning" variant="outlined" icon={<WarningAmberRoundedIcon />} sx={{ borderRadius: 1.5 }}>
              将原地写入固件目录中的镜像。请确认已开启「自动备份原镜像」，否则无法还原。
            </Alert>
          </Collapse>
        </Box>
      </Card>

      {/* ---------------- 扫描结果 ---------------- */}
      <Card
        title="检测结果"
        sub={
          scanned.length > 0
            ? `最近一次扫描解析到 ${scanned.length} 个镜像`
            : "点击「扫描」后，这里会汇总目录内 LK 镜像的适配状态"
        }
        icon={<FactCheckOutlinedIcon sx={{ fontSize: 15 }} />}
        action={
          scanned.length > 0 ? (
            <Button size="small" onClick={() => setShowDetail(!showDetail)}>
              {showDetail ? "收起详情" : "展开详情"}
            </Button>
          ) : undefined
        }
      >
        {scanned.length === 0 ? (
          <Box sx={{ py: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              暂无扫描结果
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "grid", gap: 1.25 }}>            {scanned.map((img, i) => {
              const fitOk = /适配|可打|可修补|ok|匹配/i.test(img.fit) && !/不|否|fail|no/i.test(img.fit);
              const chipColor =
                img.patchState === "patchable"
                  ? theme.md3.tertiary
                  : img.patchState === "already"
                    ? theme.palette.warning.main
                    : theme.palette.error.main;
              const chipLabel =
                img.patchState === "patchable"
                  ? "可打补丁"
                  : img.patchState === "already"
                    ? "已打补丁"
                    : "未找到补丁点";
              return (
                <Paper
                  key={`${img.name}-${i}`}
                  elevation={0}
                  sx={{
                    p: 1.75,
                    borderRadius: 1.5,
                    bgcolor: "background.default",
                    border: 1,
                    borderColor: "divider",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {img.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={chipLabel}
                      sx={{ bgcolor: alpha(chipColor, 0.16), color: chipColor, fontWeight: 700 }}
                    />
                    {img.warnings > 0 && (
                      <Chip
                        size="small"
                        label={`警告文本 ${img.warnings} 段`}
                        sx={{ bgcolor: alpha(theme.palette.warning.main, 0.16), color: theme.palette.warning.main }}
                      />
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                      {img.size}
                    </Typography>
                  </Box>

                  <Box sx={{ display: "flex", gap: 2, mt: 0.75, flexWrap: "wrap" }}>
                    <Typography variant="caption" color="text.secondary">
                      适配：{img.fit || "—"}
                      {fitOk ? "（可处理）" : ""}
                    </Typography>
                    {img.patchOffset && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                        补丁点 {img.patchOffset}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "monospace" }}>
                      MD5 {img.md5.slice(0, 16)}…
                    </Typography>
                  </Box>

                  <Collapse in={showDetail} unmountOnExit>
                    <Divider sx={{ my: 1 }} />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", fontFamily: "monospace", wordBreak: "break-all" }}
                    >
                      头部：{img.headerDetail || "—"}
                    </Typography>
                    {img.payload && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", fontFamily: "monospace" }}
                      >
                        负载：{img.payload}
                      </Typography>
                    )}
                    {img.params.length > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                        内核参数（不会被改动）：{img.params.join("、")}
                      </Typography>
                    )}
                  </Collapse>
                </Paper>
              );
            })}
          </Box>
        )}

        {lastResult?.kind.startsWith("lk") && !running && (
          <Typography
            variant="caption"
            sx={{
              display: "block",
              mt: 2,
              color: lastResult.code === 0 ? "success.main" : "error.main",
              fontWeight: 600,
            }}
          >
            最近一次操作：{lastResult.kind} · 退出码 {lastResult.code}
            {lastResult.code === 0 ? "（成功）" : "（未成功，详见日志）"}
          </Typography>
        )}
      </Card>
    </Box>
  );
}
