import { ingestMessage } from "@/lib/cs/store";
import { listCrispAccounts } from "@/lib/cs/crispClient";
import type { IngestPayload } from "@/lib/cs/types";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

interface CrispWebhookEvent {
  website_id: string;
  event: string; // "message:send" | "message:received" | ...
  data?: {
    session_id?: string;
    website_id?: string;
    from?: "user" | "operator";
    type?: string;
    origin?: string;
    content?: unknown;
    fingerprint?: number;
    timestamp?: number;
    user?: {
      nickname?: string;
      user_id?: string;
      email?: string;
    };
  };
  timestamp?: number;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
  }
  return "";
}

export async function POST(req: Request) {
  let event: CrispWebhookEvent;
  try {
    event = (await req.json()) as CrispWebhookEvent;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  // message:send = 사용자 발신, message:received = operator 발신 (Crisp 용어 특이)
  // Crisp docs 기준 더 안전한 방식: data.from 으로 판단
  const relevantEvents = [
    "message:send",
    "message:received",
    "message:updated",
  ];
  if (!relevantEvents.includes(event.event)) {
    return Response.json({ ok: true, ignored: event.event });
  }

  const data = event.data;
  if (!data?.session_id || !data?.website_id) {
    return Response.json({ ok: true, ignored: "missing ids" });
  }

  try {
    const accounts = await listCrispAccounts();
    const account = accounts.find((a) => a.websiteId === data.website_id);
    if (!account) {
      return Response.json({ ok: true, ignored: "no account" });
    }

    const text = extractText(data.content);
    if (!text) {
      return Response.json({ ok: true, ignored: "no text" });
    }

    const isOut = data.from === "operator";
    const nickname = data.user?.nickname ?? null;
    const email = data.user?.email ?? null;
    const fingerprint = data.fingerprint ?? Date.now();
    const timestamp = data.timestamp ?? Date.now();

    const payload: IngestPayload = {
      brand: account.brand,
      channel: "crisp",
      externalThreadId: data.session_id,
      externalMessageId: `${data.session_id}:${fingerprint}`,
      customerHandle: email ?? undefined,
      customerName: nickname ?? undefined,
      subject: nickname ?? email ?? "Crisp 대화",
      bodyText: text,
      sentAt: new Date(timestamp),
      direction: isOut ? "out" : "in",
      raw: { webhook: true, event },
    };

    await ingestMessage(payload);

    // 수신 메시지면 즉시 이메일 알림 트리거
    if (!isOut) {
      fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? "https://paulvice-dashboard.vercel.app"}/api/cs/notify/email`,
        { method: "POST" }
      ).catch(() => {});
    }

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Crisp은 webhook 연결 테스트를 위해 GET도 받음 (ping)
export async function GET() {
  return Response.json({ ok: true, service: "crisp webhook" });
}
