/**
 * 카드 → 장부 귀속 사업자 매핑.
 *
 * 왜: 카드 적재 라우트들이 전부 `is_default` 사업자로만 넣고 있었다. 그런데 기본 사업자를
 * 2026-08-18 에 제이에이치 → 해리엇와치스로 바꾸면서, **같은 카드의 거래가 적재 시점에 따라
 * 두 사업자로 쪼개졌다**(2026-09-18 실측: 우리 0969 가 제이에이치 117건·해리엇 31건).
 * 귀속은 적재 시점이 아니라 **카드 명의자**로 정해져야 한다(사장님 결정 2026-09-18).
 *
 * ⚠️ 사업자 ≠ 브랜드. 여기서 정하는 건 장부(사업자) 귀속일 뿐, 브랜드 손익 배분은 ÷2 규칙을 따른다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** 카드사 → 명의자의 사업자등록번호. 모르는 카드사는 넣지 않는다(기본 사업자로 떨어진다). */
const CARD_OWNER_REG: Array<{ match: RegExp; reg: string; note: string }> = [
  { match: /^우리/,  reg: "209-27-70599", note: "홍성조 명의 → 해리엇와치스" },
  { match: /^현대/,  reg: "209-27-70599", note: "홍성조 명의 → 해리엇와치스" },
  { match: /^KB|국민/, reg: "663-23-01279", note: "한지형 명의 → 제이에이치" },
  // 하나(외환): 네이버페이에 물린 개인 체크카드. 명의 미확인이라 매핑하지 않는다.
];

/** 이 카드사가 어느 사업자로 가야 하는지. 매핑에 없으면 null → 호출측이 기본 사업자를 쓴다. */
export function cardOwnerRegNo(cardCompany: string | null | undefined): string | null {
  const c = (cardCompany ?? "").trim();
  if (!c) return null;
  return CARD_OWNER_REG.find((e) => e.match.test(c))?.reg ?? null;
}

/**
 * 카드사별 사업자 id 해석기. 라우트에서 한 번 만들어 행마다 호출한다.
 * DB 를 한 번만 읽고 캐시하므로 수백 행을 적재해도 쿼리는 1회다.
 */
export async function makeCardBusinessResolver(
  db: SupabaseClient,
  fallbackId: string,
): Promise<(cardCompany: string | null | undefined) => string> {
  const { data } = await db.from("finance_businesses").select("id, registration_number");
  const byReg = new Map<string, string>();
  for (const b of (data ?? []) as Array<{ id: string; registration_number: string | null }>) {
    if (b.registration_number) byReg.set(String(b.registration_number), String(b.id));
  }
  return (cardCompany) => {
    const reg = cardOwnerRegNo(cardCompany);
    return (reg && byReg.get(reg)) || fallbackId;
  };
}
