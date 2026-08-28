/**
 * 카카오톡 요약 읽기 — local-agent/kakaoDigest.js 가 적재한 것만 읽는다.
 *
 * 대화 원문은 이 경로로 절대 오지 않는다. 아이맥 로컬 CSV 에만 있고,
 * 여기 올라오는 건 "내가 챙겨야 할 항목"으로 이미 추려진 결과뿐이다.
 */
import { createClient } from "@supabase/supabase-js";
import type { Domain } from "./types";

export const KAKAO_KEY = "today:kakao_digest";

export type KakaoKind = "todo" | "waiting" | "fyi";

export const KIND_LABEL: Record<KakaoKind, string> = {
  todo:    "할일",
  waiting: "대기",
  fyi:     "참고",
};

export interface KakaoItem {
  id: string;
  room: string;
  title: string;
  domain: Domain;
  kind: KakaoKind;
  /** 요청한 사람. 없으면 빈 문자열 */
  who: string;
  /** YYYY-MM-DD 또는 빈 문자열 */
  due: string;
}

interface RawDigest {
  generatedAt?: string;
  rooms?: Array<{
    room?: string;
    summary?: string;
    items?: Array<{ title?: string; domain?: string; kind?: string; who?: string; due?: string }>;
  }>;
}

const DOMAINS = new Set<Domain>(["paulvice", "harriot", "ars", "personal"]);
const KINDS   = new Set<KakaoKind>(["todo", "waiting", "fyi"]);

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface KakaoResult {
  generatedAt: string | null;
  items: KakaoItem[];
  error?: string;
}

export async function getKakaoItems(): Promise<KakaoResult> {
  const db = getDb();
  if (!db) return { generatedAt: null, items: [], error: "Supabase 미설정" };

  const { data, error } = await db.from("kv_store").select("data").eq("key", KAKAO_KEY).maybeSingle();
  if (error) return { generatedAt: null, items: [], error: error.message };

  const digest = (data?.data ?? null) as RawDigest | null;
  if (!digest?.rooms?.length) return { generatedAt: null, items: [], error: "카톡 요약이 아직 없습니다" };

  const items: KakaoItem[] = [];
  for (const room of digest.rooms) {
    const roomName = (room.room ?? "").trim();
    for (const [i, it] of (room.items ?? []).entries()) {
      const title = (it.title ?? "").trim();
      if (!title) continue;
      // 모델이 엉뚱한 값을 내도 화면이 깨지지 않게 좁힌다.
      const domain = DOMAINS.has(it.domain as Domain) ? (it.domain as Domain) : "personal";
      const kind   = KINDS.has(it.kind as KakaoKind)  ? (it.kind as KakaoKind)  : "fyi";
      items.push({
        id: `kakao:${roomName}:${i}`,
        room: roomName,
        title,
        domain,
        kind,
        who: (it.who ?? "").trim(),
        due: /^\d{4}-\d{2}-\d{2}$/.test(it.due ?? "") ? (it.due as string) : "",
      });
    }
  }

  // 할일 → 대기 → 참고 순으로. 아침에 위에서부터 읽으면 되게.
  const rank: Record<KakaoKind, number> = { todo: 0, waiting: 1, fyi: 2 };
  items.sort((a, b) => rank[a.kind] - rank[b.kind]);

  return { generatedAt: digest.generatedAt ?? null, items };
}
