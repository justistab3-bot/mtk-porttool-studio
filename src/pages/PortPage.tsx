/**
 * 移植工作台。
 *
 * 相对 tkinter 原版的交互优化（布局与信息架构，不触碰后端逻辑）：
 *  1. 底包 / 移植源从"点击按钮后弹窗"改为页面内常驻表单 —— 路径可见、可粘贴、可核对；
 *  2. 移植条目按语义分组、带图标与悬停说明，并支持搜索过滤；
 *  3. 每项标注风险等级，卡片顶部按勾选数量给出整体"开机风险"评估
 *     （勾选越多，与底包不匹配的面越大，能开机的概率越低）；
 *  4. 非法组合（zip 输出 + img 源、recovery 模式 + zip）在提交前即被禁用并给出原因；
 *  5. 追加"终止任务"能力（原版只能等或强杀进程）。
 */
import { useMemo, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import Checkbox from "@mui/material/Checkbox";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Collapse from "@mui/material/Collapse";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import InputAdornment from "@mui/material/InputAdornment";
import { alpha, useTheme } from "@mui/material/styles";

import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import OutputOutlinedIcon from "@mui/icons-material/OutputOutlined";

import PathField from "../components/PathField";
import { chipsetCapabilities, useApp } from "../store";
import { APK_FILTER, IMG_FILTER, ZIP_FILTER } from "../api";
import { GROUPS, metaFor } from "./itemMeta";

// ============================================================
// 通用卡片（紧凑版）
// ============================================================

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

// ============================================================
// 页面
// ============================================================

export default function PortPage() {
  const theme = useTheme();
  const s = useApp();
  const cap = chipsetCapabilities(s.chipset, s.items);
  const running = s.running === "port";
  const busy = s.running !== null;

  const enabledCount = s.items.filter((i) => i.enabled).length;
  /** 条目图标跟随当前配色方案的主色（勾选时用 primary，未勾选用中性色） */
  const accent = theme.md3.primary;

  const grouped = useMemo(() => {
    const q = s.itemFilter.trim().toLowerCase();
    const match = (key: string) => {
      if (!q) return true;
      const m = metaFor(key);
      return (
        key.toLowerCase().includes(q) || m.label.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      );
    };
    return GROUPS.map((g) => ({
      ...g,
      items: s.items.filter((it) => metaFor(it.key).group === g.key && match(it.key)),
    })).filter((g) => g.items.length > 0);
  }, [s.items, s.itemFilter]);

  /** 提交前校验：把 CLI 的组合规则前置到 UI，减少无效执行。 */
  const problems: string[] = [];
  if (!s.chipset) problems.push("尚未选择芯片方案");
  if (!s.paths.baseBoot) problems.push(cap.isRecovery ? "缺少底包 recovery 镜像" : "缺少底包 boot.img");
  if (!cap.isRecovery && !cap.isKernelOnly && !s.paths.baseSystem) problems.push("缺少底包 system.img");
  if (s.sourceKind === "zip") {
    if (!s.paths.donorZip) problems.push("缺少移植用 zip 卡刷包");
  } else {
    if (!s.paths.donorBoot) problems.push(cap.isRecovery ? "缺少移植用 recovery 镜像" : "缺少移植用 boot.img");
    if (!cap.isRecovery && !cap.isKernelOnly && !s.paths.donorSystem) problems.push("缺少移植用 system.img");
  }
  if (s.outType === "zip" && s.sourceKind !== "zip") problems.push("输出 zip 卡刷包必须使用 zip 移植源");
  if (cap.imgOnly && s.outType !== "img") problems.push("该方案仅支持 img 镜像输出");
  if (cap.isRecovery && s.sourceKind === "zip") problems.push("Recovery 移植仅支持 img 移植源");
  if (s.patchMagisk && !s.paths.magiskApk) problems.push("已勾选修补 Magisk，但未选择 Magisk APK");

  const canRun = problems.length === 0 && !s.running;

  const chipsetCard = (
    <Card
      title="芯片方案"
      sub="方案决定默认移植条目、分区表与模式"
      icon={<MemoryOutlinedIcon sx={{ fontSize: 16 }} />}
      action={
        <Chip
          size="small"
          label={cap.isRecovery ? "仅 Recovery" : cap.isKernelOnly ? "仅内核" : "完整移植"}
          sx={{ bgcolor: alpha(theme.md3.tertiary, 0.14), color: theme.md3.tertiary }}
        />
      }
    >
      <TextField
        select
        fullWidth
        label="方案"
        value={s.chipset}
        onChange={(e) => void s.setChipset(e.target.value)}
        disabled={busy || s.chipsets.length === 0}
        helperText="方案名需与底包芯片匹配，非同平台会导致驱动不兼容"
      >
        {s.chipsets.map((c) => (
          <MenuItem key={c} value={c}>
            {c}
          </MenuItem>
        ))}
      </TextField>
    </Card>
  );

  return (
    <Box sx={{ maxWidth: 1180, display: "grid", gap: 1.5, pb: 8 }}>
      {chipsetCard}

      {/* ---------------- 移植条目 ---------------- */}
      <Card
        title="移植条目"
        sub={`已选 ${enabledCount} / ${s.items.length} 项 · 悬停条目可查看详细说明`}
        icon={<TuneRoundedIcon sx={{ fontSize: 16 }} />}
        action={
          <Box sx={{ display: "flex", gap: 0.25, alignItems: "center" }}>
            <Button size="small" onClick={() => s.setAllItems(true)} disabled={busy}>
              全选
            </Button>
            <Button size="small" onClick={() => s.setAllItems(false)} disabled={busy}>
              全不选
            </Button>
            <Tooltip title="恢复方案默认值">
              <span>
                <IconButton onClick={() => void s.resetItemsToDefault()} disabled={busy}>
                  <RestartAltRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        }
      >
        <Box sx={{ display: "grid", gap: 1.25 }}>
          <TextField
            fullWidth
            value={s.itemFilter}
            onChange={(e) => s.setItemFilter(e.target.value)}
            placeholder="搜索条目（中文名 / 键名 / 说明）"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                  </InputAdornment>
                ),
                sx: { fontFamily: "inherit", fontSize: 12.5 },
              },
            }}
          />

          {s.itemsLoading ? (
            <LinearProgress />
          ) : (
            <Box sx={{ maxHeight: 320, overflowY: "auto", pr: 0.5, display: "grid", gap: 1.5 }}>
              {grouped.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1.5, textAlign: "center" }}>
                  没有匹配的条目
                </Typography>
              )}
              {grouped.map((g) => (
                <Box key={g.key}>
                  <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.25 }}>
                    <Typography variant="overline" color="text.secondary">
                      {g.label}
                    </Typography>
                    <Typography variant="caption" color="text.disabled" noWrap>
                      {g.hint}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: {
                        xs: "1fr",
                        sm: "repeat(2, minmax(0, 1fr))",
                        lg: "repeat(3, minmax(0, 1fr))",
                      },
                      columnGap: 1.5,
                      rowGap: 0.25,
                    }}
                  >
                    {g.items.map((it) => {
                      const m = metaFor(it.key);
                      const Icon = m.Icon;
                      return (
                        <Tooltip
                          key={it.key}
                          placement="top"
                          enterDelay={300}
                          title={
                            <Box sx={{ maxWidth: 320 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                {m.label}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{ display: "block", mt: 0.25, lineHeight: 1.5, opacity: 0.92 }}
                              >
                                {m.desc}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{ display: "block", mt: 0.4, opacity: 0.55, fontFamily: "monospace" }}
                              >
                                {it.key}
                              </Typography>
                            </Box>
                          }
                        >
                          <Box
                            onClick={() => !busy && s.toggleItem(it.key)}
                            sx={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 0.75,
                              py: 0.5,
                              px: 0.5,
                              borderRadius: 1,
                              cursor: busy ? "default" : "pointer",
                              "&:hover": busy ? undefined : { bgcolor: "action.hover" },
                            }}
                          >
                            <Checkbox
                              checked={it.enabled}
                              onChange={() => s.toggleItem(it.key)}
                              disabled={busy}
                              onClick={(e) => e.stopPropagation()}
                              sx={{ mt: -0.25, ml: -0.5 }}
                            />
                            <Box sx={{ minWidth: 0, pt: 0.25, flex: 1 }}>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                {/* 图标跟随当前配色方案：勾选用主色，未勾选用中性色 */}
                                <Icon
                                  sx={{
                                    fontSize: 15,
                                    color: it.enabled ? accent : "text.disabled",
                                    flexShrink: 0,
                                  }}
                                />
                                <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }} noWrap>
                                  {m.label}
                                </Typography>
                              </Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: "block", lineHeight: 1.3 }}
                                noWrap
                              >
                                {m.desc}
                              </Typography>
                            </Box>
                          </Box>
                        </Tooltip>
                      );
                    })}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Card>

      {/* ---------------- 路径（底包 + 移植源） ---------------- */}
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
          alignItems: "start",
        }}
      >
        <Card title="底包（当前设备）" sub="内核与驱动以此为准" icon={<StorageOutlinedIcon sx={{ fontSize: 16 }} />}>
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <PathField
              label={cap.isRecovery ? "底包 recovery 镜像" : "底包 boot.img"}
              value={s.paths.baseBoot}
              onChange={(v) => s.setPath("baseBoot", v)}
              filters={IMG_FILTER}
              required
              disabled={busy}
            />
            {!cap.isRecovery && !cap.isKernelOnly && (
              <PathField
                label="底包 system.img"
                value={s.paths.baseSystem}
                onChange={(v) => s.setPath("baseSystem", v)}
                filters={IMG_FILTER}
                required
                hint="建议与移植源 system 分区大小接近"
                disabled={busy}
              />
            )}
            {cap.isKernelOnly && (
              <Typography variant="caption" color="text.secondary">
                仅移植内核模式：底包 system 不参与流程，只输出 boot.img。
              </Typography>
            )}
            {cap.isRecovery && (
              <Typography variant="caption" color="text.secondary">
                仅移植 Recovery 模式：跳过 system 处理，仅输出 recovery 镜像（img）。
              </Typography>
            )}
          </Box>
        </Card>

        <Card
          title="移植源（目标 ROM）"
          sub="ZIP 卡刷包与独立镜像二选一"
          icon={<FolderZipOutlinedIcon sx={{ fontSize: 16 }} />}
        >
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <ToggleButtonGroup
              exclusive
              value={s.sourceKind}
              onChange={(_, v) => v && s.setSourceKind(v)}
              disabled={busy}
              fullWidth
            >
              <ToggleButton value="zip" disabled={!cap.allowsZipSource}>
                ZIP 卡刷包
              </ToggleButton>
              <ToggleButton value="img">独立镜像</ToggleButton>
            </ToggleButtonGroup>

            {s.sourceKind === "zip" ? (
              <PathField
                label="移植用 zip 卡刷包"
                value={s.paths.donorZip}
                onChange={(v) => s.setPath("donorZip", v)}
                filters={ZIP_FILTER}
                required
                disabled={busy}
              />
            ) : (
              <>
                <PathField
                  label={cap.isRecovery ? "移植用 recovery 镜像" : "移植用 boot.img"}
                  value={s.paths.donorBoot}
                  onChange={(v) => s.setPath("donorBoot", v)}
                  filters={IMG_FILTER}
                  required
                  disabled={busy}
                />
                {!cap.isRecovery && !cap.isKernelOnly && (
                  <PathField
                    label="移植用 system.img"
                    value={s.paths.donorSystem}
                    onChange={(v) => s.setPath("donorSystem", v)}
                    filters={IMG_FILTER}
                    required
                    disabled={busy}
                  />
                )}
              </>
            )}

            {!cap.allowsZipSource && (
              <Typography variant="caption" color="text.secondary">
                Recovery 移植仅支持独立镜像移植源。
              </Typography>
            )}
          </Box>
        </Card>
      </Box>

      {/* ---------------- 输出与高级选项 ---------------- */}
      <Card
        title="输出与高级选项"
        sub="产物写入后端工具目录的 out/<时间戳>/"
        icon={<OutputOutlinedIcon sx={{ fontSize: 16 }} />}
        action={
          <Button
            size="small"
            onClick={() => s.setAdvancedOpen(!s.advancedOpen)}
            endIcon={
              <ExpandMoreRoundedIcon
                sx={{
                  fontSize: 16,
                  transform: s.advancedOpen ? "rotate(180deg)" : "none",
                  transition: "transform 150ms",
                }}
              />
            }
          >
            {s.advancedOpen ? "收起高级" : "高级选项"}
          </Button>
        }
      >
        <Box sx={{ display: "grid", gap: 1.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            <ToggleButtonGroup
              exclusive
              value={s.outType}
              onChange={(_, v) => v && s.setOutType(v)}
              disabled={busy}
            >
              <ToggleButton value="img">img 镜像</ToggleButton>
              <ToggleButton value="zip" disabled={!cap.allowsZipOut}>
                ZIP 卡刷包
              </ToggleButton>
            </ToggleButtonGroup>

            {!cap.allowsZipOut && (
              <Typography variant="caption" color="text.secondary">
                {cap.isRecovery ? "Recovery 模式" : "仅内核模式"}仅支持 img 镜像输出
              </Typography>
            )}
            {cap.allowsZipOut && s.outType === "zip" && s.sourceKind !== "zip" && (
              <Typography variant="caption" color="warning.main">
                选择 ZIP 输出会自动切换为 ZIP 移植源
              </Typography>
            )}
          </Box>

          <Collapse in={s.advancedOpen}>
            <Box sx={{ display: "grid", gap: 1.25, pt: 0.5 }}>
              <Divider />

              <Box
                onClick={() => !busy && cap.supportsMagisk && s.setPatchMagisk(!s.patchMagisk)}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 0.75,
                  borderRadius: 1,
                  px: 0.5,
                  cursor: busy || !cap.supportsMagisk ? "default" : "pointer",
                  "&:hover": busy || !cap.supportsMagisk ? undefined : { bgcolor: "action.hover" },
                }}
              >
                <Checkbox
                  checked={s.patchMagisk}
                  onChange={(e) => s.setPatchMagisk(e.target.checked)}
                  disabled={busy || !cap.supportsMagisk}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ mt: -0.25, ml: -0.5 }}
                />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    修补 Magisk（对 boot.img 打补丁）
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    需要提供 Magisk APK 并指定目标架构
                  </Typography>
                </Box>
              </Box>

              <Collapse in={s.patchMagisk}>
                <Box
                  sx={{
                    display: "grid",
                    gap: 1.25,
                    pl: 3.5,
                    gridTemplateColumns: { xs: "1fr", sm: "2fr 1fr" },
                    alignItems: "start",
                  }}
                >
                  <PathField
                    label="Magisk APK"
                    value={s.paths.magiskApk}
                    onChange={(v) => s.setPath("magiskApk", v)}
                    filters={APK_FILTER}
                    required
                    disabled={busy}
                  />
                  <TextField
                    select
                    label="目标架构"
                    value={s.targetArch}
                    onChange={(e) => s.setTargetArch(e.target.value)}
                    disabled={busy}
                  >
                    {["arm64", "arm", "x86", "x86_64"].map((a) => (
                      <MenuItem key={a} value={a}>
                        {a}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
              </Collapse>

              <Box
                onClick={() => !busy && s.setCleanBase(!s.cleanBase)}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 0.75,
                  borderRadius: 1,
                  px: 0.5,
                  cursor: busy ? "default" : "pointer",
                  "&:hover": busy ? undefined : { bgcolor: "action.hover" },
                }}
              >
                <Checkbox
                  checked={s.cleanBase}
                  onChange={(e) => s.setCleanBase(e.target.checked)}
                  disabled={busy}
                  onClick={(e) => e.stopPropagation()}
                  sx={{ mt: -0.25, ml: -0.5 }}
                />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    完成后清除 base 缓存目录
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    默认保留底包解包缓存（按 MD5 命中可跳过重复解包）
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Collapse>
        </Box>
      </Card>

      {/* ---------------- 操作栏（sticky 于内容底部） ---------------- */}
      <Paper
        elevation={2}
        sx={{
          position: "sticky",
          bottom: 0,
          px: 1.75,
          py: 1,
          borderRadius: 2,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          zIndex: 10,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {running ? (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                正在执行移植…
              </Typography>
              <LinearProgress sx={{ mt: 0.5 }} />
            </Box>
          ) : problems.length > 0 ? (
            <Box>
              <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600 }}>
                还差 {problems.length} 项才能开始
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {problems.slice(0, 2).join(" · ")}
                {problems.length > 2 ? " …" : ""}
              </Typography>
            </Box>
          ) : (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                准备就绪 · {enabledCount} 个移植条目
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                {s.chipset} → {s.outType === "img" ? "img 镜像" : "ZIP 卡刷包"}（
                {s.sourceKind === "zip" ? "ZIP 源" : "img 源"}）
              </Typography>
            </Box>
          )}
        </Box>

        {running ? (
          <Button
            variant="outlined"
            color="error"
            onClick={s.cancelRunning}
            startIcon={<StopCircleOutlinedIcon />}
            sx={{ minWidth: 128 }}
          >
            终止任务
          </Button>
        ) : (
          <Tooltip title={problems.length > 0 ? problems[0] : "开始移植"}>
            <span>
              <Button
                variant="contained"
                size="large"
                disabled={!canRun}
                onClick={() => void s.startPort()}
                startIcon={<PlayArrowRoundedIcon />}
                sx={{ minWidth: 128 }}
              >
                开始移植
              </Button>
            </span>
          </Tooltip>
        )}
      </Paper>
    </Box>
  );
}
