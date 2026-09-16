/**
 * 스토어프론트 상단 띠배너 — 설정(KV).
 *
 * 왜 새로 만들었나: 상단 띠가 두 몰 모두 **우리 손 밖**에 있었다(2026-09-16 확인).
 *  · 폴바이스 `/skin2/moa/import/top_banner.html` = 배너매니저 앱이 채우는 템플릿 껍데기.
 *    앱은 관리자 UI 전용이고 API 가 없어 에이전트가 못 건드린다. 파일에 하드코딩하면
 *    앱이 다시 그릴 때 사라지거나 겹친다.
 *  · 해리엇은 상단 띠가 **의도적으로 꺼져 있었다**(`displaynone` + `@import` 의 `@` 제거).
 * 사장님 지시(2026-09-16): "배너매니저로 채우는 방식은 버리고 네가 만들어 네가 관리해라."
 *
 * 설계 규칙 — 이 세 가지는 전례에서 나왔다.
 *  ① **페일오픈**: 스크립트가 죽어도 페이지는 멀쩡해야 한다. 해리엇 영문몰에서 주입 스크립트
 *     하나가 결제를 막은 적이 있다([[harriot-en-checkout-emailfix]]).
 *  ② **기간을 설정에 둔다**: `startAt`/`endAt` 이 지나면 저절로 사라진다. 사람이 내리는 걸
 *     잊어도 추석 안내가 10월까지 걸려 있지 않는다.
 *  ③ **배포 없이 끌 수 있다**: 설정이 KV 라 `enabled:false` 한 줄이면 즉시 내려간다.
 *     급할 때 배포를 기다려야 하면 그 자체가 사고다.
 *
 * ⚠️ 팝업이 아니다. 구매 CTA 를 가리면 안 된다 — 2026-07 웰컴팝업이 상세페이지 구매버튼을
 *    가려 주문이 5~8건/일에서 1~3건/일로 떨어진 전례가 있다. 그래서 문서 흐름 맨 위에
 *    **자리를 차지하는 띠**로 넣고, 덮지 않는다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const NOTICE_KEY = "storefront:notice:v1";

export type NoticeMall = "paulvice" | "harriot" | "all";

export interface NoticeItem {
  /** 어느 몰에 띄울지. "all" 이면 둘 다. */
  mall: NoticeMall;
  /** 띠에 보일 문구(한 줄). HTML 이 아니라 평문으로 넣는다 — 스크립트가 textContent 로 박는다. */
  text: string;
  /** 누르면 갈 곳. 비우면 링크 없이 문구만. */
  href?: string | null;
  /** 노출 시작·종료 (KST 날짜 YYYY-MM-DD, 종료일 포함). 비우면 제한 없음. */
  startAt?: string | null;
  endAt?: string | null;
  /** 배경/글자 색. 비우면 브랜드 기본값(검정 바탕 흰 글씨). */
  bg?: string | null;
  fg?: string | null;
  /** 닫기 버튼을 줄지. 공지성이면 false 로 계속 보이게 둔다. */
  dismissible?: boolean;
}

export interface NoticeConfig {
  /** 전체 스위치. false 면 스크립트가 아무것도 그리지 않는다(원격 킬스위치). */
  enabled: boolean;
  /** 닫으면 이 시간 동안 다시 안 뜬다. dismissible 인 항목에만 적용. */
  snoozeHours: number;
  items: NoticeItem[];
}

export const DEFAULT_NOTICE: NoticeConfig = {
  enabled: true,
  snoozeHours: 24,
  items: [],
};

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** KST 오늘(YYYY-MM-DD). 기간 판정은 서버에서 한다 — 브라우저 시계는 못 믿는다. */
export function todayKST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function inWindow(it: NoticeItem, today: string): boolean {
  if (it.startAt && today < it.startAt) return false;
  if (it.endAt && today > it.endAt) return false;
  return true;
}

export async function getNoticeConfig(): Promise<NoticeConfig> {
  const sb = db(); if (!sb) return DEFAULT_NOTICE;
  const { data } = await sb.from("kv_store").select("data").eq("key", NOTICE_KEY).maybeSingle();
  const saved = data?.data as Partial<NoticeConfig> | undefined;
  if (!saved) return DEFAULT_NOTICE;
  return { ...DEFAULT_NOTICE, ...saved, items: Array.isArray(saved.items) ? saved.items : [] };
}

/**
 * 그 몰에서 **지금 보여줄 항목 하나**만 골라 돌려준다.
 * 스크립트가 기간·몰 판정을 하지 않게 하려는 것이다 — 클라이언트에 규칙이 흩어지면
 * 브라우저 캐시에 낡은 규칙이 남아 내렸다고 생각한 배너가 계속 보인다.
 */
export async function noticeFor(
  mall: "paulvice" | "harriot",
): Promise<{ notice: NoticeItem | null; snoozeHours: number }> {
  const cfg = await getNoticeConfig();
  if (!cfg.enabled) return { notice: null, snoozeHours: cfg.snoozeHours };
  const today = todayKST();
  // 기간이 겹치는 항목을 여러 개 넣으면 **먼저 적힌 것**이 이긴다. 겹치지 않게 관리할 것.
  const hit = cfg.items.find(
    (it) => it && typeof it.text === "string" && it.text.trim()
      && (it.mall === mall || it.mall === "all") && inWindow(it, today),
  );
  return { notice: hit ?? null, snoozeHours: cfg.snoozeHours };
}

/** 항목만 필요할 때. 라우트는 스누즈 값도 같이 필요하므로 noticeFor 를 쓴다. */
export async function activeNotice(mall: "paulvice" | "harriot"): Promise<NoticeItem | null> {
  return (await noticeFor(mall)).notice;
}

/** ⚠️ 얕은 병합이다. items 는 통째로 갈아끼운다(일부만 넘기면 나머지가 사라진다). */
export async function setNoticeConfig(patch: Partial<NoticeConfig>): Promise<NoticeConfig> {
  const sb = db(); if (!sb) throw new Error("KV 미설정");
  const next = { ...(await getNoticeConfig()), ...patch };
  await sb.from("kv_store").upsert(
    { key: NOTICE_KEY, data: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return next;
}
