export type TaskCategory = "design" | "ads" | "cs" | "content" | "ops" | "etc";

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  design:  "시계 디자인",
  ads:     "광고 운영",
  cs:      "고객 CS",
  content: "콘텐츠",
  ops:     "운영",
  etc:     "기타",
};

export const CATEGORY_BADGE: Record<TaskCategory, string> = {
  design:  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  ads:     "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  cs:      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  content: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  ops:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  etc:     "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export const CATEGORY_ORDER: TaskCategory[] = ["design", "ads", "cs", "content", "ops", "etc"];

export interface InboxItem {
  id:            string; // composite: accountId:threadId
  accountId:     string;
  accountBrand:  string;
  threadId:      string;
  sender:        string;
  senderEmail:   string | null;
  subject:       string;
  snippet:       string;
  receivedAt:    string; // ISO
  receivedLabel: string;
  overdue:       boolean;
  gmailWebUrl:   string;
}

export interface InboxThreadMessage {
  from:       string;
  to:         string;
  date:       string;
  bodyText:   string;
  bodyHtml:   string;
  isOutgoing: boolean;
}

export interface InboxThreadDetail {
  threadId:  string;
  accountId: string;
  subject:   string;
  messages:  InboxThreadMessage[];
}

export interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  done: boolean;
  /** YYYY-MM-DD KST. 어제 미완료면 오늘 날짜로 자동 이월. */
  date: string;
}

export type CadenceType = "weekly" | "monthly";

export interface RevenueAction {
  id: string;
  title: string;
  cadence: string;
  scope: string;
  cadenceType: CadenceType;
  target: number;
  done: number;
  /** weekly: YYYY-MM-DD (해당 주 일요일) · monthly: YYYY-MM. period 변경 시 done 리셋. */
  periodKey: string;
}

export interface RevenueGoal {
  /** 이번 달 목표 매출 (원). 브랜드별 분리 저장. 사용자가 위젯에서 편집 가능. */
  target: number;
}

export interface EventChecklistItem {
  id: string;
  /** 이벤트 D-day로부터 며칠 전이 마감인지 */
  dDay: number;
  title: string;
  done: boolean;
}

export interface BigEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD KST. 오늘 기준 daysLeft = daysUntil(targetDate) */
  targetDate: string;
  checklist: EventChecklistItem[];
}

/** TodayTasksWidget 에 빅 이벤트 마감을 시각적으로 주입할 때 쓰는 형태 */
export interface InjectedEventItem {
  eventId: string;
  eventTitle: string;
  checklistId: string;
  dDay: number;
  /** 0 = 오늘 마감, 음수 = 지남 */
  daysLeftDelta: number;
  title: string;
}
