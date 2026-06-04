import {
  sendMany,
  detectMessageType,
  estimateCost,
  smsConfigured,
} from "@/lib/sms/solapi";
import { logSmsSend } from "@/lib/sms/store";
import { getAsRequestsByIds, updateAsRequest } from "@/lib/as/store";
import type { AsRequest } from "@/lib/as/types";
import { BRAND_LABEL } from "@/lib/cs/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface NotifyBody {
  ids: string[];
  template: string; // #{브랜드}#{이름}#{모델}#{수리내역}#{수리비}#{반송비}#{합계}#{증상}#{AS번호}
  shippingFee?: number | null; // 반송 택배비 (전 건 공통)
  isTest?: boolean;
}

/** 건별 토큰 치환 — /as 클라이언트 미리보기와 동일 규칙 */
function fillTokens(
  template: string,
  r: AsRequest,
  shippingFee: number | null
): string {
  const won = (n: number) => n.toLocaleString("ko-KR") + "원";
  const repair = r.repair_cost;
  const repairStr = repair != null ? won(repair) : "별도 안내";
  const shipStr = shippingFee != null ? won(shippingFee) : "별도 안내";
  const totalStr =
    repair != null && shippingFee != null ? won(repair + shippingFee) : "별도 안내";
  return template
    .replace(/#\{브랜드\}/g, BRAND_LABEL[r.brand])
    .replace(/#\{이름\}/g, (r.customer_name ?? "").trim() || "고객")
    .replace(/#\{모델\}/g, r.model ?? "제품")
    .replace(/#\{증상\}/g, r.symptom ?? "")
    .replace(/#\{수리내역\}/g, r.repair_detail ?? "")
    .replace(/#\{수리비\}/g, repairStr)
    .replace(/#\{반송비\}/g, shipStr)
    .replace(/#\{합계\}/g, totalStr)
    .replace(/#\{비용\}/g, repairStr) // 하위호환
    .replace(/#\{AS번호\}/g, r.as_number);
}

function digits(phone: string | null): string {
  return (phone ?? "").replace(/\D/g, "");
}

export async function POST(req: Request) {
  const cfg = smsConfigured();
  if (!cfg.ok) {
    return Response.json(
      { ok: false, error: `Solapi 설정 누락: ${cfg.missing.join(", ")}` },
      { status: 503 }
    );
  }

  const body = (await req.json()) as NotifyBody;
  const template = (body.template ?? "").trim();
  const shippingFee =
    typeof body.shippingFee === "number" && Number.isFinite(body.shippingFee)
      ? body.shippingFee
      : null;
  if (!template) {
    return Response.json({ ok: false, error: "메시지를 입력하세요" }, { status: 400 });
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ ok: false, error: "대상이 없습니다" }, { status: 400 });
  }

  const tickets = await getAsRequestsByIds(body.ids);

  // 유효 번호 + 중복 제거 (첫 건 유지)
  const seen = new Set<string>();
  const targets = tickets.filter((t) => {
    const d = digits(t.customer_phone);
    if (d.length < 10 || seen.has(d)) return false;
    seen.add(d);
    return true;
  });

  if (targets.length === 0) {
    return Response.json(
      { ok: false, error: "연락처가 있는 대상이 없습니다" },
      { status: 400 }
    );
  }

  const messages = targets.map((t) => ({
    to: t.customer_phone as string,
    text: fillTokens(template, t, shippingFee),
  }));

  const outcome = await sendMany(messages);

  // 발송 성공한 건만 안내완료로 전환 — results 를 전화번호로 매칭.
  const failedPhones = new Set(
    (outcome.results ?? [])
      .filter((r) => r.status !== "success")
      .map((r) => digits(r.phone))
  );

  let advanced = 0;
  await Promise.all(
    targets.map(async (t) => {
      if (failedPhones.has(digits(t.customer_phone))) return;
      try {
        await updateAsRequest(t.id, { status: "notified" });
        advanced += 1;
      } catch {
        /* 상태 갱신 실패는 무시 — 발송 자체는 성공 */
      }
    })
  );

  try {
    await logSmsSend({
      messageText: template,
      messageType: detectMessageType(fillTokens(template, targets[0], shippingFee)),
      sourceDesc: `AS 수리완료 안내 (${targets.length}건)`,
      recipientCount: targets.length,
      successCount: outcome.successCount,
      failCount: outcome.failCount,
      estCost: estimateCost(template, targets.length),
      groupId: outcome.groupId,
      results: outcome.results,
      isTest: !!body.isTest,
    });
  } catch (e) {
    console.error("[as/notify] 이력 기록 실패:", e instanceof Error ? e.message : String(e));
  }

  return Response.json(
    {
      ok: outcome.ok,
      successCount: outcome.successCount,
      failCount: outcome.failCount,
      advanced,
      groupId: outcome.groupId,
      error: outcome.error,
    },
    { status: outcome.ok ? 200 : 502 }
  );
}
