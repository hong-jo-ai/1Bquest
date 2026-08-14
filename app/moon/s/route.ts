import { NextRequest, NextResponse } from "next/server";
import { getMoonData, formatKoreanDate, isOccasion, CANONICAL_PAGE, type Occasion } from "../moonShared";

// 공유 중계 페이지 — 카카오톡·페북 크롤러에게는 '그날의 달' OG 카드를 보여주고,
// 사람(JS 실행 브라우저)은 harriotwatches.co.kr 본 페이지로 즉시 이동시킨다.
// meta refresh는 쓰지 않는다(일부 크롤러가 따라가 OG를 잃는다) — JS 리다이렉트 + noscript 링크만.

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const dRaw = sp.get("d") ?? "";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(dRaw);
  const date = valid ? dRaw : "";
  const occasion: Occasion | "" = isOccasion(sp.get("o")) ? (sp.get("o") as Occasion) : "";
  const memory = (sp.get("m") ?? "").slice(0, 44);

  const q = new URLSearchParams();
  if (date) q.set("d", date);
  if (occasion) q.set("o", occasion);
  if (memory) q.set("m", memory);
  const qs = q.toString();
  const target = qs ? `${CANONICAL_PAGE}?${qs}` : CANONICAL_PAGE;
  const ogImage = `${req.nextUrl.origin}/moon/og${qs ? `?${qs}` : ""}`;

  let description = "오래 남아 있는 밤의 달을 한 장의 기록으로 간직하세요.";
  let title = "그날의 달 — HARRIOT";
  if (date) {
    const data = getMoonData(date);
    title = `${formatKoreanDate(date)} — ${data.label}`;
    description = `${data.fact} 당신의 밤은 언제인가요?`;
  }

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeAttr(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HARRIOT">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:image" content="${escapeAttr(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${escapeAttr(target)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(ogImage)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="background:#0f1626;color:#e9edf4;font-family:serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<noscript><a href="${escapeAttr(target)}" style="color:#e9edf4">그날의 달 보러 가기</a></noscript>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
