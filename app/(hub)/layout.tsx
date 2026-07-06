import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";

export const metadata: Metadata = {
  title:       "Harriot Watches · 운영 허브",
  description: "폴바이스·해리엇 브랜드 통합 운영 허브",
};

export default async function HubLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cafe24Connected  = !!(await readRefreshTokenFromStore());          // 폴바이스(기본)
  const harriotConnected = !!(await readRefreshTokenFromStore("harriot"));  // 해리엇
  const metaConnected    = !!(await getMetaTokenServer());

  return (
    <div className="min-h-screen flex">
      <Sidebar cafe24Connected={cafe24Connected} harriotConnected={harriotConnected} metaConnected={metaConnected} />
      <div className="flex-1 min-w-0 flex flex-col bg-zinc-50 dark:bg-zinc-950 pt-12 md:pt-0">
        {children}
      </div>
    </div>
  );
}
