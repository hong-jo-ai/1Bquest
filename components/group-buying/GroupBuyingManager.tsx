"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus, Search, ShoppingBag, TrendingUp, DollarSign, Users, RefreshCw, FileText,
} from "lucide-react";
import { GB_STATUS_CONFIG, type GbCampaign, type GbStatus } from "@/lib/groupBuying/types";
import CampaignCard from "./CampaignCard";
import CreateCampaignModal from "./CreateCampaignModal";
import CampaignDetailModal from "./CampaignDetailModal";

// 파이프라인 탭
type TabId = "all" | GbStatus;

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "전체" },
  ...Object.entries(GB_STATUS_CONFIG).map(([k, v]) => ({ id: k as TabId, label: v.label })),
];

// 통계 카드
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string;
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

export default function GroupBuyingManager() {
  const [campaigns, setCampaigns] = useState<GbCampaign[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [detailTarget, setDetailTarget] = useState<GbCampaign | null>(null);
  const [loading, setLoading] = useState(false);

  const [stats, setStats] = useState({ total: 0, active: 0, totalRevenue: 0, avgCommission: 0 });

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (search) params.set("search", search);
      const res = await fetch(`/api/group-buying/campaigns?${params}`);
      const json = await res.json();
      setCampaigns(json.campaigns ?? []);
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/group-buying/stats");
      const json = await res.json();
      if (!json.error) setStats(json);
    } catch { /* ignore */ }
  }, []);

  // 마운트 + 30초 폴링
  useEffect(() => {
    loadCampaigns();
    loadStats();
    const id = setInterval(() => { loadCampaigns(); loadStats(); }, 30_000);
    return () => clearInterval(id);
  }, [loadCampaigns, loadStats]);

  // 전체 목록 (탭 필터와 별개로 카운트용)
  const [allCampaigns, setAllCampaigns] = useState<GbCampaign[]>([]);
  useEffect(() => {
    fetch("/api/group-buying/campaigns")
      .then((r) => r.json())
      .then((j) => setAllCampaigns(j.campaigns ?? []))
      .catch(() => {});
  }, [campaigns]);

  const tabCount = (id: TabId) =>
    id === "all" ? allCampaigns.length : allCampaigns.filter((c) => c.status === id).length;

  const handleAdvance = async (campaignId: string) => {
    const c = campaigns.find((x) => x.id === campaignId);
    if (!c) return;
    const next = GB_STATUS_CONFIG[c.status].next;
    if (!next) return;
    if (!confirm(`"${c.title}" 상태를 "${GB_STATUS_CONFIG[next].label}"(으)로 변경하시겠습니까?`)) return;
    await fetch(`/api/group-buying/campaigns/${campaignId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    loadCampaigns();
    loadStats();
  };

  const handleDelete = async (campaignId: string) => {
    if (!confirm("이 공동구매를 삭제하시겠습니까?")) return;
    await fetch(`/api/group-buying/campaigns/${campaignId}`, { method: "DELETE" });
    loadCampaigns();
    loadStats();
  };

  const reload = () => { loadCampaigns(); loadStats(); };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ���이지 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">공동구매 관리</h1>
            <p className="text-sm text-zinc-400 mt-0.5">인플루언�� 공동구매 파이프라인</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reload}
              className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <Link
              href="/tools/group-buying/proposal-templates"
              className="flex items-center gap-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-4 py-2.5 rounded-xl transition-colors"
            >
              <FileText size={16} />
              제안 템플릿
            </Link>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus size={16} />
              새 공동구매
            </button>
          </div>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="전체 캠페인" value={String(stats.total)} icon={ShoppingBag} color="bg-violet-500" />
          <StatCard label="진행 중" value={String(stats.active)} icon={TrendingUp} color="bg-blue-500" />
          <StatCard label="총 매출" value={stats.totalRevenue > 0 ? `${Math.round(stats.totalRevenue / 10000)}만` : "0"} icon={DollarSign} color="bg-emerald-500" />
          <StatCard label="평균 수수료율" value={stats.avgCommission > 0 ? `${stats.avgCommission}%` : "-"} icon={Users} color="bg-amber-500" />
        </div>

        {/* 파이프라인 탭 + 검색 */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
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

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="캠페인명, 인플루언��, 상품 검색..."
              className="w-full pl-9 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        {/* 결과 */}
        {(activeTab !== "all" || search) && (
          <p className="text-sm text-zinc-400">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{campaigns.length}건</span> 표시 중
            {search && <span className="ml-1">— &quot;{search}&quot; 검색 결과</span>}
          </p>
        )}

        {/* 카드 그리드 */}
        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
            <ShoppingBag size={48} className="opacity-20" />
            <p className="text-base font-medium">
              {loading ? "불러오는 중..." : "아직 등록된 공동구매가 없습니다"}
            </p>
            {!loading && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
              >
                <Plus size={15} />
                첫 공동구매 등록하기
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onDetail={(camp) => setDetailTarget(camp)}
                onAdvance={handleAdvance}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* 모달 */}
      {showCreate && (
        <CreateCampaignModal
          onSave={reload}
          onClose={() => setShowCreate(false)}
        />
      )}
      {detailTarget && (
        <CampaignDetailModal
          campaign={detailTarget}
          onUpdate={() => {
            reload();
            // 열려있는 캠��인 데이터 갱신
            fetch(`/api/group-buying/campaigns/${detailTarget.id}`)
              .then((r) => r.json())
              .then((j) => { if (j.campaign) setDetailTarget(j.campaign); });
          }}
          onClose={() => { setDetailTarget(null); reload(); }}
        />
      )}
    </div>
  );
}
