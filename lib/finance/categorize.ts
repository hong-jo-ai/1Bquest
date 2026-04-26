/**
 * 은행 거래 자동 분류 — 규칙 기반.
 *
 * 보낸분/받는분 + 적요 + 송금메모를 모두 합쳐서 패턴 매칭.
 * 매칭되지 않으면 '기타'.
 */

export type TxCategory =
  | "매출"
  | "광고비"
  | "매입"
  | "임대료"
  | "통신비"
  | "소프트웨어"
  | "택배비"
  | "수수료"
  | "세금"
  | "카드결제"
  | "식비"
  | "교통/연료"
  | "송금"
  | "기타";

interface Rule {
  category: TxCategory;
  patterns: RegExp[];
  /** true면 입금만 (false면 출금만, undefined면 양쪽 모두) */
  isDeposit?: boolean;
}

// 우선순위 순서로 매칭. 입금/출금 방향까지 일치할 때만 매칭.
const RULES: Rule[] = [
  // ── 매출 입금 ─────────────────────────────────────
  {
    category: "매출",
    isDeposit: true,
    patterns: [
      /카페24페이먼/,
      /카페24/,
      /Npay\s*정산/i,
      /네이버페이|네이버\s*페이/,
      /NICE결제대행/,
      /NICE\s*페이/,
      /KG이니시스/,
      /KCP/,
      /토스페이먼츠/,
      /무신사정산|무신사\s*정산/,
      /W컨셉|wconcept/i,
      /29CM|29cm/i,
      /식스샵|sixshop/i,
      /스마트스토어|네이버\s*스토어/,
      /SC은행/, // 카페24페이먼이 SC은행 통해 입금되는 케이스
    ],
  },
  // ── 카드결제 (체크카드 출금 — 신용카드 결제 인출) ─
  {
    category: "카드결제",
    isDeposit: false,
    patterns: [/카드대금|카드결제|신한카드|KB카드출금|삼성카드|현대카드|롯데카드|BC카드|NH카드|우리카드|하나카드/],
  },
  // ── 광고비 ──────────────────────────────────────
  {
    category: "광고비",
    patterns: [
      /facebook|페이스북|메타|FB\.AD/i,
      /google\s*ads|구글\s*광고|google\s*ireland/i,
      /카카오모먼트|카카오비즈|kakao/i,
      /네이버\s*광고|네이버\s*검색광고|naver\s*ads/i,
      /tiktok|틱톡/i,
      /당근마켓\s*광고|daangn/i,
    ],
  },
  // ── 통신비 ──────────────────────────────────────
  {
    category: "통신비",
    patterns: [
      /SK텔레콤|skt|sk\s*텔레콤/i,
      /KT\b|케이티/,
      /LGU\+|엘지유플러스|lg\s*u\+/i,
      /SK브로드밴드/,
    ],
  },
  // ── 임대료 ──────────────────────────────────────
  {
    category: "임대료",
    patterns: [/임대료|월세|관리비|부동산|렌트/],
  },
  // ── 소프트웨어 / SaaS ──────────────────────────
  {
    category: "소프트웨어",
    patterns: [
      /aws\b|amazon\s*web/i,
      /vercel|github|cloudflare|supabase|notion|slack|figma/i,
      /google\s*cloud|gcp/i,
      /openai|anthropic|claude|gemini|chatgpt/i,
      /다우데이타|다우오피스|cafe24\s*호스팅/,
    ],
  },
  // ── 택배비 ──────────────────────────────────────
  {
    category: "택배비",
    patterns: [/CJ대한통운|한진택배|롯데택배|로젠택배|우체국택배|쿠팡로지스/],
  },
  // ── 세금 ─────────────────────────────────────────
  {
    category: "세금",
    patterns: [
      /국세청|국세|부가세|법인세|소득세|세무서/,
      /지방세|취득세|등록세|재산세/,
      /건강보험|국민연금|고용보험|산재보험|4대보험/,
    ],
  },
  // ── 식비 ─────────────────────────────────────────
  {
    category: "식비",
    isDeposit: false,
    patterns: [
      /스타벅스|커피|이디야|투썸|파스쿠치|메가커피/,
      /던킨|버거킹|맥도날드|롯데리아|서브웨이|파파존스/,
      /식당|식탁|국밥|한식|중식|일식|치킨|피자|배달의민족|쿠팡이츠|요기요/,
      /이마트|홈플러스|편의점|GS25|CU\b|세븐일레븐/,
    ],
  },
  // ── 교통/연료 ───────────────────────────────────
  {
    category: "교통/연료",
    isDeposit: false,
    patterns: [
      /주유소|GS칼텍스|SK에너지|S-OIL|현대오일/,
      /택시|TADA|타다|카카오모빌리티|kakaomobility|kakao\s*t/i,
      /지하철|버스|코레일|KTX|SRT/,
      /하이패스|highway|톨게이트/i,
    ],
  },
  // ── 수수료 ──────────────────────────────────────
  {
    category: "수수료",
    patterns: [/수수료|이체수수료|송금수수료|타행이체/],
  },
];

export function categorizeTx(input: {
  description: string;
  counterparty: string;
  memo: string;
  withdrawal: number;
  deposit: number;
}): { category: TxCategory; source: "rule" } {
  const text = `${input.counterparty} ${input.description} ${input.memo}`;
  const isDeposit = input.deposit > 0;

  for (const rule of RULES) {
    if (rule.isDeposit !== undefined && rule.isDeposit !== isDeposit) continue;
    if (rule.patterns.some((p) => p.test(text))) {
      return { category: rule.category, source: "rule" };
    }
  }

  // 매칭 실패: 입금이면 송금/매출, 출금이면 기타
  if (isDeposit) return { category: "송금", source: "rule" };
  return { category: "기타", source: "rule" };
}

/** 카테고리별 색상 (UI용) */
export const CATEGORY_COLOR: Record<TxCategory, string> = {
  매출: "#10b981",
  광고비: "#3b82f6",
  매입: "#8b5cf6",
  임대료: "#f59e0b",
  통신비: "#06b6d4",
  소프트웨어: "#6366f1",
  택배비: "#ec4899",
  수수료: "#94a3b8",
  세금: "#dc2626",
  카드결제: "#71717a",
  식비: "#f97316",
  "교통/연료": "#84cc16",
  송금: "#0ea5e9",
  기타: "#a1a1aa",
};
