/**
 * 모리가 어느 화면 위에서 열렸는지 알려주는 가벼운 페이지 컨텍스트.
 *
 * iframe으로 뜬 모리는 부모 화면의 React 상태를 직접 알 수 없으므로, 최소한 pathname을
 * 넘겨 "지금 대표님이 어떤 업무 화면을 보고 있는지"를 system context에 넣는다.
 */

interface PageGuide {
  prefix: string;
  label: string;
  focus: string[];
  suggestedActions: string[];
}

const PAGE_GUIDES: PageGuide[] = [
  {
    prefix: "/inbox",
    label: "통합 CS 인박스",
    focus: ["미답변·대기 CS", "고객 감정이 큰 클레임", "답변 초안 품질", "반복 문의 패턴"],
    suggestedActions: ["미답변을 먼저 정리", "답변 초안 작성", "환불·배송·AS 원칙 확인", "반복 문의는 플레이북으로 저장"],
  },
  {
    prefix: "/inventory",
    label: "재고 관리",
    focus: ["품절·위험 재고", "판매 중인데 재고관리 미사용인 품목", "단종 제외 여부", "발주 필요 품목"],
    suggestedActions: ["부족 재고 확인", "발주 기록 제안", "품절 상품 노출/광고 영향 확인", "제품별 메모 저장"],
  },
  {
    prefix: "/ads",
    label: "광고/MADS",
    focus: ["MADS 대기 추천", "오늘 광고 지출·노출·클릭·구매", "ROAS와 전환 문제", "광고를 흔들지 않는 원칙"],
    suggestedActions: ["MADS 추천 근거 설명", "광고 집행 여부 확인", "클릭 후 구매 0이면 상세페이지·가격·품절 점검", "예산 변경은 확인 카드 전 단계로만 제안"],
  },
  {
    prefix: "/analytics",
    label: "매출 분석",
    focus: ["오늘·이번주·이번달 매출", "최근 추이", "상위 판매 상품", "광고 유입과 전환"],
    suggestedActions: ["오늘 운영 브리핑", "매출/주문 추이 차트 표시", "상위 상품 확인", "이상 징후의 다음 확인 행동 제안"],
  },
  {
    prefix: "/finance",
    label: "정산/재무",
    focus: ["정산 업로드", "광고비·원가·마진", "세금계산서·카드 사용", "채널별 수익성"],
    suggestedActions: ["미처리 정산 확인", "마진/비용 관점으로 제안 검토", "재무 데이터가 없으면 단정하지 않기", "반복 정산 기준은 기억으로 저장"],
  },
  {
    prefix: "/channel-pricing",
    label: "채널 가격 관리",
    focus: ["채널별 가격 일관성", "과도한 할인", "마진 훼손", "가격 불일치"],
    suggestedActions: ["가격 정책 기준 확인", "채널별 가격 차이 점검", "할인 제안은 브랜드 가치와 마진 기준으로 판단", "확정 가격 원칙 저장"],
  },
  {
    prefix: "/as",
    label: "AS 접수/수리 추적",
    focus: ["AS 접수 상태", "고객 연락처·주소", "증상·모델", "고객 안내 필요 여부"],
    suggestedActions: ["AS 상태 요약", "고객 안내 문구 작성", "오늘 처리할 AS를 할일로 추가", "반복 증상은 제품 메모로 저장"],
  },
  {
    prefix: "/sms",
    label: "고객 안내 SMS",
    focus: ["문자 발송 대상", "발송 전 확인", "배송 지연·AS 안내", "고객에게 나가는 문구 품질"],
    suggestedActions: ["문자 문안 초안 작성", "발송 전 확인 필요성 강조", "고객 개인정보 단정 금지", "반복 템플릿은 기억으로 저장"],
  },
  {
    prefix: "/jewelry-clearance",
    label: "주얼리 클리어런스",
    focus: ["청산 대상", "노출·복구 상태", "재고 소진", "브랜드 결 훼손 위험"],
    suggestedActions: ["청산 우선순위 확인", "광고/노출 상태 점검", "운영 부담 대비 효과 판단", "정리 기준 저장"],
  },
  {
    prefix: "/tools/influencer",
    label: "인플루언서 관리",
    focus: ["협업 후보 적합성", "팔로워보다 타깃 결", "운영 부담", "DM/발송 상태"],
    suggestedActions: ["후보 적합성 1차 판단", "DM 초안 작성", "발송/회신 상태 정리", "거절·진행 기준 저장"],
  },
  {
    prefix: "/tools/group-buying",
    label: "공동구매 관리",
    focus: ["공구 캠페인 상태", "주문·정산·가격", "운영 공수", "브랜드 결"],
    suggestedActions: ["캠페인 상태 요약", "정산/가격 이슈 확인", "운영 부담 기준으로 진행 여부 판단", "공구 기준 저장"],
  },
  {
    prefix: "/tools/content",
    label: "콘텐츠 스튜디오",
    focus: ["콘텐츠 기획", "채널 변환", "트렌드", "광고 티 안 나는 문구"],
    suggestedActions: ["콘텐츠 초안 작성", "공감→제작 배경→CTA 구조 적용", "채널별 톤 변환", "잘 먹힌 문구는 기억으로 저장"],
  },
  {
    prefix: "/tools/threads-analytics",
    label: "스레드 분석",
    focus: ["스레드 반응", "댓글·인사이트", "콘텐츠 성과", "다음 게시 전략"],
    suggestedActions: ["성과 요약", "댓글 인사이트 정리", "다음 게시 아이디어 제안", "반응 좋은 패턴 저장"],
  },
  {
    prefix: "/tools/threads",
    label: "스레드 운영",
    focus: ["게시 큐", "댓글 대응", "자동 게시 상태", "브랜드 톤"],
    suggestedActions: ["게시 문안 작성", "댓글 답변 초안 작성", "큐 상태 확인", "반복 톤 가이드 저장"],
  },
  {
    prefix: "/mori",
    label: "모리 전용 화면",
    focus: ["전체 운영 질문", "장기 기억", "오늘 브리핑", "다음 액션 정리"],
    suggestedActions: ["오늘 운영 브리핑", "기억 저장/수정", "할일 추가", "필요한 화면으로 이동 제안"],
  },
  {
    prefix: "/",
    label: "오늘 허브/대시보드",
    focus: ["오늘 매출", "광고", "CS", "재고", "할일·일정"],
    suggestedActions: ["오늘 운영 브리핑", "우선순위 제안", "필요한 지표 카드 표시", "할일 추가"],
  },
];

export interface MoriPageContext {
  path: string;
  label: string;
  focus: string[];
  suggestedActions: string[];
}

export function normalizePagePath(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 240) return "";
  if (!s.startsWith("/")) return "";
  if (s.startsWith("/api/")) return "";
  return s.replace(/[\n\r\t]/g, " ");
}

export function resolvePageContext(raw: unknown): MoriPageContext | null {
  const path = normalizePagePath(raw);
  if (!path) return null;
  const pathname = path.split("?")[0] || "/";
  const guide = PAGE_GUIDES.find((g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`));
  return {
    path,
    label: guide?.label ?? "대시보드 화면",
    focus: guide?.focus ?? ["현재 화면의 주요 업무"],
    suggestedActions: guide?.suggestedActions ?? ["현재 화면에서 이어서 할 수 있는 다음 행동 제안"],
  };
}

export function buildPageContextBlock(raw: unknown): string {
  const ctx = resolvePageContext(raw);
  if (!ctx) return "";
  return `# 현재 화면 맥락

- 대표님이 모리를 연 화면: ${ctx.label}
- 경로: ${ctx.path}
- 이 화면에서 우선 볼 것: ${ctx.focus.join(" / ")}
- 이 화면에서 이어서 할 수 있는 행동: ${ctx.suggestedActions.join(" / ")}

답변할 때 이 화면에서 바로 이어서 할 수 있는 행동을 우선 제안하세요. 단, 이 정보는 화면 위치 힌트일 뿐이고 실시간 수치 판단은 대시보드 데이터와 도구 조회를 우선하세요.`;
}
