/**
 * 인플루언서 등록 공유 로직.
 *
 * /api/mcp (claude.ai 데스크톱) 와 /api/telegram/webhook (모바일 봇)
 * 양쪽에서 호출.
 *
 * 저장 위치: kv_store 테이블의 paulvice_influencers_v1 키
 *   = 대시보드 InfluencerManager가 30초 폴링으로 동기화하는 그 키.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const INFLUENCERS_KEY = "paulvice_influencers_v1";

export type Platform = "instagram" | "youtube" | "tiktok";
export type Priority = "high" | "medium" | "low";

export interface StoredInfluencer {
  id: string;
  platform: Platform;
  handle: string;
  name: string;
  profileImage: string;
  followers: number;
  engagementRate: number;
  categories: string[];
  status: string;
  priority: Priority;
  notes: string;
  addedAt: string;
  updatedAt: string;
  messages: unknown[];
}

export interface RegisterArgs {
  platform?: string;
  handle?: string;
  name?: string;
  followers?: number;
  engagement_rate?: number;
  categories?: string[];
  priority?: string;
  notes?: string;
}

export type RegisterResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string }
  | { ok: false; duplicate: true; message: string; id: string };

/** Anthropic tool / MCP tool 양쪽에서 공통으로 쓰는 입력 스키마. */
export const REGISTER_INFLUENCER_TOOL = {
  name: "register_influencer",
  description:
    "발굴한 인플루언서를 paulwise 대시보드(인플루언서 발굴 도구)에 등록합니다. " +
    "정보가 부분적이어도 OK — 모르는 필드는 비워두세요. " +
    "등록 후 status는 자동으로 'discovered'(발굴됨)로 설정. " +
    "사용자가 인스타 스크린샷을 첨부하면 거기서 handle/name/팔로워/카테고리를 읽어 채워주세요.",
  inputSchema: {
    type: "object" as const,
    properties: {
      platform: {
        type: "string",
        enum: ["instagram", "youtube", "tiktok"],
        description: "플랫폼",
      },
      handle: {
        type: "string",
        description: "사용자 ID (@ 제외, 예: '@hong_sj' → 'hong_sj')",
      },
      name: {
        type: "string",
        description: "표시 이름 (모르면 handle과 동일하게)",
      },
      followers: {
        type: "number",
        description: "팔로워 수 (모르면 생략)",
      },
      engagement_rate: {
        type: "number",
        description: "참여율 % (예: 3.5). 모르면 생략",
      },
      categories: {
        type: "array",
        items: { type: "string" },
        description:
          "카테고리 태그 (예: ['패션', '라이프스타일', '뷰티']). 모르면 빈 배열",
      },
      priority: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "우선순위 (기본 medium)",
      },
      notes: {
        type: "string",
        description:
          "메모 — 왜 등록했는지, 어떤 점이 매력적이었는지 등 (선택)",
      },
      // profile_image는 받지 않는다. 스크린샷에서 추출한 URL은 프로필 페이지/바이오
      // 링크/환각 placeholder인 경우가 많아 깨진 이미지를 유발했다. 프로필 사진은
      // handle 기반 파이프라인(/api/influencer/avatar 프록시 + influencer-avatars cron)이
      // 전담해 Supabase Storage에 영구 저장한다.
    },
    required: ["platform", "handle", "name"],
  },
};

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getInfluencerList(
  supabase: SupabaseClient,
): Promise<StoredInfluencer[]> {
  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", INFLUENCERS_KEY)
    .maybeSingle();
  const raw = data?.data;
  return Array.isArray(raw) ? (raw as StoredInfluencer[]) : [];
}

async function saveInfluencerList(
  supabase: SupabaseClient,
  list: StoredInfluencer[],
): Promise<void> {
  const { error } = await supabase
    .from("kv_store")
    .upsert(
      {
        key: INFLUENCERS_KEY,
        data: list,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (error) throw new Error(`KV 저장 실패: ${error.message}`);
}

/** handle(인스타)로 인플루언서 1건 조회 — 인바운드 DM 자동판별용. */
export async function getInfluencerByHandle(
  handle: string,
): Promise<StoredInfluencer | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const h = String(handle).replace(/^@/, "").trim().toLowerCase();
  if (!h) return null;
  const list = await getInfluencerList(supabase);
  return (
    list.find((x) => x.handle?.toLowerCase() === h && x.platform === "instagram") ??
    null
  );
}

/**
 * handle 로 인플루언서 레코드를 부분 갱신(read-modify-write).
 * 인바운드 DM 시 상태 자동전진에 사용. kv 단일 blob 이라 동시쓰기 race 가능(Phase 3 테이블 이전 예정).
 */
export async function patchInfluencerByHandle(
  handle: string,
  patch: Partial<StoredInfluencer>,
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const h = String(handle).replace(/^@/, "").trim().toLowerCase();
  if (!h) return false;
  const list = await getInfluencerList(supabase);
  const idx = list.findIndex(
    (x) => x.handle?.toLowerCase() === h && x.platform === "instagram",
  );
  if (idx < 0) return false;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  await saveInfluencerList(supabase, list);
  return true;
}

export async function registerInfluencer(
  args: RegisterArgs,
): Promise<RegisterResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "DB 미설정 (SUPABASE_URL/KEY 확인)" };
  }

  const platform = String(args.platform || "").toLowerCase() as Platform;
  if (!["instagram", "youtube", "tiktok"].includes(platform)) {
    return {
      ok: false,
      error: "platform은 instagram / youtube / tiktok 중 하나여야 합니다",
    };
  }

  const handle = String(args.handle || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  if (!handle) return { ok: false, error: "handle 필요" };

  const name = String(args.name || "").trim() || handle;

  const list = await getInfluencerList(supabase);
  const existing = list.find(
    (x) => x.handle?.toLowerCase() === handle && x.platform === platform,
  );
  if (existing) {
    return {
      ok: false,
      duplicate: true,
      message: `이미 등록되어 있습니다: @${handle} (${platform}, 현재 상태=${existing.status})`,
      id: existing.id,
    };
  }

  const priorityRaw = String(args.priority || "medium").toLowerCase();
  const priority: Priority = (
    ["high", "medium", "low"].includes(priorityRaw) ? priorityRaw : "medium"
  ) as Priority;

  const now = new Date().toISOString();
  const newInf: StoredInfluencer = {
    id: crypto.randomUUID(),
    platform,
    handle,
    name,
    // 빈 값으로 시작 → handle 기반 아바타 파이프라인이 채운다 (위 스키마 주석 참고).
    profileImage: "",
    followers: Number.isFinite(Number(args.followers))
      ? Number(args.followers)
      : 0,
    engagementRate: Number.isFinite(Number(args.engagement_rate))
      ? Number(args.engagement_rate)
      : 0,
    categories: Array.isArray(args.categories)
      ? args.categories.filter((c) => typeof c === "string")
      : [],
    status: "discovered",
    priority,
    notes: String(args.notes || ""),
    addedAt: now,
    updatedAt: now,
    messages: [],
  };

  await saveInfluencerList(supabase, [...list, newInf]);

  return {
    ok: true,
    id: newInf.id,
    message: `✅ 등록 완료: @${handle} (${platform}, ${name})`,
  };
}
