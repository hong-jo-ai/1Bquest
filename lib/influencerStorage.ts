import { saveWithSync, loadFromServer } from "./syncStorage";

// ── 타입 ──────────────────────────────────────────────────────────────────

export type Platform = "instagram" | "youtube" | "tiktok";

export type InfluencerStatus =
  | "discovered"   // 발굴됨
  | "reviewing"    // 검토중
  | "approved"     // 승인됨
  | "dm_sent"      // DM발송
  | "replied"      // 답장수신
  | "negotiating"  // 협의중
  | "confirmed"    // 협찬확정
  | "shipped"      // 발송완료
  | "rejected";    // 거절/보류

export type Priority = "high" | "medium" | "low";

export interface DmMessage {
  id: string;
  direction: "outgoing" | "incoming";
  content: string;
  timestamp: string;
  isTemplate: boolean;
}

export interface ShippingInfo {
  recipientName: string;
  phone: string;
  address: string;
  addressDetail: string;
  postalCode: string;
  productName: string;
  quantity: number;
  memo: string;
}

export interface Influencer {
  id: string;
  platform: Platform;
  handle: string;           // @username (@ 제외)
  name: string;
  profileImage: string;     // URL
  followers: number;
  engagementRate: number;   // % (예: 3.5)
  categories: string[];     // 패션, 라이프스타일 등
  status: InfluencerStatus;
  priority: Priority;
  notes: string;
  addedAt: string;          // ISO
  updatedAt: string;        // ISO
  messages: DmMessage[];
  shippingInfo?: ShippingInfo;
}

// ── 상태 설정 ─────────────────────────────────────────────────────────────

export const STATUS_CONFIG: Record<InfluencerStatus, {
  label: string;
  color: string;
  bg: string;
  border: string;
  next: InfluencerStatus | null;
}> = {
  discovered:  { label: "발굴됨",    color: "text-zinc-500",    bg: "bg-zinc-100",    border: "border-zinc-200",   next: "reviewing"   },
  reviewing:   { label: "검토중",    color: "text-blue-600",    bg: "bg-blue-50",     border: "border-blue-200",   next: "approved"    },
  approved:    { label: "승인됨",    color: "text-violet-600",  bg: "bg-violet-50",   border: "border-violet-200", next: "dm_sent"     },
  dm_sent:     { label: "DM발송",    color: "text-amber-600",   bg: "bg-amber-50",    border: "border-amber-200",  next: "replied"     },
  replied:     { label: "답장수신",  color: "text-sky-600",     bg: "bg-sky-50",      border: "border-sky-200",    next: "negotiating" },
  negotiating: { label: "협의중",    color: "text-orange-600",  bg: "bg-orange-50",   border: "border-orange-200", next: "confirmed"   },
  confirmed:   { label: "협찬확정",  color: "text-emerald-600", bg: "bg-emerald-50",  border: "border-emerald-200",next: "shipped"     },
  shipped:     { label: "발송완료",  color: "text-teal-600",    bg: "bg-teal-50",     border: "border-teal-200",   next: null          },
  rejected:    { label: "거절/보류", color: "text-red-500",     bg: "bg-red-50",      border: "border-red-200",    next: null          },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; dot: string }> = {
  high:   { label: "높음", color: "text-red-500",    dot: "bg-red-400"    },
  medium: { label: "보통", color: "text-amber-500",  dot: "bg-amber-400"  },
  low:    { label: "낮음", color: "text-zinc-400",   dot: "bg-zinc-300"   },
};

export const PLATFORM_CONFIG: Record<Platform, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "text-pink-500"   },
  youtube:   { label: "YouTube",   color: "text-red-500"    },
  tiktok:    { label: "TikTok",    color: "text-zinc-800"   },
};

// ── localStorage ──────────────────────────────────────────────────────────

const STORAGE_KEY = "paulvice_influencers_v1";
const EXCLUDED_KEY = "paulvice_influencers_excluded_v1";

export function loadInfluencers(): Influencer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveInfluencers(list: Influencer[]): void {
  if (typeof window === "undefined") return;
  saveWithSync(STORAGE_KEY, list);
}

/** 앱 마운트 시 서버에서 최신 인플루언서 데이터 로드 */
export async function syncInfluencersFromServer(): Promise<Influencer[] | null> {
  return loadFromServer<Influencer[]>(STORAGE_KEY);
}

export function addInfluencer(inf: Omit<Influencer, "id" | "addedAt" | "updatedAt" | "messages">): Influencer {
  const list = loadInfluencers();
  const now = new Date().toISOString();
  const newInf: Influencer = { ...inf, id: crypto.randomUUID(), addedAt: now, updatedAt: now, messages: [] };
  saveInfluencers([...list, newInf]);
  return newInf;
}

export function updateInfluencer(id: string, patch: Partial<Influencer>): void {
  const list = loadInfluencers();
  const updated = list.map((inf) =>
    inf.id === id ? { ...inf, ...patch, updatedAt: new Date().toISOString() } : inf
  );
  saveInfluencers(updated);
}

export function deleteInfluencer(id: string): void {
  const list = loadInfluencers();
  const target = list.find((inf) => inf.id === id);
  if (target) {
    excludeHandle(target.handle);
  }
  saveInfluencers(list.filter((inf) => inf.id !== id));
}

// ── 제외 목록 (삭제된 인플루언서를 다시 추천하지 않기 위함) ──────────

export function loadExcludedHandles(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(EXCLUDED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function excludeHandle(handle: string): void {
  const set = loadExcludedHandles();
  set.add(handle.toLowerCase());
  if (typeof window !== "undefined") {
    saveWithSync(EXCLUDED_KEY, [...set]);
  }
}

export function addMessage(id: string, msg: Omit<DmMessage, "id" | "timestamp">): void {
  const list = loadInfluencers();
  const updated = list.map((inf) => {
    if (inf.id !== id) return inf;
    const newMsg: DmMessage = { ...msg, id: crypto.randomUUID(), timestamp: new Date().toISOString() };
    return { ...inf, messages: [...inf.messages, newMsg], updatedAt: new Date().toISOString() };
  });
  saveInfluencers(updated);
}

export function advanceStatus(id: string): InfluencerStatus | null {
  const inf = loadInfluencers().find((i) => i.id === id);
  if (!inf) return null;
  const next = STATUS_CONFIG[inf.status].next;
  if (!next) return null;
  updateInfluencer(id, { status: next });
  return next;
}

// ── 숫자 포맷 ─────────────────────────────────────────────────────────────

export function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
