import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { useApp } from "../store";

/** 全局提示：右下角堆叠，6 秒后自动消失（超时逻辑在 store 中）。 */
export default function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);

  return (
    <>
      {toasts.map((t, idx) => (
        <Snackbar
          key={t.id}
          open
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          sx={{ mb: idx * 7, mr: 1 }}
          onClose={(_, reason) => {
            if (reason === "clickaway") return;
            dismiss(t.id);
          }}
        >
          <Alert
            severity={t.severity}
            variant="filled"
            onClose={() => dismiss(t.id)}
            sx={{ borderRadius: 1.5, alignItems: "center", boxShadow: 4 }}
          >
            {t.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
