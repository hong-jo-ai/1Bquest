import { ingestMessage } from "@/lib/cs/store";
import { listIgAccounts } from "@/lib/cs/instagramClient";
import type { IngestPayload } from "@/lib/cs/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const META_BASE = "https://graph.facebook.com/v22.0";

/**
 * Meta webhook verification (GET)
 * Meta가 GET 요청을 보내서 hub.challenge를 돌려받으면 webhook이 유효하다고 판정.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "paulvice-cs-inbox";

  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

interface MetaIgWebhookEvent {
  object: string;
  entry?: Array<{
    id: string;
    time?: number;
    messaging?: Array<{
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: {
        mid: string;
        text?: string;
        is_echo?: boolean;
      };
    }>;
    changes?: Array<{
      field: string;
      value: Record<string, unknown>;
    }>;
  }>;
}

/**
 * Meta webhook event receiver (POST)
 * Instagram DM 이벤트를 즉시 ingest.
 */
export async function POST(req: Request) {
  let event: MetaIgWebhookEvent;
  try {
    event = (await req.json()) as MetaIgWebhookEvent;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (event.object !== "instagram") {
    // Meta 공식 object 값
    return Response.json({ ok: true, ignored: "not instagram" });
  }

  try {
    const accounts = await listIgAccounts();
    let processed = 0;

    for (const entry of event.entry ?? []) {
      const pageOrIgId = entry.id;
      // pageId 또는 ig_user_id로 매칭
      const account = accounts.find(
        (a) => a.pageId === pageOrIgId || a.igUserId === pageOrIgId
      );
      if (!account) continue;

      // 포맷 1: entry.messaging[]
      for (const msg of entry.messaging ?? []) {
        if (!msg.message || msg.message.is_echo) continue;
        const senderId = msg.sender.id;
        const recipientId = msg.recipient.id;
        const isOut = senderId === account.igUserId;

        // 상대방 username은 webhook에 포함 안 됨 → Graph API로 조회 시도
        const otherId = isOut ? recipientId : senderId;
        let otherUsername: string | undefined;
        try {
          const url = `${META_BASE}/${otherId}?fields=username&access_token=${encodeURIComponent(account.pageAccessToken)}`;
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) {
            const json = (await res.json()) as { username?: string };
            otherUsername = json.username;
          }
        } catch {
          // 무시
        }

        const payload: IngestPayload = {
          brand: account.brand,
          channel: "ig_dm",
          externalThreadId: `ig_conv_${[account.igUserId, otherId].sort().join("_")}`,
          externalMessageId: msg.message.mid,
          customerHandle: otherUsername ?? otherId,
          customerName: otherUsername ?? undefined,
          subject: otherUsername ? `@${otherUsername} DM` : "IG DM",
          bodyText: msg.message.text ?? "",
          sentAt: new Date(msg.timestamp),
          direction: isOut ? "out" : "in",
          raw: { webhook: true, from: msg.sender, to: msg.recipient },
        };

        if (!payload.bodyText) continue;
        await ingestMessage(payload);
        processed++;
      }

      // 포맷 2: entry.changes[] (Instagram API v22 새 포맷)
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const v = change.value as {
          sender?: { id: string; username?: string };
          recipient?: { id: string };
          timestamp?: string | number;
          message?: { mid: string; text?: string };
        };
        if (!v.message?.text || !v.sender?.id) continue;
        const senderId = v.sender.id;
        const isOut = senderId === account.igUserId;
        const otherId = isOut ? v.recipient?.id ?? "" : senderId;
        const otherUsername = v.sender.username;

        const payload: IngestPayload = {
          brand: account.brand,
          channel: "ig_dm",
          externalThreadId: `ig_conv_${[account.igUserId, otherId].sort().join("_")}`,
          externalMessageId: v.message.mid,
          customerHandle: otherUsername ?? otherId,
          customerName: otherUsername ?? undefined,
          subject: otherUsername ? `@${otherUsername} DM` : "IG DM",
          bodyText: v.message.text,
          sentAt: new Date(
            typeof v.timestamp === "string"
              ? v.timestamp
              : (v.timestamp ?? Date.now())
          ),
          direction: isOut ? "out" : "in",
          raw: { webhook: true, change: v },
        };
        await ingestMessage(payload);
        processed++;
      }
    }

    // 즉시 이메일 알림 트리거 (async, 응답에 영향 없음)
    if (processed > 0) {
      fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? "https://paulvice-dashboard.vercel.app"}/api/cs/notify/email`,
        { method: "POST" }
      ).catch(() => {});
    }

    return Response.json({ ok: true, processed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
