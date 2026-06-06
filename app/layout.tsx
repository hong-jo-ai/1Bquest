import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import MoriFloatingLauncher from "@/components/mori/MoriFloatingLauncher";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title:       "Harriotwatches Dashboard",
  description: "해리엇워치스 / 폴바이스 운영 도구",
  manifest: "/manifest-dashboard.webmanifest",
  appleWebApp: {
    capable: true,
    title: "대시보드",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/app-icon-dashboard-512.png",
    apple: "/app-icon-dashboard-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0d1320",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-50 dark:bg-zinc-950">
        {children}
        <MoriFloatingLauncher />
      </body>
    </html>
  );
}
