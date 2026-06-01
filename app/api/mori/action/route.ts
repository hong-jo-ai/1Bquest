/**
 * 모리 실행 엔드포인트 — 되돌리기 어려운 작업의 "실제 실행".
 *
 * 모리(LLM)는 이 엔드포인트를 호출하지 않는다. 화면 확인 카드(ConfirmWidget)의
 * [실행] 버튼을 사용자가 직접 눌렀을 때만 클라이언트가 호출한다.
 * → 음성/LLM 단독으로는 절대 실행되지 않는다(사람 클릭이 트리거).
 *
 * 허용 액션은 화이트리스트(ALLOWED)로만. 현재: telegram_owner(대표 본인 텔레그램).
 */
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type ActionType = "telegram_owner";
const ALLOWED: ActionType[] = ["telegram_owner"];

/**
 * 대표 본인 텔레그램 전송 — 실제 성공/실패를 정직하게 반환.
 * (lib/cs/telegram의 공용 sender는 fire-and-forget라 실패해도 throw 안 함 → 확인 카드가
 *  거짓 성공을 띄울 수 있어, 여기선 직접 보내고 결과를 확인한다. plain text라 HTML 이스케이프 불필요.)
 */
async function sendOwnerTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "텔레그램이 설정돼 있지 않습니다 (TELEGRAM_BOT_TOKEN/CHAT_ID)" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `텔레그램 오류 ${res.status} ${body.slice(0, 150)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "네트워크 오류" };
  }
}

export async function POST(req: NextRequest) {
  let body: { type?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 });
  }

  const type = body.type as ActionType;
  if (!ALLOWED.includes(type)) {
    return Response.json({ ok: false, error: `허용되지 않은 액션: ${body.type}` }, { status: 400 });
  }

  try {
    if (type === "telegram_owner") {
      const text = String(body.params?.text ?? "").trim();
      if (!text) return Response.json({ ok: false, error: "보낼 내용이 비어 있습니다" }, { status: 400 });
      const r = await sendOwnerTelegram(text);
      if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 502 });
      return Response.json({ ok: true, message: "사장님 텔레그램으로 전송했습니다." });
    }
    return Response.json({ ok: false, error: "처리할 수 없는 액션" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "실행 실패" }, { status: 500 });
  }
}
