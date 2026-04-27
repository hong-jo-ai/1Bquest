import type { Metadata } from "next";
import { cookies } from "next/headers";
import Sidebar from "@/components/Sidebar";
import NotificationBell from "@/components/NotificationBell";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

export const metadata: Metadata = {
  title:       "Harriot Watches · 운영 허브",
  description: "폴바이스·해리엇 브랜드 통합 운영 허브",
};

export default async function HubLayout({
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
    <div className="min-h-screen flex">
      <Sidebar cafe24Connected={cafe24Connected} metaConnected={metaConnected} />
      <div className="flex-1 min-w-0 flex flex-col bg-zinc-50 dark:bg-zinc-950 pt-12 md:pt-0">
        {children}
      </div>
      <NotificationBell />
    </div>
  );
}
