import { createContext, type ReactNode, use, useState } from "react";

export type Theme = "light" | "dark";

const ThemeContext = createContext<
  { theme: Theme; toggle: () => void } | undefined
>(undefined);

/**
 * The page's theme, which index.html picks before the page draws, and a
 * toggle that remembers the visitor's choice.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      // index.html reads this key before the page draws.
      localStorage.setItem("theme", next);
    } catch {
      // Storage is blocked, so the choice lasts until the page reloads.
    }
    setTheme(next);
  };
  return <ThemeContext value={{ theme, toggle }}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = use(ThemeContext);
  if (!context) throw new Error("useTheme needs a ThemeProvider around it");
  return context;
}
