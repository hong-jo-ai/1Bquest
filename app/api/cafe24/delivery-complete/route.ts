/**
 * 배송완료 자동 전환 — 수동 실행/점검용.
 *
 * GET  ?mall=paulvice&days=14         → 무엇이 바뀔지만 보여준다(쓰지 않음)
 * POST { mall, days, confirm: true }  → 실제 전환
 */
import { type NextRequest } from "next/server";
import { flipDeliveredOrders } from "@/lib/cafe24/deliveryComplete";
import type { MallId } from "@/lib/cafe24Client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const mallOf = (v: string | null): MallId => (v === "harriot" ? "harriot" : "paulvice");

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const r = await flipDeliveredOrders(mallOf(p.get("mall")), { days: Number(p.get("days")) || 14 });
  return Response.json({ ok: true, ...r });
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { mall?: string; days?: number; confirm?: boolean; limit?: number };
  const r = await flipDeliveredOrders(mallOf(b.mall ?? null), {
    days: b.days ?? 14, confirm: !!b.confirm, limit: b.limit,
  });
  return Response.json({ ok: true, ...r });
}
