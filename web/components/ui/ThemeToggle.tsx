"use client";

import { Sun, Moon } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { useTheme } from "./ThemeProvider";

interface ThemeToggleProps {
  asChild?: boolean;
}

export function ThemeToggle({ asChild }: ThemeToggleProps) {
  const { resolved, toggle } = useTheme();
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      onClick={toggle}
      className="rounded-md p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
    >
      {resolved === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </Comp>
  );
}
