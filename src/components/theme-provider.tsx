"use client";

import { createContext, useContext } from "react";

/**
 * EQUIL - Economía Familiar ships a single warm-light theme. The provider is a
 * passthrough kept only so existing `useTheme()` callers keep compiling while the
 * light/dark toggle is retired from Settings. `theme` is always "light" and
 * `toggleTheme` is a no-op.
 */
type Theme = "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeContext.Provider value={{ theme: "light", toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
