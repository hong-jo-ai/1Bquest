/**
 * /api/campaigns
 *   GET ?brand=paulvice              → Campaign[]
 *   PUT  body { brand, campaign }    → 업서트
 *   DELETE body { brand, id }        → 삭제
 */
import {
  listCampaigns, upsertCampaign, deleteCampaign,
} from "@/lib/campaigns/store";
import type { CampaignBrand, Campaign } from "@/lib/campaigns/types";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const VALID: CampaignBrand[] = ["paulvice", "harriot"];

function isBrand(b: unknown): b is CampaignBrand {
  return typeof b === "string" && (VALID as string[]).includes(b);
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand");
  if (!isBrand(brand)) {
    return Response.json({ ok: false, error: "brand 필수 (paulvice/harriot)" }, { status: 400 });
  }
  try {
    const campaigns = await listCampaigns(brand);
    return Response.json({ ok: true, campaigns });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  let body: { brand?: unknown; campaign?: Campaign };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!isBrand(body.brand)) {
    return Response.json({ ok: false, error: "brand 필수" }, { status: 400 });
  }
  if (!body.campaign?.id || !body.campaign?.name) {
    return Response.json({ ok: false, error: "campaign.id, campaign.name 필수" }, { status: 400 });
  }

  try {
    await upsertCampaign(body.brand, body.campaign);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  let body: { brand?: unknown; id?: string };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!isBrand(body.brand)) {
    return Response.json({ ok: false, error: "brand 필수" }, { status: 400 });
  }
  if (!body.id) {
    return Response.json({ ok: false, error: "id 필수" }, { status: 400 });
  }

  try {
    await deleteCampaign(body.brand, body.id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
