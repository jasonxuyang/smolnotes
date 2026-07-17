import type { Metadata, Viewport } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://smol-notes.jasonxuyang.com";

const title = "SmolNotes";
const description =
  "Local autocomplete notepad in the browser. Ghost suggestions via WebGPU — no server, no API key, nothing leaves the machine.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "SmolNotes",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "SmolNotes",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  alternates: {
    canonical: "/",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceMono.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
