/**
 * 아르바이트 출퇴근·급여 관리 (박자영).
 *
 * - 근무일(월·화·목·금, 공휴일 제외)마다 텔레그램으로 "근무했나요? y/n" 질문(크론 /api/alba/ask).
 * - 사장님이 y/n 답장 → webhook이 resolveAlbaAttendance로 그날 근무여부 기록.
 * - 월말/명령으로 급여명세서 생성(buildPayslip).
 *
 * 저장: Supabase kv_store (records=일자별 근무, pending=답변대기 일자).
 * 시각은 전부 KST 기준(서버 UTC라 +9h 보정).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const ALBA = {
  name: "박자영",
  wage: 10320,                 // 최저시급(원)
  workdays: [1, 2, 3, 4, 5],   // 월(1)·화(2)·수(3)·목(4)·금(5)  (0=일 … 6=토)  ※2026-06-17 수요일 추가
  hoursPerDay: 2,              // 1일 2시간
  time: "13:00~15:00",
  car: "4330",                 // 출근차량 번호(끝4자리) — 출근확인 시 주차할인 자동등록
};

// 2026 대한민국 공휴일(주말 제외 법정공휴일+대체공휴일). 알바는 공휴일 근무 안 함.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02",
  "2026-05-05", "2026-05-24", "2026-05-25", "2026-06-06", "2026-08-15", "2026-08-17",
  "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25",
]);

const PENDING_KEY = "alba_attendance_pending";
const RECORDS_KEY = "alba_attendance_records";
const WDK = ["일", "월", "화", "수", "목", "금", "토"];

export interface DayRecord { worked: boolean; confirmed: boolean; hours: number; at?: string; note?: string; }
type Records = Record<string, DayRecord>;

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── KST 시각 ─────────────────────────────────────────────
export function kstNow(): Date { return new Date(Date.now() + 9 * 3600 * 1000); }
const pad = (n: number) => String(n).padStart(2, "0");
export function kstDateStr(d = kstNow()): string { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function weekdayOf(dateStr: string): number { return new Date(`${dateStr}T12:00:00Z`).getUTCDay(); }
function mmddKor(dateStr: string): string { const [, m, d] = dateStr.split("-"); return `${Number(m)}/${Number(d)}(${WDK[weekdayOf(dateStr)]})`; }

export function isWorkday(dateStr: string): boolean {
  return ALBA.workdays.includes(weekdayOf(dateStr)) && !HOLIDAYS.has(dateStr);
}

/** 2026 대한민국 법정공휴일(+대체공휴일) 여부. dateStr = "YYYY-MM-DD". */
export function isKoreanPublicHoliday(dateStr: string): boolean {
  return HOLIDAYS.has(dateStr);
}

// ── kv 입출력 ────────────────────────────────────────────
async function readKv<T>(key: string, fallback: T): Promise<T> {
  const c = db(); if (!c) return fallback;
  const { data } = await c.from("kv_store").select("data").eq("key", key).maybeSingle();
  return (data?.data ?? fallback) as T;
}
async function writeKv(key: string, data: unknown): Promise<void> {
  const c = db(); if (!c) return;
  await c.from("kv_store").upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
// kv_store.data 는 NOT NULL — null 업서트는 조용히 실패하므로 해제는 행 삭제로 한다
async function deleteKv(key: string): Promise<void> {
  const c = db(); if (!c) return;
  await c.from("kv_store").delete().eq("key", key);
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

function parseYN(text: string): boolean | null {
  const s = text.trim().toLowerCase();
  if (/^(y|yes|o|ㅇ|네|예|응|근무|출근|함|왔어|왔음|일함)$/.test(s)) return true;
  if (/^(n|no|x|ㄴ|아니|아뇨|안함|안왔|안왔어|결근|쉼|휴무)$/.test(s)) return false;
  return null;
}

// ── 월별 집계 ────────────────────────────────────────────
function summarize(records: Records, ym: string) {
  const dates = Object.keys(records).filter((d) => d.startsWith(ym) && records[d].worked).sort();
  const days = dates.length;
  // 연장근무 등 일자별 hours가 기본과 다를 수 있으므로 기록된 hours를 합산
  const hours = dates.reduce((s, d) => s + (records[d].hours ?? ALBA.hoursPerDay), 0);
  const pay = Math.round(hours * ALBA.wage);
  return { dates, days, hours, pay };
}

// ── 답변 대기열 ──────────────────────────────────────────
// 단일 {date} 였다가 대기열로 바꿨다. 리마인드(아침)와 당일 질문(13시)이 겹칠 때
// 뒤엣것이 앞엣것을 덮어써서 **답이 엉뚱한 날짜에 기록되던** 위험을 없앤다.
// 답변은 항상 **가장 오래된 것부터** 처리하고, 어느 날짜에 기록했는지 회신에 명시한다.
interface PendingItem { date: string; askedAt: string }

async function readPendingQueue(): Promise<PendingItem[]> {
  const raw = await readKv<unknown>(PENDING_KEY, null);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as PendingItem[];
  // 구 형식 {date, askedAt} 후방호환
  const one = raw as { date?: string; askedAt?: string };
  return one?.date ? [{ date: one.date, askedAt: one.askedAt ?? new Date().toISOString() }] : [];
}

async function enqueuePending(date: string): Promise<PendingItem[]> {
  const q = await readPendingQueue();
  if (!q.some((p) => p.date === date)) q.push({ date, askedAt: new Date().toISOString() });
  q.sort((a, b) => a.date.localeCompare(b.date));
  await writeKv(PENDING_KEY, q);
  return q;
}

// ── 질문(크론) ───────────────────────────────────────────
export async function askAttendance(): Promise<{ asked: boolean; reason?: string; date?: string }> {
  const date = kstDateStr();
  if (!isWorkday(date)) return { asked: false, reason: "근무일 아님(주말/공휴일)" };
  // 기본 근무로 선기록(미확정) — 답이 없으면 근무로 간주, n이면 정정
  const records = await readKv<Records>(RECORDS_KEY, {});
  if (!records[date]) { records[date] = { worked: true, confirmed: false, hours: ALBA.hoursPerDay }; await writeKv(RECORDS_KEY, records); }
  const q = await enqueuePending(date);
  const backlog = q.length > 1 ? `\n\n⏳ 아직 확인 안 된 날: ${q.filter((p) => p.date !== date).map((p) => mmddKor(p.date)).join(", ")}\n(오래된 날부터 하나씩 처리됩니다)` : "";
  await sendTelegram(`📋 ${ALBA.name}님 오늘(${mmddKor(date)}) 출근했나요?\n\ny = 출근 / n = 결근\n(${ALBA.time}, ${ALBA.hoursPerDay}시간 근무)${backlog}`);
  return { asked: true, date };
}

// ── 무응답 리마인드(크론) ────────────────────────────────
// 답을 안 하면 근무로 기록되는 구조라, 미확인이 쌓이면 급여가 과다 계상된다.
// (실제로 2026-07~08 에 5일이 무응답으로 근무 처리돼 있었다.)
// 지난 근무일 중 미확인이 있으면 **가장 오래된 것 하나**를 다시 묻는다.
export async function remindUnconfirmed(): Promise<{ sent: boolean; date?: string; remaining?: number }> {
  const today = kstDateStr();
  const records = await readKv<Records>(RECORDS_KEY, {});
  const stale = Object.keys(records)
    .filter((d) => d < today && records[d]?.confirmed === false)
    .sort();
  if (stale.length === 0) return { sent: false };

  const date = stale[0];
  await enqueuePending(date);
  const more = stale.length > 1 ? `\n(미확인 ${stale.length}일 중 가장 오래된 날입니다. 답하시면 다음 날짜를 이어서 여쭙겠습니다.)` : "";
  await sendTelegram(
    `⏳ ${ALBA.name}님 ${mmddKor(date)} 출근 여부가 아직 확인되지 않았습니다.\n\n` +
    `y = 출근 / n = 결근\n` +
    `⚠️ 답이 없으면 <b>근무</b>로 기록됩니다 (일 ₩${(ALBA.hoursPerDay * ALBA.wage).toLocaleString()}).${more}`.replace(/<\/?b>/g, ""),
  );
  return { sent: true, date, remaining: stale.length };
}

// ── 응답 처리(webhook) ───────────────────────────────────
export async function resolveAlbaAttendance(text: string): Promise<{ message: string } | null> {
  const queue = await readPendingQueue();
  if (queue.length === 0) return null;
  const yn = parseYN(text);
  if (yn === null) return null;

  const target = queue[0].date;            // 항상 가장 오래된 것부터
  const rest = queue.slice(1);
  const records = await readKv<Records>(RECORDS_KEY, {});
  // 이미 별도 hours(연장근무 등)가 기록돼 있으면 y 확인이 덮어쓰지 않도록 보존
  const prev = records[target];
  records[target] = { ...prev, worked: yn, confirmed: true, hours: yn ? (prev?.hours ?? ALBA.hoursPerDay) : 0, at: new Date().toISOString() };
  await writeKv(RECORDS_KEY, records);
  if (rest.length) await writeKv(PENDING_KEY, rest); else await deleteKv(PENDING_KEY);

  const hours = records[target].hours;
  const { days, pay } = summarize(records, target.slice(0, 7));
  const head = yn ? `✅ ${mmddKor(target)} 근무 확인 (${hours}시간)` : `🚫 ${mmddKor(target)} 미근무 처리`;
  // 어느 날짜에 기록했는지 반드시 밝힌다 — 밀린 답변이 엉뚱한 날에 붙는 것을 사람이 알아챌 수 있게
  const next = rest.length ? `\n\n➡️ 다음으로 ${mmddKor(rest[0].date)} 출근하셨나요? (y/n)` : "";
  return { message: `${head}\n이번 달 누적: ${days}일 · ₩${pay.toLocaleString()}${next}` };
}

// ── 오늘 근무 여부(주차 자동등록용) ──────────────────────
// 오늘이 근무일이고, 출근으로 기록(기본 근무 또는 Y 확인)이면 true. N(결근)이면 false.
export async function workedToday(): Promise<boolean> {
  const date = kstDateStr();
  if (!isWorkday(date)) return false;
  const records = await readKv<Records>(RECORDS_KEY, {});
  return records[date]?.worked === true;
}

// ── 급여명세서 ──────────────────────────────────────────
export async function buildPayslip(ym?: string): Promise<string> {
  // ym 미지정 시: KST 기준 직전 달
  if (!ym) { const n = kstNow(); const m = n.getUTCMonth(); const y = n.getUTCFullYear(); const pm = m === 0 ? 12 : m; const py = m === 0 ? y - 1 : y; ym = `${py}-${pad(pm)}`; }
  const records = await readKv<Records>(RECORDS_KEY, {});
  const { dates, days, hours, pay } = summarize(records, ym);
  const [y, m] = ym.split("-");
  // 기본 근무시간과 다른 날(연장근무 등)은 시간을 함께 표기
  const list = dates.map((d) => {
    const h = records[d].hours ?? ALBA.hoursPerDay;
    return h === ALBA.hoursPerDay ? mmddKor(d) : `${mmddKor(d)}[${h}h]`;
  }).join("  ") || "(근무 없음)";
  return [
    `📄 ${ALBA.name}님 급여명세서`,
    `${Number(y)}년 ${Number(m)}월`,
    `──────────────`,
    `근무일수: ${days}일`,
    `근무시간: ${hours}시간 (일 ${ALBA.hoursPerDay}h)`,
    `시급: ₩${ALBA.wage.toLocaleString()}`,
    `──────────────`,
    `💰 지급 총액: ₩${pay.toLocaleString()}`,
    `(일용 일급 ₩${(ALBA.hoursPerDay * ALBA.wage).toLocaleString()} → 소액 비과세, 실지급=총액)`,
    `──────────────`,
    `근무일: ${list}`,
  ].join("\n");
}

export async function sendPayslip(ym?: string): Promise<string> {
  const text = await buildPayslip(ym);
  await sendTelegram(text);
  return text;
}
