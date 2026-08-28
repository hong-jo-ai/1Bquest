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

/** 호스트별 키 접두사 — today:cc_activity:<host>. 구 단일 키(today:cc_activity)도 같이 잡힌다. */
export const ACTIVITY_PREFIX = "today:cc_activity";

/**
 * 보드에 띄울 기간(일). 스캐너는 더 길게(기본 21일) 적재하지만 화면에는 최근 것만 보인다 —
 * 몇 주 전에 끝난 일까지 "진행 중"으로 늘어놓으면 목록이 쓸모없어진다.
 */
export const WINDOW_DAYS = 7;
export const OVERRIDES_KEY   = "today:domain_overrides";
export const CLOSED_KEY    = "today:closed_threads";

/**
 * 닫은 줄기 기록. { 줄기id: 닫을 당시의 lastTouchedAt }
 *
 * 삭제가 아니라 "그 시점까지는 끝난 것으로 본다"는 기록이다. 그래서 나중에 같은
 * 일감으로 세션이 또 생기면(lastTouchedAt 이 기록보다 새로우면) 알아서 되살아난다.
 * 안 건드린 이유가 '끝나서'인지 '미뤄서'인지 파일 mtime 만으로는 못 가르기 때문에,
 * 그 구분은 사람이 한 번 눌러서 알려주는 수밖에 없다.
 */
export type ClosedMap = Record<string, string>;

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
  /** 끝난 것으로 닫혀서 화면에서 빠진 줄기 수 */
  closedCount: number;
  /** 스캐너가 한 번도 안 돌았거나 Supabase 미설정 */
  error?: string;
}

/** 줄기 하나를 끝난 것으로 닫거나(닫을 당시 시각 기록) 다시 연다. */
export async function setThreadClosed(
  threadId: string,
  lastTouchedAt: string,
  closed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  if (!db) return { ok: false, error: "Supabase 미설정" };

  const { data, error } = await db.from("kv_store").select("data").eq("key", CLOSED_KEY).maybeSingle();
  if (error) return { ok: false, error: error.message };

  const map: ClosedMap = (data?.data as ClosedMap) ?? {};
  if (closed) map[threadId] = lastTouchedAt;
  else delete map[threadId];

  const { error: putError } = await db
    .from("kv_store")
    .upsert({ key: CLOSED_KEY, data: map, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return putError ? { ok: false, error: putError.message } : { ok: true };
}

export async function getActivity(): Promise<ActivityResult> {
  const db = getDb();
  if (!db) return { scannedAt: null, threads: [], closedCount: 0, error: "Supabase 미설정" };

  const [scansRes, etcRes] = await Promise.all([
    db.from("kv_store").select("key, data").like("key", `${ACTIVITY_PREFIX}%`),
    db.from("kv_store").select("key, data").in("key", [OVERRIDES_KEY, CLOSED_KEY]),
  ]);
  if (scansRes.error) return { scannedAt: null, threads: [], closedCount: 0, error: scansRes.error.message };
  if (etcRes.error)   return { scannedAt: null, threads: [], closedCount: 0, error: etcRes.error.message };

  // 맥북·아이맥 스캔을 병합. 같은 세션이 양쪽에 있을 일은 없지만(세션 파일은 머신별),
  // 혹시 겹치면 sessionId 기준으로 더 최근에 만진 쪽을 남긴다.
  const bySession = new Map<string, RawSession>();
  let scannedAt: string | null = null;
  for (const row of scansRes.data ?? []) {
    const scan = row.data as ActivityScan | undefined;
    if (!scan?.sessions?.length) continue;
    if (!scannedAt || scan.scannedAt > scannedAt) scannedAt = scan.scannedAt;
    for (const s of scan.sessions) {
      const prev = bySession.get(s.sessionId);
      if (!prev || s.touchedAt > prev.touchedAt) bySession.set(s.sessionId, s);
    }
  }
  if (bySession.size === 0) {
    return { scannedAt: null, threads: [], closedCount: 0, error: "스캔 기록이 아직 없습니다" };
  }

  const map = new Map((etcRes.data ?? []).map((r) => [r.key as string, r.data]));
  const overrides = (map.get(OVERRIDES_KEY) ?? {}) as Record<string, Domain>;
  const closed    = (map.get(CLOSED_KEY) ?? {}) as ClosedMap;

  const all  = buildThreads([...bySession.values()], overrides);
  // 닫은 뒤로 새 세션이 붙은 줄기는 다시 살린다 — 일이 재개된 것이므로.
  // 기간 밖으로 밀려난 것과 사람이 끝냄 처리한 것은 다르다. 섞어 세면
  // 화면의 "끝냄" 숫자가 실제 누른 횟수와 무관해진다.
  const recent = all.filter((t) => t.staleDays <= WINDOW_DAYS);
  const open   = recent.filter((t) => !(closed[t.id] && closed[t.id] >= t.lastTouchedAt));

  return {
    scannedAt,
    threads:     open,
    closedCount: recent.length - open.length,
  };
}
