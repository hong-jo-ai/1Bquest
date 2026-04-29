/**
 * 일회성 import 엔드포인트 — 폴바이스 × @_bysoy 공구 (5/19~22) BigEvent 등록.
 * 출처: PAULVICE_bysoy_complete_checklist_1.md (2026-04-29)
 *
 * 사용:
 *   GET /api/today-hub/events/import-bysoy
 *   → today_hub:events:paulvice 에 append (같은 id 있으면 교체)
 *   → 대시보드 새로고침 시 빅 이벤트 위젯에 표시
 *
 * 등록 후 이 라우트는 그대로 둬도 무방 (idempotent — 재호출 시 같은 id 로 갱신).
 */
import { createClient } from "@supabase/supabase-js";

interface BigEvent {
  id: string;
  title: string;
  targetDate: string;
  checklist: Array<{ id: string; dDay: number; title: string; done: boolean }>;
}

export const dynamic = "force-dynamic";

const BYSOY_EVENT: BigEvent = {
  id:         "bysoy_2026_05",
  title:      "폴바이스 × @_bysoy 공동구매 (5/19~22)",
  targetDate: "2026-05-19",
  checklist: [
    // ── D-19 · 4/30 (목) START ────────────────────────
    { id: "by-1",  dDay: 19, title: "재고 실사 완료 + 공구 SKU 최종 확정 (16 SKU)",                          done: false },
    { id: "by-2",  dDay: 19, title: "카페24 쿠폰 코드 BYSOY 생성 (5/19~22 한정)",                            done: false },
    { id: "by-3",  dDay: 19, title: "박스/포장 자재 발주 (예상 800 + 여유 100)",                              done: false },
    { id: "by-4",  dDay: 19, title: "동봉 카드 디자인 브리프 발주",                                            done: false },

    // ── D-15 · 5/4 (월) ────────────────────────────────
    { id: "by-5",  dDay: 15, title: "동봉 카드 디자인 최종 + 인쇄 발주 (5/12 입고 목표)",                     done: false },
    { id: "by-6",  dDay: 15, title: "CS 응대 매뉴얼 1차 작성 (예상 문의 Top 10 + 표준 답변)",                done: false },

    // ── D-12 · 5/7 (목) ────────────────────────────────
    { id: "by-7",  dDay: 12, title: "발송 워크플로우 설계 (각인/일반 큐 분리, 합포장 로직, 송장 자동화)",   done: false },

    // ── D-11 · 5/8 (금) ────────────────────────────────
    { id: "by-8",  dDay: 11, title: "5/19~22 발송 인력 일정 확정 + 출장 중 CS 권한 설정",                    done: false },

    // ── D-8 · 5/11 (월) ────────────────────────────────
    { id: "by-9",  dDay: 8,  title: "이소연 촬영컷 큐레이션 + 메인/서브 비주얼 선정",                        done: false },

    // ── D-7 · 5/12 (화) ⭐ 출장 전 데드라인 ──────────
    { id: "by-10", dDay: 7,  title: "공구 페이지 디자인 1차 완료 (출장 전 데드라인) + 이소연 검수 링크 공유", done: false },
    { id: "by-11", dDay: 7,  title: "박스 사전 패킹 시작 (인기 SKU 1차, 각인 옵션 제외)",                    done: false },
    { id: "by-12", dDay: 7,  title: "동봉 카드 입고 확인 + 단기 발주분 시계 입고 확인",                       done: false },
    { id: "by-13", dDay: 7,  title: "출장 중 직원 작업 가이드라인 문서화 (패킹 SOP / CS 매뉴얼 / 비상 연락)", done: false },

    // ── D-5 · 5/14 (목) — 중국 출장 중 ────────────────
    { id: "by-14", dDay: 5,  title: "이소연 D-5 사전 예고 게시 확인 (스토리/릴스)",                          done: false },
    { id: "by-15", dDay: 5,  title: "박스 사전 패킹 진척률 50% 점검 (원격)",                                  done: false },

    // ── D-3 · 5/16 (토) — 출장 귀국 ────────────────────
    { id: "by-16", dDay: 3,  title: "귀국 후 박스 패킹 현황 직접 확인 + 이소연 D-3 사전 예고 게시 확인",     done: false },

    // ── D-2 · 5/17 (일) ────────────────────────────────
    { id: "by-17", dDay: 2,  title: "페이지 디자인 최종 점검 + 박스 패킹 90% 완료",                          done: false },
    { id: "by-18", dDay: 2,  title: "출고 워크플로우 모의 운영 (가상 주문 1건 패킹→송장→출고 시뮬)",       done: false },

    // ── D-1 · 5/18 (월) ────────────────────────────────
    { id: "by-19", dDay: 1,  title: "최종 QA (쿠폰 BYSOY 작동 / 장바구니→결제→송장 / 모바일·다중 브라우저)", done: false },
    { id: "by-20", dDay: 1,  title: "사전 패킹 박스 100% 완료 + 발송 인력 최종 확인",                        done: false },
    { id: "by-21", dDay: 1,  title: "이소연 D-1 마지막 예고 확인",                                            done: false },

    // ── D-0 · 5/19 (화) ⭐ OPENING ───────────────────
    { id: "by-22", dDay: 0,  title: "00:00 페이지 오픈 정상 확인 (실접속 테스트) + 09:00 이소연 메인 게시",  done: false },
    { id: "by-23", dDay: 0,  title: "즉시 발송 라인 가동 (사전 패킹 박스 송장 부착) + CS 1시간 내 응답",     done: false },
    { id: "by-24", dDay: 0,  title: "23:00 첫날 결산 → 이소연 결과 요약 공유",                                done: false },
  ],
};

const KEY = "today_hub:events:paulvice";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET() {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", KEY)
    .maybeSingle();

  const existing = (data?.data as BigEvent[] | null) ?? [];
  const filtered = existing.filter((e) => e.id !== BYSOY_EVENT.id);
  filtered.push(BYSOY_EVENT);

  const { error } = await db.from("kv_store").upsert(
    { key: KEY, data: filtered, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    message: "BYSOY 공구 이벤트 등록 완료 — 대시보드 새로고침하면 빅 이벤트 카드에 노출됩니다.",
    eventId: BYSOY_EVENT.id,
    eventTitle: BYSOY_EVENT.title,
    targetDate: BYSOY_EVENT.targetDate,
    checklistCount: BYSOY_EVENT.checklist.length,
    totalEvents: filtered.length,
  });
}
