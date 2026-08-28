/**
 * 파쇼 증빙 보관소 — 견적서·거래명세표·세금계산서 등 원본 파일 + 판독 데이터.
 *
 *  - 파일 원본: Supabase Storage **비공개** 버킷 `pasho-docs` (금액·사업자정보가 들어있어 공개 URL 금지).
 *    열람은 /api/pasho/docs/:id/file 이 서명URL로 리다이렉트 — 대시보드 로그인 세션이 있어야 통과(proxy.ts 게이트).
 *  - 메타데이터: kv `pasho:docs:v1` (발주 귀속·종류·금액·품목·판독원문).
 *
 * 유입 경로 두 가지, 저장 형식은 동일하다:
 *  (a) 대시보드 /pasho 증빙 섹션에서 첨부   → source "web"
 *  (b) 텔레그램에 거래명세표 사진 전송      → source "telegram" (receiptFlow가 입고기록과 함께 적재)
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const PASHO_DOCS_BUCKET = "pasho-docs";
const K_DOCS = "pasho:docs:v1";

/** 증빙 종류 — /pasho 증빙 섹션의 슬롯과 1:1 */
export const DOC_KINDS = [
  "견적서",
  "발주서",
  "거래명세표",
  "사급출고증",
  "검수확인서",
  "세금계산서",
  "기타",
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export interface DocItem { name: string; qty?: number; unitPrice?: number; amount?: number }

export interface PashoDoc {
  id: string;
  orderNo: string;            // 발주 귀속. 매칭 실패분은 "미분류"
  kind: DocKind;
  title: string;              // 표시명 (파일명 기반 또는 판독 요약)
  path: string;               // 버킷 내 경로
  mime: string;
  size: number;
  at: string;                 // 등록 시각 (ISO)
  source: "web" | "telegram";
  docDate?: string | null;    // 문서상 날짜 YYYY-MM-DD
  currency?: "KRW" | "USD" | null;
  supplyAmount?: number | null; // 공급가액
  vat?: number | null;          // 세액
  totalAmount?: number | null;  // 합계
  items?: DocItem[] | null;     // 명세 품목
  receiptId?: string | null;    // 연결된 입고 기록 id
  note?: string | null;
  paid?: boolean;               // 지급 완료 표시
}

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listDocs(orderNo?: string): Promise<PashoDoc[]> {
  const sb = kv(); if (!sb) return [];
  const { data } = await sb.from("kv_store").select("data").eq("key", K_DOCS).maybeSingle();
  const all = ((data?.data as PashoDoc[]) ?? []).slice();
  all.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return orderNo ? all.filter((d) => d.orderNo === orderNo) : all;
}

async function saveAll(docs: PashoDoc[]): Promise<void> {
  const sb = kv(); if (!sb) throw new Error("KV 미설정");
  await sb.from("kv_store").upsert(
    { key: K_DOCS, data: docs, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export function extFor(mime: string, filename?: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
  };
  if (map[mime]) return map[mime];
  const fromName = filename?.split(".").pop()?.toLowerCase();
  return fromName && /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : "bin";
}

function newDocId(): string {
  return `doc_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/**
 * 파일만 먼저 버킷에 올린다(메타 등록 없이).
 * 텔레그램 명세표처럼 "확인카드 승인 전에는 원장에 안 남기되 사진은 잡아둬야" 하는 경우에 쓴다.
 * 승인 안 되면 removeObject 로 지운다.
 */
export async function putObject(
  file: { buffer: Buffer; mime: string; filename?: string },
  folder = "미분류",
): Promise<{ path: string; size: number }> {
  const sb = kv(); if (!sb) throw new Error("KV 미설정");
  const path = `${folder || "미분류"}/${newDocId()}.${extFor(file.mime, file.filename)}`;
  const { error } = await sb.storage.from(PASHO_DOCS_BUCKET)
    .upload(path, file.buffer, { contentType: file.mime, upsert: false });
  if (error) throw new Error(`업로드 실패: ${error.message}`);
  return { path, size: file.buffer.length };
}

export async function removeObject(path: string): Promise<void> {
  const sb = kv(); if (!sb) return;
  await sb.storage.from(PASHO_DOCS_BUCKET).remove([path]);
}

/** 이미 올라간 파일에 메타를 붙여 원장에 등록 */
export async function registerDoc(
  meta: Omit<PashoDoc, "id" | "at"> & { at?: string },
): Promise<PashoDoc> {
  const doc: PashoDoc = { ...meta, id: newDocId(), at: meta.at || new Date().toISOString() };
  await saveAll([doc, ...(await listDocs())]);
  return doc;
}

/** 원본 파일 업로드 + 메타 등록. 파일은 발주번호 폴더에 담아 나중에 사람이 봐도 알아보게 둔다. */
export async function addDoc(
  file: { buffer: Buffer; mime: string; filename?: string },
  meta: Omit<PashoDoc, "id" | "path" | "mime" | "size" | "at"> & { at?: string },
): Promise<PashoDoc> {
  const { path, size } = await putObject(file, meta.orderNo);
  return registerDoc({ ...meta, path, mime: file.mime, size });
}

export async function getDoc(id: string): Promise<PashoDoc | null> {
  return (await listDocs()).find((d) => d.id === id) ?? null;
}

export async function updateDoc(id: string, patch: Partial<PashoDoc>): Promise<PashoDoc | null> {
  const all = await listDocs();
  const i = all.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const next = { ...all[i], ...patch, id: all[i].id, path: all[i].path };
  all[i] = next;
  await saveAll(all);
  return next;
}

export async function deleteDoc(id: string): Promise<boolean> {
  const sb = kv(); if (!sb) return false;
  const all = await listDocs();
  const doc = all.find((d) => d.id === id);
  if (!doc) return false;
  await sb.storage.from(PASHO_DOCS_BUCKET).remove([doc.path]);
  await saveAll(all.filter((d) => d.id !== id));
  return true;
}

/** 열람용 서명 URL (기본 10분). 비공개 버킷이라 이 경로로만 원본이 나간다. */
export async function signedUrl(path: string, expiresIn = 600): Promise<string | null> {
  const sb = kv(); if (!sb) return null;
  const { data, error } = await sb.storage.from(PASHO_DOCS_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}
