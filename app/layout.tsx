import type { Metadata, Viewport } from "next";
import { canonicalOrigin } from "@/lib/runtime";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalOrigin()),
  title: "GitNorm — Build freely. Lose nothing.",
  description:
    "The simple home for every app you build with AI—organized, versioned, and ready to share. No Git required.",
  openGraph: {
    title: "GitNorm — Build freely. Lose nothing.",
    description:
      "Keep every app, every version, and every idea worth sharing—all without learning Git.",
    images: ["/og-v2.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitNorm — Build freely. Lose nothing.",
    description:
      "Keep every app, every version, and every idea worth sharing—all without learning Git.",
    images: ["/og-v2.png"],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
};

const themeInitializer = `
  (() => {
    try {
      const saved = localStorage.getItem("gitnorm-theme");
      const theme = saved === "light" || saved === "dark"
        ? saved
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        "content",
        theme === "dark" ? "#111612" : "#f6f2e9"
      );
    } catch (_) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#f6f2e9" />
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
