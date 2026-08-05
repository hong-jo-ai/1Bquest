/**
 * 우체국 접수내역 조회/갱신.
 *   GET  /api/postparcel/shipments?status=&channel=&reqType=  → { shipments, counts }
 *   POST /api/postparcel/shipments  { action:"track", ids?:string[] }  → 종추적조회 후 갱신
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refreshShipmentTracking } from "@/lib/postParcel/refreshTracking";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 종추적 갱신이 건수만큼 순차 호출되므로 여유 확보

function sb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
 try {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const channel = sp.get("channel");
  const reqType = sp.get("reqType");
  const search = (sp.get("q") || "").trim();

  let q = sb().from("pp_shipments").select("*").order("registered_at", { ascending: false });
  if (status && status !== "all") q = q.eq("status", status);
  if (channel && channel !== "all") q = q.eq("channel", channel);
  if (reqType && reqType !== "all") q = q.eq("req_type", reqType);

  if (search) {
    // 검색: 보관분(1주일 이전) 포함 전체에서 조회. or() 문법 깨지는 문자는 공백 처리.
    const safe = search.replace(/[,()%*]/g, " ").trim();
    if (safe) {
      q = q.or(
        `recipient_name.ilike.%${safe}%,order_number.ilike.%${safe}%,regi_no.ilike.%${safe}%,product_name.ilike.%${safe}%`
      );
    }
    q = q.limit(200);
  } else {
    // 기본: 최근 1주일치만 노출(그 이전은 보관 — 검색으로만). 접수일 없는 신규(pending)도 포함.
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    q = q.or(`registered_at.gte.${weekAgo},registered_at.is.null`).limit(500);
  }

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return Response.json({ shipments: data ?? [], counts });
 } catch (e) {
  // 어떤 경우에도 JSON 으로 응답 (클라이언트 res.json() 깨짐 방지)
  return Response.json({ error: (e as Error)?.message || "접수내역 조회 중 오류" }, { status: 500 });
 }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.action !== "track") {
    return Response.json({ error: "지원하지 않는 action" }, { status: 400 });
  }
  try {
    // 크론(/api/cron/parcel-track)과 같은 로직 — lib/postParcel/refreshTracking.ts
    // 화면 버튼은 maxDuration 60s 안에 끝나야 하므로 한 번에 100건까지만.
    const { checked, updated, results } = await refreshShipmentTracking({
      ids: Array.isArray(body.ids) ? body.ids : undefined,
      limit: 100,
    });
    return Response.json({ checked, updated, results });
  } catch (e) {
    return Response.json({ error: (e as Error)?.message || "배송조회 중 오류" }, { status: 500 });
  }
}
