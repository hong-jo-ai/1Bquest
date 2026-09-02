/**
 * 자사몰 스크립트 주입/갱신 — 카페24 스크립트태그 API.
 *
 * 왜 필요한가: 장바구니 리마인더는 **재방문자**에게 뜨는데, 재방문자는 대개
 * 상품 상세가 아니라 메인·목록으로 들어온다. 상세 스킨에만 스크립트가 실려 있으면
 * 정작 보여줘야 할 사람에게 안 뜬다. 스크립트태그는 display_location=["ALL"] 로
 * 전 페이지에 실린다.
 *
 * 스킨 SFTP 직접 편집보다 안전한 주입 수단이다 — 스킨 파일을 건드리지 않고,
 * 되돌릴 때도 스크립트태그 하나만 지우면 된다(2026-08-30 pv-cart.js 때 확인).
 *
 * ⚠️ 스킨에도 같은 스크립트가 박혀 있으면 두 번 로드된다. 두 스크립트 모두
 *    `window.__pvCartLoaded` / `window.__pvHesitateLoaded` 가드가 있어 무해하다.
 *
 * 사용:
 *   curl -X POST .../api/cafe24/install-storefront-script \
 *     -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" \
 *     -d '{"brand":"paulvice","script":"pv-hesitate.js","dry_run":true}'
 */
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get, cafe24Post, cafe24Put, type MallId } from "@/lib/cafe24Client";

export const dynamic = "force-dynamic";

type Cafe24ScriptTag = { script_no: number; src?: string | null; display_location?: string | null };

/** 주입을 허용하는 스크립트 — 임의 URL 주입을 막는다(자사몰에 남의 스크립트가 실리면 끝이다). */
const ALLOWED_SCRIPTS = ["pv-cart.js", "pv-hesitate.js"] as const;

function origin() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const v = process.env.VERCEL_URL?.trim();
  return v ? `https://${v.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "https://paulvice-dashboard.vercel.app";
}

function isAuthorized(req: Request) {
  const secret = process.env.WEBCHAT_INSTALL_SECRET || process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const brand: MallId = body.brand === "harriot" ? "harriot" : "paulvice";
  const script = String(body.script ?? "pv-hesitate.js");
  if (!(ALLOWED_SCRIPTS as readonly string[]).includes(script)) {
    return Response.json({ error: `script must be one of ${ALLOWED_SCRIPTS.join(", ")}` }, { status: 400 });
  }

  const token = await getAccessTokenFromStore(brand);
  if (!token) return Response.json({ error: "카페24 재연결 필요" }, { status: 401 });

  // ⚠️ 버전 쿼리 필수 — 캐시 때문에 파일만 바꾸면 옛 스크립트가 계속 돈다.
  const version = String(body.version ?? new Date().toISOString().slice(0, 10).replace(/-/g, ""));
  const src = `${origin()}/${script}?v=${version}`;
  const dryRun = body.dry_run === true;

  const list = (await cafe24Get(
    "/api/v2/admin/scripttags?limit=100&fields=script_no,src,display_location",
    token,
    brand,
  )) as { scripttags?: Cafe24ScriptTag[] };
  // 같은 파일의 기존 태그를 찾는다(버전 쿼리가 달라도 같은 스크립트다) → 중복 등록 방지.
  const existing = (list.scripttags ?? []).find((t) => (t.src ?? "").includes(`/${script}`));

  const payload = { request: { src, display_location: ["ALL"] } };
  const action = existing ? "update" : "create";
  if (dryRun) return Response.json({ ok: true, dryRun: true, action, scriptNo: existing?.script_no ?? null, src });

  const result = existing
    ? await cafe24Put(`/api/v2/admin/scripttags/${existing.script_no}`, token, payload, brand)
    : await cafe24Post("/api/v2/admin/scripttags", token, payload, brand);

  const created = (result as { scripttag?: Cafe24ScriptTag }).scripttag;
  return Response.json({ ok: true, action, scriptNo: existing?.script_no ?? created?.script_no ?? null, src });
}
