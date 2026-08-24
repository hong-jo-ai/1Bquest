/**
 * 웹사이트 변경 승인 큐 — 에이전트가 만든 스킨 변경안을 사장님 승인 뒤 배포한다.
 *
 * 왜 큐인가: 배포는 **카페24 SFTP**로만 가능하고 그 자격증명·워커는 아이맥(local-agent)에 있다.
 *   반면 텔레그램 콜백은 프로덕션(Vercel)이 받는다. 그래서 우체국 접수 큐와 같은 구조를 쓴다 —
 *   Vercel 은 kv 에 승인 표시만 하고, 아이맥 워커(skinDeployWorker.js)가 폴링해 실제 배포한다.
 *
 * 상태: pending → approved|rejected → deployed|failed
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type SkinChangeStatus = "pending" | "approved" | "rejected" | "deployed" | "failed";

export interface SkinChange {
  id: string;
  kind: "hero" | "sections";          // 무엇을 바꾸는가
  title: string;                       // 카드 제목 (예: "가을 히어로 교체")
  summary: string;                     // 사람이 읽을 요약
  /** 배포 대상 — 워커가 그대로 실행한다. 로컬 경로는 아이맥 기준. */
  plan: {
    images?: Array<{ local: string; remote: string }>;
    section?: { local: string; remoteDir: string; base: string }; // 버저닝 업로드
    /** index.html 에서 갈아끼울 import 정규식(문자열) — 워커가 new RegExp 로 만든다 */
    indexImportPattern?: string;
  };
  previewUrl?: string;                 // 시안 아티팩트/이미지 URL
  status: SkinChangeStatus;
  createdAt: string;
  decidedAt?: string;
  deployedAt?: string;
  result?: string;                     // 배포 결과/실패 사유
}

const KEY = (id: string) => `skin:change:${id}`;
const INDEX_KEY = "skin:change:index";

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function saveChange(c: SkinChange): Promise<void> {
  const sb = kv(); if (!sb) throw new Error("Supabase 미설정");
  await sb.from("kv_store").upsert({ key: KEY(c.id), data: c, updated_at: new Date().toISOString() }, { onConflict: "key" });
  const { data } = await sb.from("kv_store").select("data").eq("key", INDEX_KEY).maybeSingle();
  const ids: string[] = Array.isArray(data?.data) ? (data!.data as string[]) : [];
  if (!ids.includes(c.id)) {
    ids.unshift(c.id);
    await sb.from("kv_store").upsert({ key: INDEX_KEY, data: ids.slice(0, 100), updated_at: new Date().toISOString() }, { onConflict: "key" });
  }
}

export async function loadChange(id: string): Promise<SkinChange | null> {
  const sb = kv(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", KEY(id)).maybeSingle();
  return (data?.data as SkinChange) ?? null;
}

export async function listChanges(status?: SkinChangeStatus): Promise<SkinChange[]> {
  const sb = kv(); if (!sb) return [];
  const { data } = await sb.from("kv_store").select("data").eq("key", INDEX_KEY).maybeSingle();
  const ids: string[] = Array.isArray(data?.data) ? (data!.data as string[]) : [];
  const out: SkinChange[] = [];
  for (const id of ids) {
    const c = await loadChange(id);
    if (c && (!status || c.status === status)) out.push(c);
  }
  return out;
}

/** 텔레그램 콜백에서 호출 — 승인/거절만 기록한다(실제 배포는 아이맥 워커). */
export async function decideChange(id: string, decision: "accept" | "reject"): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const c = await loadChange(id);
  if (!c) return { ok: false, error: "변경안을 찾을 수 없습니다(만료됐을 수 있어요)" };
  if (c.status !== "pending") return { ok: false, error: `이미 처리됨(${c.status})` };
  c.status = decision === "accept" ? "approved" : "rejected";
  c.decidedAt = new Date().toISOString();
  await saveChange(c);
  return {
    ok: true,
    summary: decision === "accept"
      ? `${c.title} — 승인. 아이맥 워커가 곧 배포하고 결과를 알려드립니다.`
      : `${c.title} — 반영하지 않습니다.`,
  };
}

/** 워커가 배포 결과를 기록 */
export async function finishChange(id: string, ok: boolean, result: string): Promise<void> {
  const c = await loadChange(id); if (!c) return;
  c.status = ok ? "deployed" : "failed";
  c.deployedAt = new Date().toISOString();
  c.result = result;
  await saveChange(c);
}
