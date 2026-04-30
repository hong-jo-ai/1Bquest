/**
 * 카카오선물하기 발주서 동기화 디버그 — 어떤 메일이 검색되는지 raw 노출.
 */
import { getKakaoGiftGmailAccessToken } from "@/lib/finance/kakaoGiftGmailToken";

export const dynamic = "force-dynamic";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface RawHeader { name: string; value: string }
interface MetaResponse {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: RawHeader[]; parts?: Array<{ filename?: string; mimeType?: string }> };
}

export async function GET() {
  const accessToken = await getKakaoGiftGmailAccessToken();
  if (!accessToken) {
    return Response.json({ ok: false, error: "plvekorea Gmail 미연결" });
  }

  const queries = [
    { label: "from:song@fjord.kr (전체)",                        q: `from:song@fjord.kr newer_than:30d` },
    { label: "from:song@fjord.kr + 첨부",                         q: `from:song@fjord.kr has:attachment newer_than:30d` },
    { label: "from:song@fjord.kr + 미처리(라벨X)",                q: `from:song@fjord.kr has:attachment -label:카카오선물_처리완료 newer_than:30d` },
    { label: "from:fjord.kr (도메인 전체, 다른 alias 가능성)",     q: `from:fjord.kr newer_than:30d` },
    { label: "subject:카카오선물하기 발주서 newer_than:30d",      q: `subject:카카오선물하기 발주서 newer_than:30d` },
    { label: "subject:[피오르드] newer_than:7d",                  q: `subject:[피오르드] newer_than:7d` },
  ];

  const results = [];
  for (const { label, q } of queries) {
    try {
      const list = await fetch(
        `${GMAIL_BASE}/messages?q=${encodeURIComponent(q)}&maxResults=10`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      ).then((r) => r.json()) as { messages?: Array<{ id: string }> };

      const ids = list.messages ?? [];
      const samples = [];
      for (const { id } of ids.slice(0, 5)) {
        const meta = await fetch(
          `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
        ).then((r) => r.json()) as MetaResponse;
        const headers = meta.payload?.headers ?? [];
        const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
        const subj = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
        const date = headers.find((h) => h.name.toLowerCase() === "date")?.value ?? "";
        samples.push({
          id,
          from,
          subject:  subj,
          date,
          labels:   meta.labelIds ?? [],
          snippet:  (meta.snippet ?? "").slice(0, 100),
          attachments: (meta.payload?.parts ?? [])
            .filter((p) => p.filename)
            .map((p) => p.filename),
        });
      }
      results.push({ query: q, label, count: ids.length, samples });
    } catch (e) {
      results.push({ query: q, label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 사용자 인박스 정보
  const profile = await fetch(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json()).catch(() => null);

  return Response.json({ ok: true, profile, results });
}
