import type { AgentConfig, AgentId } from "./types";

export const AGENTS: AgentConfig[] = [
  {
    id: "data-collector",
    name: "정보수집",
    nameEn: "Data Collector",
    description: "Cafe24 매출, GA4 트래픽, Meta 광고, 재고 현황을 수집",
    icon: "Database",
    llm: "none",
    capabilities: ["Cafe24 주문/상품 수집", "GA4 트래픽 수집", "Meta 광고 성과 수집", "재고 에이징 분석"],
  },
  {
    id: "research-analyst",
    name: "리서치",
    nameEn: "Research Analyst",
    description: "수집 데이터를 분석하여 저조 상품, 트렌드, 경쟁 인사이트 도출",
    icon: "Search",
    llm: "claude",
    capabilities: ["저조 상품 원인 분석", "트렌드 키워드 분석", "경쟁사 인사이트", "고객 행동 분석"],
  },
  {
    id: "strategy-planner",
    name: "전략기획",
    nameEn: "Strategy Planner",
    description: "리서치 결과를 기반으로 구체적 액션 플랜과 A/B 테스트 설계",
    icon: "Target",
    llm: "claude",
    capabilities: ["액션 플랜 수립", "A/B 테스트 설계", "ROI 예측", "프로모션 기획"],
  },
  {
    id: "copywriter",
    name: "카피라이팅",
    nameEn: "Copywriter",
    description: "상세페이지, 배너, 프로모션, SEO, SNS 텍스트 콘텐츠 생성",
    icon: "PenTool",
    llm: "claude",
    capabilities: ["상세페이지 카피", "배너 카피", "프로모션 문구", "SEO 메타 태그", "SNS 카피"],
  },
  {
    id: "designer",
    name: "디자인",
    nameEn: "Designer",
    description: "Gemini 3.1 Pro로 배너, 상세페이지, SNS 이미지 생성",
    icon: "Palette",
    llm: "gemini",
    capabilities: ["메인 배너 생성", "상세페이지 이미지", "인스타 콘텐츠", "프로모션 배너"],
  },
  {
    id: "marketing",
    name: "마케팅",
    nameEn: "Marketing",
    description: "Meta 광고 운영, SNS 발행, 프로모션 실행, 인플루언서 협업",
    icon: "Megaphone",
    llm: "claude",
    capabilities: ["Meta 캠페인 관리", "리타겟팅 설계", "SNS 발행", "인플루언서 조율"],
  },
  {
    id: "merchandiser",
    name: "머천다이징",
    nameEn: "Merchandiser",
    description: "카테고리 진열, 메인페이지 구성, 가격 전략, 번들 구성",
    icon: "LayoutGrid",
    llm: "claude",
    capabilities: ["카테고리 진열 최적화", "가격 전략", "번들/세트 구성", "재고 소진 전략"],
  },
  {
    id: "product-dev",
    name: "상품개발",
    nameEn: "Product Dev",
    description: "시장 갭 분석, 신상품 아이디어, 소싱 키워드 제안",
    icon: "Lightbulb",
    llm: "claude",
    capabilities: ["갭 분석", "신상품 아이디어", "경쟁 상품 분석", "소싱 키워드"],
  },
  {
    id: "prompt-engineer",
    name: "프롬프팅",
    nameEn: "Prompt Engineer",
    description: "모든 에이전트 프롬프트 관리, 품질 평가, A/B 테스트",
    icon: "Sparkles",
    llm: "claude",
    capabilities: ["프롬프트 버전 관리", "품질 평가", "A/B 테스트", "비용 최적화"],
  },
];

export function getAgent(id: AgentId): AgentConfig | undefined {
  return AGENTS.find((a) => a.id === id);
}

export const AGENT_MAP = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<AgentId, AgentConfig>;
