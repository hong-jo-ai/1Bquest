/**
 * 베스트 소재 자동 세트 생성.
 *
 * 흐름:
 *   1. 원본 광고세트를 deep copy (Meta /copies endpoint, 새 세트는 PAUSED)
 *   2. 새 세트의 daily_budget = 지정값, name = "MADS-BEST-{date}-{ad_name}"
 *   3. 새 세트 안의 모든 광고 중 베스트 광고가 아닌 것은 PAUSE (cannibalization 방지)
 *
 * 결과 세트는 항상 PAUSED. 사용자가 Meta UI에서 검토 후 활성화.
 */
import { metaGet, metaPost } from "../metaClient";
import { logManualAction } from "./wobbleDetector";

export interface BuildBestAdsetInput {
  originalAdsetId: string;
  bestAdId:        string;
  bestAdName:      string;
  dailyBudgetKrw:  number;
}

export interface BuildBestAdsetResult {
  ok:               boolean;
  newAdsetId:       string | null;
  newName:          string | null;
  totalAdsInNew:    number;
  keptActiveAdIds:  string[];
  pausedAdIds:      string[];
  errors:           string[];
}

function kstDate(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function safeShortName(name: string, max = 30): string {
  return name.replace(/[^\w가-힣\- ]/g, "").trim().slice(0, max);
}

interface CopyResponse {
  copied_adset_id?: string;
  ad_object_ids?: { adset_id?: string };
  ad_object_id?: string;
  id?: string;
}

interface AdRow { id: string; name: string; status: string }

export async function buildBestAdset(
  token: string,
  input: BuildBestAdsetInput,
): Promise<BuildBestAdsetResult> {
  const errors: string[] = [];
  const result: BuildBestAdsetResult = {
    ok: false, newAdsetId: null, newName: null,
    totalAdsInNew: 0, keptActiveAdIds: [], pausedAdIds: [], errors,
  };

  // 1) Deep copy
  let copy: CopyResponse;
  try {
    copy = (await metaPost(`/${input.originalAdsetId}/copies`, token, {
      deep_copy:     "true",
      status_option: "PAUSED",
    })) as CopyResponse;
  } catch (e) {
    errors.push(`원본 세트 복제 실패: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  const newAdsetId =
    copy.copied_adset_id ??
    copy.ad_object_ids?.adset_id ??
    copy.ad_object_id ??
    copy.id ??
    null;

  if (!newAdsetId) {
    errors.push(`복제 응답에서 새 광고세트 ID 못 찾음: ${JSON.stringify(copy)}`);
    return result;
  }
  result.newAdsetId = newAdsetId;

  // 2) 새 세트: 일예산 + 이름 변경
  const newName = `MADS-BEST-${kstDate()}-${safeShortName(input.bestAdName)}`;
  result.newName = newName;
  try {
    await metaPost(`/${newAdsetId}`, token, {
      daily_budget: String(input.dailyBudgetKrw),
      name:         newName,
    });
  } catch (e) {
    errors.push(`새 세트 일예산/이름 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    // 계속 진행 — 적어도 복제는 됐음
  }

  // 3) 새 세트의 광고 목록
  let ads: AdRow[] = [];
  try {
    const data = (await metaGet(`/${newAdsetId}/ads`, token, {
      fields: "id,name,status",
      limit:  "100",
    })) as { data?: AdRow[] };
    ads = data.data ?? [];
  } catch (e) {
    errors.push(`새 세트 광고 목록 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  result.totalAdsInNew = ads.length;

  // 4) 베스트 광고 외 PAUSE
  const targetName = input.bestAdName.trim();
  for (const ad of ads) {
    const isBest =
      ad.name === targetName ||
      ad.name.startsWith(targetName) ||
      ad.name.includes(targetName.slice(0, 20));
    if (isBest) {
      result.keptActiveAdIds.push(ad.id);
      continue;
    }
    if (ad.status === "PAUSED") continue; // 이미 일시중지
    try {
      await metaPost(`/${ad.id}`, token, { status: "PAUSED" });
      result.pausedAdIds.push(ad.id);
    } catch (e) {
      errors.push(`광고 ${ad.id} 일시중지 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 5) 흔들림 감지용 로그 (소스: mads)
  await logManualAction(input.originalAdsetId, "duplicate_for_best", "mads", {
    new_adset_id:    newAdsetId,
    daily_budget:    input.dailyBudgetKrw,
    best_ad_id:      input.bestAdId,
    best_ad_name:    input.bestAdName,
    paused_ad_count: result.pausedAdIds.length,
  });

  result.ok = result.keptActiveAdIds.length > 0;
  return result;
}
