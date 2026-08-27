import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
