/**
 * 스토어프론트 팝업 — 설정·기록·성과.
 *
 * ⚠️ 이 기능에는 전례가 있다. 2026-07-01 웰컴팝업을 켰다가 카페24 주문이
 *    5~8건/일 → 1~3건/일로 급락해 7/8 에 껐다. 원인은 광고가 **상품 상세로 유입**되는데
 *    착지 1초 뒤 바텀시트가 가격·구매버튼을 가려서였다. 그때는 노출 기록이 없어
 *    원인을 며칠 뒤에야 짚었다.
 *
 * 그래서 이번 설계는 세 가지를 강제한다.
 *   ① **착지 직후 발동 금지** — 체류·스크롤·미행동이 모두 충족돼야 뜬다(망설임 확인).
 *   ② **홀드아웃** — 일부에게는 안 띄우고, 그 사람들의 구매율과 비교한다.
 *      "팝업 켠 뒤 매출이 떨어졌다"를 감으로 말하지 않기 위해서다.
 *   ③ **원격 킬스위치** — 설정이 KV 에 있어 배포 없이 즉시 끌 수 있다.
 *      급할 때 배포를 기다려야 하면 그 자체가 사고다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const CONFIG_KEY = "storefront:popup:v1";

export interface PopupConfig {
  /** 전체 스위치. false 면 스크립트가 아무것도 하지 않는다. */
  enabled: boolean;
  /** 안 띄울 비율(0~1). 이 사람들이 성과 비교의 기준선이다. */
  holdout: number;
  hesitation: {
    enabled: boolean;
    /** 이 시간 이상 머물러야 '망설임'으로 본다(ms) */
    dwellMs: number;
    /** 이만큼 스크롤을 내려야 한다(0~1) — 대충 보고 나가는 사람은 대상이 아니다 */
    scrollPct: number;
    /** 리뷰가 이보다 적으면 띄우지 않는다. 근거가 약한 설득은 역효과다. */
    minReviews: number;
    /** 닫으면 이 시간 동안 다시 안 뜬다(시간) */
    snoozeHours: number;
  };
}

export const DEFAULT_CONFIG: PopupConfig = {
  enabled: true,
  holdout: 0.1,
  hesitation: {
    enabled: true,
    dwellMs: 45_000,
    scrollPct: 0.6,
    minReviews: 10,
    snoozeHours: 24,
  },
};

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

export async function getConfig(): Promise<PopupConfig> {
  const sb = db(); if (!sb) return DEFAULT_CONFIG;
  const { data } = await sb.from("kv_store").select("data").eq("key", CONFIG_KEY).maybeSingle();
  const saved = data?.data as Partial<PopupConfig> | undefined;
  if (!saved) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG, ...saved,
    hesitation: { ...DEFAULT_CONFIG.hesitation, ...(saved.hesitation ?? {}) },
  };
}

export async function setConfig(patch: Partial<PopupConfig>): Promise<PopupConfig> {
  const sb = db(); if (!sb) throw new Error("KV 미설정");
  const next = { ...(await getConfig()), ...patch };
  await sb.from("kv_store").upsert(
    { key: CONFIG_KEY, data: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return next;
}

export interface PopupEvent {
  mall: string;
  popup: string;
  anonId?: string | null;
  memberId?: string | null;
  productNo?: number | null;
  event: "eligible" | "shown" | "click" | "dismiss";
  holdout?: boolean;
  path?: string | null;
}

export async function recordEvent(e: PopupEvent): Promise<void> {
  const sb = db(); if (!sb) return;
  await sb.from("storefront_popup_events").insert({
    mall: e.mall, popup: e.popup, anon_id: e.anonId ?? null, member_id: e.memberId ?? null,
    product_no: e.productNo ?? null, event: e.event, holdout: !!e.holdout,
    path: e.path?.slice(0, 300) ?? null,
  });
}

// ── 성과 ────────────────────────────────────────────────────────────────────

export interface PopupStats {
  days: number;
  /** 조건을 충족한 사람 = 망설인 사람. 팝업군 + 홀드아웃 */
  eligible: number;
  shown: number;
  clicked: number;
  dismissed: number;
  clickRate: number;
  /** 팝업을 본 사람 중 산 사람 */
  shownBuyers: number;
  shownCvr: number;
  /** 홀드아웃(안 본 사람) 중 산 사람 — 이게 기준선 */
  holdoutSize: number;
  holdoutBuyers: number;
  holdoutCvr: number;
  /** 팝업군 − 홀드아웃. 음수면 팝업이 오히려 방해한 것이다. */
  liftPp: number | null;
  enabled: boolean;
}

/**
 * 팝업을 본 사람이 실제로 샀는지는 `crm_cart_events` 의 전환 신호(주문완료 도달)로 본다.
 * 두 테이블 모두 같은 익명ID를 쓰기 때문에 사람 단위로 이어붙는다.
 */
export async function popupStats(days = 14): Promise<PopupStats | null> {
  const sb = db(); if (!sb) return null;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const cfg = await getConfig();

  const { data: evs } = await sb.from("storefront_popup_events")
    .select("anon_id,event,holdout").gte("created_at", since);
  const rows = (evs ?? []) as Array<{ anon_id: string | null; event: string; holdout: boolean }>;

  const eligible = new Set<string>(), shown = new Set<string>(), held = new Set<string>();
  let clicked = 0, dismissed = 0;
  for (const r of rows) {
    const id = r.anon_id;
    if (r.event === "eligible" && id) { eligible.add(id); if (r.holdout) held.add(id); }
    if (r.event === "shown" && id) shown.add(id);
    if (r.event === "click") clicked++;
    if (r.event === "dismiss") dismissed++;
  }

  // 구매 여부 — 같은 익명ID 의 전환 기록
  const ids = [...new Set([...shown, ...held])];
  const buyers = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("crm_cart_events")
      .select("anon_id").in("anon_id", ids.slice(i, i + 200)).not("converted_at", "is", null);
    for (const r of (data ?? []) as Array<{ anon_id: string }>) buyers.add(r.anon_id);
  }

  const shownBuyers = [...shown].filter((i) => buyers.has(i)).length;
  const holdoutBuyers = [...held].filter((i) => buyers.has(i)).length;
  const shownCvr = shown.size ? shownBuyers / shown.size : 0;
  const holdoutCvr = held.size ? holdoutBuyers / held.size : 0;

  return {
    days,
    eligible: eligible.size,
    shown: shown.size, clicked, dismissed,
    clickRate: shown.size ? clicked / shown.size : 0,
    shownBuyers, shownCvr,
    holdoutSize: held.size, holdoutBuyers, holdoutCvr,
    // 홀드아웃이 너무 작으면 비율이 요동친다 — 비교를 아예 하지 않는다.
    liftPp: held.size >= 20 && shown.size >= 20 ? shownCvr - holdoutCvr : null,
    enabled: cfg.enabled,
  };
}
