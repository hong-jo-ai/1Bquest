/**
 * 신상 출시 런북 — 조회·생성·단계완료·입고확정.
 *
 * GET  /api/launch                          → 런북 목록 + 진행률 + 다음 할 일
 * POST /api/launch  { product, pashoOrderNo?, productNo?, domain? }   → 런북 생성(before 단계 즉시 열림)
 * POST /api/launch  { runbookId, step }                                → 단계 완료
 * POST /api/launch  { arrived: "<runbookId|파쇼발주번호>" }             → 입고 확정(onArrival·after 열림)
 * POST /api/launch  { runbookId, addStep:{key,title,phase?,date?} }    → 상품 고유 단계 추가
 */
import { type NextRequest } from "next/server";
import { listRunbooks, createRunbook, completeStep, markArrived, progressOf, addStep } from "@/lib/launch/runbook";
import type { Domain } from "@/lib/today/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const list = await listRunbooks();
    return Response.json({
      ok: true,
      runbooks: list.map((rb) => ({
        id: rb.id, product: rb.product, pashoOrderNo: rb.pashoOrderNo, productNo: rb.productNo,
        arrivedAt: rb.arrivedAt, progress: progressOf(rb),
        steps: rb.steps.map((s) => ({ key: s.key, title: s.title, phase: s.phase, done: s.done, opened: !!s.openedAt })),
      })),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let b: { product?: string; pashoOrderNo?: string; productNo?: number; domain?: Domain; runbookId?: string; step?: string; arrived?: string;
           addStep?: { key: string; title: string; phase?: "before" | "onArrival" | "after"; date?: string } };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 }); }
  try {
    if (b.arrived) {
      const rb = await markArrived(b.arrived);
      if (!rb) return Response.json({ ok: false, error: "런북 없음" }, { status: 404 });
      return Response.json({ ok: true, runbook: { id: rb.id, product: rb.product, arrivedAt: rb.arrivedAt, progress: progressOf(rb) } });
    }
    if (b.runbookId && b.addStep) {
      const rb = await addStep(b.runbookId, b.addStep);
      if (!rb) return Response.json({ ok: false, error: "런북 없음" }, { status: 404 });
      return Response.json({ ok: true, progress: progressOf(rb) });
    }
    if (b.runbookId && b.step) {
      const rb = await completeStep(b.runbookId, b.step);
      if (!rb) return Response.json({ ok: false, error: "런북 없음" }, { status: 404 });
      return Response.json({ ok: true, progress: progressOf(rb) });
    }
    if (b.product) {
      const rb = await createRunbook({ product: b.product, pashoOrderNo: b.pashoOrderNo, productNo: b.productNo, domain: b.domain });
      return Response.json({ ok: true, runbook: { id: rb.id, product: rb.product, progress: progressOf(rb) } });
    }
    return Response.json({ ok: false, error: "product / (runbookId+step) / arrived 중 하나 필요" }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
