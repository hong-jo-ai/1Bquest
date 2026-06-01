/**
 * 모리 위젯 타입 — 클라이언트 안전(서버 의존성 없음).
 *
 * 서버(lib/mori/tools.ts 실행기)와 클라이언트(components/mori/MoriWidgets.tsx)가 공유.
 * 절대 여기에 서버 전용 import(cafe24/supabase 등)를 넣지 말 것 — 클라이언트 번들에 샌다.
 */

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartWidget {
  id: string;
  kind: "chart";
  chartType: "line" | "bar";
  title: string;
  /** 값 단위 표기 ("원", "건" 등) */
  unit: string;
  data: ChartPoint[];
}

export interface MetricCard {
  label: string;
  value: string;
  sub?: string;
  /** 톤 — 강조 색 분기용 */
  tone?: "neutral" | "good" | "warn";
}

export interface CardsWidget {
  id: string;
  kind: "cards";
  title?: string;
  cards: MetricCard[];
}

/** 패널 비우기 신호. */
export interface ClearWidget {
  kind: "clear";
}

/**
 * 실행 확인 카드 — 되돌리기 어려운 작업(예: 사장님 텔레그램)은 모리가 바로 실행하지 않고
 * 이 카드를 띄운다. 사용자가 [실행]을 직접 눌러야 /api/mori/action 으로 실제 실행된다.
 * (음성/LLM 단독으로는 실행 불가 — 사람 클릭이 트리거)
 */
export interface ConfirmAction {
  /** 실행 엔드포인트가 분기하는 액션 종류 (화이트리스트) */
  type: "telegram_owner";
  /** 실행에 필요한 파라미터(서버가 type별로 해석) */
  params: Record<string, unknown>;
}

export interface ConfirmWidget {
  id: string;
  kind: "confirm";
  /** 카드 제목 (예: "사장님 텔레그램 보내기") */
  title: string;
  /** 미리보기 본문 — 실제로 실행될 내용 */
  detail: string;
  /** 실행 버튼 라벨 (기본 "실행") */
  confirmLabel?: string;
  action: ConfirmAction;
}

export type MoriWidget = ChartWidget | CardsWidget | ConfirmWidget;
export type WidgetEvent = MoriWidget | ClearWidget;
