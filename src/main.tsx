import React from "react";
import ReactDOM from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import App from "./App";
import { buildTheme } from "./theme";
import { useApp } from "./store";
import "./index.css";

/** 主题根：订阅生效外观 + MD3 配色方案（默认来自桌面壁纸），并跟随系统外观变化。 */
function ThemeRoot() {
  const effective = useApp((s) => s.effectiveTheme);
  const scheme = useApp((s) => s.themeScheme);
  const resolveTheme = useApp((s) => s.resolveTheme);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => resolveTheme();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [resolveTheme]);

  const theme = React.useMemo(() => buildTheme(effective, scheme), [effective, scheme]);

  React.useEffect(() => {
    document.documentElement.style.colorScheme = effective;
  }, [effective]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeRoot />
  </React.StrictMode>,
);
