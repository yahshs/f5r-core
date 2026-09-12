import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import ThemeProvider from "@/components/theme-provider";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="dark" enableSystem={false} storageKey="f5r-theme">
    <App />
  </ThemeProvider>,
);
