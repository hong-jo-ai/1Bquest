/**
 * 문의 고객 ↔ PAULVICE CARE 등록 대조.
 *
 * 왜 필요한가: CARE 등록자는 **배터리 교체 1회 무료**다. 그런데 상담 중에
 * 그걸 확인하려면 사람이 따로 조회해야 하고, 그 몇 초 때문에 결국 확인을 안 한다
 * → 혜택이 있는데도 안내를 못 하고, 고객은 등록한 보람을 못 느낀다.
 * 그래서 문의가 열리는 순간 자동으로 붙인다. 자동응대 프롬프트에도 같은 값을 넣는다.
 *
 * 번호를 얻는 두 경로
 *   ① webchat — 고객이 이름·전화를 직접 남기므로 customer_handle 이 곧 전화번호다.
 *   ② 그 외(crisp·메일 등) — handle 이 이메일이라 전화가 없다. 이 경우 주문이력
 *      매칭으로 복원된 번호(orderHistory.phone)를 쓴다. 이름만 일치한 매칭이면
 *      동명이인 위험이 있어 **쓰지 않는다** — 남의 무료 혜택을 안내하는 게 더 나쁘다.
 */
import { lookup, type CareLookup } from "@/lib/care/store";
import { normalizePhone } from "./customerOrders";

export interface CareContext extends CareLookup {
  /** 어느 경로로 번호를 얻었는지 — UI 에서 확신도를 다르게 보여주기 위해 */
  matchedBy: "handle" | "orders";
}

export async function careContextFor(opts: {
  handle?: string | null;
  /** getCustomerOrderHistory 결과. 전화 매칭으로 번호가 복원됐을 때만 쓴다. */
  orderPhone?: string | null;
  orderMatchedByPhone?: boolean;
}): Promise<CareContext | null> {
  const fromHandle = normalizePhone(opts.handle);
  const fromOrders = opts.orderMatchedByPhone ? normalizePhone(opts.orderPhone) : null;
  const phone = fromHandle ?? fromOrders;
  if (!phone) return null;
  const r = await lookup(phone).catch(() => null);
  if (!r) return null;
  return { ...r, matchedBy: fromHandle ? "handle" : "orders" };
}

/** 자동응대 프롬프트에 넣을 한 문단. 등록자가 아니면 null(=넣지 않는다). */
export function carePromptBlock(c: CareContext | null): string | null {
  if (!c?.registered) return null;
  const lines = [
    `- PAULVICE CARE 등록 고객입니다 (등록일 ${c.registeredAt?.slice(0, 10) ?? "확인필요"}).`,
    c.products.length ? `- 등록 제품: ${c.products.map((p) => p.name ?? "제품미상").join(", ")}` : null,
    c.batteryFree
      ? "- **배터리 교체 1회 무료가 아직 남아 있습니다.** 배터리·방전 관련 문의면 무료 교체를 먼저 안내하세요. "
        + "작업은 무료이고 보내주시는 택배비만 고객 부담이라는 점을 같이 말해야 합니다."
      : `- 배터리 무료 1회는 이미 사용했습니다(${c.batteryUsedAt?.slice(0, 10)}). 유상 안내로 진행하세요.`,
    "- 등록 고객이므로 구매처·구매일을 되묻지 마세요(이미 확인된 고객입니다).",
  ].filter(Boolean);
  return lines.join("\n");
}
