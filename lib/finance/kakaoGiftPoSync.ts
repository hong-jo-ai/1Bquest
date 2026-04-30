/**
 * 카카오선물하기 일일 발주서 — Gmail 자동 동기화.
 *
 * 흐름:
 *  1. shong@harriotwatches.com 의 Gmail 에서 from:song@fjord.kr + 첨부 .xlsx 메일 검색
 *     이미 처리된 메일은 '카카오선물_처리완료' 라벨로 마킹돼 있어 제외
 *  2. 각 메일의 첨부 다운로드 → parseKakaoGiftPo → KakaoGiftPo
 *  3. kv_store key=`kakao_gift_po:YYYY-MM-DD` 에 저장 (날짜별 단일, 같은 날짜에 새 메일 오면 덮어씀)
 *  4. 처리 완료 메일에 '카카오선물_처리완료' 라벨 추가
 *  5. 마지막에 rebuildKakaoGiftChannelData() 호출해 머지 다시 구성
 *
 * 인증: getKakaoGiftGmailAccessToken() — plvekorea@gmail.com 전용 OAuth (gmail.modify 필요)
 *       (캘린더/인박스 분류용 shong@harriotwatches.com 토큰과 분리)
 */
import { createClient } from "@supabase/supabase-js";
import { getKakaoGiftGmailAccessToken } from "./kakaoGiftGmailToken";
import { parseKakaoGiftPo } from "./kakaoGiftPo";
import { rebuildKakaoGiftChannelData } from "./kakaoGiftMerger";
import type { KakaoGiftPo } from "./kakaoGiftPo";

const GMAIL_BASE          = "https://gmail.googleapis.com/gmail/v1/users/me";
const SENDER              = "song@fjord.kr";
const PROCESSED_LABEL     = "카카오선물_처리완료";
const PO_KEY_PREFIX       = "kakao_gift_po:";

interface GmailMessageMeta {
  id: string;
  threadId: string;
}

interface GmailLabel {
  id: string;
  name: string;
}

interface GmailMessageFull {
  id: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: GmailMessageFull["payload"][];
    mimeType?: string;
    filename?: string;
    body?: { attachmentId?: string; data?: string; size?: number };
  };
}

interface GmailAttachmentBody {
  data?: string;
  size?: number;
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    if (
      res.status === 403 &&
      /insufficient|ACCESS_TOKEN_SCOPE/i.test(body)
    ) {
      throw new Error(
        "Gmail 스코프 부족 (gmail.modify 미부여). " +
        "/api/auth/google/login?hint=shong@harriotwatches.com 으로 재연결 후 " +
        "동의 화면에서 Gmail 메일 읽기/수정 권한을 체크해 주세요. " +
        `상세: ${body.slice(0, 200)}`,
      );
    }
    throw new Error(`Gmail ${path}: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

/** '카카오선물_처리완료' 라벨 ID. 없으면 생성. */
async function ensureLabel(accessToken: string): Promise<string> {
  const list = await gmailFetch<{ labels?: GmailLabel[] }>(accessToken, "/labels");
  const existing = list.labels?.find((l) => l.name === PROCESSED_LABEL);
  if (existing) return existing.id;

  const created = await gmailFetch<GmailLabel>(accessToken, "/labels", {
    method: "POST",
    body: JSON.stringify({
      name:                  PROCESSED_LABEL,
      labelListVisibility:   "labelShow",
      messageListVisibility: "show",
    }),
  });
  return created.id;
}

/** 발주서 첨부가 있을 만한 미처리 메일 검색 */
async function findCandidateMessages(accessToken: string): Promise<GmailMessageMeta[]> {
  // q: from + has:attachment + 처리완료 라벨 미적용. 최근 30일로 한정.
  const q = `from:${SENDER} has:attachment -label:${PROCESSED_LABEL} newer_than:30d`;
  const url = `/messages?q=${encodeURIComponent(q)}&maxResults=50`;
  const json = await gmailFetch<{ messages?: GmailMessageMeta[] }>(accessToken, url);
  return json.messages ?? [];
}

/** 메일 1통의 .xlsx 첨부 모두 추출 (sender 필터로 이미 카카오선물 메일임을 확인했기 때문에 파일명 매칭 불필요) */
function extractAttachments(msg: GmailMessageFull): Array<{ filename: string; attachmentId: string }> {
  const out: Array<{ filename: string; attachmentId: string }> = [];
  const walk = (part?: GmailMessageFull["payload"]): void => {
    if (!part) return;
    const fname = part.filename ?? "";
    if (fname.toLowerCase().endsWith(".xlsx") && part.body?.attachmentId) {
      out.push({ filename: fname, attachmentId: part.body.attachmentId });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(msg.payload);
  return out;
}

async function downloadAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const att = await gmailFetch<GmailAttachmentBody>(
    accessToken,
    `/messages/${messageId}/attachments/${attachmentId}`,
  );
  if (!att.data) throw new Error("첨부 본문 없음");
  // base64url → Buffer
  const b64 = att.data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

async function savePo(po: KakaoGiftPo): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const key = `${PO_KEY_PREFIX}${po.date}`;
  await db.from("kv_store").upsert(
    { key, data: po, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

async function addLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
  await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

export interface SyncResult {
  ok: boolean;
  processed: number;            // 새로 처리한 메일 수
  totalAttachments: number;
  poDates: string[];            // 처리한 PO 날짜들
  errors: Array<{ messageId: string; error: string }>;
}

export async function syncKakaoGiftPos(): Promise<SyncResult> {
  const accessToken = await getKakaoGiftGmailAccessToken();
  if (!accessToken) {
    throw new Error("plvekorea@gmail.com Gmail 미연결 — /api/auth/kakao-gift-gmail/login 으로 OAuth 후 재시도");
  }

  const labelId = await ensureLabel(accessToken);
  const candidates = await findCandidateMessages(accessToken);

  let processed = 0;
  let totalAttachments = 0;
  const poDates: string[] = [];
  const errors: SyncResult["errors"] = [];

  for (const { id: messageId } of candidates) {
    try {
      const msg = await gmailFetch<GmailMessageFull>(accessToken, `/messages/${messageId}?format=full`);
      const attachments = extractAttachments(msg);
      if (attachments.length === 0) {
        // 첨부 없으면 라벨 안 붙이고 skip — 다음 sync 에서 재시도 가능 (Gmail nested part 미스 케이스 대비)
        errors.push({
          messageId,
          error: "첨부 .xlsx 못 찾음 — 메일에는 첨부 있을 수 있으나 우리 파서가 못 잡음",
        });
        continue;
      }

      // internalDate fallback (KST YYYY-MM-DD)
      const fallbackDate = msg.internalDate
        ? new Date(parseInt(msg.internalDate) + 9 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        : undefined;

      for (const att of attachments) {
        try {
          const buf = await downloadAttachment(accessToken, messageId, att.attachmentId);
          const po  = parseKakaoGiftPo(buf, att.filename, fallbackDate);
          await savePo(po);
          poDates.push(po.date);
          totalAttachments++;
        } catch (e) {
          errors.push({
            messageId: `${messageId}/${att.filename}`,
            error:     e instanceof Error ? e.message : String(e),
          });
        }
      }

      // 모든 첨부 처리 후 라벨 추가 (실패해도 다음 동기화 때 재시도되도록)
      await addLabel(accessToken, messageId, labelId);
      processed++;
    } catch (e) {
      errors.push({ messageId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 머저 재구성 — 채널 데이터에 반영
  if (totalAttachments > 0) {
    try { await rebuildKakaoGiftChannelData(); }
    catch (e) {
      errors.push({ messageId: "rebuild", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ok: true, processed, totalAttachments, poDates, errors };
}

/** 저장된 모든 PO 가져오기 (머저에서 사용) */
export async function listAllPos(): Promise<KakaoGiftPo[]> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from("kv_store")
    .select("data")
    .like("key", `${PO_KEY_PREFIX}%`);
  if (error || !data) return [];
  return data.map((r) => r.data as KakaoGiftPo);
}
