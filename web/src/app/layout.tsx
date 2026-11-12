import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "LockedIn Group" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Security: the page may only load from and talk to our own site, our Supabase project and Discord's picture server.
// If you ever move to a different Supabase project, change the two awpyovkucwteyzsqcazl addresses below.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://awpyovkucwteyzsqcazl.supabase.co https://cdn.discordapp.com; connect-src 'self' https://awpyovkucwteyzsqcazl.supabase.co wss://awpyovkucwteyzsqcazl.supabase.co; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

// Before anything is drawn: your group's color and light/dark mode (remembered on this device), so the
// opening screen matches your group. It shows on every open and reload, but never if you prefer less motion (globals.css).
const BEFORE_PAINT = `try {
  window.__liStart = performance.now();
  const root = document.documentElement, accent = localStorage.getItem("accent");
  if (/^[a-z]{3,12}$/.test(accent || "")) root.dataset.accent = accent;
  const theme = (JSON.parse(localStorage.getItem("mnq-settings") || "{}").theme) || "dark";
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
} catch (e) {}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The script above sets data-theme and data-accent on <html> before React starts, so React mustn't complain.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <meta name="theme-color" content="#17181c" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)" />
        <link rel="manifest" href="manifest.webmanifest" />
        <link rel="icon" type="image/png" sizes="128x128" href="icons/favicon-128.png?v=2" />
        <link rel="icon" type="image/png" sizes="64x64" href="icons/favicon-64.png?v=2" />
        <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LockedIn" />
        <link rel="stylesheet" href="vendor/fonts.css" />
        <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
