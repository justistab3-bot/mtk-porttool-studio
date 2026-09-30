import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import type { ReactNode } from "react";

import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";

import { pickDirectory, pickFile, type FileFilter } from "../api";

interface PathFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** 不传则选择目录 */
  filters?: FileFilter[];
  placeholder?: string;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
}

/**
 * 路径输入行：手动粘贴与「浏览」按钮并存。
 * 原版只能靠弹窗选择文件，这里把路径显式暴露在表单里，便于复用与核对。
 */
export default function PathField({
  label,
  value,
  onChange,
  filters,
  placeholder,
  required,
  hint,
  disabled,
}: PathFieldProps) {
  const browse = async () => {
    const picked = filters ? await pickFile(filters) : await pickDirectory();
    if (picked) onChange(picked);
  };

  return (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? (filters ? "选择或粘贴文件路径" : "选择或粘贴目录路径")}
      disabled={disabled}
      required={required}
      helperText={hint}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end" sx={{ mr: -0.5 }}>
              {value && (
                <Tooltip title="清空">
                  <IconButton size="small" onClick={() => onChange("")} edge="end">
                    <CloseRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={filters ? "浏览文件" : "浏览目录"}>
                <span>
                  <Button
                    size="small"
                    variant="text"
                    disabled={disabled}
                    onClick={() => void browse()}
                    startIcon={
                      filters ? (
                        <InsertDriveFileOutlinedIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <FolderOpenOutlinedIcon sx={{ fontSize: 16 }} />
                      )
                    }
                    sx={{ minWidth: 0, px: 1 }}
                  >
                    浏览
                  </Button>
                </span>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
      sx={{
        "& .MuiFormHelperText-root": { mx: 0.5 },
        "& .MuiInputLabel-root": { fontSize: 12.5 },
      }}
    />
  );
}

/** 表单区块容器：MD3 卡片的统一内边距与标题间距。 */
export function FieldStack({ children, gap = 1.5 }: { children: ReactNode; gap?: number }) {
  return <Box sx={{ display: "grid", gap }}>{children}</Box>;
}
