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

export interface ScheduleItem {
  id: string;
  time: string;
  title: string;
  location: string;
}

export interface InboxItem {
  id: string;
  sender: string;
  subject: string;
  receivedLabel: string;
  overdue: boolean;
}

export interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  done: boolean;
}

export interface RevenueAction {
  id: string;
  title: string;
  cadence: string;
  scope: string;
  target: number;
  done: number;
}

export interface RevenueGoal {
  target: number;
  current: number;
}

export interface EventChecklistItem {
  id: string;
  dDay: number;
  title: string;
  done: boolean;
  isToday?: boolean;
}

export interface BigEvent {
  id: string;
  title: string;
  daysLeft: number;
  checklist: EventChecklistItem[];
}
