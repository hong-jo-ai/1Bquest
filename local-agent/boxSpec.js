/**
 * 주문 → 배송 박스 규격(치수·무게) 판정.
 *
 * 왜 필요한가: 페덱스는 **실중량과 부피무게(가로×세로×높이÷5000) 중 큰 쪽**으로 청구한다.
 * 치수를 안 보내면 페덱스가 직접 재서 나중에 차액을 청구한다 — 시계 박스처럼 가볍고 부피가
 * 있는 화물은 대개 부피무게가 이기므로, 치수를 함께 보내는 게 정확하다.
 *
 * 규격 출처: 사장님 실측 2026-09-18. 부자재 KV(`paulwise:supplies:v1`)의 각 박스 `dims`·
 * `weightKg` 와 같은 값이다. ⚠️ 한쪽을 고치면 다른 쪽도 고칠 것.
 *
 * 실중량(사장님 실측 2026-09-18): 18×15×7 은 0.3kg, 나머지 둘은 0.5kg.
 * 🔑 **세 박스 모두 부피무게가 실중량보다 커서, 청구 기준은 언제나 부피무게다**
 * (0.38 / 0.77 / 1.75kg). 실중량은 신고값일 뿐 운임에 영향을 주지 않는다 —
 * 무게를 더 정밀하게 재봤자 운임은 그대로이고, **치수가 곧 운임**이라는 뜻이다.
 *
 * 쓰는 곳: 페덱스 라벨 발급(fedexShip.createShipment). 국내 우체국 접수는 무게·치수를
 * 쓰지 않으므로(요금이 고정) 이 모듈과 무관하다.
 */

/** 기원·설월은 전용 박스를 쓴다 — 상품명으로 판별(국문몰·영문몰 표기 모두). */
const BIG_WATCH = /기원|설월|ki:?won|seolwol/i;

/**
 * 박스 크기를 좌우하지 않는 소품 — 시계와 같은 박스에 들어간다.
 * ⚠️ 이걸 시계처럼 세면 "기원 1개 + 밴드 1개"가 최대 박스로 올라가 운임이 0.77 → 1.75kg 로
 * 두 배가 된다. 시계+밴드 주문은 흔해서 그대로 두면 계속 과다 청구된다.
 */
const ACCESSORY = /밴드|스트랩|strap|band|버클|buckle|공구|tool|쇼핑백|배터리|batter/i;

const BOXES = {
  // 폴바이스·해리엇 일반시계 1개
  "box-default": { lengthCm: 18, widthCm: 15, heightCm: 7,  weightKg: 0.3 },
  // 기원·설월 1개 또는 일반시계 2~3개
  "box-giwon":   { lengthCm: 24, widthCm: 16, heightCm: 10, weightKg: 0.5 },
  // 기원·설월 2개 (그 이상도 현재는 이 박스가 최대)
  "box-giwon2":  { lengthCm: 28, widthCm: 26, heightCm: 12, weightKg: 0.5 },
};

/** 페덱스 부피무게(kg). 국제특송 표준 제수 5000. */
const volumetricKg = (b) => +((b.lengthCm * b.widthCm * b.heightCm) / 5000).toFixed(2);

/**
 * 주문 품목으로 박스를 고른다.
 * @param {Array<{name?: string, qty?: number|string}>} items 품목(상품명·수량)
 * @returns {{boxId: string, lengthCm: number, widthCm: number, heightCm: number,
 *            weightKg: number, volumetricKg: number, billableKg: number, reason: string}}
 */
function pickBox(items) {
  const list = Array.isArray(items) ? items : [];
  let big = 0, normal = 0, accessory = 0;
  for (const it of list) {
    const q = Math.max(1, Number(it.qty) || 1);
    const name = String(it.name || "");
    if (ACCESSORY.test(name)) { accessory += q; continue; }   // 소품은 박스 크기에 영향 없음
    if (BIG_WATCH.test(name)) big += q; else normal += q;
  }
  const total = big + normal;
  // 소품만 있는 주문(밴드만 사는 경우)도 가장 작은 박스로 나간다.
  if (total === 0 && accessory > 0) {
    const b = BOXES["box-default"], vol = volumetricKg(b);
    return { boxId: "box-default", ...b, volumetricKg: vol,
             billableKg: Math.max(b.weightKg, vol), reason: `소품 ${accessory}개만` };
  }

  let boxId, reason;
  if (big >= 2)                   { boxId = "box-giwon2";  reason = `기원·설월 ${big}개`; }
  else if (big === 1 && total > 1){ boxId = "box-giwon2";  reason = `기원·설월 1개 + 다른 품목 ${total - 1}개`; }
  else if (big === 1)             { boxId = "box-giwon";   reason = "기원·설월 1개"; }
  else if (normal >= 4)           { boxId = "box-giwon2";  reason = `일반시계 ${normal}개`; }
  else if (normal >= 2)           { boxId = "box-giwon";   reason = `일반시계 ${normal}개`; }
  else                            { boxId = "box-default"; reason = "일반시계 1개"; }

  const b = BOXES[boxId];
  const vol = volumetricKg(b);
  return {
    boxId, ...b,
    volumetricKg: vol,
    // 페덱스가 실제로 적용할 기준 — 우리가 참고·검증용으로 같이 계산해 둔다.
    billableKg: Math.max(b.weightKg, vol),
    reason,
  };
}

module.exports = { pickBox, BOXES, volumetricKg, BIG_WATCH };

// ── CLI 확인: node local-agent/boxSpec.js ──
if (require.main === module) {
  const cases = [
    [{ name: "폴바이스 에끌라 오벌 워치 - 골드", qty: 1 }],
    [{ name: "Éclat Oval Watch - Gold", qty: 2 }],
    [{ name: "에끌라 오벌", qty: 3 }],
    [{ name: "기원 백색", qty: 1 }],
    [{ name: "SEOLWOL", qty: 1 }],
    [{ name: "설월", qty: 2 }],
    [{ name: "기원 비취색", qty: 1 }, { name: "20mm 가죽밴드 흑색", qty: 1 }],
    [{ name: "에끌라 오벌 실버", qty: 1 }, { name: "메탈 스트랩 10mm", qty: 1 }],
    [{ name: "기원 백색", qty: 1 }, { name: "폴바이스 에끌라 오벌", qty: 1 }],
    [{ name: "20mm 가죽밴드 갈색", qty: 2 }],
  ];
  for (const c of cases) {
    const r = pickBox(c);
    const label = c.map((x) => `${x.name}×${x.qty}`).join(" + ");
    console.log(
      `${label}\n  → ${r.boxId} ${r.lengthCm}×${r.widthCm}×${r.heightCm}cm · ` +
      `실중량 ${r.weightKg} / 부피 ${r.volumetricKg} → 청구 ${r.billableKg}kg  (${r.reason})\n`
    );
  }
}
