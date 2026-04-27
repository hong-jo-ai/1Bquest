import AppHeader from "@/components/AppHeader";
import MadsThresholds from "@/components/mads/MadsThresholds";
import MadsRecommendationsClient from "@/components/mads/MadsRecommendationsClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { Zap, AlertCircle, LogIn, Brain } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdsPage() {
  const metaToken = await getMetaTokenServer();
  const isConnected = !!metaToken;

  return (
    <>
      <AppHeader refreshHref="/ads" />
      <main className="w-full min-w-0 max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">

        {/* 헤더 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-6 py-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white shrink-0">
                <Brain size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">광고 의사결정 시스템 (MADS)</h1>
                <p className="text-xs text-zinc-400 mt-0.5">신뢰등급 + BE ROAS 기반 추천 — 모든 적용은 직접 결정</p>
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
              <p className="text-xs mt-1 opacity-80">상단 &lsquo;Meta 광고 연결&rsquo; 버튼으로 연결하세요. 연결 후 매일 KST 09:00에 자동 평가됩니다.</p>
            </div>
          </div>
        )}

        {isConnected && (
          <>
            <MadsThresholds />

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
                  <Zap size={16} className="text-violet-500" />
                  대기 중 추천
                </h2>
                <p className="text-xs text-zinc-400">매일 KST 09:00 자동 평가 + KST 09:30 이메일 리포트</p>
              </div>
              <div className="p-4 sm:p-5">
                <MadsRecommendationsClient />
              </div>
            </div>
          </>
        )}

      </main>
    </>
  );
}
