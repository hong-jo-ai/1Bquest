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
import { listRecommendations } from "@/lib/mads/dbStore";
import { countThreadsByStatus } from "@/lib/cs/store";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getDashboardData } from "@/lib/cafe24Data";
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
const kstHourNow = () => new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();

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
  const directive = `[능동 발화 상황] 지금은 대표님이 묻지 않았는데 네가 먼저 말 거는 순간이다.
아래 트리거를 근거로, 대표님께 **짧게(2~3문장)** 상황 + (알면)원인 + 다음 행동 제안을 말해라.
- 인사말·서론 없이 바로 핵심부터.
- 차트/위젯 얘기는 하지 말고 말로만.
- 운영 헌법·말투 그대로(정중한 프로, 대표님, 존댓말).

트리거:
${triggers}`;

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
  const newState: PulseState = {
    ...state,
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
