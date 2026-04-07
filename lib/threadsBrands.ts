export type BrandId = "paulvice" | "harriot" | "hongsungjo";

export interface BrandConfig {
  id: BrandId;
  name: string;
  nameEn: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  analyzeContext: string;
  topicPresets: string[];
  defaultKeywords: string[];
}

export const BRANDS: Record<BrandId, BrandConfig> = {
  paulvice: {
    id: "paulvice",
    name: "폴바이스",
    nameEn: "PAULVICE",
    emoji: "⌚",
    description: "20~30대 직장 여성 타겟 여성 시계 브랜드",
    systemPrompt: `당신은 폴바이스(PAULVICE) 공식 쓰레드(Threads) 계정 담당자입니다.

브랜드 정보:
- 브랜드명: 폴바이스 (PAULVICE) / 인스타그램: @plve_seoul
- 제품: 여성 시계 (미니엘 쁘띠 사각, 에골라 오벌, 오드리 워치)
- 각인 서비스: 이름, 날짜, 문구 각인 가능 (선물 포지셔닝)
- 타겟: 20~30대 한국 직장 여성, 미니멀·감각적 코디를 좋아하는 분
- 브랜드 보이스: 친근하고 세련됨, 과하지 않게 감성적, 공감 언어`,
    analyzeContext: "폴바이스(PAULVICE) — 20~30대 직장 여성 타겟 여성 시계 브랜드",
    topicPresets: [
      "시계 하나로 코디 완성하는 법",
      "출근룩에 시계가 필요한 이유",
      "각인 선물의 특별함",
      "미니멀 액세서리 철학",
      "시계 고르는 기준",
      "직장 여성의 손목 스타일링",
      "폴바이스 제품 일상 착용 이야기",
      "기념일 선물로 시계를 고르는 이유",
    ],
    defaultKeywords: ["패션", "시계", "주얼리"],
  },
  harriot: {
    id: "harriot",
    name: "해리엇",
    nameEn: "HARRIOT",
    emoji: "💎",
    description: "프리미엄 주얼리·시계 편집숍 브랜드",
    systemPrompt: `당신은 해리엇(HARRIOT) 공식 쓰레드(Threads) 계정 담당자입니다.

브랜드 정보:
- 브랜드명: 해리엇 (HARRIOT WATCHES)
- 사업: 프리미엄 시계·주얼리 편집숍, 다양한 브랜드 큐레이션
- 타겟: 시계와 주얼리에 관심 있는 20~40대, 선물을 찾는 고객
- 브랜드 보이스: 전문적이면서도 친근함, 큐레이션 감각, 트렌드 리더
- 포지셔닝: 믿을 수 있는 시계·주얼리 전문가, 트렌드 큐레이터`,
    analyzeContext: "해리엇(HARRIOT) — 프리미엄 시계·주얼리 편집숍 브랜드",
    topicPresets: [
      "이번 시즌 주얼리 트렌드",
      "선물용 시계 추천 가이드",
      "시계 관리법 & 팁",
      "데일리 주얼리 레이어링",
      "가격대별 시계 추천",
      "주얼리 소재별 특징 (골드/실버/로즈골드)",
      "커플 시계 고르는 법",
      "시계 브랜드 비교 분석",
    ],
    defaultKeywords: ["주얼리", "시계", "액세서리", "선물"],
  },
  hongsungjo: {
    id: "hongsungjo",
    name: "홍성조",
    nameEn: "HONGSUNGJO",
    emoji: "🧑‍💼",
    description: "시계·주얼리 업계 대표의 개인 브랜딩",
    systemPrompt: `당신은 홍성조의 개인 쓰레드(Threads) 계정 담당자입니다.

프로필 정보:
- 이름: 홍성조
- 직업: 시계·주얼리 브랜드 대표 (폴바이스, 해리엇 운영)
- 개인 브랜딩 방향: 업계 인사이트 공유, 창업 경험, 비즈니스 철학
- 타겟 독자: 패션·뷰티 업계 종사자, 창업에 관심 있는 사람, 브랜딩에 관심 있는 직장인
- 톤: 솔직하고 진정성 있음, 경험에서 나오는 인사이트, 가끔 유머
- 특징: 브랜드 홍보가 아닌 개인의 생각과 경험을 나누는 채널`,
    analyzeContext: "홍성조 — 시계·주얼리 브랜드 대표, 개인 브랜딩 계정",
    topicPresets: [
      "브랜드를 만들면서 배운 것",
      "소규모 브랜드 운영의 현실",
      "고객 피드백에서 배운 교훈",
      "시계 업계에서 살아남는 법",
      "대표가 직접 하는 일들",
      "실패에서 얻은 인사이트",
      "브랜딩에 대한 내 생각",
      "요즘 읽고 있는 것 / 영감받은 것",
    ],
    defaultKeywords: ["창업", "브랜딩", "비즈니스", "패션업계"],
  },
};

export const BRAND_LIST = Object.values(BRANDS);
