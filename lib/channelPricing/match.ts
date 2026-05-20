/**
 * 채널 상품명 → 우리 canonical SKU 자동 매칭.
 *
 * 보수적으로 — 정규화 후 완전 일치만 자동 연결하고, 나머지는 후보만 제시해 사용자가
 * 확인하게 한다 (가격/수수료가 걸린 민감한 매칭이라 오연결 방지). 한 번 확인하면
 * channelCode→sku 로 저장돼 다음 업로드부터 자동.
 */

export interface SkuRef {
  sku: string;
  name: string;
}

/** 브랜드 접두어/공백/특수문자 제거 + 소문자. */
export function normalizeName(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/폴바이스|paulvice|\bpv\b/g, "")
    .replace(/[^0-9a-z가-힣]/g, "")
    .trim();
}

function tokens(raw: string): Set<string> {
  return new Set(
    (raw ?? "")
      .toLowerCase()
      .replace(/폴바이스|paulvice/g, "")
      .split(/[^0-9a-z가-힣]+/)
      .filter((t) => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** name 과 SKU 후보들의 유사도 점수 (0~1) 상위 정렬. */
export function rankCandidates(
  name: string,
  skus: SkuRef[],
  limit = 3,
): Array<{ sku: string; name: string; score: number }> {
  const nNorm = normalizeName(name);
  const nTok = tokens(name);
  return skus
    .map((s) => {
      const sNorm = normalizeName(s.name);
      let score: number;
      if (nNorm && sNorm && nNorm === sNorm) score = 1;
      else if (nNorm && sNorm && (nNorm.includes(sNorm) || sNorm.includes(nNorm))) score = 0.85;
      else score = jaccard(nTok, tokens(s.name));
      return { sku: s.sku, name: s.name, score: Number(score.toFixed(3)) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 자동 연결 임계치 — 정규화 완전 일치(1.0)만 자동, 그 외 수동확인. */
export const AUTO_MATCH_THRESHOLD = 1.0;
