//! 壁纸取色与 Material Design 3 色彩系统。
//!
//! 严格按 M3 规范构建，而非"近似 MD3"：
//!
//! 1. **色板（tonal palette）**：每组关键色 13 个色阶
//!    `0 10 20 30 40 50 60 70 80 90 95 99 100`；色阶值即感知亮度，
//!    0 = 纯黑、100 = 纯白、**40 为浅色模式主色、80 为深色模式主色**。
//! 2. **关键色（key colors）** 5 组：主色 / 次要色 / 第三色 / 中性色 / 中性色变体。
//! 3. **配色方案（color scheme）** 19 个颜色角色，每个角色固定映射到某个色阶；
//!    浅色与深色模式使用同一套色板，仅映射关系不同。
//!
//! 亮度映射用 `L = (tone/100)^0.85`（OkLCh 的 L），使 tone 差 40 的两级
//! 对比度 ≥3:1、差 50 ≥4.5:1、差 70 ≥7:1，即 M3 承诺的可访问性下界。

use std::path::PathBuf;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

// ============================================================
// 色阶与亮度
// ============================================================

/// M3 标准色阶（13 级）。
pub const TONES: [u32; 13] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

/// 色阶 → OkLCh 亮度。指数 0.85 让感知亮度贴近 WCAG 相对亮度，
/// 从而让 tone 差与对比度要求对应上。
fn lightness_of(tone: u32) -> f64 {
    match tone {
        0 => 0.0,
        100 => 1.0,
        t => (t as f64 / 100.0).powf(0.85),
    }
}

fn tone_index(tone: u32) -> usize {
    TONES
        .iter()
        .position(|&t| t == tone)
        .unwrap_or_else(|| panic!("非标准色阶 {tone}"))
}

// ============================================================
// 色彩空间（OkLCh ↔ sRGB）
// ============================================================

fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(c: f64) -> f64 {
    if c <= 0.003_130_8 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// sRGB(0..1) → OkLCh（L 0..1，C 0..0.4，H 度）
pub fn rgb_to_oklch(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let (lr, lg, lb) = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b));
    let l = 0.412_221_470_8 * lr + 0.536_332_536_3 * lg + 0.051_445_992_9 * lb;
    let m = 0.211_903_498_2 * lr + 0.680_699_545_1 * lg + 0.107_396_956_6 * lb;
    let s = 0.088_302_461_9 * lr + 0.281_718_837_6 * lg + 0.629_978_700_5 * lb;
    let (l_, m_, s_) = (l.cbrt(), m.cbrt(), s.cbrt());
    let ok_l = 0.210_454_255_3 * l_ + 0.793_617_785_0 * m_ - 0.004_072_046_8 * s_;
    let ok_a = 1.977_998_495_1 * l_ - 2.428_592_205_0 * m_ + 0.450_593_709_9 * s_;
    let ok_b = 0.025_904_037_1 * l_ + 0.782_771_766_2 * m_ - 0.808_675_766_0 * s_;
    let c = (ok_a * ok_a + ok_b * ok_b).sqrt();
    let h = ok_b.atan2(ok_a).to_degrees().rem_euclid(360.0);
    (ok_l, c, h)
}

/// OkLCh → sRGB(0..1)，可能越界（调用方用 max_chroma 约束）
pub fn oklch_to_rgb(l: f64, c: f64, h: f64) -> (f64, f64, f64) {
    let hr = h.to_radians();
    let ok_a = c * hr.cos();
    let ok_b = c * hr.sin();
    let l_ = l + 0.396_337_777_4 * ok_a + 0.215_803_757_3 * ok_b;
    let m_ = l - 0.105_561_345_8 * ok_a - 0.063_854_172_8 * ok_b;
    let s_ = l - 0.089_484_177_5 * ok_a - 1.291_485_548_0 * ok_b;
    let (l3, m3, s3) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
    let lr = 4.076_741_662_1 * l3 - 3.307_711_591_3 * m3 + 0.230_969_929_2 * s3;
    let lg = -1.268_438_004_6 * l3 + 2.609_757_401_1 * m3 - 0.341_319_396_5 * s3;
    let lb = -0.004_196_086_3 * l3 - 0.703_418_614_7 * m3 + 1.707_614_701_0 * s3;
    (linear_to_srgb(lr), linear_to_srgb(lg), linear_to_srgb(lb))
}

fn in_gamut(r: f64, g: f64, b: f64) -> bool {
    let eps = 1e-4;
    (-eps..=1.0 + eps).contains(&r) && (-eps..=1.0 + eps).contains(&g) && (-eps..=1.0 + eps).contains(&b)
}

/// 二分求该亮度/色相下 sRGB 内可达的最大彩度。
pub fn max_chroma(l: f64, h: f64) -> f64 {
    let (mut lo, mut hi) = (0.0_f64, 0.4_f64);
    for _ in 0..18 {
        let mid = (lo + hi) / 2.0;
        let (r, g, b) = oklch_to_rgb(l, mid, h);
        if in_gamut(r, g, b) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

pub fn to_hex(r: f64, g: f64, b: f64) -> String {
    format!(
        "#{:02X}{:02X}{:02X}",
        (clamp01(r) * 255.0).round() as u8,
        (clamp01(g) * 255.0).round() as u8,
        (clamp01(b) * 255.0).round() as u8
    )
}

// ============================================================
// 色板
// ============================================================

/// 生成 13 级色调板：亮度由色阶决定，彩度受 sRGB 可达上限约束
/// （深色端与浅色端自然收敛，避免溢出，也是 M3 色板"两端更灰"的成因）。
pub fn tonal_palette(hue: f64, chroma: f64) -> Vec<String> {
    TONES
        .iter()
        .map(|&tone| {
            if tone == 0 {
                return "#000000".to_string();
            }
            if tone == 100 {
                return "#FFFFFF".to_string();
            }
            let l = lightness_of(tone);
            let c = chroma.min(max_chroma(l, hue));
            let (r, g, b) = oklch_to_rgb(l, c, hue);
            to_hex(r, g, b)
        })
        .collect()
}

/// 5 组关键色的色相与彩度派生关系（对齐 M3 的 Material Color Utilities 思路）：
///
/// | 关键色 | 色相 | 彩度 |
/// |---|---|---|
/// | 主色 primary | 种子色相 | 种子彩度 |
/// | 次要色 secondary | 种子色相 +12° | 主色 × 0.34（更灰的辅助色） |
/// | 第三色 tertiary | 种子色相 +60° | 主色 × 0.55（互补点缀） |
/// | 中性色 neutral | 种子色相 | 0.004（几乎纯灰，仅保留一丝色相） |
/// | 中性色变体 neutralVariant | 种子色相 | 0.012（用于中等强度文字与描边） |
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KeyColors {
    pub primary: Vec<String>,
    pub secondary: Vec<String>,
    pub tertiary: Vec<String>,
    pub neutral: Vec<String>,
    pub neutral_variant: Vec<String>,
}

pub fn key_colors_from_seed(hue: f64, chroma: f64) -> KeyColors {
    let h = hue.rem_euclid(360.0);
    let c = chroma.clamp(0.04, 0.20);
    KeyColors {
        primary: tonal_palette(h, c),
        secondary: tonal_palette((h + 12.0).rem_euclid(360.0), (c * 0.34).clamp(0.02, 0.07)),
        tertiary: tonal_palette((h + 60.0).rem_euclid(360.0), (c * 0.55).clamp(0.03, 0.11)),
        neutral: tonal_palette(h, 0.004),
        neutral_variant: tonal_palette(h, 0.012),
    }
}

// ============================================================
// 配色方案：19 个颜色角色 × 浅色/深色映射
// ============================================================

/// 一个颜色角色：来自哪组关键色 + 用哪个色阶。
#[derive(Clone, Copy)]
struct Role {
    /// 0=primary 1=secondary 2=tertiary 3=neutral 4=neutralVariant 5=error
    group: usize,
    tone: u32,
}

/// 浅色模式：主色 tone40、容器 tone90/tone10，表面由中性色 tone98 起逐级下沉。
const LIGHT: &[(&str, Role)] = &[
    ("primary", Role { group: 0, tone: 40 }),
    ("onPrimary", Role { group: 0, tone: 100 }),
    ("primaryContainer", Role { group: 0, tone: 90 }),
    ("onPrimaryContainer", Role { group: 0, tone: 10 }),
    ("secondary", Role { group: 1, tone: 40 }),
    ("onSecondary", Role { group: 1, tone: 100 }),
    ("secondaryContainer", Role { group: 1, tone: 90 }),
    ("onSecondaryContainer", Role { group: 1, tone: 10 }),
    ("tertiary", Role { group: 2, tone: 40 }),
    ("onTertiary", Role { group: 2, tone: 100 }),
    ("tertiaryContainer", Role { group: 2, tone: 90 }),
    ("onTertiaryContainer", Role { group: 2, tone: 10 }),
    ("error", Role { group: 5, tone: 40 }),
    ("onError", Role { group: 5, tone: 100 }),
    ("errorContainer", Role { group: 5, tone: 90 }),
    ("onErrorContainer", Role { group: 5, tone: 10 }),
    ("surface", Role { group: 3, tone: 98 }),
    ("surfaceDim", Role { group: 3, tone: 87 }),
    ("surfaceBright", Role { group: 3, tone: 98 }),
    ("surfaceContainerLowest", Role { group: 3, tone: 100 }),
    ("surfaceContainerLow", Role { group: 3, tone: 96 }),
    ("surfaceContainer", Role { group: 3, tone: 94 }),
    ("surfaceContainerHigh", Role { group: 3, tone: 92 }),
    ("surfaceContainerHighest", Role { group: 3, tone: 90 }),
    ("onSurface", Role { group: 3, tone: 10 }),
    ("onSurfaceVariant", Role { group: 4, tone: 30 }),
    ("outline", Role { group: 4, tone: 50 }),
    ("outlineVariant", Role { group: 4, tone: 80 }),
    ("inverseSurface", Role { group: 3, tone: 20 }),
    ("inverseOnSurface", Role { group: 3, tone: 95 }),
    ("inversePrimary", Role { group: 0, tone: 80 }),
];

/// 深色模式：同一套色板，主色改为 tone80，表面从 tone4 起逐级上升。
const DARK: &[(&str, Role)] = &[
    ("primary", Role { group: 0, tone: 80 }),
    ("onPrimary", Role { group: 0, tone: 20 }),
    ("primaryContainer", Role { group: 0, tone: 30 }),
    ("onPrimaryContainer", Role { group: 0, tone: 90 }),
    ("secondary", Role { group: 1, tone: 80 }),
    ("onSecondary", Role { group: 1, tone: 20 }),
    ("secondaryContainer", Role { group: 1, tone: 30 }),
    ("onSecondaryContainer", Role { group: 1, tone: 90 }),
    ("tertiary", Role { group: 2, tone: 80 }),
    ("onTertiary", Role { group: 2, tone: 20 }),
    ("tertiaryContainer", Role { group: 2, tone: 30 }),
    ("onTertiaryContainer", Role { group: 2, tone: 90 }),
    ("error", Role { group: 5, tone: 80 }),
    ("onError", Role { group: 5, tone: 20 }),
    ("errorContainer", Role { group: 5, tone: 30 }),
    ("onErrorContainer", Role { group: 5, tone: 90 }),
    ("surface", Role { group: 3, tone: 6 }),
    ("surfaceDim", Role { group: 3, tone: 6 }),
    ("surfaceBright", Role { group: 3, tone: 24 }),
    ("surfaceContainerLowest", Role { group: 3, tone: 4 }),
    ("surfaceContainerLow", Role { group: 3, tone: 10 }),
    ("surfaceContainer", Role { group: 3, tone: 12 }),
    ("surfaceContainerHigh", Role { group: 3, tone: 17 }),
    ("surfaceContainerHighest", Role { group: 3, tone: 22 }),
    ("onSurface", Role { group: 3, tone: 90 }),
    ("onSurfaceVariant", Role { group: 4, tone: 80 }),
    ("outline", Role { group: 4, tone: 60 }),
    ("outlineVariant", Role { group: 4, tone: 30 }),
    ("inverseSurface", Role { group: 3, tone: 90 }),
    ("inverseOnSurface", Role { group: 3, tone: 20 }),
    ("inversePrimary", Role { group: 0, tone: 40 }),
];

/// 按角色表取值：色阶不在标准 13 级内时，用最接近的两级做线性插值，
/// 这样既保持 M3 的角色结构，又能表达 surfaceContainer 的细分层级。
fn lookup(palette: &[String], tone: u32) -> String {    if let Some(idx) = TONES.iter().position(|&t| t == tone) {
        return palette[idx].clone();
    }
    let lower = TONES.iter().rev().find(|&&t| t < tone).copied();
    let upper = TONES.iter().find(|&&t| t > tone).copied();
    match (lower, upper) {
        (Some(lo), Some(hi)) => {
            let a = &palette[tone_index(lo)];
            let b = &palette[tone_index(hi)];
            mix_hex(a, b, (tone - lo) as f64 / (hi - lo) as f64)
        }
        (Some(lo), None) => palette[tone_index(lo)].clone(),
        (None, Some(hi)) => palette[tone_index(hi)].clone(),
        (None, None) => "#000000".to_string(),
    }
}

fn parse_hex(s: &str) -> (f64, f64, f64) {
    let v = u32::from_str_radix(s.trim_start_matches('#'), 16).unwrap_or(0);
    (
        ((v >> 16) & 0xff) as f64 / 255.0,
        ((v >> 8) & 0xff) as f64 / 255.0,
        (v & 0xff) as f64 / 255.0,
    )
}

fn mix_hex(a: &str, b: &str, t: f64) -> String {
    let (ar, ag, ab) = parse_hex(a);
    let (br, bg, bb) = parse_hex(b);
    let t = clamp01(t);
    to_hex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/// MD3 语义配色方案：19 个颜色角色的实际色值。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ColorScheme {
    pub primary: String,
    pub on_primary: String,
    pub primary_container: String,
    pub on_primary_container: String,
    pub secondary: String,
    pub on_secondary: String,
    pub secondary_container: String,
    pub on_secondary_container: String,
    pub tertiary: String,
    pub on_tertiary: String,
    pub tertiary_container: String,
    pub on_tertiary_container: String,
    pub error: String,
    pub on_error: String,
    pub error_container: String,
    pub on_error_container: String,
    pub surface: String,
    pub surface_dim: String,
    pub surface_bright: String,
    pub surface_container_lowest: String,
    pub surface_container_low: String,
    pub surface_container: String,
    pub surface_container_high: String,
    pub surface_container_highest: String,
    pub on_surface: String,
    pub on_surface_variant: String,
    pub outline: String,
    pub outline_variant: String,
    pub inverse_surface: String,
    pub inverse_on_surface: String,
    pub inverse_primary: String,
}

/// MD3 错误色独立于种子色相（语义色不随壁纸变化）。
const ERROR_PALETTE: [&str; 13] = [
    "#000000", "#410002", "#690005", "#93000A", "#BA1A1A", "#DE3730", "#FF5449", "#FF897D", "#FFB4AB",
    "#FFDAD6", "#FFE9E7", "#FFFBFF", "#FFFFFF",
];

fn build_scheme(keys: &KeyColors, table: &[(&str, Role)]) -> ColorScheme {
    // 错误色是语义色，不随壁纸变化，用标准 M3 错误色板
    let error_palette: Vec<String> = ERROR_PALETTE.iter().map(|s| s.to_string()).collect();
    let groups: [&[String]; 6] = [
        &keys.primary,
        &keys.secondary,
        &keys.tertiary,
        &keys.neutral,
        &keys.neutral_variant,
        &error_palette,
    ];
    let get = |name: &str| -> String {
        let role = table
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, r)| *r)
            .unwrap_or_else(|| panic!("配色方案缺少角色 {name}"));
        lookup(groups[role.group], role.tone)
    };
    ColorScheme {
        primary: get("primary"),
        on_primary: get("onPrimary"),
        primary_container: get("primaryContainer"),
        on_primary_container: get("onPrimaryContainer"),
        secondary: get("secondary"),
        on_secondary: get("onSecondary"),
        secondary_container: get("secondaryContainer"),
        on_secondary_container: get("onSecondaryContainer"),
        tertiary: get("tertiary"),
        on_tertiary: get("onTertiary"),
        tertiary_container: get("tertiaryContainer"),
        on_tertiary_container: get("onTertiaryContainer"),
        error: get("error"),
        on_error: get("onError"),
        error_container: get("errorContainer"),
        on_error_container: get("onErrorContainer"),
        surface: get("surface"),
        surface_dim: get("surfaceDim"),
        surface_bright: get("surfaceBright"),
        surface_container_lowest: get("surfaceContainerLowest"),
        surface_container_low: get("surfaceContainerLow"),
        surface_container: get("surfaceContainer"),
        surface_container_high: get("surfaceContainerHigh"),
        surface_container_highest: get("surfaceContainerHighest"),
        on_surface: get("onSurface"),
        on_surface_variant: get("onSurfaceVariant"),
        outline: get("outline"),
        outline_variant: get("outlineVariant"),
        inverse_surface: get("inverseSurface"),
        inverse_on_surface: get("inverseOnSurface"),
        inverse_primary: get("inversePrimary"),
    }
}

/// 由关键色生成浅色 + 深色两套配色方案（同一色板，映射关系不同）。
pub fn schemes_from_keys(keys: &KeyColors) -> (ColorScheme, ColorScheme) {
    (build_scheme(keys, LIGHT), build_scheme(keys, DARK))
}

// ============================================================
// 壁纸取色
// ============================================================

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperPalette {
    /// 壁纸文件路径
    pub path: String,
    /// 主色（种子色 tone40 表现）
    pub seed: String,
    /// 主色色相（度）
    pub hue: f64,
    /// 主色彩度（OkLCh）
    pub chroma: f64,
    /// 主色像素占比
    pub coverage: f64,
    /// 5 组关键色 × 13 级色板
    pub keys: KeyColors,
    /// 浅色 / 深色配色方案（19 个角色）
    pub light: ColorScheme,
    pub dark: ColorScheme,
}

/// 读取当前壁纸路径（Windows：HKCU\Control Panel\Desktop\Wallpaper）。
pub fn current_wallpaper_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(p) = read_wallpaper_registry() {
            if p.is_file() {
                return Some(p);
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let transcoded = PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Themes")
                .join("TranscodedWallpaper");
            if transcoded.is_file() {
                return Some(transcoded);
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// 壁纸路径是否指向一个可读的文件（诊断与测试用）。
#[cfg(test)]
pub fn wallpaper_readable(path: &std::path::Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

#[cfg(windows)]
fn read_wallpaper_registry() -> Option<PathBuf> {
    use std::process::Command;

    let mut cmd = Command::new("reg");
    cmd.args(["query", r"HKCU\Control Panel\Desktop", "/v", "Wallpaper"]);
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Wallpaper") {
            let rest = rest.trim_start();
            if let Some(idx) = rest.find("REG_SZ") {
                let value = rest[idx + "REG_SZ".len()..].trim();
                if !value.is_empty() {
                    return Some(PathBuf::from(value));
                }
            }
        }
    }
    None
}

/// 主色提取的直方图统计（可并行累加）。
#[derive(Clone, Copy)]
struct SeedStats {
    weight: [f64; 24],
    count: [usize; 24],
    sum_cos: [f64; 24],
    sum_sin: [f64; 24],
    sum_chroma: [f64; 24],
    total: usize,
}

impl SeedStats {
    fn new() -> Self {
        Self {
            weight: [0.0; 24],
            count: [0; 24],
            sum_cos: [0.0; 24],
            sum_sin: [0.0; 24],
            sum_chroma: [0.0; 24],
            total: 0,
        }
    }

    fn absorb(&mut self, other: &SeedStats) {
        for i in 0..24 {
            self.weight[i] += other.weight[i];
            self.count[i] += other.count[i];
            self.sum_cos[i] += other.sum_cos[i];
            self.sum_sin[i] += other.sum_sin[i];
            self.sum_chroma[i] += other.sum_chroma[i];
        }
        self.total += other.total;
    }
}

/// 统计一段像素：按 15° 色相分桶、以彩度加权，忽略近灰与过暗/过亮像素。
fn accumulate(pixels: &[u8]) -> SeedStats {
    let mut s = SeedStats::new();
    for px in pixels.chunks_exact(3) {
        let (r, g, b) = (
            px[0] as f64 / 255.0,
            px[1] as f64 / 255.0,
            px[2] as f64 / 255.0,
        );
        let (l, c, h) = rgb_to_oklch(r, g, b);
        s.total += 1;
        if !(0.12..=0.94).contains(&l) || c < 0.035 {
            continue;
        }
        let w = c.powf(1.6);
        let idx = ((h / 15.0) as usize) % 24;
        s.weight[idx] += w;
        s.count[idx] += 1;
        s.sum_chroma[idx] += c * w;
        s.sum_cos[idx] += h.to_radians().cos() * w;
        s.sum_sin[idx] += h.to_radians().sin() * w;
    }
    s
}

/// 从图片像素提取主色：按色相分桶、以彩度加权，忽略近灰与过暗/过亮像素。
/// 返回 (色相, 彩度, 覆盖率)，其中覆盖率为**主色桶的像素占比**。
///
/// 4K 壁纸有 800 万像素，逐像素转 OkLCh 约需数秒，因此按行切块并行统计
/// （取色只需要直方图，可无锁并行累加）。
fn extract_seed(img: &image::RgbImage) -> Option<(f64, f64, f64)> {
    let raw = img.as_raw();
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(1, 8))
        .unwrap_or(4);
    // 按像素数均分（每像素 3 字节），保证各线程工作量相近
    let per_thread = raw.len().div_ceil(threads).max(3);

    let mut stats = SeedStats::new();
    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(threads);
        for chunk in raw.chunks(per_thread) {
            // 尾部不足 3 字节的余数直接丢弃（最多 2 字节，无影响）
            handles.push(scope.spawn(move || accumulate(chunk)));
        }
        for h in handles {
            stats.absorb(&h.join().unwrap_or_else(|_| SeedStats::new()));
        }
    });

    let best = (0..24).max_by(|&a, &b| {
        stats.weight[a]
            .partial_cmp(&stats.weight[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    })?;
    if stats.weight[best] <= 0.0 || stats.total == 0 {
        return None;
    }
    let w = stats.weight[best];
    let chroma = stats.sum_chroma[best] / w;
    let hue = stats.sum_sin[best]
        .atan2(stats.sum_cos[best])
        .to_degrees()
        .rem_euclid(360.0);
    Some((hue, chroma, stats.count[best] as f64 / stats.total as f64))
}

/// 完整流程：定位壁纸 → 命中缓存则直接用 → 否则解码 → 并行取色 → 落盘缓存。
///
/// 不做整图缩略：4K 壁纸的高质量缩放本身要 1 秒以上，而取色只需直方图，
/// 直接在原图上按行并行统计更快也更准。
///
/// 取色本身约 0.8s，但 4K JPEG 解码要 4s 以上，因此把结果按
/// 「壁纸路径 + 修改时间 + 文件大小」缓存到本地，重复启动即可秒开。
pub fn palette_from_wallpaper() -> Result<WallpaperPalette, String> {
    let path = current_wallpaper_path()
        .ok_or_else(|| "未能定位当前桌面壁纸（注册表项缺失或文件不存在）".to_string())?;

    let key = cache_key(&path);
    if let Some(cached) = load_cached(&key) {
        return Ok(cached);
    }

    let img = image::open(&path)
        .map_err(|e| format!("壁纸解码失败（{}）：{e}", path.display()))?
        .to_rgb8();

    let (hue, chroma, coverage) = extract_seed(&img)
        .ok_or_else(|| "壁纸中未找到足够鲜艳的颜色（可能为纯灰/纯黑壁纸）".to_string())?;

    let keys = key_colors_from_seed(hue, chroma);
    let (light, dark) = schemes_from_keys(&keys);
    let seed = lookup(&keys.primary, 40);

    let palette = WallpaperPalette {
        path: path.to_string_lossy().to_string(),
        seed,
        hue,
        chroma,
        coverage,
        keys,
        light,
        dark,
    };
    save_cached(&key, &palette);
    Ok(palette)
}

// ============================================================
// 取色结果缓存
// ============================================================

/// 缓存目录（由外壳启动时注入；测试或未注入时退回临时目录）。
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}

fn cache_file() -> Option<PathBuf> {
    let dir = CACHE_DIR.get().cloned().unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("wallpaper-palette.json"))
}

/// 缓存键：壁纸路径 + 修改时间 + 文件大小；任一变化即视为换了壁纸。
fn cache_key(path: &std::path::Path) -> String {
    let meta = std::fs::metadata(path).ok();
    let modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let size = meta.map(|m| m.len()).unwrap_or(0);
    format!("{}|{modified}|{size}", path.display())
}

#[derive(Serialize, Deserialize)]
struct CacheEntry {
    key: String,
    palette: WallpaperPalette,
}

fn load_cached(key: &str) -> Option<WallpaperPalette> {
    let file = cache_file()?;
    let text = std::fs::read_to_string(&file).ok()?;
    let entry: CacheEntry = serde_json::from_str(&text).ok()?;
    if entry.key == key {
        Some(entry.palette)
    } else {
        None
    }
}

fn save_cached(key: &str, palette: &WallpaperPalette) {
    let Some(file) = cache_file() else { return };
    let entry = CacheEntry {
        key: key.to_string(),
        palette: palette.clone(),
    };
    if let Ok(text) = serde_json::to_string(&entry) {
        let _ = std::fs::write(file, text);
    }
}

/// 手动指定色相时，前端需要与壁纸取色同构的结果。
pub fn palette_from_hue(hue: f64, chroma: f64) -> WallpaperPalette {
    let keys = key_colors_from_seed(hue, chroma);
    let (light, dark) = schemes_from_keys(&keys);
    let seed = lookup(&keys.primary, 40);
    WallpaperPalette {
        path: String::new(),
        seed,
        hue: hue.rem_euclid(360.0),
        chroma,
        coverage: 0.0,
        keys,
        light,
        dark,
    }
}

// ============================================================
// 测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn relative_luminance(hex: &str) -> f64 {
        let (r, g, b) = parse_hex(hex);
        let f = |c: f64| {
            if c <= 0.03928 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }

    fn contrast(a: &str, b: &str) -> f64 {
        let (l1, l2) = (relative_luminance(a), relative_luminance(b));
        let (hi, lo) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
        (hi + 0.05) / (lo + 0.05)
    }

    #[test]
    fn oklch_round_trip_is_stable() {
        for &(r, g, b) in &[(0.2, 0.5, 0.9), (0.9, 0.3, 0.1), (0.5, 0.5, 0.5)] {
            let (l, c, h) = rgb_to_oklch(r, g, b);
            let (r2, g2, b2) = oklch_to_rgb(l, c, h);
            assert!((r - r2).abs() < 1e-6, "r {r} vs {r2}");
            assert!((g - g2).abs() < 1e-6, "g {g} vs {g2}");
            assert!((b - b2).abs() < 1e-6, "b {b} vs {b2}");
        }
    }

    #[test]
    fn known_colors_map_to_expected_hues() {
        let (_, _, h_red) = rgb_to_oklch(1.0, 0.0, 0.0);
        let (_, _, h_green) = rgb_to_oklch(0.0, 1.0, 0.0);
        let (_, _, h_blue) = rgb_to_oklch(0.0, 0.0, 1.0);
        assert!((20.0..45.0).contains(&h_red), "红应在 20-45°，实际 {h_red}");
        assert!((130.0..165.0).contains(&h_green), "绿应在 130-165°，实际 {h_green}");
        assert!((250.0..290.0).contains(&h_blue), "蓝应在 250-290°，实际 {h_blue}");
    }

    #[test]
    fn tonal_palette_has_thirteen_tones() {
        let p = tonal_palette(35.0, 0.20);
        assert_eq!(p.len(), 13, "M3 色板应为 13 级");
        assert_eq!(p[0], "#000000");
        assert_eq!(p[12], "#FFFFFF");
        for hex in &p {
            assert_eq!(hex.len(), 7, "非法色值 {hex}");
            assert!(u32::from_str_radix(&hex[1..], 16).is_ok(), "非法色值 {hex}");
        }
    }

    #[test]
    fn lightness_is_monotonic_across_tones() {
        for &(h, c) in &[(35.0, 0.20), (250.0, 0.16), (140.0, 0.12)] {
            let p = tonal_palette(h, c);
            let mut prev = -1.0;
            for hex in &p {
                let (r, g, b) = parse_hex(hex);
                let (l, _, _) = rgb_to_oklch(r, g, b);
                assert!(l >= prev - 0.02, "亮度未单调：{hex} l={l} prev={prev}");
                prev = l;
            }
        }
    }

    #[test]
    fn tone_gaps_meet_contrast_requirements() {
        // M3 承诺：色阶差 40 → ≥3:1，差 50 → ≥4.5:1，差 70 → ≥7:1
        for &(h, c) in &[(35.0, 0.20), (250.0, 0.16), (0.0, 0.001)] {
            let p = tonal_palette(h, c);
            let at = |tone: u32| p[tone_index(tone)].clone();
            assert!(
                contrast(&at(40), &at(80)) >= 3.0,
                "tone40/tone80 对比度不足：{:.2}",
                contrast(&at(40), &at(80))
            );
            assert!(
                contrast(&at(40), &at(90)) >= 4.5,
                "tone40/tone90 对比度不足：{:.2}",
                contrast(&at(40), &at(90))
            );
            assert!(
                contrast(&at(10), &at(80)) >= 7.0,
                "tone10/tone80 对比度不足：{:.2}",
                contrast(&at(10), &at(80))
            );
        }
    }

    #[test]
    fn key_colors_have_five_groups_of_thirteen() {
        let keys = key_colors_from_seed(35.0, 0.20);
        for (name, p) in [
            ("primary", &keys.primary),
            ("secondary", &keys.secondary),
            ("tertiary", &keys.tertiary),
            ("neutral", &keys.neutral),
            ("neutralVariant", &keys.neutral_variant),
        ] {
            assert_eq!(p.len(), 13, "{name} 应有 13 级");
            assert_eq!(p[0], "#000000", "{name} tone0 应为黑");
            assert_eq!(p[12], "#FFFFFF", "{name} tone100 应为白");
        }
        // 次要色比主色更灰；第三色与主色不同
        assert_ne!(keys.primary[4], keys.secondary[4]);
        assert_ne!(keys.primary[4], keys.tertiary[4]);
        // 中性色应接近灰（R/G/B 三通道差异很小）
        let (r, g, b) = parse_hex(&keys.neutral[6]);
        let spread = [r, g, b].iter().cloned().fold(f64::MIN, f64::max)
            - [r, g, b].iter().cloned().fold(f64::MAX, f64::min);
        assert!(spread < 0.10, "中性色过于鲜艳：spread={spread}");
    }

    #[test]
    fn scheme_roles_follow_m3_tone_mapping() {
        let keys = key_colors_from_seed(35.0, 0.20);
        let (light, dark) = schemes_from_keys(&keys);

        // 浅色：主色 = 色板 tone40，容器 tone90 / tone10
        assert_eq!(light.primary, keys.primary[tone_index(40)]);
        assert_eq!(light.on_primary, keys.primary[tone_index(100)]);
        assert_eq!(light.primary_container, keys.primary[tone_index(90)]);
        assert_eq!(light.on_primary_container, keys.primary[tone_index(10)]);
        // surface 用 tone98（介于 95 与 99 之间），需与 lookup 的插值结果一致
        assert_eq!(light.surface, lookup(&keys.neutral, 98));
        assert_ne!(light.surface, keys.neutral[tone_index(95)]);
        assert_ne!(light.surface, keys.neutral[tone_index(100)]);

        // 深色：主色 = 色板 tone80，容器 tone30 / tone90
        assert_eq!(dark.primary, keys.primary[tone_index(80)]);
        assert_eq!(dark.on_primary, keys.primary[tone_index(20)]);
        assert_eq!(dark.primary_container, keys.primary[tone_index(30)]);
        assert_eq!(dark.on_primary_container, keys.primary[tone_index(90)]);
    }

    #[test]
    fn schemes_provide_readable_foregrounds() {
        let keys = key_colors_from_seed(210.0, 0.15);
        let (light, dark) = schemes_from_keys(&keys);
        for (name, fg, bg, need) in [
            ("light/onPrimary", &light.on_primary, &light.primary, 4.5),
            ("light/onSurface", &light.on_surface, &light.surface, 7.0),
            (
                "light/onSurfaceVariant",
                &light.on_surface_variant,
                &light.surface,
                4.5,
            ),
            ("dark/onPrimary", &dark.on_primary, &dark.primary, 4.5),
            ("dark/onSurface", &dark.on_surface, &dark.surface, 7.0),
            (
                "dark/onSurfaceVariant",
                &dark.on_surface_variant,
                &dark.surface,
                4.5,
            ),
        ] {
            let c = contrast(fg, bg);
            assert!(c >= need, "{name} 对比度 {c:.2} 低于 {need}:1");
        }
    }

    #[test]
    fn surface_containers_are_ordered() {
        let keys = key_colors_from_seed(35.0, 0.20);
        let (light, dark) = schemes_from_keys(&keys);
        // 浅色：容器越"高"越暗（tone 递减）
        let l = [
            &light.surface_container_lowest,
            &light.surface_container_low,
            &light.surface_container,
            &light.surface_container_high,
            &light.surface_container_highest,
        ];
        for w in l.windows(2) {
            assert!(
                relative_luminance(w[0]) > relative_luminance(w[1]),
                "浅色 surfaceContainer 顺序错误：{} vs {}",
                w[0],
                w[1]
            );
        }
        // 深色：容器越"高"越亮
        let d = [
            &dark.surface_container_lowest,
            &dark.surface_container_low,
            &dark.surface_container,
            &dark.surface_container_high,
            &dark.surface_container_highest,
        ];
        for w in d.windows(2) {
            assert!(
                relative_luminance(w[0]) < relative_luminance(w[1]),
                "深色 surfaceContainer 顺序错误：{} vs {}",
                w[0],
                w[1]
            );
        }
    }

    #[test]
    fn seed_extraction_ignores_grayscale_image() {
        let img = image::RgbImage::from_pixel(64, 64, image::Rgb([128, 128, 128]));
        assert!(extract_seed(&img).is_none(), "纯灰图不应产生主色");
    }

    #[test]
    fn seed_extraction_finds_dominant_hue() {
        // 大面积蓝色 + 小块橙色：主色应为蓝
        let mut img = image::RgbImage::from_pixel(80, 80, image::Rgb([60, 110, 230]));
        for y in 0..10 {
            for x in 0..10 {
                img.put_pixel(x, y, image::Rgb([240, 140, 20]));
            }
        }
        let (hue, chroma, coverage) = extract_seed(&img).expect("应提取到主色");
        assert!((220.0..300.0).contains(&hue), "主色相应为蓝，实际 {hue}");
        assert!(chroma > 0.05, "彩度应大于 0.05，实际 {chroma}");
        assert!(coverage > 0.5, "蓝色占比应超过一半，实际 {coverage}");
    }

    #[test]
    fn seed_extraction_skips_near_black_but_keeps_dark_colors() {
        // 近黑像素不参与（否则深色壁纸会被判为黑）
        let dark = image::RgbImage::from_pixel(40, 40, image::Rgb([8, 8, 10]));
        assert!(extract_seed(&dark).is_none());
        // 但明显有色的深色仍应被识别
        let deep_blue = image::RgbImage::from_pixel(40, 40, image::Rgb([20, 40, 90]));
        let (hue, _, _) = extract_seed(&deep_blue).expect("深蓝应可识别");
        assert!((220.0..300.0).contains(&hue), "深蓝色相异常：{hue}");
    }

    #[test]
    fn manual_hue_produces_full_scheme() {
        let p = palette_from_hue(252.0, 0.15);
        assert_eq!(p.keys.primary.len(), 13);
        assert_eq!(p.keys.neutral_variant.len(), 13);
        assert!(p.seed.starts_with('#'));
        assert_ne!(p.light.primary, p.dark.primary);
        assert!(!p.light.surface.is_empty() && !p.dark.surface.is_empty());
    }

    #[test]
    fn missing_wallpaper_file_is_reported_not_panicked() {
        // 壁纸被删除/移动时必须能被判定出来（前端据此回退默认色板），而不是 panic
        let missing = std::env::temp_dir().join("__mtk_no_such_wallpaper__.jpg");
        let _ = std::fs::remove_file(&missing);
        assert!(!wallpaper_readable(&missing), "不存在的壁纸不应判定为可读");
        assert!(image::open(&missing).is_err(), "不存在的壁纸应解码失败");
    }

    #[test]
    fn corrupted_wallpaper_file_is_reported_not_panicked() {
        // 文件存在但不是图片：解码失败，同样不应 panic
        let bad = std::env::temp_dir().join("__mtk_bad_wallpaper__.jpg");
        std::fs::write(&bad, b"this is definitely not a jpeg").unwrap();
        assert!(wallpaper_readable(&bad), "文件存在即视为可读");
        assert!(image::open(&bad).is_err(), "损坏的图片应解码失败");
        let _ = std::fs::remove_file(&bad);
    }

    #[test]
    fn real_wallpaper_pipeline_is_fast_and_deterministic() {
        // 若本机存在壁纸，验证整条取色链路可重复且耗时可控；无壁纸环境直接跳过
        let Some(path) = current_wallpaper_path() else {
            return;
        };

        // 分阶段计时，便于定位瓶颈
        let t0 = std::time::Instant::now();
        let decoded = image::open(&path).map(|i| i.to_rgb8());
        let t_decode = t0.elapsed();
        let Ok(img) = decoded else {
            return; // 壁纸存在但无法解析（少见格式）：返回 Err 亦属预期
        };
        let t1 = std::time::Instant::now();
        let seed = extract_seed(&img);
        let t_extract = t1.elapsed();
        eprintln!(
            "壁纸 {} 尺寸 {}x{} | 解码 {t_decode:?} | 取色 {t_extract:?}",
            path.display(),
            img.width(),
            img.height()
        );
        assert!(seed.is_some(), "壁纸应能取到主色");

        let start = std::time::Instant::now();
        let first = palette_from_wallpaper();
        let elapsed = start.elapsed();
        let Ok(first) = first else {
            return;
        };
        eprintln!("完整取色（含缓存） {elapsed:?}");
        assert!(elapsed.as_secs() < 8, "取色耗时过长：{elapsed:?}");
        assert_eq!(first.keys.primary.len(), 13);
        assert!(first.light.primary.starts_with('#'));

        // 第二次必须走缓存且结果一致（缓存键由路径+修改时间+大小决定）
        let t3 = std::time::Instant::now();
        if let Ok(second) = palette_from_wallpaper() {
            let cached_elapsed = t3.elapsed();
            eprintln!("第二次取色（应命中缓存） {cached_elapsed:?}");
            assert!(
                cached_elapsed.as_millis() < 500,
                "缓存未命中，耗时 {cached_elapsed:?}"
            );
            assert_eq!(first.hue, second.hue);
            assert_eq!(first.seed, second.seed);
            assert_eq!(first.light.primary, second.light.primary);
            assert_eq!(first.dark.surface, second.dark.surface);
        }
    }

    #[test]
    fn cache_round_trip_and_invalidation() {
        let dir = std::env::temp_dir().join("mtk-theme-cache-test");
        let _ = std::fs::remove_dir_all(&dir);
        set_cache_dir(dir.clone());

        let keys = key_colors_from_seed(200.0, 0.14);
        let (light, dark) = schemes_from_keys(&keys);
        let palette = WallpaperPalette {
            path: "X:\\wall.jpg".into(),
            seed: light.primary.clone(),
            hue: 200.0,
            chroma: 0.14,
            coverage: 0.5,
            keys,
            light,
            dark,
        };

        assert!(load_cached("k1").is_none(), "缓存初始应为空");
        save_cached("k1", &palette);
        let loaded = load_cached("k1").expect("同键应命中缓存");
        assert_eq!(loaded.seed, palette.seed);
        assert_eq!(loaded.light.primary, palette.light.primary);
        assert_eq!(loaded.keys.neutral.len(), 13);

        // 换了壁纸（键不同）不应命中旧缓存
        assert!(load_cached("k2").is_none(), "换壁纸后不应命中旧缓存");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
