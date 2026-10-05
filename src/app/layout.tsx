import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "FocusParse",
  // The link preview a stranger reads before arriving, so it says what the home
  // says: the user's own plain line, not the app's internal vocabulary.
  description:
    "FocusParse reads a document aloud and keeps your place word by word. It stops at the end of each section to ask what you just heard.",
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
