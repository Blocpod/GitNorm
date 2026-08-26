import type { Metadata } from "next";
import { canonicalOrigin } from "@/lib/runtime";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalOrigin()),
  title: "GitNorm — A home for the software you make",
  description:
    "Save, update, and share the apps you make without learning Git.",
  openGraph: {
    title: "GitNorm",
    description: "A home for the software you make.",
    images: ["/og.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitNorm",
    description: "A home for the software you make.",
    images: ["/og.png"],
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
