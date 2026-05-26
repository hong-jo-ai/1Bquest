import { sendMany, detectMessageType, estimateCost, smsConfigured } from "@/lib/sms/solapi";
import { logSmsSend } from "@/lib/sms/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SendBody {
  // 수신자: [{ phone, name }]. name 은 #{이름} 치환용(없으면 빈 문자열).
  recipients: Array<{ phone: string; name?: string }>;
  message: string;          // #{이름} 토큰 포함 가능
  subject?: string;         // LMS 제목(선택)
  sourceDesc?: string;      // 이력 기록용 대상 설명
  isTest?: boolean;         // 본인 테스트 발송
}

/** 메시지 토큰 치환 — #{이름}. 빈 이름이면 "고객님". */
function personalize(template: string, name?: string): string {
  const display = (name ?? "").trim() || "고객님";
  return template.replace(/#\{이름\}/g, display).replace(/#\{name\}/gi, display);
}

export async function POST(req: Request) {
  const cfg = smsConfigured();
  if (!cfg.ok) {
    return Response.json(
      { ok: false, error: `Solapi 설정 누락: ${cfg.missing.join(", ")}` },
      { status: 503 },
    );
  }

  const body = (await req.json()) as SendBody;
  const message = (body.message ?? "").trim();

  // 유효 번호만 + 중복 번호 제거(첫 항목 유지).
  // Solapi send-many 는 한 요청에 동일 번호가 중복되면 "중복 수신번호"로 실패 처리하므로
  // 출처가 섞여(카페24 + 수동) 같은 번호가 들어와도 안전하게 1건만 남긴다.
  const seen = new Set<string>();
  const recipients = (body.recipients ?? []).filter((r) => {
    const d = (r.phone ?? "").replace(/\D/g, "");
    if (d.length < 10 || seen.has(d)) return false;
    seen.add(d);
    return true;
  });

  if (!message) return Response.json({ ok: false, error: "메시지를 입력하세요" }, { status: 400 });
  if (recipients.length === 0) return Response.json({ ok: false, error: "유효한 수신자가 없습니다" }, { status: 400 });
  if (recipients.length > 1000) {
    return Response.json({ ok: false, error: "1회 발송은 1000명까지" }, { status: 400 });
  }

  const messages = recipients.map((r) => ({
    to: r.phone,
    text: personalize(message, r.name),
    subject: body.subject,
  }));

  const outcome = await sendMany(messages);

  // 이력 기록 (실패해도 발송 결과는 반환)
  try {
    await logSmsSend({
      messageText: message,
      messageType: detectMessageType(personalize(message, recipients[0]?.name)),
      sourceDesc: body.sourceDesc,
      recipientCount: recipients.length,
      successCount: outcome.successCount,
      failCount: outcome.failCount,
      estCost: estimateCost(message, recipients.length),
      groupId: outcome.groupId,
      results: outcome.results,
      isTest: !!body.isTest,
    });
  } catch (e) {
    console.error("[sms] 이력 기록 실패:", e instanceof Error ? e.message : String(e));
  }

  return Response.json(
    {
      ok: outcome.ok,
      successCount: outcome.successCount,
      failCount: outcome.failCount,
      groupId: outcome.groupId,
      error: outcome.error,
      results: outcome.results,
    },
    { status: outcome.ok ? 200 : 502 },
  );
}
