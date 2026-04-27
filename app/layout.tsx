import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import NotificationBell from "@/components/NotificationBell";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Harriot Watches · AI 운영 허브",
  description:
    "해리엇와치스 AI 운영 허브 — 폴바이스·해리엇 브랜드 통합 대시보드 (CS, 재고, 광고, 콘텐츠)",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cafe24Connected = !!(
    cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value
  );
  const metaConnected = !!(await getMetaTokenServer());

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <Sidebar cafe24Connected={cafe24Connected} metaConnected={metaConnected} />
        <div className="flex-1 min-w-0 flex flex-col bg-zinc-50 dark:bg-zinc-950 pt-12 md:pt-0">
          {children}
        </div>
        <NotificationBell />
      </body>
    </html>
  );
}
