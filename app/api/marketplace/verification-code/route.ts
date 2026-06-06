/**
 * 마켓플레이스 로그인 2차 인증용 — shong@ Gmail에서 최신 인증번호(6자리)를 읽어 반환.
 *
 * 로컬 에이전트(marketplaceSync.js)가 무신사 등 이메일 인증 로그인 시 호출.
 * Google secret이 서버(Vercel env)에만 있으므로, 코드 읽기를 서버가 대신 수행한다.
 *
 * GET /api/marketplace/verification-code?channel=musinsa[&q=<gmail query 덮어쓰기>]
 * 헤더: x-agent-token: <PAULWISE_MCP_TOKEN>
 * 응답: { code: "123456" } | { error, code: null }
 */
import { type NextRequest } from "next/server";
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";
import { getKakaoGiftGmailAccessToken } from "@/lib/finance/kakaoGiftGmailToken";

export const dynamic = "force-dynamic";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// 채널별 기본 Gmail 검색 쿼리 (테스트 후 발신자 확인되면 정교화)
const DEFAULT_QUERY: Record<string, string> = {
  musinsa: "from:(musinsa.com) newer_than:15m",
  wconcept: "from:(wconcept) newer_than:15m",
  "29cm": "from:(musinsa OR 29cm) newer_than:15m",
};

// 채널별 수신 메일함: 무신사=shong@(google_refresh_token), 29CM=plvekorea@(kakao_gift_gmail_token)
async function accessTokenForChannel(channel: string): Promise<string | null> {
  if (channel === "29cm") return getKakaoGiftGmailAccessToken();
  return getGoogleAccessTokenFromStore();
}

type GmailPart = {
  body?: { data?: string };
  parts?: GmailPart[];
};

function extractCode(payload: GmailPart | undefined): string | null {
  const chunks: string[] = [];
  const walk = (part?: GmailPart) => {
    if (!part) return;
    if (part.body?.data) chunks.push(part.body.data);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  const text = chunks
    .map((d) => Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
    .join("\n");
  const match = text.match(/(?<!\d)(\d{6})(?!\d)/);
  return match ? match[1] : null;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const channel = req.nextUrl.searchParams.get("channel") || "";
  const query = req.nextUrl.searchParams.get("q") || DEFAULT_QUERY[channel];
  if (!query) {
    return Response.json({ error: `알 수 없는 채널: ${channel}` }, { status: 400 });
  }

  let accessToken: string | null = null;
  try {
    accessToken = await accessTokenForChannel(channel);
  } catch (e) {
    return Response.json(
      { error: `Google 토큰 갱신 실패: ${e instanceof Error ? e.message : String(e)}`, code: null },
      { status: 502 }
    );
  }
  if (!accessToken) {
    return Response.json({ error: "저장된 Google refresh token 없음", code: null }, { status: 500 });
  }

  const listRes = await fetch(`${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=5`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    return Response.json(
      { error: `Gmail 검색 실패 (${listRes.status}): ${await listRes.text()}`, code: null },
      { status: 502 }
    );
  }
  const list = await listRes.json();
  const messageId = list.messages?.[0]?.id;
  if (!messageId) {
    return Response.json({ error: `인증 메일 없음 (query: ${query})`, code: null }, { status: 404 });
  }

  const msgRes = await fetch(`${GMAIL}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!msgRes.ok) {
    return Response.json({ error: `Gmail 메시지 조회 실패 (${msgRes.status})`, code: null }, { status: 502 });
  }
  const msg = await msgRes.json();
  const code = extractCode(msg.payload);
  if (!code) {
    return Response.json({ error: "메일에서 6자리 코드 추출 실패", code: null }, { status: 404 });
  }
  return Response.json({ code });
}
