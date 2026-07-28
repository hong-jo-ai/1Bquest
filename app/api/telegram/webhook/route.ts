/**
 * Telegram Bot webhook 핸들러.
 *
 * 모바일에서 텔레그램으로 봇과 대화하며 인플루언서 등록:
 *  - 인스타 프로필 스크린샷 첨부 + "등록해줘" → Claude vision이 추출 후 등록
 *  - 텍스트만 ("@handle, 패션, 5만") → Claude이 텍스트 파싱 후 등록
 *  - 사진만 → 자동으로 등록 시도
 *
 * 인증:
 *  - Telegram이 setWebhook 시 secret_token 등록 → 매 요청 헤더로 echo
 *  - X-Telegram-Bot-Api-Secret-Token === TELEGRAM_WEBHOOK_SECRET 일치해야 통과
 *  - 추가로 chat_id가 TELEGRAM_CHAT_ID 와 일치하는 경우만 응답 (멀티유저 차단)
 *
 * 모델: claude-haiku-4-5 (스크린샷 1장 추출은 Haiku로 충분, 비용 최소화)
 */
import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  registerInfluencer,
  REGISTER_INFLUENCER_TOOL,
  type RegisterArgs,
} from "@/lib/influencer/register";
import {
  addTodayTask,
  ADD_TODAY_TASK_TOOL,
  type AddTaskArgs,
} from "@/lib/todayHub/addTask";
import { createAsRequest, type CreateAsInput } from "@/lib/as/store";
import { storeSmsCode, parseWcCodeMessage } from "@/lib/marketplace/smsCode";
import { storeSyncRequest, parseSyncCommand } from "@/lib/marketplace/syncRequest";
import { hasPendingClassify, applyCardClassify } from "@/lib/finance/cardClassify";
import { parseClaudeCommand, enqueueClaudeTask, parseYesNo, resolveClaudeConfirm } from "@/lib/claudeBridge/queue";
import { resolveEscalationReply } from "@/lib/cs/csEscalation";
import { parseCancelCommand, fetchOrderSummary, setCancelPending, resolveCancelPending, CANCEL_REASONS } from "@/lib/cafe24/cancelQueue";
import { parseParcelBookingCommand, buildBookingInstruction } from "@/lib/postParcel/telegramBooking";
import { parseHoldCommand, applyHoldCommand } from "@/lib/postParcel/holdCommand";
import { resolveAlbaAttendance, sendPayslip } from "@/lib/alba/attendance";
import { parseParkingCommand, storeParkingRequest } from "@/lib/parking/request";
import { transcribeAudio } from "@/lib/mori/stt";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import type { CsBrandId } from "@/lib/cs/types";

const TELEGRAM_API = "https://api.telegram.org";

const CREATE_AS_REQUEST_TOOL = {
  name: "create_as_request",
  description:
    "고객 AS/수리 접수 정보를 AS 관리 앱에 새 접수로 등록합니다. " +
    "고객명, 전화번호, 반송 주소, 모델명, AS 사유/증상, 브랜드, 접수 채널을 추출합니다. " +
    "모르는 필드는 비워두고, 브랜드가 불명확하면 paulvice를 사용합니다.",
  inputSchema: {
    type: "object" as const,
    properties: {
      brand: {
        type: "string",
        enum: ["paulvice", "harriot"],
        description: "브랜드. 폴바이스/paulvice면 paulvice, 해리엇/harriot이면 harriot. 불명확하면 paulvice.",
      },
      customerName: {
        type: "string",
        description: "고객 이름. 예: 김민지",
      },
      customerPhone: {
        type: "string",
        description: "고객 전화번호. 원문 형식을 최대한 유지. 예: 010-1234-5678",
      },
      customerAddress: {
        type: "string",
        description: "반송 주소. 도로명/지번/상세주소를 한 줄로 합칩니다.",
      },
      channel: {
        type: "string",
        description: "접수 채널. 텔레그램으로 직접 입력한 경우 '텔레그램'.",
      },
      model: {
        type: "string",
        description: "제품/모델명. 예: 에끌라 실버, 가양 골드",
      },
      symptom: {
        type: "string",
        description: "AS 사유/증상. 고객 표현을 최대한 그대로 유지.",
      },
      destination: {
        type: "string",
        enum: ["office", "center", "jewelry"],
        description:
          "주얼리(팔찌·목걸이·반지·귀걸이)면 무조건 jewelry — 시계 수리센터는 주얼리를 못 고친다. " +
          "시계 중 간단 배터리/줄 조정 등 사무실 처리면 office, 수리센터 입고 필요하면 center. 불명확하면 생략.",
      },
      note: {
        type: "string",
        description: "추가 메모. 원문에서 별도 요청사항, 구매처, 주문번호 등이 있으면 기록.",
      },
    },
    required: ["brand"],
  },
};

// 파쇼 입고 라우팅 전용 툴 — 세부 수량 판독은 receiptFlow에서 별도 처리하고,
// 여기서는 "이 사진이 협력사 거래명세표/입고증인가"만 판정(고객 AS와 구분).
const ROUTE_PASHO_RECEIPT_TOOL = {
  name: "record_pasho_receipt",
  description:
    "협력사(파쇼)가 보낸 거래명세표·입고증·수령확인서 사진일 때 호출합니다. " +
    "발주번호(P26-xxx 등)·모델명·색상(옵션)별 입고 수량이 표/수기로 적힌 '공급사 서류'가 신호입니다. " +
    "고객 개인정보(고객명·반송주소·증상)가 아니라 발주·수량 문서면 create_as_request가 아니라 반드시 이 도구를 호출하세요. " +
    "세부 수량 판독은 이후 단계에서 처리하므로 여기서는 라우팅만 합니다.",
  inputSchema: {
    type: "object" as const,
    properties: {
      orderHint: { type: "string", description: "사진에서 보이는 발주번호(P26-xxx). 안 보이면 생략." },
    },
  },
};

// 나비스트(주얼리 공급처) 거래명세서 라우팅 전용 툴 — 파쇼(시계 발주)와 구분.
// 세부 제품·수량 판독은 navist/receiptFlow에서 처리, 여기선 "나비스트 명세서인가"만 판정.
const ROUTE_NAVIST_RECEIPT_TOOL = {
  name: "record_navist_receipt",
  description:
    "주얼리 공급처 (주)나비스트(NABIST) 거래명세서 사진일 때 호출합니다. " +
    "상단에 NABIST/나비스트 상호가 있거나 주얼리(팔찌·목걸이·반지·귀걸이) 제품명·단가·수량 표가 신호입니다. " +
    "발주번호(P26-xxx)가 있는 시계 협력사 서류는 record_pasho_receipt, 이건 나비스트 주얼리 명세서일 때만.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vendorHint: { type: "string", description: "명세서에 보이는 공급처명. 보통 '(주)나비스트'." },
    },
  },
};

function authOk(req: NextRequest): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  return got === expected;
}

interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhoto[]; // smallest → largest
  voice?: { file_id: string; duration?: number; mime_type?: string };
  audio?: { file_id: string; duration?: number; mime_type?: string };
  reply_to_message?: { message_id: number };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from?: { id: number; first_name?: string };
    message?: { message_id: number; chat: { id: number }; text?: string };
    data?: string;
  };
}

async function sendTelegramReply(
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeBrand(raw: unknown): CsBrandId {
  const value = String(raw ?? "").toLowerCase();
  if (/harriot|해리엇|harr/i.test(value)) return "harriot";
  return "paulvice";
}

function nullableText(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value ? value : null;
}

// 주얼리 판별 — 모델명만 봐도 시계가 아닌 게 확실한 품목.
const JEWELRY_MODEL_RE = /팔찌|목걸이|반지|귀걸이|주얼리|테니스|참(?:\s|$)|초커|펜던트|이어링|브레이슬릿/;

function normalizeAsDestination(raw: unknown): CreateAsInput["destination"] {
  const value = String(raw ?? "").toLowerCase();
  // 주얼리 판정이 먼저 — "입고"·"센터" 같은 말이 섞여도 시계 수리센터로 새지 않게.
  if (value === "jewelry" || /주얼리|나비스트|팔찌|목걸이|반지|귀걸이/.test(value)) return "jewelry";
  if (value === "office" || /사무실|간단|배터리|줄|스트랩/.test(value)) return "office";
  if (value === "center" || /센터|수리센터|성북|입고/.test(value)) return "center";
  return null;
}

function normalizeAsArgs(args: CreateAsInput): CreateAsInput {
  const model = nullableText(args.model);
  let destination = normalizeAsDestination(args.destination);
  // 모델명이 주얼리면 회송지를 강제 교정한다. 시계 수리센터(성북구)는 주얼리를 못 고쳐서,
  // 잘못 잡히면 고객이 엉뚱한 곳으로 물건을 보내게 된다. (AS-260728-001 사례)
  if (model && JEWELRY_MODEL_RE.test(model)) destination = "jewelry";
  return {
    brand: normalizeBrand(args.brand),
    customerName: nullableText(args.customerName),
    customerPhone: nullableText(args.customerPhone),
    customerAddress: nullableText(args.customerAddress),
    channel: nullableText(args.channel) ?? "텔레그램",
    model,
    symptom: nullableText(args.symptom),
    destination,
    note: nullableText(args.note),
    csThreadId: null,
  };
}

async function downloadTelegramPhoto(
  fileId: string,
): Promise<{ data: string; mediaType: ImageMediaType } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const getFileRes = await fetch(
    `${TELEGRAM_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!getFileRes.ok) return null;
  const getFileJson = (await getFileRes.json()) as {
    ok?: boolean;
    result?: { file_path?: string };
  };
  const filePath = getFileJson?.result?.file_path;
  if (!filePath) return null;

  const fileRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;
  const buf = Buffer.from(await fileRes.arrayBuffer());

  const lower = filePath.toLowerCase();
  let mediaType: ImageMediaType = "image/jpeg";
  if (lower.endsWith(".png")) mediaType = "image/png";
  else if (lower.endsWith(".webp")) mediaType = "image/webp";
  else if (lower.endsWith(".gif")) mediaType = "image/gif";

  return { data: buf.toString("base64"), mediaType };
}

/** 텔레그램 음성/오디오 파일 다운로드 → base64 + mimeType (전사용). */
async function downloadTelegramAudio(
  fileId: string,
  mimeHint?: string,
): Promise<{ data: string; mimeType: string } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const getFileRes = await fetch(
    `${TELEGRAM_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!getFileRes.ok) return null;
  const getFileJson = (await getFileRes.json()) as { result?: { file_path?: string } };
  const filePath = getFileJson?.result?.file_path;
  if (!filePath) return null;
  const fileRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;
  const buf = Buffer.from(await fileRes.arrayBuffer());
  // 텔레그램 음성메시지는 .oga(ogg/opus). 확장자로 mime 추정, 힌트가 있으면 우선.
  const lower = filePath.toLowerCase();
  let mimeType = mimeHint || "audio/ogg";
  if (lower.endsWith(".oga") || lower.endsWith(".ogg")) mimeType = "audio/ogg";
  else if (lower.endsWith(".mp3") || lower.endsWith(".mpeg")) mimeType = "audio/mpeg";
  else if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) mimeType = "audio/mp4";
  else if (lower.endsWith(".wav")) mimeType = "audio/wav";
  return { data: buf.toString("base64"), mimeType };
}

type ExtractedTool =
  | { toolName: "register_influencer"; args: RegisterArgs }
  | { toolName: "add_today_task";      args: AddTaskArgs }
  | { toolName: "create_as_request";   args: CreateAsInput }
  | { toolName: "pasho_receipt";       args: Record<string, never> }
  | { toolName: "navist_receipt";      args: Record<string, never> };

async function extractToolCall(
  text: string | undefined,
  imageData: { data: string; mediaType: ImageMediaType } | null,
): Promise<{ tool: ExtractedTool | null; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { tool: null, error: "ANTHROPIC_API_KEY 미설정" };

  const client = new Anthropic({ apiKey });

  const userContent: Array<
    Anthropic.ImageBlockParam | Anthropic.TextBlockParam
  > = [];

  if (imageData) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageData.mediaType,
        data: imageData.data,
      },
    });
  }

  const userInstruction =
    (text && text.trim()
      ? `사용자 메시지: "${text.trim()}"\n\n`
      : "사용자가 사진만 보냈습니다.\n\n") +
    "위 정보를 보고 다섯 중 하나의 도구를 정확히 한 번 호출하세요:\n" +
    "1) register_influencer — 인스타/유튜브/틱톡 프로필 스크린샷이거나 인플루언서/계정 등록 의도인 경우.\n" +
    "2) add_today_task — '오늘 할 일', '투두', '대시보드에 할일' 같이 본인 작업 등록 의도인 경우.\n" +
    "3) create_as_request — 고객 AS/수리 접수 정보인 경우. 고객명/전화/반송주소/모델/증상/AS사유가 들어오면 이 도구를 사용.\n" +
    "4) record_pasho_receipt — 시계 협력사(파쇼) 거래명세표·입고증 사진. 발주번호(P26-xxx)·모델·색상별 입고 수량이 표로 적힌 서류.\n" +
    "5) record_navist_receipt — 주얼리 공급처 (주)나비스트(NABIST) 거래명세서 사진. NABIST 상호나 주얼리(팔찌·목걸이·반지·귀걸이) 제품·단가·수량 표.\n\n" +
    "휴리스틱(이미지 종류로 구분 — '사진이면 인플루언서'라고 단정하지 말 것):\n" +
    "- 인스타/유튜브 프로필 UI(@핸들·팔로워·게시물 그리드) 스크린샷 → register_influencer.\n" +
    "- NABIST/나비스트 상호 또는 주얼리(팔찌·목걸이·반지) 제품 명세서 → record_navist_receipt.\n" +
    "- 발주번호(P26-xxx)·시계 모델·색상별 수량 서류 → record_pasho_receipt. (둘 다 명세표지만 공급처·품목으로 구분)\n" +
    "- 거래명세표·입고증류는 절대 AS로 보내지 말 것.\n" +
    "- 고객 개인정보(고객명·전화·반송주소·증상)가 담긴 AS 접수 내용 → create_as_request.\n" +
    "- 텍스트만이고 '할일'/'todo'/'task'/'할거'/'추가해줘 (작업명)' 같으면 add_today_task.\n" +
    "- '@핸들' 또는 팔로워/플랫폼 언급은 register_influencer.\n\n" +
    "register_influencer 호출 시:\n" +
    "- handle: @ 제외하고 추출 (예: @nak__ta__ → nak__ta__)\n" +
    "- followers: '5만'/'50K'/'50,000' → 50000 정수\n" +
    "- categories: bio/해시태그에서 추정 (패션/뷰티/라이프스타일 등)\n" +
    "- platform: 인스타 UI → instagram, 빨강/구독 → youtube\n" +
    "- 모르는 필드는 비워두기\n\n" +
    "add_today_task 호출 시:\n" +
    "- title: 할 일 한 줄 (예: '에끌라 영상 컷 편집')\n" +
    "- category: 디자인/광고/CS/콘텐츠/운영/기타 중 추정. 모르면 기타.\n\n" +
    "create_as_request 호출 시:\n" +
    "- brand: 폴바이스/paulvice는 paulvice, 해리엇/harriot은 harriot. 불명확하면 paulvice.\n" +
    "- customerName/customerPhone/customerAddress/model/symptom을 원문에서 추출.\n" +
    "- channel은 별도 채널이 없으면 '텔레그램'.\n" +
    "- destination은 명확할 때만 office 또는 center로 지정. 불명확하면 생략.\n" +
    "- note에는 주문번호, 구매처, 요청사항처럼 주 필드에 안 들어가는 내용을 기록.";

  userContent.push({ type: "text", text: userInstruction });

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system:
      "너는 paulwise 대시보드의 모바일 도우미야. " +
      "사용자가 보낸 메시지/이미지를 보고 register_influencer, add_today_task, create_as_request, record_pasho_receipt, record_navist_receipt 중 정확히 하나의 도구를 호출해. " +
      "거래명세표·입고증은 고객 AS가 아니다 — 시계 발주(P26)면 record_pasho_receipt, 나비스트 주얼리면 record_navist_receipt. " +
      "추측 금지 — 명확한 신호로만 판단. 애매하면 add_today_task 로 fallback.",
    tools: [
      {
        name: REGISTER_INFLUENCER_TOOL.name,
        description: REGISTER_INFLUENCER_TOOL.description,
        input_schema:
          REGISTER_INFLUENCER_TOOL.inputSchema as unknown as Anthropic.Tool["input_schema"],
      },
      {
        name: ADD_TODAY_TASK_TOOL.name,
        description: ADD_TODAY_TASK_TOOL.description,
        input_schema:
          ADD_TODAY_TASK_TOOL.inputSchema as unknown as Anthropic.Tool["input_schema"],
      },
      {
        name: CREATE_AS_REQUEST_TOOL.name,
        description: CREATE_AS_REQUEST_TOOL.description,
        input_schema:
          CREATE_AS_REQUEST_TOOL.inputSchema as unknown as Anthropic.Tool["input_schema"],
      },
      {
        name: ROUTE_PASHO_RECEIPT_TOOL.name,
        description: ROUTE_PASHO_RECEIPT_TOOL.description,
        input_schema:
          ROUTE_PASHO_RECEIPT_TOOL.inputSchema as unknown as Anthropic.Tool["input_schema"],
      },
      {
        name: ROUTE_NAVIST_RECEIPT_TOOL.name,
        description: ROUTE_NAVIST_RECEIPT_TOOL.description,
        input_schema:
          ROUTE_NAVIST_RECEIPT_TOOL.inputSchema as unknown as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    return { tool: null, error: "Claude이 도구를 호출하지 않았습니다" };
  }

  if (toolUse.name === "register_influencer") {
    return { tool: { toolName: "register_influencer", args: toolUse.input as RegisterArgs } };
  }
  if (toolUse.name === "add_today_task") {
    return { tool: { toolName: "add_today_task", args: toolUse.input as AddTaskArgs } };
  }
  if (toolUse.name === "create_as_request") {
    return { tool: { toolName: "create_as_request", args: toolUse.input as CreateAsInput } };
  }
  if (toolUse.name === "record_pasho_receipt") {
    return { tool: { toolName: "pasho_receipt", args: {} } };
  }
  if (toolUse.name === "record_navist_receipt") {
    return { tool: { toolName: "navist_receipt", args: {} } };
  }
  return { tool: null, error: `알 수 없는 도구: ${toolUse.name}` };
}

// 파쇼 입고증 판독 → 확인카드 전송. fast-path(캡션 키워드)와 분류기 라우팅 양쪽에서 재사용.
async function runPashoReceipt(
  chatId: number,
  replyToId: number,
  img: { data: string; mediaType: ImageMediaType },
): Promise<Response> {
  const { extractReceiptFromImage, buildConfirmText, stagePendingReceipt } = await import("@/lib/pasho/receiptFlow");
  const { receipt, order, error } = await extractReceiptFromImage(img);
  if (!receipt || !order) {
    await sendTelegramReply(
      chatId,
      `⚠️ 입고증 판독 실패: ${error || "발주 매칭 안 됨"}. 발주번호(P26-xxx)를 캡션에 같이 적어주시면 정확합니다.`,
      replyToId,
    );
    return Response.json({ ok: true });
  }
  const pending = await stagePendingReceipt(receipt, order.model);
  await sendTelegramMessage(buildConfirmText(order, receipt.items, receipt.note), {
    buttons: [
      { text: "✅ 맞음", callback_data: `pasho:accept:${pending.id}` },
      { text: "❌ 취소", callback_data: `pasho:reject:${pending.id}` },
    ],
  });
  return Response.json({ ok: true, pashoReceipt: true });
}

// 나비스트 주얼리 명세서 판독 → 확인카드(미매핑 표시). fast-path·분류기 공용.
async function runNavistReceipt(
  chatId: number,
  replyToId: number,
  img: { data: string; mediaType: ImageMediaType },
): Promise<Response> {
  const { extractNavistReceipt, stageNavistPending, buildNavistConfirmText } = await import("@/lib/navist/receiptFlow");
  const { receipt, error } = await extractNavistReceipt(img);
  if (!receipt) {
    await sendTelegramReply(chatId, `⚠️ 나비스트 명세서 판독 실패: ${error || "제품을 읽지 못함"}. 표가 잘 보이게 다시 찍어주세요.`, replyToId);
    return Response.json({ ok: true });
  }
  const pending = await stageNavistPending(receipt);
  await sendTelegramMessage(buildNavistConfirmText(pending), {
    buttons: [
      { text: "✅ 맞음", callback_data: `navist:accept:${pending.id}` },
      { text: "❌ 취소", callback_data: `navist:reject:${pending.id}` },
    ],
  });
  return Response.json({ ok: true, navistReceipt: true });
}

function shouldProcess(
  text: string | undefined,
  hasPhoto: boolean,
): { process: boolean; hint?: string } {
  // 사진이 있으면 무조건 등록 시도
  if (hasPhoto) return { process: true };

  // 텍스트만 있으면 의도 키워드 확인 (인플루언서 등록 + 오늘 할일 추가 + AS 접수)
  if (text) {
    if (/등록|추가|저장|add|register|발굴|할일|할\s*일|todo|task|할거|할\s*거|as|a\/s|AS|수리|접수|증상|반송\s*주소|전화번호|연락처/i.test(text)) {
      return { process: true };
    }
    return {
      process: false,
      hint:
        "💡 사용법:\n" +
        "• 인스타 스크린샷 첨부 + '등록해줘' → 인플루언서 등록\n" +
        "• '@handle 등록, 패션, 팔로워 5만' → 인플루언서 등록\n" +
        "• '할일 추가: 에끌라 영상 편집' → 오늘 할일에 추가\n" +
        "• 'AS 접수\\n이름: 김민지\\n전화: 010...\\n주소: ...\\n모델: ...\\n증상: ...' → AS 접수",
    };
  }

  return { process: false };
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" });
  }

  // ── 인라인 버튼 콜백 (mads 광고 추천 확인카드 등) ─────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const allowed = process.env.TELEGRAM_CHAT_ID;
    const chatId = cb.message?.chat?.id;
    if (!allowed || String(chatId) !== allowed) {
      return Response.json({ ok: true, ignored: "unauthorized callback" });
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const answer = (text: string) =>
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id, text: text.slice(0, 190) }),
      }).catch(() => {});
    const editAppend = (line: string) =>
      fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId, message_id: cb.message?.message_id,
          text: `${cb.message?.text ?? ""}

${line}`,
        }),
      }).catch(() => {});

    const m = String(cb.data || "").match(/^mads:(accept|reject):(.+)$/);
    if (m) {
      try {
        const { decideRecommendation } = await import("@/lib/mads/decide");
        const res = await decideRecommendation(m[2], m[1] as "accept" | "reject");
        const line = res.ok
          ? (m[1] === "accept" ? `✅ 승인 — ${res.summary ?? "적용 완료"}` : "❌ 거절 처리됨")
          : `⚠️ 실패: ${res.error ?? "알 수 없음"}`;
        await answer(res.ok ? "처리 완료" : `실패: ${res.error ?? ""}`);
        await editAppend(line);
      } catch (e) {
        await answer("오류: " + (e instanceof Error ? e.message : String(e)).slice(0, 150));
      }
      return Response.json({ ok: true });
    }
    const pm = String(cb.data || "").match(/^pasho:(accept|reject):(.+)$/);
    if (pm) {
      try {
        const { confirmPendingReceipt, rejectPendingReceipt } = await import("@/lib/pasho/receiptFlow");
        if (pm[1] === "accept") {
          const res = await confirmPendingReceipt(pm[2]);
          await answer(res.ok ? "입고 기록됨" : `실패: ${res.error ?? ""}`);
          await editAppend(res.ok ? `✅ ${res.summary ?? "입고 기록 완료"}` : `⚠️ 실패: ${res.error ?? "알 수 없음"}`);
        } else {
          await rejectPendingReceipt(pm[2]);
          await answer("취소됨");
          await editAppend("❌ 입고 취소 — 다시 사진을 보내주세요.");
        }
      } catch (e) {
        await answer("오류: " + (e instanceof Error ? e.message : String(e)).slice(0, 150));
      }
      return Response.json({ ok: true });
    }
    const nm = String(cb.data || "").match(/^navist:(accept|reject):(.+)$/);
    if (nm) {
      try {
        const { confirmNavistPending, rejectNavistPending } = await import("@/lib/navist/receiptFlow");
        if (nm[1] === "accept") {
          const res = await confirmNavistPending(nm[2]);
          await answer(res.ok ? "입고 기록됨" : `실패: ${res.error ?? ""}`);
          await editAppend(res.ok ? `✅ ${res.summary ?? "입고 기록 완료"}` : `⚠️ 실패: ${res.error ?? "알 수 없음"}`);
        } else {
          await rejectNavistPending(nm[2]);
          await answer("취소됨");
          await editAppend("❌ 입고 취소 — 다시 사진을 보내주세요.");
        }
      } catch (e) {
        await answer("오류: " + (e instanceof Error ? e.message : String(e)).slice(0, 150));
      }
      return Response.json({ ok: true });
    }

    await answer("알 수 없는 버튼");
    return Response.json({ ok: true, ignored: "unknown callback" });
  }

  const message = update.message || update.edited_message;
  if (!message) return Response.json({ ok: true, ignored: "no message" });

  // 사장님 본인 chat만 응답 (다른 사람이 봇 발견해서 쓰는 거 차단)
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  // 디버그 로그: 들어온 chat_id를 항상 찍어서 잘못된 env 값 잡기
  console.log(
    `[telegram-webhook] incoming chat_id=${message.chat.id} (type=${message.chat.type}) from=${message.from?.first_name ?? "?"} text="${(message.text || message.caption || "").slice(0, 40)}" allowed=${allowedChatId}`,
  );
  if (!allowedChatId || String(message.chat.id) !== allowedChatId) {
    return Response.json({
      ok: true,
      ignored: "unauthorized chat",
      received_chat_id: message.chat.id,
    });
  }

  let text = message.text || message.caption;
  // 음성메시지(STT): 텔레그램 voice/audio → 한국어 전사 → 아래 모든 명령에 그대로 흘려보냄.
  // viaVoice 플래그로 "음성 입력 → 음성 답변" 연결(클로드 브리지가 결과를 음성으로도 회신).
  let viaVoice = false;
  const audioFile = message.voice || message.audio;
  if (!text && audioFile?.file_id) {
    try {
      const dl = await downloadTelegramAudio(audioFile.file_id, audioFile.mime_type);
      if (dl) {
        const heard = await transcribeAudio(dl.data, dl.mimeType);
        if (heard) {
          text = heard;
          viaVoice = true;
          await sendTelegramReply(message.chat.id, `🎤 "${heard.slice(0, 200)}"`, message.message_id);
        }
      }
      if (!text) await sendTelegramReply(message.chat.id, "🎤 음성을 알아듣지 못했어요. 다시 말씀해 주세요.", message.message_id);
    } catch (e) {
      await sendTelegramReply(message.chat.id, `🎤 음성 인식 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      return Response.json({ ok: true, voiceError: true });
    }
  }
  const hasPhoto = !!(message.photo && message.photo.length > 0);

  // 나비스트 SKU 매핑 답장 — 확인카드에 "2=P00000BT"(여러 개 "1=P00000BT, 2=P00000BU") 형식으로 답하면
  // 미매칭 항목에 cafe24 상품코드를 지정·학습(다음 입고부터 자동)하고 확인카드를 갱신해 다시 띄운다.
  if (text && !hasPhoto && /\d+\s*=\s*[A-Za-z0-9]+/.test(text)) {
    const { getLatestPending, parseMappingPairs, applyMapping, buildNavistConfirmText } =
      await import("@/lib/navist/receiptFlow");
    const latest = await getLatestPending();
    if (latest) {
      const pairs = parseMappingPairs(text);
      if (pairs.length) {
        const { pending, mapped, errors } = await applyMapping(latest.id, pairs);
        if (pending) {
          await sendTelegramMessage(buildNavistConfirmText(pending), {
            buttons: [
              { text: "✅ 맞음", callback_data: `navist:accept:${pending.id}` },
              { text: "❌ 취소", callback_data: `navist:reject:${pending.id}` },
            ],
          });
          await sendTelegramReply(
            message.chat.id,
            `🔗 매핑 ${mapped}건 저장${errors.length ? ` · ⚠️ ${errors.join(", ")}` : ""}`,
            message.message_id,
          );
          return Response.json({ ok: true, navistMapping: true });
        }
      }
    }
  }

  // 나비스트 주얼리 입고 fast-path — 사진 + 나비스트/주얼리 캡션 → 명세서 판독 → 확인카드.
  // (파쇼보다 먼저: '거래명세서'는 파쇼와 겹치므로 공급처 키워드로 우선 분기. 캡션 없으면 분류기가 이미지로 판별)
  if (hasPhoto && message.photo && text && /나비스트|nabist|주얼리/i.test(text)) {
    try {
      const largest = message.photo[message.photo.length - 1];
      const img = await downloadTelegramPhoto(largest.file_id);
      if (!img) {
        await sendTelegramReply(message.chat.id, "❌ 사진 다운로드 실패. 다시 보내주세요.", message.message_id);
        return Response.json({ ok: true });
      }
      return await runNavistReceipt(message.chat.id, message.message_id, img);
    } catch (e) {
      await sendTelegramReply(message.chat.id, `⚠️ 나비스트 처리 오류: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      return Response.json({ ok: true });
    }
  }

  // 파쇼 입고 fast-path — 사진 + 입고/거래명세/명세표/수령확인/파쇼 캡션 → 입고증 판독 → 확인카드
  // (캡션이 없거나 이 키워드가 없어도 아래 분류기가 거래명세표를 인식해 파쇼로 라우팅한다)
  if (hasPhoto && message.photo && text && /입고|거래명세|명세표|명세서|수령\s*확인|파쇼/.test(text)) {
    try {
      const largest = message.photo[message.photo.length - 1];
      const img = await downloadTelegramPhoto(largest.file_id);
      if (!img) {
        await sendTelegramReply(message.chat.id, "❌ 사진 다운로드 실패. 다시 보내주세요.", message.message_id);
        return Response.json({ ok: true });
      }
      return await runPashoReceipt(message.chat.id, message.message_id, img);
    } catch (e) {
      await sendTelegramReply(message.chat.id, `⚠️ 입고 처리 오류: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      return Response.json({ ok: true });
    }
  }

  // CS 자동응대 에스컬레이션 답장 — 보류된 CS 문의 메시지에 swipe-reply 로 "방향"을 주면
  // 정식 답변으로 다듬어 미리보기 → "발송" 답장 시 고객에게 전송. (reply_to 로 스레드 정확 매칭)
  if (text && message.reply_to_message?.message_id) {
    try {
      const esc = await resolveEscalationReply(message.reply_to_message.message_id, text);
      if (esc?.handled) {
        return Response.json({ ok: true, csEscalation: true });
      }
    } catch (e) {
      console.error("[telegram-webhook] CS 에스컬레이션 처리 오류:", e instanceof Error ? e.message : String(e));
    }
  }

  // W컨셉 등 SMS 인증번호 릴레이 — "wc 123456" 이면 코드 저장 후 종료 (다른 처리로 안 넘김)
  if (text) {
    const wcCode = parseWcCodeMessage(text);
    if (wcCode) {
      try {
        await storeSmsCode(wcCode);
        await sendTelegramReply(message.chat.id, `✅ 인증번호 ${wcCode} 받았어요 (W컨셉 동기화에 사용).`, message.message_id);
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 인증번호 저장 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      }
      return Response.json({ ok: true, smsCode: true });
    }

    // Claude 확인 게이트 — 위험작업 대기중일 때 "예/아니오" 응답 처리 (다른 명령보다 먼저)
    const yn = parseYesNo(text);
    if (yn !== null) {
      // 카페24 주문취소 확인게이트(있으면 먼저 처리)
      try {
        const cancelRes = await resolveCancelPending(yn);
        if (cancelRes) {
          await sendTelegramReply(
            message.chat.id,
            cancelRes.enqueued
              ? `✅ 주문 ${cancelRes.orderId} 취소 작업을 큐에 넣었어요. 잠시 후 처리하고 결과를 보고할게요.`
              : `❌ 주문 ${cancelRes.orderId} 취소를 진행하지 않습니다.`,
            message.message_id,
          );
          return Response.json({ ok: true, cafe24Cancel: cancelRes.enqueued ? "queued" : "denied" });
        }
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 취소 확인 처리 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
        return Response.json({ ok: true, cafe24Cancel: "error" });
      }
      try {
        const action = await resolveClaudeConfirm(yn);
        if (action) {
          await sendTelegramReply(
            message.chat.id,
            yn ? `✅ 승인했습니다. 작업을 진행합니다.\n"${action.slice(0, 80)}"` : `❌ 취소했습니다. 작업을 진행하지 않습니다.`,
            message.message_id,
          );
          return Response.json({ ok: true, claudeConfirm: yn ? "approved" : "denied" });
        }
        // 대기중인 확인요청이 없으면 일반 메시지로 흘려보냄(아래 처리 계속)
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 확인 처리 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
        return Response.json({ ok: true, claudeConfirm: "error" });
      }
    }

    // 카페24 주문취소 명령 — "주문취소 20260627-0000050 [사유]" → 주문확인 + 예/아니오 게이트
    const cancelCmd = parseCancelCommand(text);
    if (cancelCmd) {
      try {
        const brandLabel = cancelCmd.brand === "harriot" ? "해리엇" : "폴바이스";
        const sum = await fetchOrderSummary(cancelCmd.orderId, cancelCmd.brand);
        if (!sum.ok) {
          await sendTelegramReply(message.chat.id, `⚠️ 주문 조회 실패: ${sum.error}`, message.message_id);
          return Response.json({ ok: true, cafe24Cancel: "lookup_failed" });
        }
        if (sum.canceled) {
          await sendTelegramReply(message.chat.id, `이미 취소된 주문이에요.\n${sum.summary}`, message.message_id);
          return Response.json({ ok: true, cafe24Cancel: "already_canceled" });
        }
        await setCancelPending({ orderId: cancelCmd.orderId, brand: cancelCmd.brand, reason: cancelCmd.reason, summary: sum.summary, at: new Date().toISOString() });
        await sendTelegramReply(
          message.chat.id,
          `🟠 <b>주문취소 확인</b> (${brandLabel})\n${sum.summary}\n\n사유: ${cancelCmd.reason}(${CANCEL_REASONS[cancelCmd.reason]})\n신용카드는 승인취소(환불)됩니다.\n\n이 주문 취소할까요? <b>예</b> / <b>아니오</b>`,
          message.message_id,
        );
        return Response.json({ ok: true, cafe24Cancel: "confirm_requested" });
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 취소 요청 처리 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
        return Response.json({ ok: true, cafe24Cancel: "error" });
      }
    }

    // 알바 급여명세서 명령 — "급여명세서" / "알바 급여" (+ 선택 "YYYY-MM")
    if (/급여\s*명세서|알바\s*급여|급여\s*정산/.test(text)) {
      const ym = (text.match(/(20\d{2})[-.\s]?(0?[1-9]|1[0-2])\b/) || []);
      const ymStr = ym.length ? `${ym[1]}-${String(ym[2]).padStart(2, "0")}` : undefined;
      try {
        const slip = await sendPayslip(ymStr);
        return Response.json({ ok: true, albaPayslip: true, text: slip });
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 급여명세서 생성 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
        return Response.json({ ok: true, albaPayslip: "error" });
      }
    }

    // 주차 2시간 할인 등록 — "주차 4330" → 요청 적재(아이맥 워처가 주차사이트 등록 후 결과 회신)
    const parkCarNo = parseParkingCommand(text);
    if (parkCarNo) {
      try {
        await storeParkingRequest(parkCarNo);
        await sendTelegramReply(message.chat.id, `🅿️ 차량 ${parkCarNo} 2시간 할인권 등록 중... (아이맥이 처리 후 결과 알려줄게요)`, message.message_id);
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 주차 등록 요청 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      }
      return Response.json({ ok: true, parking: parkCarNo });
    }

    // 알바 출퇴근 응답 — 대기 중인 "근무했나요?" 질문이 있고 y/n 이면 그날 근무여부 기록
    const albaRes = await resolveAlbaAttendance(text);
    if (albaRes) {
      await sendTelegramReply(message.chat.id, albaRes.message, message.message_id);
      return Response.json({ ok: true, albaAttendance: true });
    }

    // 발송보류/발송/발송취소 — "이영희 발송보류" / "이영희 발송" / "이영희 발송취소"
    // (발급된 송장 중 실제 미발송 건을 송장입력에서 제외/복귀/취소 — 서버 DB, 취소만 큐→아이맥)
    const hold = parseHoldCommand(text);
    if (hold) {
      try {
        const msg = await applyHoldCommand(hold);
        await sendTelegramReply(message.chat.id, msg, message.message_id);
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 발송보류 처리 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      }
      return Response.json({ ok: true, hold: hold.action });
    }

    // 단건 택배/반품 예약 — "홍길동 택배예약" / "홍길동 반품예약" → Claude 브리지로 라우팅
    // (헤드리스 claude가 채널 출고대기에서 고객 찾아 registerSingle/registerReturn, 가드 확인게이트로 실발급 승인)
    const booking = parseParcelBookingCommand(text);
    if (booking) {
      try {
        await enqueueClaudeTask(buildBookingInstruction(booking), message.chat.id, viaVoice);
        const kind = booking.type === "return" ? "반품" : "택배";
        await sendTelegramReply(message.chat.id, `📦 ${booking.name}님 ${kind} 단건예약 진행할게요. 주문을 찾아 수취 정보를 보여드리고, 실제 송장 발급 전에 "예/아니오"로 확인 요청드립니다.\n(아이맥이 켜져 있어야 합니다)`, message.message_id);
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 단건예약 접수 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      }
      return Response.json({ ok: true, parcelBooking: booking.type });
    }

    // Claude Code 브리지 — "클로드 <지시>" → 큐 적재, 아이맥 워처가 헤드리스 수행 후 결과 보고
    const claudeTask = parseClaudeCommand(text);
    if (claudeTask) {
      try {
        await enqueueClaudeTask(claudeTask, message.chat.id, viaVoice);
        await sendTelegramReply(message.chat.id, `🤖 작업 받았습니다, 진행할게요.\n"${claudeTask.slice(0, 60)}"\n(코드 수정·실행까지 수행 — 발송·배포·삭제 등 위험작업은 실행 전 "예/아니오"로 확인 요청. 아이맥이 켜져 있어야 합니다)`, message.message_id);
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ 작업 접수 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      }
      return Response.json({ ok: true, claudeTask: true });
    }

    // on-demand 동기화 명령 ("W컨셉 동기화" / "무신사 동기화") → 요청 기록 (아이맥 watcher가 실행)
    const syncCh = parseSyncCommand(text);
    if (syncCh) {
      const LABELS: Record<string, string> = { wconcept: "W컨셉", musinsa: "무신사", "29cm": "29CM", sixshop: "식스샵", dutyfree: "면세점 발주", wconcept_ads: "W컨셉 광고비", tax_invoice: "전자세금계산서", fedex_global: "FedEx 글로벌 엑셀" };
      const label = LABELS[syncCh] ?? syncCh;
      try {
        await storeSyncRequest(syncCh);
        if (syncCh === "dutyfree") {
          await sendTelegramReply(message.chat.id, `📦 면세점 발주 처리를 시작합니다. 발주제안서(신세계·롯데)를 다운로드 폴더에 받아두시면 입고서류를 생성·저장하고 면세점 박스를 차감합니다.\n(아이맥이 켜져 있어야 실행됩니다)`, message.message_id);
        } else if (syncCh === "fedex_global") {
          await sendTelegramReply(message.chat.id, `📦 식스샵 글로벌 미발송 해외주문을 수집해 FedEx Ship Manager용 엑셀을 만들어 보내드릴게요.\n(아이맥이 켜져 있어야 실행됩니다)`, message.message_id);
        } else {
          const guide = syncCh === "wconcept"
            ? "잠시 후 인증번호 요청이 2번 갑니다. 각 SMS를 'wc 코드'로 보내주세요."
            : "잠시 후 자동으로 진행됩니다.";
          await sendTelegramReply(message.chat.id, `🔄 ${label} 동기화를 시작합니다. ${guide}\n(아이맥이 켜져 있어야 실행됩니다)`, message.message_id);
        }
      } catch (e) {
        await sendTelegramReply(message.chat.id, `⚠️ ${label} 요청 실패: ${e instanceof Error ? e.message : String(e)}`, message.message_id);
      }
      return Response.json({ ok: true, syncRequest: syncCh });
    }
  }

  // PG 결제 분류 답장 — 대기 중인 "이거 뭐였어?" 질문이 있으면 이 메시지를 분류 답으로 처리
  if (text) {
    try {
      if (await hasPendingClassify()) {
        const res = await applyCardClassify(text);
        if (res) {
          await sendTelegramReply(message.chat.id, `✅ ${res.merchant} ₩${res.amount.toLocaleString()} → [${res.category}]로 정리했어요.`, message.message_id);
          return Response.json({ ok: true, cardClassify: true });
        }
      }
    } catch { /* 실패 시 일반 처리로 진행 */ }
  }

  const decision = shouldProcess(text, hasPhoto);
  if (!decision.process) {
    if (decision.hint) {
      await sendTelegramReply(message.chat.id, decision.hint, message.message_id);
    }
    return Response.json({ ok: true });
  }

  // 사진 다운로드 (가장 큰 사이즈)
  let imageData: { data: string; mediaType: ImageMediaType } | null = null;
  if (hasPhoto && message.photo) {
    const largest = message.photo[message.photo.length - 1];
    imageData = await downloadTelegramPhoto(largest.file_id);
    if (!imageData) {
      await sendTelegramReply(
        message.chat.id,
        "❌ 사진 다운로드 실패. 다시 보내주세요.",
        message.message_id,
      );
      return Response.json({ ok: true });
    }
  }

  // 봇 메시지에 대한 '답장'인데 위의 명시적 답장 핸들러(CS 에스컬레이션·미리보기, 확인게이트, wc코드)가
  // 아무것도 못 잡았으면 → 이미 처리됐거나 만료된 답장이다. 인플루언서/AS 분류기로 흘려보내면
  // 엉뚱한 도움말·오등록이 나오므로 여기서 멈추고 안내한다. (사진 첨부 답장은 예외로 통과)
  if (message.reply_to_message?.message_id && !imageData) {
    await sendTelegramReply(
      message.chat.id,
      "↪️ 이 답장을 처리할 대상을 못 찾았어요 (이미 처리됐거나 만료됐어요).\n답변은 최신 '📝 이렇게 보낼게요' 미리보기 메시지에 답장하거나, 대시보드 CS 인박스에서 처리해 주세요.",
      message.message_id,
    );
    return Response.json({ ok: true, staleReply: true });
  }

  try {
    const { tool, error: extractError } = await extractToolCall(text, imageData);
    if (!tool) {
      await sendTelegramReply(
        message.chat.id,
        `❌ 정보 추출 실패: ${extractError || "알 수 없는 오류"}`,
        message.message_id,
      );
      return Response.json({ ok: true });
    }

    // 거래명세표/입고증으로 분류되면 파쇼 입고 흐름으로(확인카드). imageData는 위에서 이미 받아둠.
    if (tool.toolName === "pasho_receipt") {
      if (!imageData) {
        await sendTelegramReply(message.chat.id, "⚠️ 파쇼 입고증은 사진으로 보내주세요.", message.message_id);
        return Response.json({ ok: true });
      }
      return await runPashoReceipt(message.chat.id, message.message_id, imageData);
    }
    // 나비스트 주얼리 명세서로 분류되면 나비스트 입고 흐름으로.
    if (tool.toolName === "navist_receipt") {
      if (!imageData) {
        await sendTelegramReply(message.chat.id, "⚠️ 나비스트 명세서는 사진으로 보내주세요.", message.message_id);
        return Response.json({ ok: true });
      }
      return await runNavistReceipt(message.chat.id, message.message_id, imageData);
    }

    let reply: string;

    if (tool.toolName === "add_today_task") {
      const result = await addTodayTask(tool.args);
      if (result.ok) {
        reply = [
          `✅ ${result.message}`,
          "",
          "대시보드 새로고침 시 즉시 반영됩니다.",
        ].join("\n");
      } else {
        reply = `❌ 할일 추가 실패: ${result.error}`;
      }
    } else if (tool.toolName === "create_as_request") {
      const args = normalizeAsArgs(tool.args);
      const request = await createAsRequest(args);
      const lines = [
        `✅ AS 접수 완료: <b>${escapeHtml(request.as_number)}</b>`,
        "",
        `<b>브랜드</b>: ${request.brand === "harriot" ? "해리엇" : "폴바이스"}`,
        request.customer_name ? `<b>고객</b>: ${escapeHtml(request.customer_name)}` : null,
        request.customer_phone ? `<b>전화</b>: ${escapeHtml(request.customer_phone)}` : null,
        request.customer_address ? `<b>주소</b>: ${escapeHtml(request.customer_address)}` : null,
        request.model ? `<b>모델</b>: ${escapeHtml(request.model)}` : null,
        request.symptom ? `<b>증상</b>: ${escapeHtml(request.symptom)}` : null,
        request.note ? `<b>메모</b>: ${escapeHtml(request.note)}` : null,
        "",
        "대시보드 → AS 관리에서 확인할 수 있습니다.",
      ].filter((l): l is string => l !== null);
      reply = lines.join("\n");
    } else {
      const args = tool.args;
      const result = await registerInfluencer(args);
      if (result.ok) {
        const lines = [
          result.message,
          "",
          `<b>플랫폼</b>: ${args.platform}`,
          `<b>이름</b>: ${args.name || args.handle}`,
          args.followers ? `<b>팔로워</b>: ${args.followers.toLocaleString()}` : null,
          args.categories?.length ? `<b>카테고리</b>: ${args.categories.join(", ")}` : null,
          args.priority ? `<b>우선순위</b>: ${args.priority}` : null,
          args.notes ? `<b>메모</b>: ${args.notes}` : null,
          "",
          "대시보드 → 인플루언서 도구에서 확인 (다음 마운트 시 동기화)",
        ].filter((l): l is string => l !== null);
        reply = lines.join("\n");
      } else if ("duplicate" in result) {
        reply = `⚠️ ${result.message}`;
      } else {
        reply = `❌ 등록 실패: ${result.error}`;
      }
    }

    await sendTelegramReply(message.chat.id, reply, message.message_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "내부 오류";
    await sendTelegramReply(
      message.chat.id,
      `❌ 처리 중 오류: ${msg}`,
      message.message_id,
    );
  }

  return Response.json({ ok: true });
}

// 헬스체크용 (수동 점검 시 GET으로 살아있는지 확인)
export async function GET() {
  return Response.json({
    ok: true,
    name: "paulwise-telegram-webhook",
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasSecret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    hasChatId: !!process.env.TELEGRAM_CHAT_ID,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  });
}
