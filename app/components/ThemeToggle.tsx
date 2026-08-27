"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "gitnorm-theme";
const THEME_COLORS: Record<Theme, string> = {
  light: "#f6f2e9",
  dark: "#111612",
};

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

function subscribeToTheme(onChange: () => void) {
  const preference = window.matchMedia("(prefers-color-scheme: dark)");
  const followSystem = (event: MediaQueryListEvent) => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    applyTheme(event.matches ? "dark" : "light");
    onChange();
  };

  preference.addEventListener("change", followSystem);
  window.addEventListener("gitnorm-themechange", onChange);
  return () => {
    preference.removeEventListener("change", followSystem);
    window.removeEventListener("gitnorm-themechange", onChange);
  };
}

export default function ThemeToggle() {
  const isDark = useSyncExternalStore(
    subscribeToTheme,
    () => currentTheme() === "dark",
    () => false,
  );

  function toggleTheme() {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem(STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event("gitnorm-themechange"));
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
    >
      <span className="theme-toggle__label">Light</span>
      <span className="theme-toggle__track" aria-hidden="true">
        <span className="theme-toggle__thumb" />
      </span>
      <span className="theme-toggle__label">Dark</span>
    </button>
  );
}
