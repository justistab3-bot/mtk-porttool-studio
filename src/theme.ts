/**
 * Material Design 3 主题。
 *
 * 色彩方案（19 个颜色角色 × 浅色/深色）由 Rust 侧按 M3 规范生成：
 * 13 级色板 → 5 组关键色 → 角色映射。前端只负责把配色方案接到 MUI 上，
 * 并定义形状、排版与组件密度。
 *
 * 色板与角色映射规则见 src-tauri/src/theme.rs 与 DESIGN.md。
 */
import { createTheme, type Theme } from "@mui/material/styles";
import type { ColorScheme } from "./api";

// ============================================================
// MUI 模块增强：把 MD3 配色方案挂到 theme.md3
// ============================================================

declare module "@mui/material/styles" {
  interface Theme {
    md3: ColorScheme;
  }
  interface ThemeOptions {
    md3?: ColorScheme;
  }
}

// ============================================================
// 字体、圆角与排版
// ============================================================

const FONT_STACK =
  '"MiSans", "HarmonyOS Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif';

export const MONO_FONT =
  '"JetBrains Mono", "Cascadia Mono", "Consolas", "SFMono-Regular", "Microsoft YaHei Mono", monospace';

/** 圆角分级：小控件 6 / 控件 8 / 分组 10 / 卡片 12 / 容器 16。 */
export const RADIUS = {
  chip: 6,
  control: 8,
  group: 10,
  card: 12,
  container: 16,
} as const;

// ============================================================
// 主题构造
// ============================================================

export function buildTheme(mode: "light" | "dark", scheme: ColorScheme): Theme {
  const c = scheme;

  return createTheme({
    md3: c,
    palette: {
      mode,
      primary: { main: c.primary, contrastText: c.onPrimary },
      secondary: { main: c.secondary, contrastText: c.onSecondary },
      error: { main: c.error, contrastText: c.onError },
      background: { default: c.surface, paper: c.surfaceContainerLow },
      text: { primary: c.onSurface, secondary: c.onSurfaceVariant },
      divider: c.outlineVariant,
    },
    shape: { borderRadius: RADIUS.control },
    typography: {
      fontFamily: FONT_STACK,
      h1: { fontSize: 34, fontWeight: 500, lineHeight: "42px" },
      h2: { fontSize: 28, fontWeight: 500, lineHeight: "36px" },
      h3: { fontSize: 24, fontWeight: 500, lineHeight: "32px" },
      h4: { fontSize: 20, fontWeight: 500, lineHeight: "28px" },
      h5: { fontSize: 17, fontWeight: 600, lineHeight: "24px" },
      h6: { fontSize: 15, fontWeight: 600, lineHeight: "22px" },
      subtitle1: { fontSize: 14, fontWeight: 600, lineHeight: "20px" },
      subtitle2: { fontSize: 13, fontWeight: 600, lineHeight: "18px" },
      body1: { fontSize: 13, fontWeight: 400, lineHeight: "19px" },
      body2: { fontSize: 12.5, fontWeight: 400, lineHeight: "18px" },
      button: { fontSize: 13, fontWeight: 600, textTransform: "none", letterSpacing: 0 },
      caption: { fontSize: 11.5, fontWeight: 500, lineHeight: "16px", letterSpacing: "0.02em" },
      overline: { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: c.surface, color: c.onSurface },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, size: "small" },
        styleOverrides: {
          root: { borderRadius: RADIUS.control, paddingInline: 14, minHeight: 32, fontSize: 13 },
          sizeLarge: { minHeight: 38, paddingInline: 20, fontSize: 13.5 },
          sizeSmall: { minHeight: 30, paddingInline: 12 },
          containedPrimary: { backgroundColor: c.primary, color: c.onPrimary },
          outlined: { borderColor: c.outlineVariant },
        },
      },
      MuiIconButton: {
        defaultProps: { size: "small" },
        styleOverrides: {
          root: { borderRadius: RADIUS.control, padding: 6 },
          sizeSmall: { padding: 6 },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.control,
            border: "none",
            textTransform: "none",
            fontWeight: 600,
            fontSize: 12.5,
            paddingBlock: 5,
            paddingInline: 12,
            color: c.onSurfaceVariant,
            "&.Mui-selected": {
              backgroundColor: c.secondaryContainer,
              color: c.onSecondaryContainer,
              "&:hover": { backgroundColor: c.secondaryContainer },
            },
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { gap: 6 },
          grouped: {
            border: `1px solid ${c.outlineVariant}`,
            "&.Mui-selected": { borderColor: "transparent" },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: RADIUS.chip, fontWeight: 600, height: 22, fontSize: 11.5 },
          label: { paddingInline: 8 },
        },
      },
      MuiCheckbox: {
        defaultProps: { size: "small" },
        styleOverrides: { root: { color: c.onSurfaceVariant, padding: 6 } },
      },
      MuiRadio: { defaultProps: { size: "small" } },
      MuiSwitch: { styleOverrides: { thumb: { boxShadow: "none" } } },
      MuiTextField: { defaultProps: { variant: "outlined", size: "small" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.control,
            backgroundColor: c.surfaceContainerHighest,
            fontSize: 13,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: c.outlineVariant },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: c.outline },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: c.primary,
              borderWidth: 1.5,
            },
          },
          input: { paddingBlock: 7, paddingInline: 10 },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: 12.5 } } },
      MuiFormHelperText: {
        styleOverrides: { root: { fontSize: 11, marginLeft: 2, marginTop: 3 } },
      },
      MuiSelect: {
        styleOverrides: { select: { fontFamily: FONT_STACK, fontSize: 13, paddingBlock: 7 } },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: RADIUS.group,
            border: `1px solid ${c.outlineVariant}`,
            marginTop: 4,
          },
          list: { paddingBlock: 4 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: { fontSize: 13, minHeight: 34, borderRadius: RADIUS.chip, marginInline: 4 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            minHeight: 38,
            "&.Mui-selected": {
              backgroundColor: c.secondaryContainer,
              color: c.onSecondaryContainer,
              "&:hover": { backgroundColor: c.secondaryContainer },
            },
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: c.inverseSurface,
            color: c.inverseOnSurface,
            borderRadius: RADIUS.chip,
            fontSize: 11.5,
            paddingBlock: 4,
            paddingInline: 8,
          },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: c.outlineVariant } } },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 999, height: 3, backgroundColor: c.surfaceContainerHighest },
          bar: { borderRadius: 999 },
        },
      },
      MuiCircularProgress: { defaultProps: { size: 16, thickness: 5 } },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: RADIUS.container, backgroundImage: "none" } },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: RADIUS.group, fontSize: 12.5, paddingBlock: 6, paddingInline: 10 },
          message: { paddingBlock: 2 },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.group,
            backgroundColor: c.inverseSurface,
            color: c.inverseOnSurface,
          },
        },
      },
      MuiTabs: {
        styleOverrides: { root: { minHeight: 38 }, indicator: { height: 2.5, borderRadius: 3 } },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            minHeight: 38,
            fontSize: 12.5,
            paddingInline: 12,
          },
        },
      },
      MuiCollapse: { defaultProps: { unmountOnExit: true } },
      MuiFormControlLabel: {
        styleOverrides: { root: { marginLeft: -4 }, label: { fontSize: 12.5 } },
      },
      MuiSkeleton: { styleOverrides: { root: { borderRadius: RADIUS.chip } } },
      MuiSlider: { styleOverrides: { root: { color: c.primary } } },
    },
  });
}
