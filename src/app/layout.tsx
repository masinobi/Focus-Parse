import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "FocusParse",
  description:
    "Synchronized audio-visual ingestion with active kinetic re-encoding.",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="overflow-hidden font-sans antialiased">{children}</body>
    </html>
  );
}
