/**
 * 클로드 세션 발화 → "일" 단위 작업 목록.
 *
 *   node claudeWorkDigest.js [--days 3] [--dry]
 *
 * 사장님은 터미널 한 세션에서 CS·개발·재무·기획을 다 한다. 세션 제목 하나로는
 * 그 안의 일들이 통째로 사라진다(실측: "김예성 반품 회수 완료" 제목 아래 54턴에
 * 서로 다른 일 14건). 그래서 발화를 클로드에게 읽혀 일 단위로 쪼갠다.
 *
 * 비용을 줄이려고 세션별 발화 수를 기억해 두고, 발화가 늘어난 세션만 다시 부른다.
 * 이미 처리한 세션은 직전 결과를 그대로 재사용한다.
 */
const fs = require("fs"), path = require("path"), os = require("os");
const { beat } = require("./heartbeat");

const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for (const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; let v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } } catch {} }
loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(DASH,".env.supabase")); loadEnv(path.join(DASH,"local-agent/.env"));

const OUT_KEY = "today:cc_work";
/**
 * 기본 haiku. 같은 세션 14개로 비교했을 때 추출 건수는 90 vs 91 로 사실상 같은데
 * 출력 토큰이 6,151 vs 37,692(사고 33,177) 로 6배 차이났다. 완료 판정이 조금 후한
 * 편이라, 화면에서 완료 항목을 숨기지 않고 흐리게만 보여준다(잘못 판정돼도 안 사라지게).
 * 품질이 아쉬우면 --model claude-sonnet-5.
 */
const MODEL   = (() => { const i = process.argv.indexOf("--model"); return i >= 0 ? process.argv[i+1] : "claude-haiku-4-5"; })();
/** 한 세션에서 클로드에 넘길 최대 발화 수. 넘치면 최근 것만. */
const MAX_TURNS = 250;

/** YYYY-MM-DD (KST) — 모델에 오늘을 알려줘야 "금요일까지" 같은 표현의 연도가 맞는다. */
function kstToday() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

const args = process.argv.slice(2);
const DRY  = args.includes("--dry");
const DAYS = (() => { const i = args.indexOf("--days"); const v = i >= 0 ? Number(args[i+1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 3; })();

function getDb() {
  const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE env 없음");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const SYSTEM = `너는 사장님(홍성조)의 업무 기록 정리 담당이다. 클로드 코드 세션에서 사장님이 친 발화만 시간순으로 받는다.
한 세션 안에 서로 다른 일이 여러 건 섞여 있다. 이걸 "일" 단위로 쪼개라.

규칙:
- 한 건의 일 = 하나의 항목. 같은 일에 대한 후속 발화는 하나로 합친다.
- 제목은 발화를 그대로 옮기지 말고 "무슨 일인지" 한 줄로 쓴다. 20자 내외.
- 클로드에게 시킨 잡무(파일 열어줘, 다시 해줘, 확인해줘)는 그 자체로 항목이 아니다.
  그게 어떤 일의 일부인지 보고 그 일에 합친다.
- 사장님이 "완료", "끝", "보냈어", "했어" 로 마무리한 일은 done=true.
  아직 진행 중이거나 답을 기다리는 일은 done=false.
- 마감이 언급된 것만 due 에 적는다(예: "금요일까지" → 그 주 금요일 날짜). 없으면 빈 문자열.
  오늘 날짜는 사용자 메시지 첫 줄에 준다. 연도를 반드시 그 날짜 기준으로 맞춘다.
- 잡담·감상·상담은 항목이 아니다. 단, 구체적 행동이 정해졌으면 넣는다.

domain 분류:
- paulvice: 폴바이스(국내 여성 시계·주얼리 자사몰)
- harriot: 해리엇(영문권 시계 브랜드, 조선몰·설월·성산 등)
- ars: 아르스 필하모닉 오케스트라 운영(단원·회비·출석·연습)
- personal: 그 외 개인(독서모임·가족·사이드 프로젝트 개발 등)
대시보드/스크립트 개발은 그 일이 어느 브랜드를 위한 건지로 가른다. 판단이 안 서면 paulvice.

JSON만 출력한다:
{"items":[{"title":"...","domain":"harriot","done":false,"due":"YYYY-MM-DD 또는 빈 문자열","lastTurn":12}]}
lastTurn 은 그 일이 마지막으로 언급된 발화 번호다. 건질 게 없으면 {"items":[]}.`;

const usage = { input: 0, output: 0, thinking: 0, calls: 0 };

async function segment(client, session) {
  const turns = session.turns.length > MAX_TURNS ? session.turns.slice(-MAX_TURNS) : session.turns;
  const body = turns.map((t, i) => `${i + 1}. ${t.text}`).join("\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    system: SYSTEM,
    messages: [{ role: "user", content: `오늘: ${kstToday()}\n프로젝트: ${session.projectDir}\n발화 ${turns.length}턴\n\n${body}` }],
  });
  usage.calls++;
  usage.input    += res.usage.input_tokens || 0;
  usage.output   += res.usage.output_tokens || 0;
  usage.thinking += (res.usage.output_tokens_details && res.usage.output_tokens_details.thinking_tokens) || 0;

  const text = (res.content.find((c) => c.type === "text") || {}).text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    // 빈 응답은 대개 max_tokens 로 잘린 것이다. 어디서 멈췄는지 남겨야 원인을 안다.
    throw new Error(`JSON 못 찾음 (stop=${res.stop_reason}, 블록=${res.content.map((c) => c.type).join("+") || "없음"}, 길이=${text.length})`);
  }
  const parsed = JSON.parse(m[0]);
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  // 항목마다 "마지막으로 만진 시각"을 발화 번호로 되짚는다 — 정체 일수 계산에 쓴다.
  return items.map((it) => {
    const idx = Number(it.lastTurn);
    const turn = Number.isFinite(idx) && turns[idx - 1] ? turns[idx - 1] : turns[turns.length - 1];
    return {
      title:      String(it.title || "").trim(),
      domain:     ["paulvice", "harriot", "ars", "personal"].includes(it.domain) ? it.domain : "paulvice",
      done:       Boolean(it.done),
      due:        /^\d{4}-\d{2}-\d{2}$/.test(it.due || "") ? it.due : "",
      lastAt:     (turn && turn.at) || session.touchedAt,
      sessionId:  session.sessionId,
      projectDir: session.projectDir,
    };
  }).filter((it) => it.title);
}

(async () => {
  const db = getDb();

  const { data: scans, error } = await db.from("kv_store").select("key, data").like("key", "today:cc_activity%");
  if (error) throw new Error(`스캔 읽기 실패: ${error.message}`);

  const cutoff = Date.now() - DAYS * 86400_000;
  const sessions = [];
  for (const row of scans || []) {
    for (const s of (row.data && row.data.sessions) || []) {
      if (!s.turns || s.turns.length === 0) continue;
      if (Date.parse(s.touchedAt) < cutoff) continue;
      sessions.push(s);
    }
  }
  if (sessions.length === 0) { console.log(`최근 ${DAYS}일 발화 있는 세션 없음`); return; }

  // 직전 결과 — 발화 수가 그대로면 다시 안 부른다
  const { data: prevRow } = await db.from("kv_store").select("data").eq("key", OUT_KEY).maybeSingle();
  const prev = (prevRow && prevRow.data) || {};
  const prevBySession = new Map(Object.entries(prev.bySession || {}));

  const Anthropic = require(path.join(DASH, "node_modules/@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const bySession = {};
  let called = 0, reused = 0;
  for (const s of sessions) {
    const cached = prevBySession.get(s.sessionId);
    if (cached && cached.turnCount === s.turns.length) {
      bySession[s.sessionId] = cached;
      reused++;
      continue;
    }
    try {
      const items = await segment(client, s);
      bySession[s.sessionId] = { turnCount: s.turns.length, items };
      called++;
      console.log(`  ${s.projectDir.replace("-Users-mac-sungjo-ai", "~")} (${s.turns.length}턴) → 일 ${items.length}건`);
      for (const it of items) {
        console.log(`      ${it.done ? "✓" : " "} [${it.domain}] ${it.title}${it.due ? ` · ~${it.due}` : ""}`);
      }
    } catch (e) {
      console.log(`  ${s.sessionId.slice(0, 8)}: 실패 — ${e.message}`);
      if (cached) bySession[s.sessionId] = cached; // 실패하면 옛 결과라도 유지
    }
  }

  const allItems = Object.values(bySession).flatMap((v) => v.items || []);
  const payload = { generatedAt: new Date().toISOString(), days: DAYS, bySession };

  console.log(`\n세션 ${sessions.length}개 (새로 분석 ${called}, 재사용 ${reused}) → 일 ${allItems.length}건 (미완 ${allItems.filter((i) => !i.done).length})`);
  if (usage.calls) {
    console.log(`토큰 ${usage.calls}콜 · 입력 ${usage.input.toLocaleString()} · 출력 ${usage.output.toLocaleString()}(사고 ${usage.thinking.toLocaleString()})`);
  }

  if (DRY) { console.log("--dry: 적재 생략"); return; }

  const { error: putErr } = await db.from("kv_store")
    .upsert({ key: OUT_KEY, data: payload, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (putErr) throw new Error(`적재 실패: ${putErr.message}`);
  console.log(`적재 완료 → ${OUT_KEY}`);
  await beat("claude-work-digest", { sessions: sessions.length, items: allItems.length, called });
})().catch((e) => { console.error("[claudeWorkDigest]", e.message); process.exit(1); });
