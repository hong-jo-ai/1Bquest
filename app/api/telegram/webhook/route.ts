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

const TELEGRAM_API = "https://api.telegram.org";

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
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
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

async function extractInfluencerArgs(
  text: string | undefined,
  imageData: { data: string; mediaType: ImageMediaType } | null,
): Promise<{ args: RegisterArgs | null; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { args: null, error: "ANTHROPIC_API_KEY 미설정" };

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
    "위 정보(텍스트/이미지)에서 인플루언서 정보를 추출해서 register_influencer 도구를 한 번 호출하세요.\n" +
    "- 이미지가 있으면 인스타그램/유튜브/틱톡 프로필 스크린샷으로 가정\n" +
    "- handle: @ 제외하고 추출 (예: @nak__ta__ → nak__ta__)\n" +
    "- name: 표시 이름 (한글 이름 또는 닉네임)\n" +
    "- followers: '5만'/'50K'/'50,000' → 50000 같이 정수로 변환. 모르면 생략\n" +
    "- categories: bio/소개/해시태그에서 추정 (예: 패션/뷰티/라이프스타일/푸드/여행)\n" +
    "- platform: 화면 UI로 판단 (인스타 동그라미 스토리 = instagram, 빨강/구독 = youtube)\n" +
    "- notes: 사용자가 메시지로 강조한 포인트나 bio에서 인상적인 부분\n" +
    "- 정보 없는 필드는 비워두세요.";

  userContent.push({ type: "text", text: userInstruction });

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system:
      "너는 paulwise 대시보드의 인플루언서 등록 도우미야. " +
      "사용자가 보낸 인스타/유튜브/틱톡 프로필 스크린샷이나 텍스트 정보에서 " +
      "인플루언서 정보를 추출해서 register_influencer 도구를 호출해. " +
      "추측 금지 — 보이는 정보만 추출. 모르는 필드는 비워둬.",
    tools: [
      {
        name: REGISTER_INFLUENCER_TOOL.name,
        description: REGISTER_INFLUENCER_TOOL.description,
        input_schema:
          REGISTER_INFLUENCER_TOOL.inputSchema as unknown as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: REGISTER_INFLUENCER_TOOL.name },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    return { args: null, error: "Claude이 도구를 호출하지 않았습니다" };
  }

  return { args: toolUse.input as RegisterArgs };
}

function shouldProcess(
  text: string | undefined,
  hasPhoto: boolean,
): { process: boolean; hint?: string } {
  // 사진이 있으면 무조건 등록 시도
  if (hasPhoto) return { process: true };

  // 텍스트만 있으면 등록 키워드 확인
  if (text) {
    if (/등록|추가|저장|add|register|발굴/i.test(text)) {
      return { process: true };
    }
    return {
      process: false,
      hint:
        "💡 인플루언서 등록 사용법:\n" +
        "• 인스타 프로필 스크린샷 첨부 + '등록해줘'\n" +
        "• 텍스트로 '인스타 @handle 등록, 패션, 팔로워 5만, 우선순위 높음'",
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

  const message = update.message || update.edited_message;
  if (!message) return Response.json({ ok: true, ignored: "no message" });

  // 사장님 본인 chat만 응답 (다른 사람이 봇 발견해서 쓰는 거 차단)
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!allowedChatId || String(message.chat.id) !== allowedChatId) {
    return Response.json({ ok: true, ignored: "unauthorized chat" });
  }

  const text = message.text || message.caption;
  const hasPhoto = !!(message.photo && message.photo.length > 0);

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

  try {
    const { args, error: extractError } = await extractInfluencerArgs(
      text,
      imageData,
    );
    if (!args) {
      await sendTelegramReply(
        message.chat.id,
        `❌ 정보 추출 실패: ${extractError || "알 수 없는 오류"}`,
        message.message_id,
      );
      return Response.json({ ok: true });
    }

    const result = await registerInfluencer(args);

    let reply: string;
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
