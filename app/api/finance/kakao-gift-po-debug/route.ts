/**
 * 카카오선물하기 발주서 동기화 디버그
 *   GET                          → 검색 쿼리별 매치 노출 + 최신 1건의 full part 트리 분석
 *   POST { action: "reset_labels" }  → 모든 song@fjord.kr 메일에서 '카카오선물_처리완료' 라벨 제거
 */
import { getKakaoGiftGmailAccessToken } from "@/lib/finance/kakaoGiftGmailToken";

export const dynamic = "force-dynamic";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PROCESSED_LABEL = "카카오선물_처리완료";

interface RawHeader { name: string; value: string }
interface PayloadPart {
  mimeType?: string;
  filename?: string;
  body?:     { attachmentId?: string; size?: number };
  parts?:    PayloadPart[];
}
interface MetaResponse {
  id:           string;
  threadId:     string;
  internalDate?: string;
  labelIds?:    string[];
  snippet?:     string;
  payload?:     { headers?: RawHeader[]; parts?: PayloadPart[]; mimeType?: string; filename?: string; body?: { attachmentId?: string } };
}

function flattenParts(part: PayloadPart | undefined, depth = 0): Array<{ depth: number; mimeType: string; filename: string; hasAttachmentId: boolean; size?: number }> {
  if (!part) return [];
  const out = [{
    depth,
    mimeType:        part.mimeType ?? "",
    filename:        part.filename ?? "",
    hasAttachmentId: !!part.body?.attachmentId,
    size:            part.body?.size,
  }];
  for (const child of part.parts ?? []) out.push(...flattenParts(child, depth + 1));
  return out;
}

export async function GET() {
  const accessToken = await getKakaoGiftGmailAccessToken();
  if (!accessToken) {
    return Response.json({ ok: false, error: "plvekorea Gmail 미연결" });
  }

  const queries = [
    { label: "from:song@fjord.kr (전체)",                        q: `from:song@fjord.kr newer_than:30d` },
    { label: "from:song@fjord.kr + has:attachment",              q: `from:song@fjord.kr has:attachment newer_than:30d` },
    { label: "from:song@fjord.kr + 미처리(라벨X)",                q: `from:song@fjord.kr has:attachment -label:${PROCESSED_LABEL} newer_than:30d` },
  ];

  const results: unknown[] = [];
  for (const { label, q } of queries) {
    try {
      const list = await fetch(
        `${GMAIL_BASE}/messages?q=${encodeURIComponent(q)}&maxResults=10`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      ).then((r) => r.json()) as { messages?: Array<{ id: string }> };
      results.push({ query: q, label, count: (list.messages ?? []).length, ids: (list.messages ?? []).map((m) => m.id) });
    } catch (e) {
      results.push({ query: q, label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 최신 1건의 full message — 모든 part 분석
  const latestList = await fetch(
    `${GMAIL_BASE}/messages?q=${encodeURIComponent(`from:song@fjord.kr newer_than:7d`)}&maxResults=1`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  ).then((r) => r.json()) as { messages?: Array<{ id: string }> };

  let fullAnalysis: unknown = null;
  if (latestList.messages?.[0]) {
    const id = latestList.messages[0].id;
    const full = await fetch(
      `${GMAIL_BASE}/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    ).then((r) => r.json()) as MetaResponse;

    const subject = full.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value;
    const flat = flattenParts(full.payload, 0);

    fullAnalysis = {
      id,
      subject,
      labels:        full.labelIds ?? [],
      topMime:       full.payload?.mimeType,
      partsCount:    flat.length,
      partsTree:     flat,
      attachmentParts: flat.filter((p) => p.hasAttachmentId),
    };
  }

  const profile = await fetch(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json()).catch(() => null);

  return Response.json({ ok: true, profile, queries: results, fullAnalysis });
}

export async function POST(req: Request) {
  let body: { action?: string };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (body.action !== "reset_labels") {
    return Response.json({ ok: false, error: "action=reset_labels 만 지원" }, { status: 400 });
  }

  const accessToken = await getKakaoGiftGmailAccessToken();
  if (!accessToken) {
    return Response.json({ ok: false, error: "plvekorea Gmail 미연결" });
  }

  // 라벨 ID 찾기
  const labels = await fetch(`${GMAIL_BASE}/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
  }).then((r) => r.json()) as { labels?: Array<{ id: string; name: string }> };
  const processedLabelId = labels.labels?.find((l) => l.name === PROCESSED_LABEL)?.id;
  if (!processedLabelId) {
    return Response.json({ ok: true, removed: 0, note: "처리완료 라벨 자체가 없음 — 제거할 것 없음" });
  }

  // 라벨 붙은 song@fjord.kr 메일 모두 가져와서 라벨 제거
  const list = await fetch(
    `${GMAIL_BASE}/messages?q=${encodeURIComponent(`from:song@fjord.kr label:${PROCESSED_LABEL} newer_than:60d`)}&maxResults=100`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  ).then((r) => r.json()) as { messages?: Array<{ id: string }> };

  const ids = (list.messages ?? []).map((m) => m.id);
  let removed = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      const res = await fetch(`${GMAIL_BASE}/messages/${id}/modify`, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ removeLabelIds: [processedLabelId] }),
      });
      if (!res.ok) errors.push(`${id}: ${res.status} ${await res.text()}`);
      else removed++;
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return Response.json({ ok: true, removed, total: ids.length, errors: errors.slice(0, 5) });
}
