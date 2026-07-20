/**
 * AI 성장 전략가 — "상황 알려주는 컨설턴트"가 아니라 "같이 일하는 최고의 퍼포먼스 마케터".
 *
 * 룰 기반 growthAdvisor(구조 진단)와 달리, 계정의 실데이터 + 브랜드 플레이북을 컨텍스트로
 * Claude가 소재 기획(컷 구성·카피)·타겟·예산·기간까지 구체적인 실행 플랜을 세운다.
 * (사장님 2026-07-20: "구체적으로 어떤 소재를 올리라고 기획까지, 의지할 수 있는 팀원처럼")
 *
 * 캐시: kv mads_growth_plan (24h) — 페이지 로드는 캐시 반환, 재생성은 force.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { getMarginConfig, resolveThresholds } from "./marginConfig";
import { getActiveSeasonModifier } from "./seasonModifier";

const MODEL = "claude-sonnet-5";
const KV_KEY = "mads_growth_plan";
const CACHE_HOURS = 24;

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export interface GrowthPlan {
  generatedAt: string;
  summary: string;
  plans: Array<{
    priority: number;
    title: string;
    why: string;
    creative: { concept: string; cuts: string[]; headline: string; primaryText: string; format: string } | null;
    execution: string[];
    budget: string;
    expected: string;
    needsFromBoss: string | null;
  }>;
}

/** 브랜드 플레이북 — 전략가가 지켜야 할 제작·운영 원칙 (repo 규칙·검증 결과 요약). */
const BRAND_PLAYBOOK = `
## 폴바이스 (Paul Vice) — paulvice.co.kr
- 타겟: 국내 30~40대 여성. 슬로건 "Understated Style, Bold Personality".
- 사진·영상 = 밝은 자연 컬러 필수, 흑백/다크 금지(시계 안 보임 — 사장님 확정). 골드 액센트 금지.
- 검증된 소재 공식: ①인플루언서 실사 착용컷(최강 — 골드 "착용컷A" ROAS 3.2) ②실사 기반 에디토리얼 리스타일(나노바나나, 시계·손목 원본 유지) ③시계를 AI로 창작하는 것은 절대 금지.
- 소재 소스: 구글드라이브 착용컷 폴더(에끌라·미니엘·오드리·세이렌 등 컬렉션별 실사 보유).
- 주력 상품/캠페인: 에끌라 오벌 골드(마지막수량 완판 캠페인, 완판 시 실버로 전환 예정) · 에끌라 실버+메탈밴드 세트 #263 ₩99,570 · 미니엘 쁘띠 여름세트 #261 ₩129,000(상세·브랜드필름 완성, 판매 전환 대기) · 무료각인+선물포장+당일발송 훅 보유.
- 외부채널 데이터: W컨셉 골드:실버 = 5:5 (실버 수요 건재 — 자사몰 실버 부진은 광고 파이프 부재였음).

## 해리엇 (Harriot) — harriotwatches.co.kr
- B&W 헤리티지, 경건한 무게감, "korean watch" 서사. 국내몰 카페24.
- 기원(KI:WON) 고단가(26~41만) 라인: 전환 드물지만 단가가 광고비 압도(보정 ROAS 4배+).

## 운영 원칙
- ROAS 숫자보다 신뢰등급(전환 표본) 우선. 72시간 변경 락. 예산 배분 70(검증)/20(확장)/10(실험).
- 광고 계정은 하나(해리엇 계정)에서 두 브랜드 모두 운영. 폴바이스 광고는 페이지ID 명시 필요.
- 영상 릴스: 실물 워치 클립 + AI 무드컷 톤통일 편집 파이프라인 보유(미니엘 브랜드필름 v8 완성품 있음).
`;

async function gatherContext(): Promise<string> {
  const db = getDb();
  const since14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const onlyAccount = (process.env.META_AD_ACCOUNT_ID ?? "").replace(/^act_/, "");

  const [adsetsQ, metricsQ, adsQ, adMetricsQ, marginCfg, seasonMod] = await Promise.all([
    db.from("mads_ad_sets").select("*"),
    db.from("mads_daily_metrics").select("*").gte("date", since14),
    db.from("mads_ads").select("*"),
    db.from("mads_ad_daily_metrics").select("*").gte("date", since14),
    getMarginConfig(),
    getActiveSeasonModifier(),
  ]);
  const thresholds = resolveThresholds(marginCfg, seasonMod);

  const adsets = (adsetsQ.data ?? []).filter(
    (s) => !onlyAccount || String(s.meta_account_id).replace(/^act_/, "") === onlyAccount);

  const mByAdset = new Map<string, Array<Record<string, unknown>>>();
  for (const m of metricsQ.data ?? []) {
    (mByAdset.get(m.meta_adset_id) ?? mByAdset.set(m.meta_adset_id, []).get(m.meta_adset_id))!.push(m);
  }
  const adRows = adsQ.data ?? [];
  const amByAd = new Map<string, Array<Record<string, unknown>>>();
  for (const m of adMetricsQ.data ?? []) {
    (amByAd.get(m.meta_ad_id) ?? amByAd.set(m.meta_ad_id, []).get(m.meta_ad_id))!.push(m);
  }

  const lines: string[] = [`손익분기 ROAS: ${thresholds.beRoas} (증액기준 ${thresholds.roasHigh}, 감액기준 ${thresholds.roasLow})`];
  for (const s of adsets) {
    const ms = (mByAdset.get(s.meta_adset_id) ?? []) as Array<{ date: string; spend: number; revenue: number; conversions: number; ctr: number | null; frequency: number | null }>;
    const spend = ms.reduce((a, m) => a + Number(m.spend), 0);
    if (s.status !== "ACTIVE" && spend <= 0) continue; // 휴면 제외
    const rev = ms.reduce((a, m) => a + Number(m.revenue), 0);
    const conv = ms.reduce((a, m) => a + Number(m.conversions), 0);
    lines.push(`\n[광고세트] ${s.name} | ${s.status} | 일예산 ${s.daily_budget ?? "CBO"} | 퍼널 ${s.funnel_stage}`);
    lines.push(`  14일: 지출 ${Math.round(spend).toLocaleString()}원 · 매출 ${Math.round(rev).toLocaleString()}원 · ROAS ${spend > 0 ? (rev / spend).toFixed(2) : "-"} · 전환 ${conv}건`);
    const setAds = adRows.filter((a) => a.meta_adset_id === s.meta_adset_id);
    for (const ad of setAds) {
      const ams = (amByAd.get(ad.meta_ad_id) ?? []) as Array<{ spend: number; revenue: number; ctr: number | null; frequency: number | null }>;
      const aSpend = ams.reduce((x, m) => x + Number(m.spend), 0);
      if (aSpend <= 0 && ad.effective_status !== "ACTIVE") continue;
      const aRev = ams.reduce((x, m) => x + Number(m.revenue), 0);
      const lastFreq = ams.length ? ams[ams.length - 1].frequency : null;
      lines.push(`    [광고] ${ad.name} | ${ad.effective_status} | ${ad.creative_format} | 지출 ${Math.round(aSpend).toLocaleString()} · ROAS ${aSpend > 0 ? (aRev / aSpend).toFixed(2) : "-"} · 빈도 ${lastFreq ?? "-"}`);
    }
  }
  return lines.join("\n");
}

export async function buildGrowthPlan(force = false): Promise<GrowthPlan> {
  const db = getDb();
  if (!force) {
    const { data } = await db.from("kv_store").select("data,updated_at").eq("key", KV_KEY).maybeSingle();
    if (data?.data && data.updated_at &&
        Date.now() - new Date(data.updated_at).getTime() < CACHE_HOURS * 3600000) {
      return data.data as GrowthPlan;
    }
  }

  const context = await gatherContext();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `너는 폴바이스·해리엇(시계 브랜드 2개, 1인 대표 운영)의 전속 퍼포먼스 마케팅 팀장이다.
"상황만 알려주는 컨설턴트"가 아니라, 실행을 책임지는 팀원으로서 이번 주에 실제로 올릴 광고를 기획하라.

${BRAND_PLAYBOOK}

## 현재 계정 실데이터 (최근 14일)
${context}

## 지시
1~3개의 실행 플랜을 우선순위 순으로 제안하라. 각 플랜은 대표가 "그대로 실행해줘"라고 답하면 바로 착수 가능할 만큼 구체적이어야 한다:
- why: 위 실데이터의 구체 숫자를 인용해 "왜 지금 이것"인지. 뻔한 일반론 금지.
- creative: 소재 기획 — 컨셉, 컷 구성(어떤 실사 소스를 어떻게), 헤드라인·본문 카피 실안(한국어, 브랜드 톤), 포맷(이미지/릴스). 브랜드 소재 원칙(실사 우선, 시계 AI창작 금지, 폴바이스=밝은 컬러) 준수.
- execution: 스텝바이스텝 (소재 제작 → 세팅 → 검증 기준까지).
- budget: 구체 금액과 근거. expected: 기대 성과(보수적으로).
- needsFromBoss: 대표 결정/자산이 필요하면 명시, 없으면 null.
말투: 함께 일하는 팀장. "~하시죠", "~합시다". 책임지고 제안하되 리스크는 숨기지 말 것.

JSON만 출력:
{"summary":"현 계정 상태 총평과 이번 주 방향 2~3문장","plans":[{"priority":1,"title":"","why":"","creative":{"concept":"","cuts":["컷1 설명","컷2 설명"],"headline":"","primaryText":"","format":"이미지|릴스"},"execution":["스텝1","스텝2"],"budget":"","expected":"","needsFromBoss":null}]}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  // 첫 { 부터 균형 잡힌 마지막 } 까지 추출 (코드펜스·후행 텍스트 방어)
  const start = text.indexOf("{");
  if (start < 0) throw new Error("전략가 응답에 JSON 없음");
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error("전략가 응답 JSON 미완성(잘림)");
  const parsed = JSON.parse(text.slice(start, end + 1)) as Omit<GrowthPlan, "generatedAt">;

  const plan: GrowthPlan = { generatedAt: new Date().toISOString(), ...parsed };
  await db.from("kv_store").upsert(
    { key: KV_KEY, data: plan as unknown as object, updated_at: new Date().toISOString() },
    { onConflict: "key" });
  return plan;
}
