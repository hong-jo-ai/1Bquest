"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X, Sparkles, Users, TrendingUp, Plus, SkipForward,
  RefreshCw, CheckCircle, AlertCircle, ChevronRight,
  ExternalLink, ChevronDown, SlidersHorizontal, Bot, Hash,
} from "lucide-react";
import { addInfluencer, loadInfluencers, formatFollowers } from "@/lib/influencerStorage";
import type { DiscoveredInfluencer } from "@/app/api/influencer/discover/route";
import { useAgentConnected, agentDiscover, agentFindSimilar, agentAutoStart } from "./AgentStatus";

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

// ── 옵션 상수 ──────────────────────────────────────────
const CATEGORY_OPTIONS = ["패션", "럭셔리", "라이프스타일", "여행", "뷰티", "운동/헬스", "비즈니스", "음식"];

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "youtube",   label: "YouTube"   },
  { value: "tiktok",    label: "TikTok"    },
] as const;

const FOLLOWER_PRESETS = [
  { label: "1만 이하", min: 1000,    max: 10000   },
  { label: "1만~5만",  min: 10000,   max: 50000   },
  { label: "5만~20만", min: 50000,   max: 200000  },
  { label: "20만~50만",min: 200000,  max: 500000  },
  { label: "50만+",    min: 500000,  max: 10000000},
] as const;

// ── 플랫폼 아이콘 ───────────────────────────────────────
const PlatformIcon = ({ platform }: { platform: string }) => {
  if (platform === "instagram") return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  );
  if (platform === "youtube") return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.78a4.85 4.85 0 01-1.07-.09z"/>
    </svg>
  );
};

// ── 플랫폼별 프로필 URL ─────────────────────────────────
function getProfileUrl(platform: string, handle: string): string {
  if (platform === "instagram") return `https://www.instagram.com/${handle}/`;
  if (platform === "youtube")   return `https://www.youtube.com/@${handle}`;
  if (platform === "tiktok")    return `https://www.tiktok.com/@${handle}`;
  return `https://www.instagram.com/${handle}/`;
}

// ── 칩 버튼 ────────────────────────────────────────────
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
        active
          ? "bg-violet-600 text-white border-violet-600"
          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
      }`}
    >
      {label}
    </button>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────
export default function DiscoverModal({ onClose, onAdded }: Props) {
  const agentConnected = useAgentConnected();
  const [agentStarting, setAgentStarting] = useState(false);

  // 에이전트 모드 선택 시 자동 시작
  const startAgentIfNeeded = useCallback(async () => {
    if (agentConnected || agentStarting) return;
    setAgentStarting(true);
    await agentAutoStart();
    setAgentStarting(false);
  }, [agentConnected, agentStarting]);

  // 탭: "naver" | "agent" | "similar"
  const [discoverMode, setDiscoverMode] = useState<"naver" | "agent" | "similar">("naver");

  // 에이전트 해시태그
  const [hashtagInput, setHashtagInput]       = useState("시계패션 럭셔리라이프 명품시계 패션인플루언서 dailylook");

  // 유사 계정 발굴 - 시드 계정 입력
  const [seedInput, setSeedInput]             = useState("");

  // 기본 조건
  const [platform, setPlatform]               = useState<"instagram" | "youtube" | "tiktok">("instagram");
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["패션", "럭셔리", "라이프스타일"]);

  // 상세 조건
  const [showDetail, setShowDetail]           = useState(false);
  const [gender, setGender]                   = useState("");           // "" | "남성" | "여성"
  const [ageGroup, setAgeGroup]               = useState("");           // "" | "10-20대" | "20-30대" | "30-40대"
  const [nationality, setNationality]         = useState("");           // "" | "한국인" | "외국인"
  const [followerPreset, setFollowerPreset]   = useState(1);           // index into FOLLOWER_PRESETS
  const [contentGuide, setContentGuide]       = useState("");          // 자유 텍스트
  const [extraGuide, setExtraGuide]           = useState("");          // 추가 요구사항

  // 결과
  const [candidates, setCandidates]           = useState<DiscoveredInfluencer[]>([]);
  const [added, setAdded]                     = useState<Set<string>>(new Set());
  const [skipped, setSkipped]                 = useState<Set<string>>(new Set());
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState("");
  const [batch, setBatch]                     = useState(0);
  const [hasSearched, setHasSearched]         = useState(false);
  const [sourceInfo, setSourceInfo]           = useState("");

  const toggleCategory = (cat: string) =>
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );

  // ── 유사 계정 + 댓글 발굴 ──────────────────────────────
  const discoverSimilar = async () => {
    const seedHandles = seedInput
      .split(/[\s,@\n]+/)
      .map((h) => h.replace(/^@/, "").trim().toLowerCase())
      .filter((h) => h.length >= 3);

    if (seedHandles.length === 0) {
      setError("시드 계정을 1개 이상 입력해주세요");
      return;
    }

    setLoading(true);
    setError("");
    setCandidates([]);
    setAdded(new Set());
    setSkipped(new Set());
    setHasSearched(true);

    const preset = FOLLOWER_PRESETS[followerPreset];

    try {
      const data = await agentFindSimilar({
        seedHandles,
        targetCount: 10,
        followerMin: preset.min,
        followerMax: preset.max,
      });
      setBatch(0);
      setCandidates(data.influencers || []);
      setSourceInfo(`@${seedHandles[0]} 등 ${seedHandles.length}개 계정 분석 → ${data.count}명 발굴`);
    } catch (e: any) {
      setError(e.message || "유사 계정 발굴 오류");
    } finally {
      setLoading(false);
    }
  };

  // ── 에이전트 발굴 ──────────────────────────────────────
  const discoverWithAgent = async () => {
    setLoading(true);
    setError("");
    setCandidates([]);
    setAdded(new Set());
    setSkipped(new Set());
    setHasSearched(true);

    const hashtags = hashtagInput.split(/[\s,]+/).filter(Boolean).map((h) => h.replace(/^#/, ""));
    const preset   = FOLLOWER_PRESETS[followerPreset];

    try {
      const data = await agentDiscover({
        hashtags,
        targetCount: 10,
        followerMin: preset.min,
        followerMax: preset.max,
      });
      setBatch(0);
      setCandidates(data.influencers || []);
      setSourceInfo(`Chrome으로 Instagram 직접 탐색 → ${data.count}명 발굴`);
    } catch (e: any) {
      setError(e.message || "에이전트 오류");
    } finally {
      setLoading(false);
    }
  };

  const discover = async (nextBatch = 0) => {
    if (discoverMode === "agent") return discoverWithAgent();

    setLoading(true);
    setError("");
    if (nextBatch === 0) {
      setCandidates([]);
      setAdded(new Set());
      setSkipped(new Set());
    }
    setHasSearched(true);

    const preset = FOLLOWER_PRESETS[followerPreset];

    try {
      const params = new URLSearchParams({
        batch:       String(nextBatch),
        categories:  selectedCategories.join(","),
        platform,
        gender,
        ageGroup,
        nationality,
        followerMin: String(preset.min),
        followerMax: String(preset.max),
        contentGuide,
        extraGuide,
      });
      const res  = await fetch(`/api/influencer/discover?${params}`);
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "ANTHROPIC_API_KEY_MISSING") throw new Error("API_KEY_MISSING");
        if (data.error === "NAVER_NO_RESULTS") throw new Error(data.message || "검색 결과 없음");
        throw new Error(data.error || "발굴 실패");
      }
      setBatch(nextBatch);
      setCandidates(data.influencers);
      const verifiedCount = data.verifiedCount ?? 0;
      const filteredOut   = data.filteredOutCount ?? 0;
      const verifyNote = verifiedCount > 0
        ? ` · ${verifiedCount}개 팔로워 실제 확인${filteredOut > 0 ? ` (범위 밖 ${filteredOut}개 제외)` : ""}`
        : " · 팔로워 수 직접 확인 필요";
      setSourceInfo(`네이버 블로그에서 ${data.foundHandles}개 핸들 수집 → AI 분류${verifyNote}`);
    } catch (e: any) {
      setError(e.message || "오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  };

  const existingHandles = new Set(loadInfluencers().map((i) => i.handle.toLowerCase()));

  const handleAdd = (inf: DiscoveredInfluencer) => {
    addInfluencer({
      platform:      inf.platform,
      handle:        inf.handle,
      name:          inf.name,
      profileImage:  "",
      followers:     inf.followers,
      engagementRate:inf.engagementRate,
      categories:    inf.categories,
      priority:      inf.followers >= 200000 ? "high" : inf.followers >= 50000 ? "medium" : "low",
      notes:         inf.reason,
      status:        "discovered",
    });
    setAdded((prev) => new Set([...prev, inf.handle]));
    onAdded();
  };

  const handleSkip = (handle: string) =>
    setSkipped((prev) => new Set([...prev, handle]));

  const handleAddAll = () => {
    candidates
      .filter((c) => !added.has(c.handle) && !skipped.has(c.handle) && !existingHandles.has(c.handle))
      .forEach(handleAdd);
  };

  const pendingCount = candidates.filter(
    (c) => !added.has(c.handle) && !skipped.has(c.handle) && !existingHandles.has(c.handle)
  ).length;

  // 활성화된 상세 조건 개수 (배지용)
  const activeDetailCount = [gender, ageGroup, nationality, contentGuide, extraGuide].filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── 헤더 ── */}
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-pink-500 rounded-xl flex items-center justify-center shrink-0">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">AI 인플루언서 발굴</h3>
                <p className="text-xs text-zinc-400">PAULVICE와 어울리는 인플루언서를 자동으로 찾아드립니다</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── 모드 탭 ── */}
        <div className="flex border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <button
            onClick={() => setDiscoverMode("naver")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
              discoverMode === "naver"
                ? "border-violet-600 text-violet-600"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            <Sparkles size={14} />
            네이버 검색 발굴
          </button>
          <button
            onClick={() => { setDiscoverMode("agent"); startAgentIfNeeded(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
              discoverMode === "agent"
                ? "border-emerald-600 text-emerald-600"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            <Bot size={14} />
            Chrome 직접 탐색
            {agentConnected
              ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" />
              : <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 ml-0.5" />
            }
          </button>
          <button
            onClick={() => { setDiscoverMode("similar"); startAgentIfNeeded(); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
              discoverMode === "similar"
                ? "border-pink-600 text-pink-600"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            <Users size={14} />
            유사 계정 발굴
            {agentConnected
              ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" />
              : <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 ml-0.5" />
            }
          </button>
        </div>

        {/* ── 검색 설정 패널 ── */}
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0 space-y-3">

          {/* 에이전트 모드 안내 */}
          {(discoverMode === "agent" || discoverMode === "similar") && (
            agentStarting ? (
              <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-2.5 text-xs text-blue-700 dark:text-blue-300">
                <RefreshCw size={13} className="animate-spin" />
                <span>로컬 에이전트 시작 중...</span>
              </div>
            ) : !agentConnected ? (
              <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>에이전트 연결 실패</span>
                </div>
                <button
                  onClick={startAgentIfNeeded}
                  className="shrink-0 flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-lg font-medium transition-colors"
                >
                  <RefreshCw size={11} />
                  다시 시도
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                <Bot size={13} />
                <span>
                  {discoverMode === "similar"
                    ? "에이전트 연결됨 — 시드 계정의 유사 계정·댓글 작성자를 분석합니다"
                    : "에이전트 연결됨 — Chrome이 Instagram을 직접 탐색합니다"}
                </span>
              </div>
            )
          )}

          {/* 유사 계정 모드: 시드 계정 입력 */}
          {discoverMode === "similar" && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 mb-1.5">
                <Users size={12} /> 기준 계정 (협찬 진행했던 계정 핸들, 공백·쉼표·줄바꿈으로 구분)
              </label>
              <textarea
                rows={3}
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder={"예: nugayoung, iamriverkim\n@feve__r stylebyj"}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
              <p className="mt-1.5 text-[11px] text-zinc-400">
                입력한 계정의 인스타그램 '비슷한 계정'과 최근 게시물 댓글 작성자를 분석해 후보를 추천합니다
              </p>
            </div>
          )}

          {/* 에이전트 모드: 해시태그 입력 */}
          {discoverMode === "agent" && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 mb-1.5">
                <Hash size={12} /> 탐색할 해시태그 (공백으로 구분)
              </label>
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                placeholder="시계패션 럭셔리라이프 명품시계 dailylook"
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* 플랫폼 (네이버 모드만) */}
          {discoverMode === "naver" && <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-500 w-12 shrink-0">플랫폼</span>
            <div className="flex gap-1.5">
              {PLATFORM_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPlatform(p.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    platform === p.value
                      ? "bg-violet-600 text-white border-violet-600"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300"
                  }`}
                >
                  <PlatformIcon platform={p.value} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>}

          {/* 카테고리 (네이버 모드만) */}
          {discoverMode === "naver" && <div className="flex items-start gap-3">
            <span className="text-xs font-medium text-zinc-500 w-12 shrink-0 pt-1.5">카테고리</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_OPTIONS.map((cat) => (
                <Chip
                  key={cat} label={cat}
                  active={selectedCategories.includes(cat)}
                  onClick={() => toggleCategory(cat)}
                />
              ))}
            </div>
          </div>}

          {/* 팔로워 범위 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-500 w-12 shrink-0">팔로워</span>
            <div className="flex gap-1.5">
              {FOLLOWER_PRESETS.map((p, idx) => (
                <Chip
                  key={p.label} label={p.label}
                  active={followerPreset === idx}
                  onClick={() => setFollowerPreset(idx)}
                />
              ))}
            </div>
          </div>

          {/* 상세 조건 토글 (네이버 모드만) */}
          {discoverMode === "naver" && <button
            onClick={() => setShowDetail((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            <SlidersHorizontal size={13} />
            상세 조건
            {activeDetailCount > 0 && (
              <span className="bg-violet-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {activeDetailCount}
              </span>
            )}
            <ChevronDown size={13} className={`transition-transform ${showDetail ? "rotate-180" : ""}`} />
          </button>}

          {/* 상세 조건 패널 (네이버 모드만) */}
          {discoverMode === "naver" && showDetail && (
            <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4 space-y-3 text-xs">

              {/* 성별 */}
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 w-16 shrink-0">인플루언서 성별</span>
                <div className="flex gap-1.5">
                  {["무관", "남성", "여성"].map((v) => (
                    <Chip key={v} label={v} active={gender === (v === "무관" ? "" : v)} onClick={() => setGender(v === "무관" ? "" : v)} />
                  ))}
                </div>
              </div>

              {/* 연령대 */}
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 w-16 shrink-0">인플루언서 나이</span>
                <div className="flex gap-1.5">
                  {["무관", "10-20대", "20-30대", "30-40대"].map((v) => (
                    <Chip key={v} label={v} active={ageGroup === (v === "무관" ? "" : v)} onClick={() => setAgeGroup(v === "무관" ? "" : v)} />
                  ))}
                </div>
              </div>

              {/* 국적 */}
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 w-16 shrink-0">국적</span>
                <div className="flex gap-1.5">
                  {["무관", "한국인", "외국인"].map((v) => (
                    <Chip key={v} label={v} active={nationality === (v === "무관" ? "" : v)} onClick={() => setNationality(v === "무관" ? "" : v)} />
                  ))}
                </div>
              </div>

              {/* 게시물 유형 */}
              <div className="flex items-start gap-3">
                <span className="text-zinc-500 w-16 shrink-0 pt-2">게시물 유형</span>
                <input
                  type="text"
                  value={contentGuide}
                  onChange={(e) => setContentGuide(e.target.value)}
                  placeholder="예: 일상 패션 코디, 명품 언박싱, 여행 브이로그..."
                  className="flex-1 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {/* 추가 요구사항 */}
              <div className="flex items-start gap-3">
                <span className="text-zinc-500 w-16 shrink-0 pt-2">추가 조건</span>
                <textarea
                  value={extraGuide}
                  onChange={(e) => setExtraGuide(e.target.value)}
                  rows={2}
                  placeholder="예: 시계나 명품 액세서리를 자주 착용하는 분, 깔끔한 화이트 피드 선호..."
                  className="flex-1 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          )}

          {/* 발굴 버튼 */}
          <button
            onClick={() => discoverMode === "similar" ? discoverSimilar() : discover(0)}
            disabled={
              loading ||
              (discoverMode === "naver" && selectedCategories.length === 0) ||
              (discoverMode === "agent" && !agentConnected) ||
              (discoverMode === "similar" && !agentConnected)
            }
            className={`w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-all ${
              discoverMode === "agent"
                ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                : discoverMode === "similar"
                ? "bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700"
                : "bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-700 hover:to-pink-700"
            }`}
          >
            {loading ? (
              <><RefreshCw size={15} className="animate-spin" /> {
                discoverMode === "agent" ? "Chrome으로 Instagram 탐색 중..." :
                discoverMode === "similar" ? "유사 계정·댓글 분석 중..." :
                "AI가 분석하는 중..."
              }</>
            ) : discoverMode === "agent" ? (
              <><Bot size={15} /> {hasSearched ? "다시 탐색" : "Chrome으로 Instagram 직접 탐색"}</>
            ) : discoverMode === "similar" ? (
              <><Users size={15} /> {hasSearched ? "다시 분석하기" : "유사 계정 + 댓글 작성자 분석"}</>
            ) : (
              <><Sparkles size={15} /> {hasSearched ? "다시 발굴하기" : "10명 발굴 시작"}</>
            )}
          </button>
        </div>

        {/* ── 결과 영역 ── */}
        <div className="flex-1 overflow-y-auto">

          {/* 에러 */}
          {error && (
            <div className="m-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-4 text-sm text-red-700 dark:text-red-300">
              {error === "API_KEY_MISSING" ? (
                <div className="space-y-2">
                  <p className="font-semibold flex items-center gap-2"><AlertCircle size={15} /> Anthropic API 키 설정 필요</p>
                  <ol className="text-xs space-y-1 list-decimal pl-4 leading-relaxed">
                    <li><a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="underline">console.anthropic.com</a> → API Keys에서 키 발급</li>
                    <li>Vercel 대시보드 → 프로젝트 Settings → Environment Variables</li>
                    <li><code className="bg-red-100 dark:bg-red-900/50 px-1 rounded">ANTHROPIC_API_KEY</code> 추가 후 재배포</li>
                  </ol>
                </div>
              ) : (
                <p className="flex items-center gap-2"><AlertCircle size={15} /> {error}</p>
              )}
            </div>
          )}

          {/* 초기 안내 */}
          {!hasSearched && !loading && (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
              <Sparkles size={40} className="opacity-20" />
              <p className="text-sm">조건을 설정하고 발굴을 시작하세요</p>
            </div>
          )}

          {/* 로딩 스켈레톤 */}
          {loading && candidates.length === 0 && (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-start gap-3 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-100 dark:border-zinc-700 p-4 animate-pulse">
                  <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3" />
                    <div className="h-2 bg-zinc-100 dark:bg-zinc-600 rounded w-1/4" />
                    <div className="h-2 bg-zinc-100 dark:bg-zinc-600 rounded w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 결과 카드 */}
          {candidates.length > 0 && (
            <>
              {/* 출처 안내 */}
              {sourceInfo && (
                <div className="mx-4 mt-4 flex items-center gap-2 text-[11px] text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700 rounded-xl px-3 py-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  {sourceInfo} · 계정 확인 후 추가하세요
                </div>
              )}

              {/* 일괄 추가 바 */}
              {pendingCount > 0 && (
                <div className="sticky top-0 z-10 mx-4 mt-4 flex items-center justify-between bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 rounded-xl px-4 py-2.5">
                  <span className="text-xs text-violet-700 dark:text-violet-300 font-medium">
                    미결정 {pendingCount}명
                  </span>
                  <button
                    onClick={handleAddAll}
                    className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    전체 추가
                  </button>
                </div>
              )}

              <div className="p-4 space-y-3">
                {candidates.map((inf) => {
                  const isAdded    = added.has(inf.handle);
                  const isSkipped  = skipped.has(inf.handle);
                  const isExisting = existingHandles.has(inf.handle.toLowerCase());
                  const isDone     = isAdded || isSkipped || isExisting;
                  const profileUrl = getProfileUrl(inf.platform, inf.handle);

                  return (
                    <div
                      key={inf.handle}
                      className={`bg-white dark:bg-zinc-800 rounded-xl border transition-all ${
                        isDone
                          ? "opacity-50 border-zinc-100 dark:border-zinc-700"
                          : "border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700"
                      }`}
                    >
                      {/* 카드 상단 */}
                      <div className="flex items-start gap-3 p-4">
                        {/* 아바타 */}
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-violet-500 flex items-center justify-center text-white font-bold text-lg">
                            {inf.name.charAt(0)}
                          </div>
                          <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 flex items-center justify-center ${
                            inf.platform === "instagram" ? "text-pink-500" :
                            inf.platform === "youtube"   ? "text-red-500"  : "text-black dark:text-white"
                          }`}>
                            <PlatformIcon platform={inf.platform} />
                          </div>
                        </div>

                        {/* 정보 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm">{inf.name}</p>
                            {inf.followersVerified && inf.followers > 0 && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                inf.followers >= 200000 ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" :
                                inf.followers >= 50000  ? "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400" :
                                                          "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                              }`}>
                                {inf.followers >= 200000 ? "MACRO" : inf.followers >= 50000 ? "MID" : "MICRO"}
                              </span>
                            )}
                            {/* 성별/나이/국적 뱃지 */}
                            {inf.gender && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400">
                                {inf.gender}
                              </span>
                            )}
                            {inf.ageGroup && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                                {inf.ageGroup}
                              </span>
                            )}
                            {inf.nationality && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                                {inf.nationality}
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-zinc-400 mb-1.5">@{inf.handle}</p>

                          <div className="flex items-center gap-3 text-xs mb-2">
                            {inf.followersVerified && inf.followers > 0 ? (
                              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                <Users size={11} />
                                {formatFollowers(inf.followers)}
                                <CheckCircle size={10} className="ml-0.5" />
                              </span>
                            ) : inf.followersVerified === false ? (
                              <span className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400">
                                <Users size={11} />
                                <span>팔로워 미확인</span>
                                <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">직접 확인 필요</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-zinc-400">
                                <Users size={11} />
                                {formatFollowers(inf.followers)}
                              </span>
                            )}
                            <span className="flex items-center gap-1 text-zinc-500">
                              <TrendingUp size={11} /> {inf.engagementRate.toFixed(1)}%
                            </span>
                          </div>

                          {inf.contentType && (
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">
                              📸 {inf.contentType}
                            </p>
                          )}

                          <div className="flex flex-wrap gap-1 mb-2">
                            {inf.categories.map((c) => (
                              <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-500">
                                {c}
                              </span>
                            ))}
                          </div>

                          <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2">
                            💡 {inf.reason}
                          </p>
                        </div>

                        {/* 액션 버튼 */}
                        <div className="flex flex-col gap-1.5 shrink-0">
                          {isExisting ? (
                            <span className="text-xs text-zinc-400 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-center">이미 추가됨</span>
                          ) : isAdded ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 font-medium">
                              <CheckCircle size={12} /> 추가됨
                            </span>
                          ) : isSkipped ? (
                            <span className="text-xs text-zinc-400 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-center">건너뜀</span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleAdd(inf)}
                                className="flex items-center justify-center gap-1 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1.5 rounded-lg transition-colors"
                              >
                                <Plus size={12} /> 추가
                              </button>
                              <button
                                onClick={() => handleSkip(inf.handle)}
                                className="flex items-center justify-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
                              >
                                <SkipForward size={12} /> 건너뛰기
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* 카드 하단: 계정 확인 버튼 */}
                      <div className="border-t border-zinc-100 dark:border-zinc-700/60 px-4 py-2.5 flex items-center justify-between">
                        <a
                          href={profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                        >
                          <ExternalLink size={11} />
                          {inf.platform === "instagram" ? "Instagram" : inf.platform === "youtube" ? "YouTube" : "TikTok"}에서 실제 계정 확인
                        </a>
                        {inf.source && (
                          <a
                            href={inf.source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-zinc-300 dark:text-zinc-600 hover:text-zinc-400 transition-colors"
                          >
                            출처: 네이버
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 다음 10명 */}
              <div className="px-4 pb-4">
                <button
                  onClick={() => discover(batch + 1)}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium rounded-xl py-3 text-sm transition-colors disabled:opacity-50"
                >
                  {loading
                    ? <><RefreshCw size={14} className="animate-spin" /> 분석 중...</>
                    : <><ChevronRight size={14} /> 다음 10명 발굴</>
                  }
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
