/**
 * 스마트스토어 1:1 고객문의 → CS 인박스 적재.
 *
 * 네이버 커머스 API 가 IP 화이트리스트라 Vercel cron 으로는 못 돈다(`GW.IP_NOT_ALLOWED`).
 * 그래서 이 아이맥에서 launchd 로 돌면서 문의를 읽어 대시보드로 넘긴다.
 *   조회(로컬) → POST /api/cs/ingest/smartstore { inquiries } → 인박스 적재(서버)
 *
 * 답변은 반대 방향이다 — 인박스에서 답장하면 액션 큐에 쌓이고 `csActionWorker.js` 가 보낸다.
 *
 * 실행: node smartstoreCsScan.js          (최근 14일)
 *       node smartstoreCsScan.js 90       (90일 백필)
 */
const { collectInquiries } = require("./smartstoreCs");

const DASHBOARD = process.env.PAULWISE_DASHBOARD_URL || "https://paulvice-dashboard.vercel.app";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

(async () => {
  const days = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 14;
  const inquiries = await collectInquiries(days);
  log(`문의 ${inquiries.length}건 조회 (최근 ${days}일)`);
  if (inquiries.length === 0) {
    log("적재할 문의 없음 — 종료.");
    return;
  }

  const token = process.env.PAULWISE_MCP_TOKEN;
  if (!token) throw new Error("PAULWISE_MCP_TOKEN 환경변수 누락");

  const res = await fetch(`${DASHBOARD}/api/cs/ingest/smartstore`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-token": token },
    body: JSON.stringify({ inquiries }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(`적재 실패 ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  log(`적재 완료 — 스캔 ${json.scanned} / 신규 ${json.inserted} / 새 문의 스레드 ${json.newInboundThreadIds?.length ?? 0}`);

  try { await require("./heartbeat").beat("smartstore-cs-scan"); } catch {}
})().catch((e) => {
  console.error("실패:", e.message);
  try { require("./notifyFail").notifyFail("스마트스토어 CS 수집 실패", e.message); } catch {}
  process.exit(1);
});
