/**
 * 신상 출시 런북 — 입고가 확정되는 순간 할 일이 하나씩 열린다.
 *
 * 왜 만들었나: 신상 출시 때마다 상품등록·상세·썸네일·쿠폰·SKU매핑·문자·티저를 매번 기억으로
 * 챙겼다. 하나라도 빠지면(특히 SKU 매핑) 재고가 틀어지거나 캠페인이 통째로 늦어진다.
 * 설월·옥타곤·마고가 줄줄이 대기 중이라 이번에 틀을 만들어 둔다.
 *
 * 구조
 *   템플릿(STEPS) → 런북 인스턴스(상품 하나) → 단계가 열릴 때 `/today` 보드에 할 일로 꽂힘
 *
 * 단계 phase
 *   before    : 입고 전에 끝내야 하는 것(상품등록·상세·쿠폰·SKU매핑). 런북 생성 시 즉시 열림
 *   onArrival : 입고 확정 순간 열림 (파쇼 입고 확인카드 승인이 트리거)
 *   after     : 발송 이후 (D+2 리마인드, D+14 성과정리) — offsetDays 만큼 뒤 날짜로 꽂힘
 *
 * ⚠️ 할 일은 `/today` 의 `today:tasks` 에 그대로 넣는다. 새 화면을 만들지 않는 게 핵심 —
 *    사장님이 아침에 보는 보드 하나에 다 모여야 실제로 굴러간다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getTasks, putTasks } from "@/lib/today/tasks";
import type { Task, Domain } from "@/lib/today/types";

const K = "product_launch_runbooks:v1";

export type Phase = "before" | "onArrival" | "after";

export interface StepTemplate {
  key: string;
  title: string;
  phase: Phase;
  /** after 단계에서 입고일 기준 며칠 뒤에 띄울지 */
  offsetDays?: number;
  /** 왜 하는지 — 보드에서 이유가 보여야 안 밀린다 */
  why?: string;
}

/** 신상 출시 표준 절차. 순서가 곧 의존관계다(상품등록 없이는 쿠폰도 광고도 못 만든다). */
export const STEPS: StepTemplate[] = [
  { key: "product",   phase: "before", title: "카페24 상품 등록(옵션·SKU·재고추적 ON)", why: "이게 없으면 이후 전부 막힘" },
  { key: "detail",    phase: "before", title: "상세페이지 제작(pvDetailBuilder)" },
  { key: "thumb",     phase: "before", title: "대표이미지·썸네일 등록", why: "API로 안 되는 항목 — 관리자에서 수동" },
  { key: "price",     phase: "before", title: "판매가·할인가 설정", why: "공홈이 최저가여야 채널 가격가드에 안 걸림" },
  { key: "coupon",    phase: "before", title: "캠페인 전용 쿠폰 생성", why: "구매 귀속의 정본" },
  { key: "skumap",    phase: "before", title: "채널 SKU 매핑(channel_pricing:skumap)", why: "빠지면 재고가 엉뚱한 SKU에서 차감됨" },
  { key: "creative",  phase: "before", title: "광고 소재 준비(실촬영 착용컷)", why: "AI 생성 금지 — 실물에서 가져온다" },

  { key: "stock",     phase: "onArrival", title: "입고 수량 재고 반영 확인", why: "텔레그램 입고증 승인으로 자동 반영됨 — 숫자만 검증" },
  { key: "open",      phase: "onArrival", title: "상품 진열·판매 ON" },
  { key: "campaign",  phase: "onArrival", title: "CRM 캠페인 생성 + 1인 1코드 발급", why: "/api/crm/campaigns" },
  { key: "sms",       phase: "onArrival", title: "문자 발송((광고) 표기·수신거부·수신동의 받기)", why: "자사몰 직접구매 6개월 이내만" },
  { key: "meta",      phase: "onArrival", title: "메타 광고세트 생성(신상 소재)" },
  { key: "insta",     phase: "onArrival", title: "인스타 티저·출시 포스트" },
  { key: "restock",   phase: "onArrival", title: "재입고 알림 신청자 개별 연락", why: "가장 확실한 구매 후보" },

  { key: "remind",    phase: "after", offsetDays: 2,  title: "장바구니 담고 이탈한 사람 리마인드", why: "퍼널에서 carted−purchased" },
  { key: "review",    phase: "after", offsetDays: 10, title: "첫 구매자 리뷰 요청 확인(알림톡 자동)" },
  { key: "report",    phase: "after", offsetDays: 14, title: "캠페인 성과 정리 → 다음 출시에 반영", why: "발송 1건당 매출·클릭률·CVR" },
];

export interface RunbookStep {
  key: string;
  title: string;
  phase: Phase;
  done: boolean;
  doneAt?: string | null;
  taskId?: string | null;
  openedAt?: string | null;
}

export interface Runbook {
  id: string;
  product: string;
  domain: Domain;
  /** 파쇼 발주번호 — 입고 확인이 이 번호로 오면 자동으로 onArrival 이 열린다 */
  pashoOrderNo?: string | null;
  productNo?: number | null;
  arrivedAt?: string | null;
  createdAt: string;
  steps: RunbookStep[];
}

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listRunbooks(): Promise<Runbook[]> {
  const sb = db(); if (!sb) return [];
  const { data } = await sb.from("kv_store").select("data").eq("key", K).maybeSingle();
  return (data?.data as Runbook[]) ?? [];
}

async function saveAll(list: Runbook[]): Promise<void> {
  const sb = db(); if (!sb) throw new Error("KV 미설정");
  await sb.from("kv_store").upsert({ key: K, data: list, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

function kstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

/** 단계를 /today 보드에 할 일로 꽂는다. 이미 꽂혔으면 아무것도 안 한다. */
async function pushTask(rb: Runbook, step: RunbookStep, date: string): Promise<string> {
  const { tasks } = await getTasks();
  const title = `[${rb.product} 출시] ${step.title}`;
  const exist = tasks.find((t) => t.title === title && !t.done);
  if (exist) return exist.id;
  const task: Task = {
    id: `lb_${rb.id}_${step.key}`,
    title, domain: rb.domain, done: false, date,
  };
  await putTasks([...tasks, task]);
  return task.id;
}

export async function createRunbook(input: {
  product: string; domain?: Domain; pashoOrderNo?: string; productNo?: number;
}): Promise<Runbook> {
  const rb: Runbook = {
    id: `lb_${Date.now().toString(36)}`,
    product: input.product,
    domain: input.domain ?? "paulvice",
    pashoOrderNo: input.pashoOrderNo ?? null,
    productNo: input.productNo ?? null,
    arrivedAt: null,
    createdAt: new Date().toISOString(),
    steps: STEPS.map((s) => ({ key: s.key, title: s.title, phase: s.phase, done: false })),
  };
  // before 단계는 지금 바로 연다 — 입고 전에 끝내야 하는 것들이라 미루면 출시가 밀린다.
  for (const s of rb.steps.filter((x) => x.phase === "before")) {
    s.taskId = await pushTask(rb, s, kstDate());
    s.openedAt = new Date().toISOString();
  }
  await saveAll([rb, ...(await listRunbooks())]);
  return rb;
}

/**
 * 입고 확정 — onArrival 단계를 열고, after 단계는 날짜를 잡아 예약한다.
 * 파쇼 입고 확인카드 승인에서 발주번호로 호출된다.
 */
export async function markArrived(idOrOrderNo: string): Promise<Runbook | null> {
  const list = await listRunbooks();
  const rb = list.find((r) => r.id === idOrOrderNo || r.pashoOrderNo === idOrOrderNo);
  if (!rb || rb.arrivedAt) return rb ?? null;
  rb.arrivedAt = new Date().toISOString();
  for (const s of rb.steps) {
    if (s.done || s.openedAt) continue;
    const tpl = STEPS.find((t) => t.key === s.key);
    if (s.phase === "onArrival") {
      s.taskId = await pushTask(rb, s, kstDate());
      s.openedAt = rb.arrivedAt;
    } else if (s.phase === "after") {
      s.taskId = await pushTask(rb, s, kstDate(tpl?.offsetDays ?? 7));
      s.openedAt = rb.arrivedAt;
    }
  }
  await saveAll(list);
  return rb;
}

export async function completeStep(runbookId: string, key: string): Promise<Runbook | null> {
  const list = await listRunbooks();
  const rb = list.find((r) => r.id === runbookId);
  if (!rb) return null;
  const s = rb.steps.find((x) => x.key === key);
  if (!s || s.done) return rb;
  s.done = true; s.doneAt = new Date().toISOString();
  const { tasks } = await getTasks();
  const i = tasks.findIndex((t) => t.id === s.taskId);
  if (i >= 0) { tasks[i].done = true; await putTasks(tasks); }
  await saveAll(list);
  return rb;
}

export function progressOf(rb: Runbook): { done: number; total: number; pct: number; nextUp: string[] } {
  const opened = rb.steps.filter((s) => s.openedAt);
  const done = opened.filter((s) => s.done).length;
  const nextUp = opened.filter((s) => !s.done).slice(0, 3).map((s) => s.title);
  return { done, total: opened.length, pct: opened.length ? Math.round((done / opened.length) * 100) : 0, nextUp };
}
