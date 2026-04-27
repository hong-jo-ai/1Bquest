import AppHeader from "@/components/AppHeader";
import MetaAutoBudgetTab from "@/components/MetaAutoBudgetTab";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { Wallet, AlertCircle, LogIn } from "lucide-react";
import Link from "next/link";

export default async function AdsAutoPage() {
  const metaToken   = await getMetaTokenServer();
  const isConnected = !!metaToken;

  return (
    <>
      <AppHeader refreshHref="/ads/auto" />
      <main className="w-full min-w-0 max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">

        {/* 헤더 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-6 py-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white shrink-0">
                <Wallet size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">광고 자동화</h1>
                <p className="text-xs text-zinc-400 mt-0.5">매일 KST 09시 자동 추천 — 적용은 직접 결정</p>
              </div>
            </div>

            {!isConnected && (
              <a
                href="/api/meta/auth/login"
                className="flex items-center gap-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-colors"
              >
                <LogIn size={15} />
                Meta 광고 연결
              </a>
            )}
          </div>
        </div>

        {/* 미연결 안내 */}
        {!isConnected && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-2xl px-5 py-4 flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Meta 광고 계정이 연결되지 않았습니다</p>
              <p className="text-xs mt-1 opacity-80">상단 &lsquo;Meta 광고 연결&rsquo; 버튼을 누르거나 <Link href="/ads" className="underline">광고 성과 페이지</Link>에서 연결하세요.</p>
            </div>
          </div>
        )}

        {/* 자동 예산 추천 */}
        {isConnected && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
                <Wallet size={16} className="text-violet-500" />
                광고세트 자동 예산 (추천)
              </h2>
              <p className="text-xs text-zinc-400">7일 ROAS 기준</p>
            </div>
            <MetaAutoBudgetTab />
          </div>
        )}

      </main>
    </>
  );
}
