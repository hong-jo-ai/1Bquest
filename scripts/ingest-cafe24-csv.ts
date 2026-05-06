/**
 * 카페24 과거 매출 CSV 를 supabase kv_store 에 인제스트하는 일회성 CLI 스크립트.
 *
 * 사용:
 *   npx tsx scripts/ingest-cafe24-csv.ts <path/to/file.csv> [brand]
 *
 *   - path/to/file.csv : 카페24 어드민 → 주문관리 → 주문목록 → CSV 다운로드
 *   - brand            : "paulvice" (기본) | "harriot"
 *
 * 환경변수 (.env.supabase / .env.local 둘 중 하나에서 자동 로드):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 동일 fileName 재실행은 교체, 다른 파일명은 누적됨.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, join } from "node:path";

// .env.supabase / .env.local 수동 로드 — Next.js 환경 밖이라 자동 로드 안됨
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
  const [, , filePathArg, brandArg] = process.argv;
  if (!filePathArg) {
    console.error("사용: npx tsx scripts/ingest-cafe24-csv.ts <CSV 경로> [paulvice|harriot]");
    process.exit(1);
  }

  const filePath = resolve(filePathArg);
  if (!existsSync(filePath)) {
    console.error(`파일을 찾을 수 없음: ${filePath}`);
    process.exit(1);
  }

  const brand = (brandArg ?? "paulvice") as "paulvice" | "harriot";
  if (brand !== "paulvice" && brand !== "harriot") {
    console.error(`brand 는 paulvice 또는 harriot 이어야 합니다: ${brand}`);
    process.exit(1);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("환경변수 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되어 있지 않습니다.");
    console.error("(.env.supabase 또는 .env.local 에 정의되어야 함)");
    process.exit(1);
  }

  // 동적 import — env 변수 로드 후 import 해야 supabase client 가 제대로 초기화됨
  const { parseCafe24HistoricalCsv, saveCafe24HistoricalUpload } = await import(
    "../lib/cafe24Historical"
  );

  const buffer = readFileSync(filePath);
  const fileName = basename(filePath);

  console.log(`▶ 파싱: ${fileName} (${buffer.length.toLocaleString()} bytes)`);
  const upload = parseCafe24HistoricalCsv(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    fileName,
  );

  console.log(`✓ 결제완료 주문 ${upload.dailyRevenue.reduce((s, d) => s + d.orders, 0)}건`);
  console.log(`✓ 기간 ${upload.period.start} ~ ${upload.period.end}`);
  console.log(`✓ 일별 데이터 ${upload.dailyRevenue.length}일치`);

  // 일자별 요약 (상위 5일)
  const top = [...upload.dailyRevenue].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  console.log(`  상위 매출일:`);
  for (const d of top) {
    console.log(`    ${d.date}: ${d.revenue.toLocaleString()}원 (${d.orders}건, ${d.shipments}배송)`);
  }

  const totalRevenue = upload.dailyRevenue.reduce((s, d) => s + d.revenue, 0);
  console.log(`✓ 총 매출 ${totalRevenue.toLocaleString()}원`);

  console.log(`▶ ${brand} 브랜드 cafe24_historical:${brand} 키로 저장 중…`);
  const result = await saveCafe24HistoricalUpload(brand, upload);
  console.log(`✓ 저장 완료. 누적 업로드 ${result.totalUploads}개.`);
  console.log(`다음 대시보드 새로고침부터 자동 반영됩니다.`);
}

main().catch((e) => {
  console.error("실패:", e);
  process.exit(1);
});
