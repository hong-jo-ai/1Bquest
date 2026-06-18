/**
 * 텔레그램 릴레이 — 로컬 에이전트(아이맥)가 api.telegram.org 직결에 실패할 때(ETIMEDOUT)
 * 이 엔드포인트로 보내면 Vercel 이 대신 텔레그램에 전송한다. Vercel→텔레그램은 안정적.
 *
 * POST /api/marketplace/telegram-relay
 * 헤더: x-agent-token: <PAULWISE_MCP_TOKEN>
 * 본문(JSON):
 *   { fileBase64, filename, caption }  → sendDocument (파일 첨부)
 *   { text }                           → sendMessage (텍스트)
 */
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface RelayBody {
  caption?: string;
  text?: string;
  filename?: string;
  fileBase64?: string;
  chatId?: string; // 기본 TELEGRAM_CHAT_ID 대신 보낼 대상(클로드 브리지 등)
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const defaultChat = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !defaultChat) {
    return Response.json({ error: "telegram_not_configured" }, { status: 500 });
  }

  let body: RelayBody;
  try {
    body = (await req.json()) as RelayBody;
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const chatId = (body.chatId && String(body.chatId)) || defaultChat;

  try {
    if (body.fileBase64) {
      const buf = Buffer.from(body.fileBase64, "base64");
      const form = new FormData();
      form.append("chat_id", chatId);
      if (body.caption) form.append("caption", body.caption);
      form.append("document", new Blob([buf]), body.filename || "file");
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        return Response.json(
          { error: `sendDocument ${res.status}: ${(await res.text()).slice(0, 300)}` },
          { status: 502 },
        );
      }
      return Response.json({ ok: true, mode: "document" });
    }

    const text = body.text || body.caption;
    if (!text) return Response.json({ error: "no_content" }, { status: 400 });
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      return Response.json(
        { error: `sendMessage ${res.status}: ${(await res.text()).slice(0, 300)}` },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, mode: "message" });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
