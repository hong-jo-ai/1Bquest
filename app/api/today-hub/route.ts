/**
 * 오늘의 운영 허브 영속 저장 (Supabase kv_store).
 *
 * GET  /api/today-hub?brand=paulvice          → tasks(공통) + routines/goal/events(브랜드)
 * PUT  /api/today-hub  body { type, brand?, payload }
 *   - type=tasks        : brand 불필요 (전사 공통)
 *   - type=routines/goal/events : brand 필수
 *
 * 키:
 *   today_hub:tasks                        — 공통
 *   today_hub:routines:{brand}             — 브랜드별
 *   today_hub:goal:{brand}                 — 브랜드별
 *   today_hub:events:{brand}               — 브랜드별
 *
 * 레거시(브랜드 suffix 없는) 키는 GET 시 paulvice 폴백으로만 읽음. 첫 PUT 후 자연 소멸.
 */
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const SHARED_SLOT = { tasks: "today_hub:tasks" } as const;
const BRAND_SLOT  = { routines: "routines", goal: "goal", events: "events" } as const;

type SharedSlot = keyof typeof SHARED_SLOT;
type BrandSlot  = keyof typeof BRAND_SLOT;
type AnySlot    = SharedSlot | BrandSlot;

const VALID_BRANDS = ["paulvice", "harriot"] as const;
type Brand = typeof VALID_BRANDS[number];

const SHARED_TYPES: SharedSlot[] = ["tasks"];
const BRAND_TYPES:  BrandSlot[]  = ["routines", "goal", "events"];

function brandKey(slot: BrandSlot, brand: Brand): string {
  return `today_hub:${BRAND_SLOT[slot]}:${brand}`;
}

function legacyKey(slot: BrandSlot): string {
  return `today_hub:${BRAND_SLOT[slot]}`;
}

function isBrand(b: unknown): b is Brand {
  return typeof b === "string" && (VALID_BRANDS as readonly string[]).includes(b);
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  const brandParam = req.nextUrl.searchParams.get("brand");
  if (!isBrand(brandParam)) {
    return Response.json({ ok: false, error: "brand 파라미터 필수 (paulvice/harriot)" }, { status: 400 });
  }
  const brand = brandParam;

  // 한 번에 모든 키 조회: 공통 + 브랜드별 + (paulvice 일 때만) 레거시 폴백
  const keys: string[] = [SHARED_SLOT.tasks];
  for (const slot of BRAND_TYPES) keys.push(brandKey(slot, brand));
  if (brand === "paulvice") {
    for (const slot of BRAND_TYPES) keys.push(legacyKey(slot));
  }

  const { data, error } = await db.from("kv_store").select("key, data").in("key", keys);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const map = new Map<string, unknown>();
  for (const row of data ?? []) map.set(row.key as string, row.data);

  const result: { ok: true } & Partial<Record<AnySlot, unknown>> = { ok: true };

  if (map.has(SHARED_SLOT.tasks)) result.tasks = map.get(SHARED_SLOT.tasks);

  for (const slot of BRAND_TYPES) {
    const k = brandKey(slot, brand);
    if (map.has(k)) {
      result[slot] = map.get(k);
    } else if (brand === "paulvice" && map.has(legacyKey(slot))) {
      // 레거시 폴백: paulvice 첫 진입에서만 한 번 노출
      result[slot] = map.get(legacyKey(slot));
    }
  }

  return Response.json(result);
}

export async function PUT(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  let body: { type?: string; brand?: string; payload?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!body.type) {
    return Response.json({ ok: false, error: "type 필수" }, { status: 400 });
  }
  if (body.payload === undefined) {
    return Response.json({ ok: false, error: "payload 필수" }, { status: 400 });
  }

  let key: string;
  if ((SHARED_TYPES as string[]).includes(body.type)) {
    key = SHARED_SLOT[body.type as SharedSlot];
  } else if ((BRAND_TYPES as string[]).includes(body.type)) {
    if (!isBrand(body.brand)) {
      return Response.json({ ok: false, error: "브랜드 슬롯에는 brand 필수 (paulvice/harriot)" }, { status: 400 });
    }
    key = brandKey(body.type as BrandSlot, body.brand);
  } else {
    return Response.json({ ok: false, error: "type 잘못됨" }, { status: 400 });
  }

  const { error } = await db
    .from("kv_store")
    .upsert(
      { key, data: body.payload, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, type: body.type, brand: body.brand });
}
