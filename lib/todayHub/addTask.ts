/**
 * 오늘 할일 추가 공유 로직.
 *
 * /api/mcp (claude.ai 데스크톱) 와 /api/telegram/webhook (모바일 봇)
 * 양쪽에서 호출 가능하도록 따로 분리.
 *
 * 저장 위치: kv_store.today_hub:tasks
 *   = TodayHubSection 이 동일 키 폴링/저장 — UI 새로고침 시 즉시 반영.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const TASKS_KEY = "today_hub:tasks";

export type TaskCategory = "design" | "ads" | "cs" | "content" | "ops" | "etc";
const VALID_CATEGORIES: TaskCategory[] = ["design", "ads", "cs", "content", "ops", "etc"];

const CATEGORY_KOREAN_ALIAS: Record<string, TaskCategory> = {
  "디자인": "design",     "시계디자인": "design",   "design": "design",
  "광고":   "ads",        "광고운영": "ads",        "ads":    "ads",
  "cs":     "cs",         "고객":   "cs",           "고객cs": "cs",
  "콘텐츠": "content",    "content": "content",
  "운영":   "ops",        "ops":    "ops",
  "기타":   "etc",        "etc":    "etc",
};

export interface StoredTask {
  id:        string;
  title:     string;
  category:  TaskCategory;
  done:      boolean;
  date:      string;  // YYYY-MM-DD KST
}

export interface AddTaskArgs {
  title?:    string;
  category?: string;
}

export type AddTaskResult =
  | { ok: true; id: string; message: string; task: StoredTask }
  | { ok: false; error: string };

export const ADD_TODAY_TASK_TOOL = {
  name: "add_today_task",
  description:
    "Paulwise 대시보드의 '오늘 할일' 위젯에 새 할 일을 추가합니다. " +
    "위젯은 클로드 모바일/데스크톱 어디서든 호출 가능. " +
    "카테고리는 디자인/광고/CS/콘텐츠/운영/기타 중 하나, 모르면 기타로 자동 분류. " +
    "추가 직후 대시보드를 새로고침하면 미체크 상태로 노출됩니다.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "할 일 제목 (한 줄). 필수.",
      },
      category: {
        type: "string",
        description:
          "카테고리. 영문: design/ads/cs/content/ops/etc 또는 한글: 디자인/광고/CS/콘텐츠/운영/기타. 미지정 시 'etc(기타)' 자동.",
      },
    },
    required: ["title"],
  },
};

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function normalizeCategory(raw: string | undefined): TaskCategory {
  const key = (raw ?? "").toLowerCase().replace(/\s+/g, "");
  if (key in CATEGORY_KOREAN_ALIAS) return CATEGORY_KOREAN_ALIAS[key];
  if ((VALID_CATEGORIES as string[]).includes(key)) return key as TaskCategory;
  return "etc";
}

function kstDateStr(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function newId(): string {
  return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function loadTasks(supabase: SupabaseClient): Promise<StoredTask[]> {
  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", TASKS_KEY)
    .maybeSingle();
  const raw = data?.data;
  return Array.isArray(raw) ? (raw as StoredTask[]) : [];
}

async function saveTasks(supabase: SupabaseClient, tasks: StoredTask[]): Promise<void> {
  const { error } = await supabase
    .from("kv_store")
    .upsert(
      { key: TASKS_KEY, data: tasks, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(`KV 저장 실패: ${error.message}`);
}

export async function addTodayTask(args: AddTaskArgs): Promise<AddTaskResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "DB 미설정 (SUPABASE_URL/KEY 확인)" };
  }

  const title = String(args.title ?? "").trim();
  if (!title) {
    return { ok: false, error: "title 필수" };
  }
  if (title.length > 200) {
    return { ok: false, error: "title 최대 200자" };
  }

  const category = normalizeCategory(args.category);

  const existing = await loadTasks(supabase);

  // 중복 방지 — 같은 날짜 + 같은 제목(대소문자 무시) 은 새로 안 만듦
  const today = kstDateStr();
  const dup = existing.find(
    (t) => t.date === today && t.title.toLowerCase() === title.toLowerCase(),
  );
  if (dup) {
    return {
      ok: true,
      id: dup.id,
      message: `이미 등록된 할 일입니다 (오늘 날짜): "${title}"`,
      task: dup,
    };
  }

  const task: StoredTask = {
    id:       newId(),
    title,
    category,
    done:     false,
    date:     today,
  };

  await saveTasks(supabase, [...existing, task]);

  return {
    ok: true,
    id: task.id,
    message: `'${title}' 추가 완료 (카테고리: ${category}, 오늘 ${today})`,
    task,
  };
}
