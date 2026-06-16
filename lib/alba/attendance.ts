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
  workdays: [1, 2, 4, 5],      // 월(1)·화(2)·목(4)·금(5)  (0=일 … 6=토)
  hoursPerDay: 2,              // 1일 2시간
  time: "13:00~15:00",
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

export interface DayRecord { worked: boolean; confirmed: boolean; hours: number; at?: string; }
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
  const hours = days * ALBA.hoursPerDay;
  const pay = hours * ALBA.wage;
  return { dates, days, hours, pay };
}

// ── 질문(크론) ───────────────────────────────────────────
export async function askAttendance(): Promise<{ asked: boolean; reason?: string; date?: string }> {
  const date = kstDateStr();
  if (!isWorkday(date)) return { asked: false, reason: "근무일 아님(주말/공휴일)" };
  // 기본 근무로 선기록(미확정) — 답이 없으면 근무로 간주, n이면 정정
  const records = await readKv<Records>(RECORDS_KEY, {});
  if (!records[date]) { records[date] = { worked: true, confirmed: false, hours: ALBA.hoursPerDay }; await writeKv(RECORDS_KEY, records); }
  await writeKv(PENDING_KEY, { date, askedAt: new Date().toISOString() });
  await sendTelegram(`📋 ${ALBA.name}님 오늘(${mmddKor(date)}) 근무했나요?\n\ny = 근무함 / n = 안 함\n(기본 ${ALBA.time}, ${ALBA.hoursPerDay}시간)`);
  return { asked: true, date };
}

// ── 응답 처리(webhook) ───────────────────────────────────
export async function resolveAlbaAttendance(text: string): Promise<{ message: string } | null> {
  const pending = await readKv<{ date?: string } | null>(PENDING_KEY, null);
  if (!pending?.date) return null;
  const yn = parseYN(text);
  if (yn === null) return null;
  const records = await readKv<Records>(RECORDS_KEY, {});
  records[pending.date] = { worked: yn, confirmed: true, hours: yn ? ALBA.hoursPerDay : 0, at: new Date().toISOString() };
  await writeKv(RECORDS_KEY, records);
  await writeKv(PENDING_KEY, null);
  const { days, pay } = summarize(records, pending.date.slice(0, 7));
  const head = yn ? `✅ ${mmddKor(pending.date)} 근무 확인 (${ALBA.hoursPerDay}시간)` : `🚫 ${mmddKor(pending.date)} 미근무 처리`;
  return { message: `${head}\n이번 달 누적: ${days}일 · ₩${pay.toLocaleString()}` };
}

// ── 급여명세서 ──────────────────────────────────────────
export async function buildPayslip(ym?: string): Promise<string> {
  // ym 미지정 시: KST 기준 직전 달
  if (!ym) { const n = kstNow(); const m = n.getUTCMonth(); const y = n.getUTCFullYear(); const pm = m === 0 ? 12 : m; const py = m === 0 ? y - 1 : y; ym = `${py}-${pad(pm)}`; }
  const records = await readKv<Records>(RECORDS_KEY, {});
  const { dates, days, hours, pay } = summarize(records, ym);
  const [y, m] = ym.split("-");
  const list = dates.map(mmddKor).join("  ") || "(근무 없음)";
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
