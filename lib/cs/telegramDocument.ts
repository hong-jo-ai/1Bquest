/**
 * Telegram sendDocument — Bot API 로 파일 첨부 전송.
 *
 * 텍스트 전용 sendTelegramMessage 와 별개. multipart/form-data 사용.
 * Node 18+ 의 글로벌 FormData/Blob 활용 (별도 의존성 없음).
 */

export async function sendTelegramDocument(
  buffer: Buffer,
  filename: string,
  caption?: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 미설정 — 파일 발송 생략");
    return;
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "(본문 읽기 실패)");
      console.error(`[telegram] sendDocument 실패 status=${res.status} body=${body.slice(0, 300)}`);
    }
  } catch (e) {
    console.error(
      "[telegram] sendDocument 네트워크 에러:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
