/**
 * 모리 능동 발화(proactive utterance) 워커 — "모리가 먼저 말 거는" 엔진.
 *
 * 흐름:
 *  1) detectSignals: 현재 state를 임계값과 대조해 신호 추출(저렴 — Supabase 조회만).
 *  2) 게이트: 모드(isSpeakableInMode) + 쿨다운(2h) 통과한 신호만 남김.
 *  3) 통과 신호가 있을 때만 Anthropic으로 멘트 1건 생성(헌법·말투 적용).
 *  4) mori:proactive_queue에 적재 + mori:pulse_state(쿨다운/lastSeenUnanswered) 갱신.
 *
 * 임계값은 lib/mori/utteranceThresholds.ts(SSOT)에서 가져온다.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { buildSystemPrompt, currentMode, type MoriMode as PromptMode } from "@/lib/mori/systemPrompt";
import {
  UTTERANCE_THRESHOLDS as T,
  isSpeakableInMode,
  type MoriMode,
  type UtteranceSignalType,
} from "@/lib/mori/utteranceThresholds";
import { assembleDashboardContext } from "@/lib/mori/context";
import { loadTodayTasks, kstDateStr } from "@/lib/mori/tasks";
import { listRecommendations } from "@/lib/mads/dbStore";
import { countThreadsByStatus } from "@/lib/cs/store";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getDashboardData } from "@/lib/cafe24Data";
import { listPurchaseOrders, restockEta } from "@/lib/purchaseOrders";
import type { ActionType } from "@/lib/mads/types";

const MODEL = process.env.MORI_MODEL ?? "claude-sonnet-4-6";
const QUEUE_KEY = "mori:proactive_queue";
const STATE_KEY = "mori:pulse_state";
const MIN_PULSE_GAP_MS = 45_000; // 과빈도 방지(여러 탭/연속 폴링)

export interface ProactiveUtterance {
  id: string;
  text: string;
  ts: string;
  urgent: boolean;
}

interface Signal {
  type: UtteranceSignalType;
  /** 쿨다운/중복 판정 키 */
  key: string;
  /** 멘트 생성기에 줄 사실 요약 */
  summary: string;
  adsActionType?: ActionType;
}

interface PulseState {
  cooldowns: Record<string, string>; // key -> ISO
  lastSeenUnanswered: number;
  lastPulseAt: string | null;
}

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const d = db();
  if (!d) return fallback;
  try {
    const { data } = await d.from("kv_store").select("data").eq("key", key).maybeSingle();
    return (data?.data as T) ?? fallback;
  } catch {
    return fallback;
  }
}

async function kvSet(key: string, data: unknown): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    await d.from("kv_store").upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {
    /* noop */
  }
}

const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR");
const kstNow = () => new Date(Date.now() + 9 * 60 * 60 * 1000);
const kstHourNow = () => kstNow().getUTCHours();
const isWeekdayKst = () => {
  const d = kstNow().getUTCDay();
  return d >= 1 && d <= 5;
};

/** 현재 state → 신호 후보. 임계값 미달/정상이면 비움. */
async function detectSignals(state: PulseState): Promise<{ signals: Signal[]; nextUnanswered: number }> {
  const signals: Signal[] = [];
  let nextUnanswered = state.lastSeenUnanswered;

  // ── 광고: MADS 신규(actionable) 추천 ──
  try {
    const recs = await listRecommendations("pending", 50);
    for (const r of recs) {
      if (!T.ads.actionableTypes.includes(r.actionType)) continue; // 'hold' 등 제외
      const roas = r.trust?.roas7d;
      const cur = r.currentBudget != null ? won(r.currentBudget) : "?";
      const rec = r.recommendedBudget != null ? won(r.recommendedBudget) : "?";
      signals.push({
        type: "ads",
        key: `ads:rec:${r.id}`, // 추천 1건당 1회만
        adsActionType: r.actionType,
        summary:
          `광고 [${r.actionType}] "${r.adset?.name ?? "광고세트"}" — ` +
          `${typeof roas === "number" ? `ROAS ${roas.toFixed(2)}, ` : ""}일예산 ${cur}→${rec}. ${r.reason}`,
      });
    }
  } catch {
    /* degrade */
  }

  // ── 매출: 사무시간 N시간(=3) 무주문 ──
  try {
    const hour = kstHourNow();
    const officeStart = 8;
    if (hour >= officeStart + T.sales.noSaleHours && hour < 19) {
      const token = await getValidC24Token();
      if (token) {
        const d = await getDashboardData(token, "paulvice");
        if (d.salesSummary.today.orders === 0) {
          signals.push({
            type: "sales",
            key: "sales:noorder:today",
            summary: `오늘 영업 시작 후 ${hour - officeStart}시간째 주문 0건(매출 0원).`,
          });
        }
      }
    }
  } catch {
    /* degrade */
  }

  // ── CS: 새 미답변(직전보다 증가 + min 이상) ──
  try {
    const c = await countThreadsByStatus({ brand: "all" });
    nextUnanswered = c.unanswered;
    if (c.unanswered >= T.cs.minUnanswered && c.unanswered > state.lastSeenUnanswered) {
      signals.push({
        type: "cs",
        key: "cs:unanswered",
        summary: `새 CS 미답변 발생 — 현재 미답변 ${c.unanswered}건(직전 ${state.lastSeenUnanswered}건), 대기 ${c.waiting}건.`,
      });
    }
  } catch {
    /* degrade */
  }

  // ── 코칭형(먼저 밀어주는) — 사무시간(평일 08-19) 한정 ──
  const hour = kstHourNow();
  const inOffice = isWeekdayKst() && hour >= 8 && hour < 19;
  if (inOffice) {
    const today = kstDateStr();

    // 발주 입고 예정(오늘이 ETA 구간 안) — 아침 브리핑/리마인드에 공유.
    let duePos: Awaited<ReturnType<typeof listPurchaseOrders>> = [];
    try {
      duePos = (await listPurchaseOrders()).filter((p) => {
        if (p.status !== "ordered") return false;
        const { start, end } = restockEta(p);
        return today >= start && today <= end;
      });
    } catch {
      /* degrade */
    }

    // ① 아침 브리핑: 평일 오전, 하루 1회. (date 키 → 한 번 발화하면 그날은 재발화 안 함)
    const briefKey = `brief:morning:${today}`;
    if (hour >= T.coaching.morningBriefFromHour && hour < 12 && !state.cooldowns[briefKey]) {
      let taskLine = "오늘 할일은 아직 안 적혀 있어요";
      try {
        const { pending, total } = await loadTodayTasks();
        if (total > 0) {
          taskLine =
            `오늘 할일 ${total}개(미완료 ${pending.length})` +
            (pending.length ? `: ${pending.slice(0, 5).map((t) => t.title).join(", ")}` : " — 전부 끝남");
        }
      } catch {
        /* degrade */
      }
      const poLine = duePos.length
        ? ` / 오늘 입고예정 발주: ${duePos.map((p) => `${p.productName} ${p.qty}개`).join(", ")}`
        : "";
      signals.push({ type: "morning_brief", key: briefKey, summary: `${taskLine}${poLine}` });
    }

    // ② 할일 채찍질: 오후, 미완료 할일 남아 있으면 하루 1회.
    const tasksKey = `tasks:nudge:${today}`;
    if (hour >= T.coaching.tasksNudgeFromHour && !state.cooldowns[tasksKey]) {
      try {
        const { pending, total } = await loadTodayTasks();
        if (pending.length > 0) {
          signals.push({
            type: "tasks",
            key: tasksKey,
            summary:
              `오후인데 오늘 할일 ${total}개 중 ${pending.length}개 아직 남음: ` +
              `${pending.slice(0, 5).map((t) => t.title).join(", ")}`,
          });
        }
      } catch {
        /* degrade */
      }
    }

    // ③ 발주 입고일 리마인드: ETA 구간에 오늘이 들어온 발주, 발주 1건당 하루 1회.
    if (T.coaching.poEtaReminder) {
      for (const p of duePos) {
        const key = `po:eta:${p.id}:${today}`;
        if (state.cooldowns[key]) continue;
        const { start, end } = restockEta(p);
        signals.push({
          type: "po_eta",
          key,
          summary: `발주 입고 예정일 — "${p.productName}" ${p.qty}개 (${p.supplier || "공급사?"}) 입고예정 ${start}~${end}. 입고/입금 확인.`,
        });
      }
    }
  }

  return { signals, nextUnanswered };
}

/** 모드 + 쿨다운 게이트. */
function gate(signals: Signal[], mode: MoriMode, state: PulseState): Signal[] {
  const now = Date.now();
  const cd = T.cooldownMinutes * 60 * 1000;
  return signals.filter((s) => {
    if (!isSpeakableInMode({ type: s.type, adsActionType: s.adsActionType }, mode)) return false;
    const last = state.cooldowns[s.key];
    if (last && now - new Date(last).getTime() < cd) return false;
    return true;
  });
}

/** 통과 신호로 능동 발화 멘트 1건 생성(헌법·말투 적용). */
async function generateUtterance(fired: Signal[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  const client = new Anthropic({ apiKey });
  const dashboardContext = await assembleDashboardContext().catch(() => "");

  const triggers = fired.map((s, i) => `${i + 1}. ${s.summary}`).join("\n");
  const hasBrief = fired.some((s) => s.type === "morning_brief");
  const coachingOnly = fired.every((s) => s.type === "morning_brief" || s.type === "tasks" || s.type === "po_eta");

  let directive: string;
  if (hasBrief) {
    directive = `[아침 브리핑] 하루를 여는 첫 인사다. 대표님이 오늘 더 잘 굴러가도록 네가 먼저 운전대를 잡아라.
아래 사실을 근거로:
- 짧은 인사 한마디로 시작(과하지 않게, "좋은 아침이에요 대표님" 정도).
- 오늘 챙길 상황을 한두 가지만 짚고,
- "오늘은 이것부터 하시죠" 하고 우선순위 한두 개를 콕 집어 제안하고,
- 가볍게 밀어붙이는 한마디로 마무리.
4~5문장 이내. 차트/위젯 얘기 말고 말로만. 운영 헌법·말투 그대로(정중한 프로, 대표님, 존댓말).

근거:
${triggers}`;
  } else if (coachingOnly) {
    directive = `[능동 코칭] 대표님이 묻지 않았지만, 오늘 더 잘 일하도록 네가 먼저 밀어주는 순간이다.
아래를 근거로 **짧게(2~3문장)** — 지금 챙겨야 할 것을 콕 집고, 잔소리가 아니라 동료의 푸쉬로 가볍게 밀어붙여라.
- 인사말·서론 없이 핵심부터. 차트/위젯 얘기 말고 말로만.
- 운영 헌법·말투 그대로(정중한 프로, 대표님, 존댓말).

근거:
${triggers}`;
  } else {
    directive = `[능동 발화 상황] 지금은 대표님이 묻지 않았는데 네가 먼저 말 거는 순간이다.
아래 트리거를 근거로, 대표님께 **짧게(2~3문장)** 상황 + (알면)원인 + 다음 행동 제안을 말해라.
- 인사말·서론 없이 바로 핵심부터.
- 차트/위젯 얘기는 하지 말고 말로만.
- 운영 헌법·말투 그대로(정중한 프로, 대표님, 존댓말).

트리거:
${triggers}`;
  }

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: [
      { type: "text", text: buildSystemPrompt() },
      { type: "text", text: dashboardContext },
    ],
    messages: [{ role: "user", content: directive }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * 펄스 1회 실행. 새로 생성된 능동 발화가 있으면 큐에 적재하고 반환.
 * (호출 측이 큐를 비우므로, 반환값은 "이번에 새로 생긴 것"이다.)
 */
export async function runPulse(): Promise<ProactiveUtterance[]> {
  const state = await kvGet<PulseState>(STATE_KEY, {
    cooldowns: {},
    lastSeenUnanswered: 0,
    lastPulseAt: null,
  });

  // 과빈도 방지
  if (state.lastPulseAt && Date.now() - new Date(state.lastPulseAt).getTime() < MIN_PULSE_GAP_MS) {
    return [];
  }

  const pm: PromptMode = currentMode();
  const mode: MoriMode = pm.mode;

  const { signals, nextUnanswered } = await detectSignals(state);
  const fired = gate(signals, mode, state);

  // state 갱신(lastSeenUnanswered/lastPulseAt는 발화 여부와 무관하게 항상 갱신)
  // 48h 지난 쿨다운 키는 정리(날짜 키가 무한정 쌓이는 것 방지).
  const pruneBefore = Date.now() - 48 * 60 * 60 * 1000;
  const cooldowns: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.cooldowns)) {
    if (new Date(v).getTime() >= pruneBefore) cooldowns[k] = v;
  }
  const newState: PulseState = {
    ...state,
    cooldowns,
    lastSeenUnanswered: nextUnanswered,
    lastPulseAt: new Date().toISOString(),
  };

  if (fired.length === 0) {
    await kvSet(STATE_KEY, newState);
    return [];
  }

  let text = "";
  try {
    text = await generateUtterance(fired);
  } catch {
    await kvSet(STATE_KEY, newState);
    return [];
  }
  if (!text) {
    await kvSet(STATE_KEY, newState);
    return [];
  }

  const urgent = fired.some((s) => isSpeakableInMode({ type: s.type, adsActionType: s.adsActionType }, "quiet"));
  const utt: ProactiveUtterance = {
    id: `pu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    ts: new Date().toISOString(),
    urgent,
  };

  // 쿨다운 기록
  const nowIso = new Date().toISOString();
  for (const s of fired) newState.cooldowns[s.key] = nowIso;
  await kvSet(STATE_KEY, newState);

  // 큐 적재(최근 20개만)
  const queue = await kvGet<ProactiveUtterance[]>(QUEUE_KEY, []);
  queue.push(utt);
  await kvSet(QUEUE_KEY, queue.slice(-20));

  return [utt];
}

/** 대기 중 능동 발화를 가져오고 큐를 비운다(클라이언트가 표시 후 소비). */
export async function drainQueue(): Promise<ProactiveUtterance[]> {
  const queue = await kvGet<ProactiveUtterance[]>(QUEUE_KEY, []);
  if (queue.length === 0) return [];
  await kvSet(QUEUE_KEY, []);
  return queue;
}
