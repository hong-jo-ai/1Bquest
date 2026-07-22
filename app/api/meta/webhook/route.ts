/**
 * Meta Ads Webhooks 콜백 — 광고 상태 실시간 수신 → 텔레그램 알림.
 * (proxy.ts 공개 경로 "/api/meta/webhook" — Meta가 직접 호출하므로 로그인 게이트 밖)
 *
 *   GET  → 구독 생성 시 Meta의 검증 요청(hub.challenge 에코)
 *   POST → 이벤트 수신. X-Hub-Signature-256(HMAC-SHA256, app secret) 검증 필수.
 *
 * 구독 필드: effective_status(송출상태 변화) · with_issues_ad_objects(거절/이슈) ·
 * creative_fatigue(소재 피로). 웹훅은 "무엇이 바뀌었다"만 오므로 상세는 Graph API로 보강.
 */
import crypto from "crypto";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { getMetaTokenFromStore } from "@/lib/metaTokenStore";
import { META_BASE } from "@/lib/metaClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIELD_LABEL: Record<string, string> = {
  effective_status: "송출상태 변경",
  with_issues_ad_objects: "🚨 광고 이슈(거절 등)",
  creative_fatigue: "🥱 소재 피로 감지",
  in_process_ad_objects: "광고 처리중 상태",
  ad_recommendations: "Meta 개선 권고",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("verify failed", { status: 403 });
}

function validSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const got = header.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got, "hex"));
  } catch {
    return false;
  }
}

/** value에서 광고 오브젝트 id를 찾아 이름 조회 (실패해도 알림은 나감) */
async function describeObject(value: Record<string, unknown>): Promise<string | null> {
  const id =
    (value.object_id as string) ??
    (value.ad_id as string) ??
    (value.adgroup_id as string) ??
    (value.adset_id as string) ??
    (value.campaign_id as string) ??
    null;
  if (!id) return null;
  try {
    const token = await getMetaTokenFromStore();
    if (!token) return `#${id}`;
    const res = await fetch(
      `${META_BASE}/${id}?fields=name,effective_status&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return `#${id}`;
    const j = (await res.json()) as { name?: string; effective_status?: string };
    return `${j.name ?? "#" + id}${j.effective_status ? ` (${j.effective_status})` : ""}`;
  } catch {
    return `#${id}`;
  }
}

/** value의 주요 키만 사람이 읽게 요약 (원본 JSON 덤프는 지양) */
function summarizeValue(value: Record<string, unknown>): string {
  const keys = [
    "level", "object_type", "new_status", "old_status", "effective_status",
    "review_feedback", "recommendation_type", "title", "message",
  ];
  const parts: string[] = [];
  for (const k of keys) {
    const v = value[k];
    if (v == null) continue;
    parts.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return parts.join("\n");
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) {
    console.warn("[meta-webhook] 서명 검증 실패 — 폐기");
    return new Response("bad signature", { status: 401 });
  }

  let body: {
    object?: string;
    entry?: { id?: string; time?: number; changes?: { field?: string; value?: unknown }[] }[];
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (body.object !== "ad_account") return Response.json({ ok: true, skipped: body.object });

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const field = change.field ?? "?";
      const value = (change.value ?? {}) as Record<string, unknown>;
      const label = FIELD_LABEL[field] ?? field;
      const objDesc = await describeObject(value);
      const summary = summarizeValue(value);
      const lines = [
        `📡 <b>MADS 실시간 — ${label}</b>`,
        `계정: act_${entry.id ?? "?"}`,
        objDesc ? `대상: ${objDesc}` : null,
        summary || null,
      ].filter(Boolean);
      await sendTelegramMessage(lines.join("\n"), {
        buttons: [{ text: "광고 현황판 열기", url: "https://dashboard.harriotwatches.com/ads" }],
      });
      console.log(`[meta-webhook] ${field} act_${entry.id}`, JSON.stringify(value).slice(0, 500));
    }
  }
  return Response.json({ ok: true });
}
