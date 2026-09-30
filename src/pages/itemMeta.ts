/**
 * 移植条目元数据：中文名、说明、分组、风险等级与图标。
 *
 * 风险等级的语义：**勾选的条目越多，产物能正常开机的概率越低**。
 * 每多替换一个与硬件/启动强相关的模块，就多一分与底包不匹配的可能，
 * 因此把"风险"直接标注在条目上，并在卡片顶部给出整体评估。
 *
 * 说明文案依据后端 configs.py 中各条目的实际语义撰写
 * （键名见 tools/mtk-garbage-porttool-master/porttool/configs.py）。
 */
import type { SvgIconComponent } from "@mui/icons-material";

import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import DeveloperBoardOutlinedIcon from "@mui/icons-material/DeveloperBoardOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import AspectRatioOutlinedIcon from "@mui/icons-material/AspectRatioOutlined";
import PhoneAndroidOutlinedIcon from "@mui/icons-material/PhoneAndroidOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import TranslateOutlinedIcon from "@mui/icons-material/TranslateOutlined";
import SimCardOutlinedIcon from "@mui/icons-material/SimCardOutlined";
import CellTowerOutlinedIcon from "@mui/icons-material/CellTowerOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import GraphicEqOutlinedIcon from "@mui/icons-material/GraphicEqOutlined";
import WifiOutlinedIcon from "@mui/icons-material/WifiOutlined";
import BluetoothOutlinedIcon from "@mui/icons-material/BluetoothOutlined";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import BatteryChargingFullOutlinedIcon from "@mui/icons-material/BatteryChargingFullOutlined";
import VibrationOutlinedIcon from "@mui/icons-material/VibrationOutlined";
import DeviceThermostatOutlinedIcon from "@mui/icons-material/DeviceThermostatOutlined";
import SensorsOutlinedIcon from "@mui/icons-material/SensorsOutlined";
import KeyboardOutlinedIcon from "@mui/icons-material/KeyboardOutlined";
import SpeakerOutlinedIcon from "@mui/icons-material/SpeakerOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import TerminalOutlinedIcon from "@mui/icons-material/TerminalOutlined";
import AutoFixHighOutlinedIcon from "@mui/icons-material/AutoFixHighOutlined";
import RestartAltOutlinedIcon from "@mui/icons-material/RestartAltOutlined";
import SettingsSuggestOutlinedIcon from "@mui/icons-material/SettingsSuggestOutlined";

export type Group = "boot" | "system" | "driver" | "audio" | "misc";

/** 风险：勾选后对"能否开机"的影响程度。 */
export type Risk = "safe" | "careful" | "risky";

export interface ItemMeta {
  label: string;
  desc: string;
  group: Group;
  risk: Risk;
  Icon: SvgIconComponent;
}

export const GROUPS: { key: Group; label: string; hint: string }[] = [
  { key: "boot", label: "引导与内核", hint: "boot.img 层面的替换与配置" },
  { key: "system", label: "系统属性", hint: "build.prop 与设备标识同步" },
  { key: "driver", label: "硬件驱动", hint: "system/vendor 下的 HAL 与固件替换" },
  { key: "audio", label: "音频与显示", hint: "外放无声、显示异常相关" },
  { key: "misc", label: "打包与其他", hint: "产物形式与打包脚本" },
];

export const RISK_LABEL: Record<Risk, string> = {
  safe: "低风险",
  careful: "需留意",
  risky: "高风险",
};

export const RISK_HINT: Record<Risk, string> = {
  safe: "不改变启动关键路径，一般不影响开机",
  careful: "替换后若与底包不匹配，可能出现对应功能异常",
  risky: "直接影响启动或大范围硬件匹配，勾选越多越容易开不了机",
};

const M = (
  label: string,
  desc: string,
  group: Group,
  risk: Risk,
  Icon: SvgIconComponent,
): ItemMeta => ({ label, desc, group, risk, Icon });

export const ITEM_META: Record<string, ItemMeta> = {
  // ---------- 引导与内核 ----------
  replace_kernel: M(
    "替换内核",
    "用底包内核替换移植源内核。内核与底包硬件匹配是能否开机的第一关键项，非同平台内核会直接卡第一屏。",
    "boot",
    "risky",
    MemoryOutlinedIcon,
  ),
  replace_fstab: M(
    "替换分区表",
    "把底包的 fstab 分区表写入 boot。分区命名或大小不一致时会导致挂载失败，仅在移植源分区布局与底包差异较大时勾选。",
    "boot",
    "risky",
    AccountTreeOutlinedIcon,
  ),
  selinux_permissive: M(
    "SELinux 宽容模式",
    "将 SELinux 置为 permissive 并写入相关属性。用于绕过启动阶段的安全策略拒绝，代价是降低系统安全性。",
    "boot",
    "careful",
    LockOpenOutlinedIcon,
  ),
  enable_adb: M(
    "开启 ADB 调试",
    "写入 ro.debuggable / ro.adb.secure 等属性，让系统启动后即可用 adb 连接，方便排查问题。",
    "boot",
    "safe",
    BugReportOutlinedIcon,
  ),
  replace_init: M(
    "替换 init",
    "替换 init 脚本或二进制。init 决定启动流程，与底包不匹配会直接导致无法开机。",
    "boot",
    "risky",
    TerminalOutlinedIcon,
  ),
  change_platform: M(
    "修改芯片平台标识",
    "同步 ro.board.platform、ro.mediatek.platform 等平台属性，让上层按底包平台加载。改错会加载到不匹配的库。",
    "boot",
    "careful",
    DeveloperBoardOutlinedIcon,
  ),

  // ---------- 系统属性 ----------
  fit_density: M(
    "同步屏幕 DPI",
    "按底包密度改写 ro.sf.lcd_density，避免界面元素过大或过小。仅影响显示缩放。",
    "system",
    "safe",
    AspectRatioOutlinedIcon,
  ),
  change_model: M(
    "同步设备型号",
    "同步 ro.product.model / brand / device 等型号信息，让系统识别为底包机型。部分应用与 OTA 会读取这些字段。",
    "system",
    "safe",
    PhoneAndroidOutlinedIcon,
  ),
  change_timezone: M(
    "同步时区",
    "把底包默认时区写入系统属性，避免首次开机时间显示错误。",
    "system",
    "safe",
    ScheduleOutlinedIcon,
  ),
  change_locale: M(
    "同步语言区域",
    "把底包默认语言与区域写入系统属性，决定首次开机的界面语言。",
    "system",
    "safe",
    TranslateOutlinedIcon,
  ),
  single_simcard: M(
    "单卡配置",
    "按单 SIM 方案写入 RIL 相关属性。与底包卡槽数量不符时会出现无信号或双卡识别异常。",
    "system",
    "careful",
    SimCardOutlinedIcon,
  ),
  dual_simcard: M(
    "双卡配置",
    "按双 SIM 方案写入 RIL 相关属性。与底包卡槽数量不符时会出现无信号或双卡识别异常。",
    "system",
    "careful",
    SimCardOutlinedIcon,
  ),

  // ---------- 硬件驱动 ----------
  replace_firmware: M(
    "替换 firmware",
    "替换基带与无线固件目录。固件与底包硬件强相关，错配会导致无信号、WiFi 打不开甚至启动异常。",
    "driver",
    "risky",
    StorageOutlinedIcon,
  ),
  replace_mddb: M(
    "替换 mddb",
    "替换调制解调器数据库文件。与基带固件配套，单独替换可能造成信号异常。",
    "driver",
    "risky",
    StorageOutlinedIcon,
  ),
  replace_malidriver: M(
    "替换 Mali 驱动",
    "替换 GPU 驱动库。用于解决花屏、界面卡顿；与内核版本不匹配会黑屏。",
    "driver",
    "careful",
    DeveloperBoardOutlinedIcon,
  ),
  replace_gralloc: M(
    "替换 gralloc",
    "替换图形内存分配 HAL。与 GPU 驱动、内核显存管理相关，错配会导致界面渲染异常。",
    "driver",
    "careful",
    DeveloperBoardOutlinedIcon,
  ),
  replace_hwcomposer: M(
    "替换 hwcomposer",
    "替换硬件合成器 HAL。负责图层合成，错配会出现闪屏、撕裂或黑屏。",
    "driver",
    "careful",
    DeveloperBoardOutlinedIcon,
  ),
  replace_ril: M(
    "替换 RIL",
    "替换电话与信号相关 HAL。移植后无信号、无法拨号时可尝试勾选。",
    "driver",
    "careful",
    CellTowerOutlinedIcon,
  ),
  replace_sensors: M(
    "替换 sensors",
    "替换传感器 HAL。影响自动亮度、重力感应、方向旋转等功能。",
    "driver",
    "careful",
    SensorsOutlinedIcon,
  ),
  replace_gps: M(
    "替换 GPS",
    "替换定位 HAL 与配置。影响定位速度与精度，不影响开机。",
    "driver",
    "careful",
    ExploreOutlinedIcon,
  ),
  replace_power: M(
    "替换 power",
    "替换电源管理 HAL。影响充电、休眠与电量统计，错配可能造成异常关机。",
    "driver",
    "careful",
    BatteryChargingFullOutlinedIcon,
  ),
  replace_bluetooth: M(
    "替换蓝牙",
    "替换蓝牙 HAL 与固件。影响蓝牙开关与配对，不影响开机。",
    "driver",
    "careful",
    BluetoothOutlinedIcon,
  ),
  replace_vibrator: M(
    "替换振动器",
    "替换振动马达 HAL。影响触感反馈与来电振动。",
    "driver",
    "careful",
    VibrationOutlinedIcon,
  ),
  replace_thermal: M(
    "替换温控",
    "替换温度控制 HAL 与配置。影响发热降频策略，错配可能导致频繁降频或过热保护。",
    "driver",
    "careful",
    DeviceThermostatOutlinedIcon,
  ),
  replace_wifi: M(
    "替换 WiFi",
    "替换 WiFi 驱动与固件。WiFi 打不开或频繁掉线时可勾选；错配会直接导致 WiFi 不可用。",
    "driver",
    "careful",
    WifiOutlinedIcon,
  ),
  replace_camera: M(
    "替换相机",
    "替换相机 HAL 与相关库。影响拍照与录像，不影响开机。",
    "driver",
    "careful",
    VideocamOutlinedIcon,
  ),
  replace_mtk_kpd: M(
    "替换按键驱动",
    "替换 MTK 键盘/按键驱动。影响音量键、电源键等实体按键，错配可能无法唤醒。",
    "driver",
    "risky",
    KeyboardOutlinedIcon,
  ),
  "replace_mtk-kpd": M(
    "替换按键驱动",
    "替换 MTK 键盘/按键驱动。影响音量键、电源键等实体按键，错配可能无法唤醒。",
    "driver",
    "risky",
    KeyboardOutlinedIcon,
  ),
  auto_replace: M(
    "自动识别替换",
    "自动扫描并替换同平台的硬件文件（firmware / HAL / GPU / 音频 / WiFi / RIL 等），不触碰系统框架库。覆盖面大，属于不确定但通常有效的选项。",
    "driver",
    "risky",
    AutoFixHighOutlinedIcon,
  ),

  // ---------- 音频与显示 ----------
  replace_audiodriver: M(
    "替换音频驱动",
    "替换 Audio HAL。移植后外放无声、通话音量异常时的首要排查项。",
    "audio",
    "careful",
    GraphicEqOutlinedIcon,
  ),
  replace_audioengine: M(
    "替换音频引擎",
    "替换音频效果引擎库。影响音效处理链，通常在替换 Audio HAL 后一并勾选。",
    "audio",
    "careful",
    GraphicEqOutlinedIcon,
  ),
  replace_tfa: M(
    "替换 TFA 功放",
    "替换 TFA 智能功放驱动。G79 等机型外放无声的关键项，与音频驱动配套替换。",
    "audio",
    "careful",
    SpeakerOutlinedIcon,
  ),
  replace_libshowlogo: M(
    "替换开机 logo 库",
    "替换开机动画与 logo 相关库。影响开机画面显示，与启动流程无直接关系。",
    "audio",
    "safe",
    ImageOutlinedIcon,
  ),

  // ---------- 打包与其他 ----------
  generate_script: M(
    "生成卡刷脚本",
    "输出 ZIP 卡刷包时生成 updater-script 与 update-binary，决定能否被 recovery 正常刷入。",
    "misc",
    "safe",
    RestartAltOutlinedIcon,
  ),
  use_custom_update_binary: M(
    "自定义 update-binary",
    "使用工具内置的 update-binary 替换卡刷包中的版本，兼容部分旧 recovery。",
    "misc",
    "safe",
    SettingsSuggestOutlinedIcon,
  ),
  "use_custom_update-binary": M(
    "自定义 update-binary",
    "使用工具内置的 update-binary 替换卡刷包中的版本，兼容部分旧 recovery。",
    "misc",
    "safe",
    SettingsSuggestOutlinedIcon,
  ),
};

/** 未收录的条目（后端新增键）使用保守默认值。 */
export function metaFor(key: string): ItemMeta {
  return (
    ITEM_META[key] ?? {
      label: key,
      desc: "后端方案定义的自定义条目，含义请参考 TASK_UI_SHELL.md 或 configs.py。",
      group: "misc",
      risk: "careful",
      Icon: SettingsSuggestOutlinedIcon,
    }
  );
}

/** 按勾选数量评估整体开机风险。 */
export function overallRisk(count: number): { risk: Risk; title: string; detail: string } {
  if (count === 0)
    return {
      risk: "safe",
      title: "未勾选任何条目",
      detail: "不会对产物做任何修改，移植结果与移植源一致。",
    };
  if (count <= 6)
    return {
      risk: "safe",
      title: `已选 ${count} 项 · 风险较低`,
      detail: "以系统属性同步为主，通常不影响开机。",
    };
  if (count <= 14)
    return {
      risk: "careful",
      title: `已选 ${count} 项 · 风险中等`,
      detail: "已涉及多个硬件模块替换，建议确认底包与移植源为同平台。",
    };
  if (count <= 22)
    return {
      risk: "risky",
      title: `已选 ${count} 项 · 风险较高`,
      detail: "大量硬件模块被替换，与底包不匹配时可能卡第一屏。建议先小范围试。",
    };
  return {
    risk: "risky",
    title: `已选 ${count} 项 · 风险很高`,
    detail: "几乎全量替换硬件相关文件，开机失败概率显著上升。建议先只保留内核与属性同步项。",
  };
}
