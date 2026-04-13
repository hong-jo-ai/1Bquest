import { getCsSupabase } from "@/lib/cs/store";
import type { CsBrandId } from "@/lib/cs/types";

export const dynamic = "force-dynamic";

interface Body {
  brand: CsBrandId;
  displayName: string;
  websiteId: string;
  identifier: string;
  key: string;
}

/**
 * POST /api/cs/accounts/crisp
 * Crisp 자격증명을 cs_accounts에 저장.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Body>;
  const { brand, displayName, websiteId, identifier, key } = body;

  if (!brand || !displayName || !websiteId || !identifier || !key) {
    return Response.json(
      {
        ok: false,
        error: "brand, displayName, websiteId, identifier, key 모두 필요",
      },
      { status: 400 }
    );
  }
  if (brand !== "paulvice" && brand !== "harriot") {
    return Response.json({ ok: false, error: "invalid brand" }, { status: 400 });
  }

  // 가벼운 검증: Crisp API 호출해서 자격증명이 유효한지 확인
  try {
    const auth = Buffer.from(`${identifier}:${key}`, "utf-8").toString("base64");
    const res = await fetch(
      `https://api.crisp.chat/v1/website/${websiteId}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "X-Crisp-Tier": "plugin",
        },
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { ok: false, error: `Crisp 자격증명 검증 실패: ${res.status} ${text}` },
        { status: 400 }
      );
    }
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }

  const db = getCsSupabase();
  const { error } = await db.from("cs_accounts").upsert(
    {
      brand,
      channel: "crisp",
      display_name: displayName,
      credentials: { website_id: websiteId, identifier, key },
      status: "active",
      error_message: null,
      last_synced_at: null,
    },
    { onConflict: "brand,channel,display_name" }
  );
  if (error) {
    return Response.json(
      { ok: false, error: `upsert 실패: ${error.message}` },
      { status: 500 }
    );
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  const db = getCsSupabase();
  const { error } = await db.from("cs_accounts").delete().eq("id", id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
