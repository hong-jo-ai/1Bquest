/**
 * 클로드 코드 세션 기록 → "지금 진행 중인 일" 목록.
 *
 * 원본은 로컬 맥의 ~/.claude/projects 에만 있다. 배포된 대시보드는 그 파일을 볼 수 없으므로
 * local-agent/claudeActivityScan.js 가 주기적으로 스캔해 kv_store 에 적재하고,
 * 여기서는 적재된 것만 읽어 분류·묶음 처리한다.
 */
import { createClient } from "@supabase/supabase-js";
import { classifySession } from "./classify";
import { staleDaysSince } from "./date";
import type { ActivityScan, ActivityThread, Domain, RawSession } from "./types";

export const ACTIVITY_KEY  = "today:cc_activity";
export const OVERRIDES_KEY = "today:domain_overrides";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 제목을 묶음 키로. 공백·문장부호를 없애 같은 일감이 흩어지지 않게 한다. */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[\s.,!?·…"'`~\-—()[\]]/g, "").slice(0, 40);
}

/**
 * 세션들을 "작업 줄기"로 묶는다.
 *   - 사이드 프로젝트: 프로젝트 디렉토리 자체가 곧 하나의 줄기다(아르스앱 = 한 덩어리).
 *   - 그 외: 제목이 같은 세션끼리 묶는다. 하루에 여러 번 이어서 한 일이 한 줄로 보인다.
 */
export function buildThreads(
  sessions: RawSession[],
  overrides: Record<string, Domain> = {},
): ActivityThread[] {
  const groups = new Map<string, { rows: RawSession[]; domain: Domain; side: boolean }>();

  for (const s of sessions) {
    const { domain, side } = classifySession(s, overrides);
    const key = side ? `dir:${s.projectDir}` : `${domain}:${titleKey(s.title)}`;
    const g = groups.get(key);
    if (g) g.rows.push(s);
    else groups.set(key, { rows: [s], domain, side });
  }

  const threads: ActivityThread[] = [];
  for (const [id, g] of groups) {
    const rows = g.rows.sort((a, b) => b.touchedAt.localeCompare(a.touchedAt));
    const latest = rows[0];
    threads.push({
      id,
      // 사이드 프로젝트는 세션 제목이 매번 달라서 가장 최근 제목을 대표로 쓴다.
      title:         latest.title,
      domain:        g.domain,
      side:          g.side,
      sessions:      rows.length,
      lastTouchedAt: latest.touchedAt,
      staleDays:     staleDaysSince(latest.touchedAt),
    });
  }

  // 최근에 만진 것 우선. 같은 날이면 세션이 많이 쌓인 쪽이 위로.
  return threads.sort(
    (a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt) || b.sessions - a.sessions,
  );
}

export interface ActivityResult {
  scannedAt: string | null;
  threads: ActivityThread[];
  /** 스캐너가 한 번도 안 돌았거나 Supabase 미설정 */
  error?: string;
}

export async function getActivity(): Promise<ActivityResult> {
  const db = getDb();
  if (!db) return { scannedAt: null, threads: [], error: "Supabase 미설정" };

  const { data, error } = await db
    .from("kv_store")
    .select("key, data")
    .in("key", [ACTIVITY_KEY, OVERRIDES_KEY]);

  if (error) return { scannedAt: null, threads: [], error: error.message };

  const map = new Map((data ?? []).map((r) => [r.key as string, r.data]));
  const scan = map.get(ACTIVITY_KEY) as ActivityScan | undefined;
  if (!scan?.sessions?.length) {
    return { scannedAt: null, threads: [], error: "스캔 기록이 아직 없습니다" };
  }

  const overrides = (map.get(OVERRIDES_KEY) ?? {}) as Record<string, Domain>;
  return { scannedAt: scan.scannedAt, threads: buildThreads(scan.sessions, overrides) };
}
