/**
 * CS 분류 탈락 메일 일일 요약 — 조용한 유실을 눈에 보이게 한다.
 *
 * 배경: gmail 수집은 한 사이클에 수십 건을 "CS 아님"으로 떨어뜨린다. 대부분 뉴스레터라
 *   맞는 동작이지만, 2026-09-03 박민 고객의 [HARRIOT 문의](광안 사이즈·가격 오표기 항의)가
 *   여기 섞여 사라졌다. 고객이 웹챗으로도 문의해준 덕에 우연히 발견됐을 뿐이다.
 *
 * 그래서 **사람이 쓴 것으로 보이는 탈락 건만** 하루 한 번 모아 알린다.
 *   - 마케팅·뉴스레터·시스템·주문알림 카테고리는 제외(진짜 노이즈다)
 *   - **분류 실패(429 등)는 카테고리와 무관하게 항상 포함** — 판정이 없었던 것이지
 *     "CS 아님"으로 판정된 게 아니다. 이게 조용히 사라지면 원인조차 못 짚는다.
 * 알린 건은 notified_at 을 찍어 다음 날 다시 알리지 않는다.
 */
import { withCron } from "@/lib/cron/withCron";
import { getCsSupabase } from "@/lib/cs/store";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 사람 문의일 가능성이 있는 카테고리. 나머지는 봐도 할 일이 없다. */
const WORTH_LOOKING = new Set(["customer_inquiry", "other"]);

interface Row {
  id: string; brand: string; from_email: string | null; from_name: string | null;
  subject: string | null; category: string | null; reason: string | null;
  failed: boolean; created_at: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function run(): Promise<Response> {
  const db = getCsSupabase();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await db
    .from("cs_classified_out")
    .select("id,brand,from_email,from_name,subject,category,reason,failed,created_at")
    .is("notified_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`조회 실패: ${error.message}`);

  const rows = (data ?? []) as Row[];
  // 분류 실패는 무조건, 나머지는 '볼 만한 카테고리'만.
  const worth = rows.filter((r) => r.failed || WORTH_LOOKING.has(r.category ?? ""));

  if (worth.length === 0) {
    // 노이즈까지 전부 소비 처리 — 다음 날 목록이 계속 부풀지 않게.
    if (rows.length) {
      await db.from("cs_classified_out").update({ notified_at: new Date().toISOString() })
        .in("id", rows.map((r) => r.id));
    }
    return Response.json({ ok: true, scanned: rows.length, notified: 0 });
  }

  const failed = worth.filter((r) => r.failed);
  const judged = worth.filter((r) => !r.failed);
  const line = (r: Row) =>
    `· <b>${esc((r.from_name || r.from_email || "?").slice(0, 24))}</b> — ${esc((r.subject || "(제목 없음)").slice(0, 46))}`;

  const parts = [`📭 <b>CS 인박스에 안 들어온 메일 ${worth.length}건</b>`, ""];
  if (failed.length) {
    parts.push(`<b>분류 실패(재시도 대상) ${failed.length}건</b>`, ...failed.slice(0, 10).map(line), "");
  }
  if (judged.length) {
    parts.push(`<b>'CS 아님'으로 판정 ${judged.length}건</b>`, ...judged.slice(0, 15).map(line), "");
  }
  parts.push("고객 문의가 섞여 있으면 알려주세요 — 분류 기준을 고치겠습니다.");

  await sendTelegramMessage(parts.join("\n"));
  await db.from("cs_classified_out").update({ notified_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));

  return Response.json({ ok: true, scanned: rows.length, notified: worth.length, failed: failed.length });
}

export const GET = withCron("cs-dropped-digest", run);
