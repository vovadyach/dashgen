import { Moon, Sun } from "lucide-react";

import { useTheme } from "../theme.tsx";
import { Button } from "./ui/button.tsx";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        theme === "dark" ? "Use the light theme" : "Use the dark theme"
      }
    >
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
