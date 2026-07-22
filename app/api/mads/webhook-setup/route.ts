/**
 * Meta Ads Webhooks 구독 설정 — 서버(프로덕션)만 앱시크릿·시스템토큰을 가지므로 여기서 실행.
 * 인증 게이트(`/api/mads/`) 안쪽. 멱등: 재호출해도 구독 갱신일 뿐 부작용 없음.
 *
 *   GET  → 현재 앱 구독 + 광고계정 연결 상태 조회
 *   POST → ①앱 구독(fields 등록, 콜백 검증 트리거) ②운영 광고계정 subscribed_apps 연결
 */
import { META_BASE } from "@/lib/metaClient";
import { getMetaTokenFromStore } from "@/lib/metaTokenStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIELDS = "effective_status,creative_fatigue,with_issues_ad_objects";
const CALLBACK = "https://dashboard.harriotwatches.com/api/meta/webhook";

function appToken(): string | null {
  const id = process.env.META_APP_ID, secret = process.env.META_APP_SECRET;
  return id && secret ? `${id}|${secret}` : null;
}

function acctId(): string | null {
  const raw = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
  return raw ? raw.replace(/^act_/, "") : null;
}

export async function GET() {
  const at = appToken();
  const sys = await getMetaTokenFromStore();
  const acct = acctId();
  const out: Record<string, unknown> = { fields: FIELDS, callback: CALLBACK, acct: acct ? `act_${acct}` : null };
  if (at) {
    const r = await fetch(`${META_BASE}/${process.env.META_APP_ID}/subscriptions?access_token=${encodeURIComponent(at)}`, { cache: "no-store" });
    out.appSubscriptions = await r.json();
  }
  if (sys && acct) {
    const r = await fetch(`${META_BASE}/act_${acct}/subscribed_apps?access_token=${encodeURIComponent(sys)}`, { cache: "no-store" });
    out.subscribedApps = await r.json();
  }
  return Response.json(out);
}

export async function POST() {
  const at = appToken();
  const sys = await getMetaTokenFromStore();
  const acct = acctId();
  const verify = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!at || !sys || !acct || !verify) {
    return Response.json(
      { ok: false, error: "env 누락", has: { app: !!at, sys: !!sys, acct: !!acct, verify: !!verify } },
      { status: 500 }
    );
  }

  // ① 앱 구독 — Meta가 이 호출 중 콜백으로 GET 검증(hub.challenge)을 보냄
  const subRes = await fetch(`${META_BASE}/${process.env.META_APP_ID}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      object: "ad_account",
      callback_url: CALLBACK,
      fields: FIELDS,
      verify_token: verify,
      access_token: at,
    }),
  });
  const subJson = await subRes.json();

  // ② 운영 광고계정 연결 (앱이 등록한 fields를 계정이 상속)
  const appRes = await fetch(`${META_BASE}/act_${acct}/subscribed_apps`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: sys }),
  });
  const appJson = await appRes.json();

  const ok = subRes.ok && appRes.ok;
  return Response.json(
    { ok, subscription: subJson, subscribedApps: appJson, acct: `act_${acct}` },
    { status: ok ? 200 : 500 }
  );
}
