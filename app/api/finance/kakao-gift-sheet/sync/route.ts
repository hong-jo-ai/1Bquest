/**
 * 카카오선물하기 정산 구글시트 동기화.
 *
 * GET /api/finance/kakao-gift-sheet/sync
 *   1. 사용자 Google access token (ga_at 쿠키, 없으면 ga_rt로 갱신)
 *   2. 시트 메타 조회 → gid 매칭하는 시트 탭 이름 찾기
 *   3. values.get으로 데이터 fetch
 *   4. parseKakaoGiftSheet → MultiChannelData
 *   5. kv_store(channel_upload:kakao_gift)에 저장 (W컨셉 등과 동일 패턴)
 */
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { refreshGoogleToken } from "@/lib/ga4Client";
import { parseKakaoGiftSheet } from "@/lib/finance/kakaoGiftSheet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SHEET_ID = "1v9BOUCNCDTE1X5rBjza-b_j4Ow6C5613U-OTo3dBL7k";
const SHEET_GID = 1480649980;
const KV_KEY = "channel_upload:kakao_gift";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getGoogleAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const cached = cookieStore.get("ga_at")?.value;
  if (cached) return cached;
  const refresh = cookieStore.get("ga_rt")?.value;
  if (!refresh) return null;
  try {
    const fresh = await refreshGoogleToken(refresh);
    cookieStore.set("ga_at", fresh, {
      httpOnly: true, secure: true, maxAge: 3600, path: "/",
    });
    return fresh;
  } catch {
    return null;
  }
}

async function fetchSheetTabName(token: string, spreadsheetId: string, gid: number): Promise<string> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`시트 메타 조회 실패 (${res.status}): ${await res.text()}`);
  const json: { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> } = await res.json();
  const match = (json.sheets ?? []).find((s) => s.properties?.sheetId === gid);
  if (!match?.properties?.title) {
    throw new Error(`gid=${gid}에 해당하는 시트 탭을 찾을 수 없음`);
  }
  return match.properties.title;
}

async function fetchSheetValues(token: string, spreadsheetId: string, sheetName: string): Promise<string[][]> {
  const range = encodeURIComponent(`${sheetName}!A1:AC2000`); // 26~28컬럼 + 여유
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`시트 데이터 조회 실패 (${res.status}): ${await res.text()}`);
  const json: { values?: string[][] } = await res.json();
  return json.values ?? [];
}

export async function GET() {
  const token = await getGoogleAccessToken();
  if (!token) {
    return Response.json(
      {
        ok: false,
        error: "Google 미연결 — /api/auth/google/login 으로 재로그인 필요 (sheets.readonly scope)",
      },
      { status: 401 },
    );
  }

  let rows: string[][];
  let sheetName: string;
  try {
    sheetName = await fetchSheetTabName(token, SHEET_ID, SHEET_GID);
    rows = await fetchSheetValues(token, SHEET_ID, sheetName);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  let parsed;
  try {
    const year = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
    parsed = parseKakaoGiftSheet(rows, year);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }

  const meta = {
    fileName: `${sheetName} (구글시트)`,
    rowCount: parsed.rowCount,
    period: { start: "월별 시트", end: "월별 시트" },
    uploadedAt: new Date().toISOString(),
  };

  // 채널 업로드 형식으로 KV 저장 (W컨셉/무신사 등과 동일 키 패턴)
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from("kv_store").upsert(
      {
        key: KV_KEY,
        data: { data: parsed.data, meta },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) {
      return Response.json({ ok: false, error: `KV 저장 실패: ${error.message}` }, { status: 500 });
    }
  }

  // 요약 — UI 표시용
  const totalRevenue = parsed.data.topProducts.reduce((s, p) => s + p.revenue, 0);
  const totalSold = parsed.data.topProducts.reduce((s, p) => s + p.sold, 0);

  return Response.json({
    ok: true,
    sheetName,
    rowCount: parsed.rowCount,
    totalRevenue,
    totalSold,
    monthsWithData: parsed.data.dailyRevenue?.length ?? 0,
    data: parsed.data,
    meta,
  });
}
