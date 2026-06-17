import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get, cafe24Post, cafe24Put } from "@/lib/cafe24Client";

export const dynamic = "force-dynamic";

type Cafe24ScriptTag = {
  script_no: number;
  src?: string | null;
  display_location?: string | null;
  skin_no?: number | null;
};

function isAuthorized(req: Request) {
  const secret = process.env.WEBCHAT_INSTALL_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function dashboardOrigin() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  }

  return "https://paulvice-dashboard.vercel.app";
}

function defaultWidgetSrc() {
  const params = new URLSearchParams({
    brandName: "PAULVICE",
  });
  return `${dashboardOrigin()}/api/cs/webchat/widget?${params}`;
}

function normalizeScriptSrc(value: string) {
  const url = new URL(value);
  return url.toString();
}

function isPaulviceWebchatScript(tag: Cafe24ScriptTag, src: string) {
  const existing = tag.src ?? "";
  return existing === src || existing.includes("/api/cs/webchat/widget");
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await getAccessTokenFromStore();
  if (!token) {
    return Response.json({ error: "카페24 재연결 필요" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const src = normalizeScriptSrc(
    typeof body.src === "string" && body.src.trim() ? body.src.trim() : defaultWidgetSrc(),
  );
  const displayLocation =
    typeof body.display_location === "string" && body.display_location.trim()
      ? body.display_location.trim()
      : "all";
  const dryRun = body.dry_run === true;

  const list = (await cafe24Get(
    "/api/v2/admin/scripttags?limit=100&fields=script_no,src,display_location,skin_no",
    token,
  )) as { scripttags?: Cafe24ScriptTag[] };
  const existing = (list.scripttags ?? []).find((tag) => isPaulviceWebchatScript(tag, src));

  const payload = {
    scripttag: {
      src,
      display_location: displayLocation,
    },
  };

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      action: existing ? "update" : "create",
      scriptNo: existing?.script_no ?? null,
      src,
      displayLocation,
    });
  }

  if (existing) {
    const result = await cafe24Put(
      `/api/v2/admin/scripttags/${existing.script_no}`,
      token,
      payload,
    );
    return Response.json({
      ok: true,
      action: "update",
      scriptNo: existing.script_no,
      src,
      displayLocation,
      result,
    });
  }

  const result = await cafe24Post("/api/v2/admin/scripttags", token, payload);
  const created = (result as { scripttag?: Cafe24ScriptTag }).scripttag;

  return Response.json({
    ok: true,
    action: "create",
    scriptNo: created?.script_no ?? null,
    src,
    displayLocation,
    result,
  });
}
