/**
 * revenue_history:{brand} 매출 히스토리 수동 빌드.
 *
 * 평소엔 매일 KST 03:30 cron 이 자동 실행 (`/api/cron/revenue-snapshot`).
 * 카페24 히스토리 CSV 인제스트 직후 등 즉시 반영이 필요할 때 수동으로 실행.
 *
 * 사용:
 *   npx tsx scripts/run-revenue-snapshot.ts
 *
 * 카페24 라이브 API 부분은 토큰이 환경변수에 없거나 로컬에서 못 가져오면 skip.
 * cafe24_historical:* / channel_upload:* 만으로도 재구성된다.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

function loadEnvFile(p: string) {
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[key] = v;
  }
}

const ROOT = resolve(__dirname, "..");
loadEnvFile(join(ROOT, ".env.supabase"));
loadEnvFile(join(ROOT, ".env.local"));

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되어 있지 않습니다.");
    process.exit(1);
  }

  const { runRevenueSnapshot } = await import("../lib/finance/revenueSnapshot");

  // 로컬에서는 cafe24 토큰을 쉽게 못 만드므로 null 로 호출.
  // cafe24 라이브 부분은 skip 되지만 cafe24_historical / channel_upload 데이터는 모두 적재된다.
  console.log("▶ runRevenueSnapshot(null) 실행 중…");
  const result = await runRevenueSnapshot(null);
  console.log("✓ 결과:");
  console.log(`  paulvice: ${result.paulvice.days}일치 — 채널 [${result.paulvice.channels.join(", ")}]`);
  console.log(`  harriot:  ${result.harriot.days}일치 — 채널 [${result.harriot.channels.join(", ")}]`);
  console.log("  매출추이 위젯이 새 데이터로 갱신됩니다.");
}

main().catch((e) => {
  console.error("실패:", e);
  process.exit(1);
});
