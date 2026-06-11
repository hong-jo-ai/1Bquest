/**
 * 우체국 접수내역 조회/갱신.
 *   GET  /api/postparcel/shipments?status=&channel=&reqType=  → { shipments, counts }
 *   POST /api/postparcel/shipments  { action:"track", ids?:string[] }  → 종추적조회 후 갱신
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { trackOne } from "@/lib/postParcel/tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 종추적 갱신이 건수만큼 순차 호출되므로 여유 확보

function sb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
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
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.action !== "track") {
    return Response.json({ error: "지원하지 않는 action" }, { status: 400 });
  }
  const client = sb();

  // 대상 후보: 송장 있고 취소 아닌 건. ids 지정 시 해당 건만.
  const specified = Array.isArray(body.ids) && body.ids.length > 0;
  let q = client
    .from("pp_shipments")
    .select("id, regi_no, tracking_state, status")
    .not("regi_no", "is", null)
    .neq("regi_no", "TESTREGINOAPI");
  if (specified) {
    q = q.in("id", body.ids);
  } else {
    q = q.neq("status", "cancelled").order("registered_at", { ascending: false }).limit(1000);
  }
  const { data: rows, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // ids 미지정이면 이미 '배달완료'인 건은 재조회 불필요 → 제외(갱신 필요한 미배달에 집중).
  // 과호출/타임아웃 방지로 200건 상한(미배달만 남으므로 실질 충분).
  const targets = (rows ?? [])
    .filter((t) => specified || !(t.tracking_state && t.tracking_state.includes("배달완료")))
    .slice(0, 200);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  for (const t of targets ?? []) {
    const tr = await trackOne(t.regi_no);
    // 실제 배송상태가 조회됐을 때만 갱신. 결과없음(ERR-001, 갓 접수해 이벤트 없음)·일시적
    // 에러일 땐 기존 상태를 보존한다(예전 정상 상태를 "-"로 덮어쓰지 않도록). checked_at 은 항상 기록.
    const patch: Record<string, unknown> = {
      tracking_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (tr.found && tr.state) {
      patch.tracking_state = tr.state;
      patch.tracking_detail = tr.scans?.length ? tr.scans : null;
    }
    await client.from("pp_shipments").update(patch).eq("id", t.id);
    results.push({ id: t.id, rgist: t.regi_no, state: tr.state, found: tr.found, error: tr.error });
    // 우체국 OpenAPI 연속 호출 throttle 회피 (한 번에 23건이 같은 초에 몰리면 빈 응답)
    await sleep(400);
  }
  const updated = results.filter((r) => r.found && r.state).length;
  return Response.json({ checked: results.length, updated, results });
}
