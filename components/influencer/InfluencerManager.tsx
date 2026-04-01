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
  { id: "shipped", label: "발송완료" },
  { id: "rejected", label: "거절" },
];

// 통계 카드 정의
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.ElementType; color: string;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-5 py-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">{value}</p>
        <p className="text-xs text-zinc-400">{label}</p>
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

  // 필터링
  const filtered = influencers.filter((inf) => {
    const matchTab    = activeTab === "all" || inf.status === activeTab;
    const matchSearch = !search || [inf.name, inf.handle, ...inf.categories]
      .some((s) => s.toLowerCase().includes(search.toLowerCase()));
    return matchTab && matchSearch;
  });

  // 탭별 개수
  const tabCount = (id: TabId) =>
    id === "all" ? influencers.length : influencers.filter((i) => i.status === id).length;

  // 통계
  const stats = {
    total:     influencers.length,
    dmSent:    influencers.filter((i) => ["dm_sent", "replied", "negotiating", "confirmed", "shipped"].includes(i.status)).length,
    replied:   influencers.filter((i) => ["replied", "negotiating", "confirmed", "shipped"].includes(i.status)).length,
    confirmed: influencers.filter((i) => i.status === "confirmed" || i.status === "shipped").length,
  };

  const handleDelete = (id: string) => {
    if (confirm("인플루언서를 삭제하시겠습니까?")) {
      deleteInfluencer(id);
      reload();
    }
  };

  const handleBulkDownloadCSV = () => {
    const csv = generateShippingCSV(influencers);
    downloadCSV(csv, `우체국택배_전체_${new Date().toLocaleDateString("ko-KR").replace(/\./g, "").replace(/ /g, "")}.csv`);
  };

  const confirmedCount = influencers.filter((i) => i.status === "confirmed" && i.shippingInfo).length;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* 페이지 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">인플루언서 마케팅</h1>
            <p className="text-sm text-zinc-400 mt-0.5">PAULVICE 협찬 인플루언서 파이프라인 관리</p>
          </div>
          <div className="flex items-center gap-2">
            {confirmedCount > 0 && (
              <button
                onClick={handleBulkDownloadCSV}
                className="flex items-center gap-1.5 text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-xl transition-colors"
              >
                <Download size={15} />
                CSV 전체 다운 ({confirmedCount})
              </button>
            )}
            <button
              onClick={() => {
                if (confirm("트래킹 시트 데이터를 불러옵니다.\n기존에 등록된 데이터는 유지되고 시트 데이터가 추가됩니다.\n\n계속하시겠습니까?")) {
                  importSeedData(false);
                }
              }}
              className="flex items-center gap-1.5 text-sm font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 px-3 py-2.5 rounded-xl transition-colors"
              title="트래킹 시트 데이터 불러오기"
            >
              <FileSpreadsheet size={15} />
              시트 불러오기
            </button>
            <button
              onClick={reload}
              className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => setShowDiscover(true)}
              className="flex items-center gap-1.5 text-sm font-semibold bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700 text-white px-4 py-2.5 rounded-xl transition-all"
            >
              <Sparkles size={16} />
              AI 발굴
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-sm font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus size={16} />
              직접 추가
            </button>
          </div>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="전체 인플루언서" value={stats.total}     icon={Users}        color="bg-violet-500" />
          <StatCard label="DM 발송 완료"    value={stats.dmSent}    icon={Send}         color="bg-sky-500"    />
          <StatCard label="답장 수신"        value={stats.replied}   icon={MessageSquare} color="bg-amber-500" />
          <StatCard label="협찬 확정"        value={stats.confirmed} icon={Package}      color="bg-teal-500"   />
        </div>

        {/* 파이프라인 탭 + 검색 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((inf) => (
              <InfluencerCard
                key={inf.id}
                influencer={inf}
                onConversation={(i) => setConversationTarget(i)}
                onShipping={(i) => setShippingTarget(i)}
                onDelete={handleDelete}
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
    </div>
  );
}
