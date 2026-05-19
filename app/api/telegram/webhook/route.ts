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

type ExtractedTool =
  | { toolName: "register_influencer"; args: RegisterArgs }
  | { toolName: "add_today_task";      args: AddTaskArgs };

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
    "위 정보를 보고 둘 중 하나의 도구를 정확히 한 번 호출하세요:\n" +
    "1) register_influencer — 인스타/유튜브/틱톡 프로필 스크린샷이거나 인플루언서/계정 등록 의도인 경우.\n" +
    "2) add_today_task — '오늘 할 일', '투두', '대시보드에 할일' 같이 본인 작업 등록 의도인 경우.\n\n" +
    "휴리스틱:\n" +
    "- 이미지가 첨부됐으면 거의 항상 인플루언서 등록.\n" +
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
    "- category: 디자인/광고/CS/콘텐츠/운영/기타 중 추정. 모르면 기타.";

  userContent.push({ type: "text", text: userInstruction });

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system:
      "너는 paulwise 대시보드의 모바일 도우미야. " +
      "사용자가 보낸 메시지/이미지를 보고 register_influencer 또는 add_today_task 중 정확히 하나의 도구를 호출해. " +
      "추측 금지 — 명확한 신호로만 판단. 둘 다 애매하면 add_today_task 로 fallback.",
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
  return { tool: null, error: `알 수 없는 도구: ${toolUse.name}` };
}

function shouldProcess(
  text: string | undefined,
  hasPhoto: boolean,
): { process: boolean; hint?: string } {
  // 사진이 있으면 무조건 등록 시도
  if (hasPhoto) return { process: true };

  // 텍스트만 있으면 의도 키워드 확인 (인플루언서 등록 + 오늘 할일 추가)
  if (text) {
    if (/등록|추가|저장|add|register|발굴|할일|할\s*일|todo|task|할거|할\s*거/i.test(text)) {
      return { process: true };
    }
    return {
      process: false,
      hint:
        "💡 사용법:\n" +
        "• 인스타 스크린샷 첨부 + '등록해줘' → 인플루언서 등록\n" +
        "• '@handle 등록, 패션, 팔로워 5만' → 인플루언서 등록\n" +
        "• '할일 추가: 에끌라 영상 편집' → 오늘 할일에 추가",
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
    const { tool, error: extractError } = await extractToolCall(text, imageData);
    if (!tool) {
      await sendTelegramReply(
        message.chat.id,
        `❌ 정보 추출 실패: ${extractError || "알 수 없는 오류"}`,
        message.message_id,
      );
      return Response.json({ ok: true });
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
