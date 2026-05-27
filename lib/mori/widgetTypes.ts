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

export type MoriWidget = ChartWidget | CardsWidget;
export type WidgetEvent = MoriWidget | ClearWidget;
