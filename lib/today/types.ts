/**
 * /today — 아침 업무 보드 타입.
 *
 * 기존 today-hub(브랜드 토글)과 달리 조직 축(domain)이 1급이다.
 * 기능 축(design/ads/cs/…)은 today-hub 쪽 TaskCategory 를 그대로 두고 여기서는 쓰지 않는다.
 */

/** 조직 축. 화면의 4열이 이 순서 그대로다. */
export type Domain = "paulvice" | "harriot" | "ars" | "personal";

export const DOMAINS: Domain[] = ["paulvice", "harriot", "ars", "personal"];

export const DOMAIN_LABEL: Record<Domain, string> = {
  paulvice: "폴바이스",
  harriot:  "해리엇",
  ars:      "아르스",
  personal: "개인",
};

/** 매출을 만드는 영역. TOP5 가중치와 컬럼 폭이 여기서 갈린다. */
export const REVENUE_DOMAINS: Domain[] = ["paulvice", "harriot"];

export interface Task {
  id: string;
  title: string;
  domain: Domain;
  /** 개인 영역 안의 사이드 프로젝트(개발) 트랙. TOP5 고정석 대상. */
  side?: boolean;
  done: boolean;
  /** YYYY-MM-DD KST. 어제 미완료면 오늘로 이월된다. */
  date: string;
  /** 있으면 마감. 없으면 마감 없는 일 = 정체 일수로 대신 잰다. */
  due?: string;
  /** 클로드 코드 세션에서 자동으로 올라온 항목인지 */
  fromActivity?: boolean;
}

/** 로컬 스캐너가 kv_store 에 적재하는 원본 한 줄 (분류 전) */
export interface RawSession {
  /** ~/.claude/projects 아래 디렉토리명 */
  projectDir: string;
  sessionId: string;
  /** ISO — 파일 mtime = 마지막으로 만진 시각 */
  touchedAt: string;
  /** ai-title 우선, 없으면 첫 사용자 발화 */
  title: string;
  /** ai-title 이 있었는지 (없으면 발화 원문이라 다듬어 보여준다) */
  titled: boolean;
}

export interface ActivityScan {
  scannedAt: string;
  sessions: RawSession[];
}

/** 같은 일감으로 묶인 세션 뭉치 = 화면에 "진행 중인 일"로 뜨는 단위 */
export interface ActivityThread {
  id: string;
  title: string;
  domain: Domain;
  side: boolean;
  /** 이 줄기에 묶인 세션 수 */
  sessions: number;
  /** ISO — 가장 최근에 만진 시각 */
  lastTouchedAt: string;
  /** 오늘(KST) 기준 며칠째 안 건드렸는지. 0 = 오늘도 했음 */
  staleDays: number;
}
