/**
 * 설월 재입고 신청 명단 — 품절된 상세페이지(영문몰)에서 수집. 2026-10-01
 *
 * 출시 대기명단(lib/harriot/waitlist.ts, KV `harriot:seolwol:waitlist:v1`)과 **일부러 따로 둔다.**
 *   - 그 명단은 같은 연락처를 중복으로 버린다 → 출시 때 신청했던 사람이 재입고를 다시 신청하면
 *     기록이 남지 않아, "이번 품절에 누가 기다리는가"를 가려낼 수 없다.
 *   - 그 명단은 9/10 출시 알림을 이미 받은 사람들이다. 섞이면 재입고 메일 대상이 362명으로 부푼다.
 *
 * 수동 명단 KV `restock_requests`(기원 비취·백색 등, 세션이 손으로 고쳐 쓰는 서술형 명단)에도 합치지 않는다.
 *   - 그쪽은 이름·경위·channel_hint 가 붙은 손 관리 장부이고 코드가 읽거나 쓰지 않는다.
 *     익명 공개 API 가 같은 키를 통째로 읽고-쓰면 손으로 고친 내용을 덮어쓸 수 있고, 스팸이 장부에 섞인다.
 *   - 입고 때는 두 곳을 다 본다: 이 명단(자동 수집) + restock_requests 중 product 가 설월인 행(수동).
 *
 * 국내몰은 카페24 내장 재입고 알림(SMS 자동발송)을 쓰므로 보통 여기에 쌓이지 않는다.
 * 그래도 mall:"kr"(휴대폰)을 받을 수 있게 해 둔다 — 입력 규칙은 출시 대기명단과 같다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, normalizePhone, type WaitlistMall } from "@/lib/harriot/waitlist";

export const RESTOCK_KEY = "harriot:seolwol:restock:v1";

/** 이 명단이 받는 상품. 키가 설월 전용이라 다른 상품번호는 거절한다. */
export const RESTOCK_PRODUCT_NOS = [136];

/** 익명 공개 API 라 무한정 커지지 않게 막는다(KV 한 행에 배열 통째로 저장). */
const MAX_ROWS = 5000;

export interface RestockEntry {
  productNo: number;
  mall: WaitlistMall;
  /** kr=정규화된 휴대폰(01012345678) · en=소문자 이메일 */
  contact: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrer: string | null;
  /** 신청한 화면 경로(상품 주소가 두 벌이라 어느 쪽에서 들어왔는지 본다) */
  page: string | null;
  createdAt: string;
  /** 재입고 안내를 보낸 시각. 보내기 전에는 null — 같은 사람에게 두 번 나가지 않게 발송 쪽이 채운다. */
  notifiedAt: string | null;
}

/** 저장소. 기본은 Supabase kv_store, 테스트는 메모리 저장소를 넘긴다(운영 키에 테스트 데이터 금지). */
export interface RestockStore {
  read(): Promise<RestockEntry[]>;
  write(rows: RestockEntry[]): Promise<void>;
}

let sbCache: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (sbCache) return sbCache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다");
  sbCache = createClient(url, key, { auth: { persistSession: false } });
  return sbCache;
}

const kvStore: RestockStore = {
  async read() {
    const { data, error } = await sb().from("kv_store").select("data").eq("key", RESTOCK_KEY).maybeSingle();
    // 읽기 실패를 빈 명단으로 읽으면 다음 쓰기가 기존 신청자를 전부 지운다 — 던져서 500 으로 끝낸다.
    if (error) throw new Error(`재입고 명단 읽기 실패: ${error.message}`);
    return (data?.data as RestockEntry[]) ?? [];
  },
  async write(rows) {
    const { error } = await sb()
      .from("kv_store")
      .upsert({ key: RESTOCK_KEY, data: rows, updated_at: new Date().toISOString() }, { onConflict: "key" });
    // 저장 실패를 성공으로 돌려주면 고객은 "신청됐다"고 보는데 명단엔 없다.
    if (error) throw new Error(`재입고 명단 쓰기 실패: ${error.message}`);
  },
};

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

export type RestockAddResult =
  | { ok: true; duplicate: boolean; total: number }
  | { ok: false; reason: string };

export async function addRestockRequest(
  input: {
    productNo?: unknown;
    mall: WaitlistMall;
    contact: string;
    consentPrivacy: boolean;
    utmSource?: unknown;
    utmMedium?: unknown;
    utmCampaign?: unknown;
    utmContent?: unknown;
    referrer?: unknown;
    page?: unknown;
  },
  store: RestockStore = kvStore,
): Promise<RestockAddResult> {
  if (!input.consentPrivacy) return { ok: false, reason: "consent_required" };

  // 상품번호를 안 보내면 설월로 본다(이 명단의 유일한 상품). 보냈는데 다른 번호면 거절.
  const productNo =
    input.productNo === undefined || input.productNo === null || input.productNo === ""
      ? RESTOCK_PRODUCT_NOS[0]
      : Number(input.productNo);
  if (!RESTOCK_PRODUCT_NOS.includes(productNo)) return { ok: false, reason: "invalid_product" };

  const contact =
    input.mall === "kr" ? normalizePhone(input.contact ?? "") : normalizeEmail(input.contact ?? "");
  if (!contact || contact.length > 254) return { ok: false, reason: "invalid_contact" };

  const rows = await store.read();
  // 같은 몰·같은 상품·같은 연락처면 다시 쌓지 않는다. 다시 눌러도 성공으로 보이게 한다.
  if (rows.some((r) => r.mall === input.mall && r.productNo === productNo && r.contact === contact)) {
    return { ok: true, duplicate: true, total: rows.length };
  }
  if (rows.length >= MAX_ROWS) return { ok: false, reason: "list_full" };

  rows.push({
    productNo,
    mall: input.mall,
    contact,
    utmSource: clip(input.utmSource, 120),
    utmMedium: clip(input.utmMedium, 120),
    utmCampaign: clip(input.utmCampaign, 120),
    utmContent: clip(input.utmContent, 120),
    referrer: clip(input.referrer, 300),
    page: clip(input.page, 200),
    createdAt: new Date().toISOString(),
    notifiedAt: null,
  });
  await store.write(rows);
  return { ok: true, duplicate: false, total: rows.length };
}

/** 관제·발송 준비용 요약. */
export async function restockSummary(store: RestockStore = kvStore) {
  const rows = await store.read();
  return {
    total: rows.length,
    kr: rows.filter((r) => r.mall === "kr").length,
    en: rows.filter((r) => r.mall === "en").length,
    pending: rows.filter((r) => !r.notifiedAt).length,
    rows,
  };
}
