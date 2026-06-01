"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus, Search, Users, Send, MessageSquare, Package,
  Download, RefreshCw, Sparkles, FileSpreadsheet,
} from "lucide-react";
import {
  loadInfluencers, saveInfluencers, deleteInfluencer,
  syncInfluencersFromServer,
  type Influencer, type InfluencerStatus,
} from "@/lib/influencerStorage";
import { SEED_INFLUENCERS } from "@/lib/influencerSeedData";
import { generateShippingCSV, downloadCSV } from "@/lib/shippingExport";
import InfluencerCard from "./InfluencerCard";
import ConversationModal from "./ConversationModal";
import ShippingModal from "./ShippingModal";
import AddInfluencerModal from "./AddInfluencerModal";
import DiscoverModal from "./DiscoverModal";
import SendQueueModal from "./SendQueueModal";

// 파이프라인 탭 정의
type TabId = "all" | InfluencerStatus;

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "discovered", label: "발굴" },
  { id: "reviewing", label: "검토중" },
  { id: "approved", label: "승인" },
  { id: "dm_sent", label: "DM발송" },
  { id: "replied", label: "답장수신" },
  { id: "negotiating", label: "협의중" },
  { id: "confirmed", label: "협찬확정" },
  { id: "shipped", label: "제품발송" },
  { id: "posted", label: "포스팅완료" },
  { id: "rejected", label: "거절" },
];

// 통계 카드 정의
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-3 py-3 sm:px-5 sm:py-4 flex items-center gap-2.5 sm:gap-4">
      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon size={16} className="text-white sm:hidden" />
        <Icon size={18} className="text-white hidden sm:block" />
      </div>
      <div className="min-w-0">
        <p className="text-lg sm:text-2xl font-bold text-zinc-800 dark:text-zinc-100">{value}</p>
        <p className="text-[10px] sm:text-xs text-zinc-400 truncate">{label}</p>
      </div>
    </div>
  );
}

export default function InfluencerManager() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [activeTab, setActiveTab]     = useState<TabId>("all");
  const [search, setSearch]           = useState("");
  const [showAdd, setShowAdd]           = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [showQueue, setShowQueue]       = useState(false);
  const [conversationTarget, setConversationTarget] = useState<Influencer | null>(null);
  const [shippingTarget, setShippingTarget]         = useState<Influencer | null>(null);

  const SEED_KEY = "paulvice_influencers_seed_v1";

  const reload = useCallback(() => {
    setInfluencers(loadInfluencers());
  }, []);

  // 마운트 + 30초 폴링으로 서버 동기화
  useEffect(() => {
    const sync = () => {
      syncInfluencersFromServer().then((serverData) => {
        if (serverData && serverData.length > 0) setInfluencers(serverData);
      });
    };
    sync();
    const id = setInterval(sync, 30_000);
    return () => clearInterval(id);
  }, []);

  // 시드 데이터 주입: 버전 키가 없으면 기존 데이터와 병합
  const importSeedData = useCallback((forceOverwrite = false) => {
    const existing = loadInfluencers();
    const existingIds = new Set(existing.map((i) => i.id));

    if (forceOverwrite) {
      // 기존 데이터 전체를 시드로 교체
      saveInfluencers(SEED_INFLUENCERS);
      localStorage.setItem(SEED_KEY, "1");
      reload();
      return;
    }

    // 중복 없는 시드 항목만 추가
    const toAdd = SEED_INFLUENCERS.filter((s) => !existingIds.has(s.id));
    if (toAdd.length > 0) {
      saveInfluencers([...existing, ...toAdd]);
    }
    localStorage.setItem(SEED_KEY, "1");
    reload();
  }, [reload]);

  useEffect(() => {
    // 시드가 아직 주입되지 않았으면 자동 주입
    if (!localStorage.getItem(SEED_KEY)) {
      importSeedData(false);
    } else {
      reload();
    }
  }, [importSeedData, reload]);

  // 전체 탭 정렬 순서: 발굴됨이 가장 위, 거절/보류가 가장 아래.
  // 같은 status 안에서는 최근 업데이트 순.
  const STATUS_ORDER: Record<InfluencerStatus, number> = {
    discovered: 0,
    reviewing: 1,
    approved: 2,
    dm_sent: 3,
    replied: 4,
    negotiating: 5,
    confirmed: 6,
    shipped: 7,
    posted: 8,
    rejected: 9,
  };

  // 필터링 + 정렬
  const filtered = influencers
    .filter((inf) => {
      const matchTab    = activeTab === "all" || inf.status === activeTab;
      const matchSearch = !search || [inf.name, inf.handle, ...inf.categories]
        .some((s) => s.toLowerCase().includes(search.toLowerCase()));
      return matchTab && matchSearch;
    })
    .sort((a, b) => {
      if (activeTab === "all") {
        const diff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (diff !== 0) return diff;
      }
      // 동일 status 또는 특정 탭: 최근 업데이트 우선
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });

  // 탭별 개수
  const tabCount = (id: TabId) =>
    id === "all" ? influencers.length : influencers.filter((i) => i.status === id).length;

  // 통계
  const stats = {
    total:     influencers.length,
    dmSent:    influencers.filter((i) => ["dm_sent", "replied", "negotiating", "confirmed", "shipped", "posted"].includes(i.status)).length,
    replied:   influencers.filter((i) => ["replied", "negotiating", "confirmed", "shipped", "posted"].includes(i.status)).length,
    posted:    influencers.filter((i) => i.status === "posted").length,
  };

  const handleDelete = (id: string) => {
    // 확인창 없이 바로 삭제 (카드의 빠른 삭제 버튼 UX). 삭제된 계정은 발굴 시 자동 제외.
    deleteInfluencer(id);
    reload();
  };

  const handleBulkDownloadCSV = () => {
    const csv = generateShippingCSV(influencers);
    downloadCSV(csv, `우체국택배_전체_${new Date().toLocaleDateString("ko-KR").replace(/\./g, "").replace(/ /g, "")}.csv`);
  };

  const confirmedCount = influencers.filter((i) => i.status === "confirmed" && i.shippingInfo).length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">

        {/* 페이지 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-zinc-800 dark:text-zinc-100">인플루언서 마케팅</h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">협찬 인플루언서 파이프라인 관리</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {confirmedCount > 0 && (
              <button
                onClick={handleBulkDownloadCSV}
                className="flex items-center gap-1.5 text-xs sm:text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl transition-colors"
              >
                <Download size={14} className="sm:hidden" />
                <Download size={15} className="hidden sm:inline" />
                <span className="hidden sm:inline">CSV 전체 다운 </span>
                <span className="sm:hidden">CSV </span>
                ({confirmedCount})
              </button>
            )}
            <button
              onClick={() => {
                if (confirm("트래킹 시트 데이터를 불러옵니다.\n기존에 등록된 데이터는 유지되고 시트 데이터가 추가됩니다.\n\n계속하시겠습니까?")) {
                  importSeedData(false);
                }
              }}
              className="flex items-center gap-1.5 text-xs sm:text-sm font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 px-3 py-2 sm:py-2.5 rounded-xl transition-colors"
              title="트래킹 시트 데이터 불러오기"
            >
              <FileSpreadsheet size={14} className="sm:hidden" />
              <FileSpreadsheet size={15} className="hidden sm:inline" />
              <span className="hidden sm:inline">시트 불러오기</span>
              <span className="sm:hidden">시트</span>
            </button>
            {filtered.length > 0 && (
              <button
                onClick={() => setShowQueue(true)}
                className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl transition-colors"
                title="현재 목록을 순서대로 빠르게 발송"
              >
                <Send size={15} />
                <span className="hidden sm:inline">순차 발송</span>
                <span className="sm:hidden">발송</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/20">
                  {filtered.length}
                </span>
              </button>
            )}
            <button
              onClick={reload}
              className="p-2 sm:p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="새로고침"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => setShowDiscover(true)}
              className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 text-white px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl transition-all"
            >
              <Sparkles size={15} />
              <span className="hidden sm:inline">AI 발굴</span>
              <span className="sm:hidden">발굴</span>
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-xs sm:text-sm font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl transition-colors"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">직접 추가</span>
              <span className="sm:hidden">추가</span>
            </button>
          </div>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
          <StatCard label="전체 인플루언서" value={stats.total}   icon={Users}        color="bg-violet-500" />
          <StatCard label="DM 발송 완료"    value={stats.dmSent}  icon={Send}         color="bg-sky-500"    />
          <StatCard label="답장 수신"        value={stats.replied} icon={MessageSquare} color="bg-amber-500" />
          <StatCard label="포스팅 완료"      value={stats.posted}  icon={Package}      color="bg-fuchsia-500" />
        </div>

        {/* 파이프라인 탭 + 검색 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-3 sm:p-4">
          {/* 탭 */}
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3">
            {TABS.map((tab) => {
              const count = tabCount(tab.id);
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-violet-600 text-white"
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      isActive ? "bg-white/20 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 검색 */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름, @핸들, 카테고리 검색..."
              className="w-full pl-9 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        {/* 결과 개수 */}
        {(activeTab !== "all" || search) && (
          <p className="text-sm text-zinc-400">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{filtered.length}명</span> 표시 중
            {search && <span className="ml-1">— "{search}" 검색 결과</span>}
          </p>
        )}

        {/* 카드 그리드 */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
            <Users size={48} className="opacity-20" />
            <p className="text-base font-medium">
              {influencers.length === 0 ? "아직 등록된 인플루언서가 없습니다" : "검색 결과가 없습니다"}
            </p>
            {influencers.length === 0 && (
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => setShowDiscover(true)}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
                >
                  <Sparkles size={15} />
                  AI로 자동 발굴하기
                </button>
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <Plus size={15} />
                  직접 추가
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
            {filtered.map((inf) => (
              <InfluencerCard
                key={inf.id}
                influencer={inf}
                onConversation={(i) => setConversationTarget(i)}
                onShipping={(i) => setShippingTarget(i)}
                onDelete={handleDelete}
                onChange={reload}
              />
            ))}
          </div>
        )}
      </div>

      {/* 모달들 */}
      {showDiscover && (
        <DiscoverModal
          onClose={() => setShowDiscover(false)}
          onAdded={reload}
        />
      )}
      {showAdd && (
        <AddInfluencerModal
          onSave={reload}
          onClose={() => setShowAdd(false)}
        />
      )}
      {conversationTarget && (
        <ConversationModal
          influencer={conversationTarget}
          onUpdate={() => {
            reload();
            // 현재 열려있는 인플루언서 데이터 갱신
            const updated = loadInfluencers().find((i) => i.id === conversationTarget.id);
            if (updated) setConversationTarget(updated);
          }}
          onClose={() => { setConversationTarget(null); reload(); }}
        />
      )}
      {shippingTarget && (
        <ShippingModal
          influencer={shippingTarget}
          onUpdate={reload}
          onClose={() => { setShippingTarget(null); reload(); }}
        />
      )}
      {showQueue && (
        <SendQueueModal
          queue={filtered}
          onUpdate={reload}
          onClose={() => { setShowQueue(false); reload(); }}
        />
      )}
    </div>
  );
}
