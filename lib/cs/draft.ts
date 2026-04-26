import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { getThread } from "./store";
import { BRAND_LABEL, CHANNEL_LABEL, type CsMessage } from "./types";

const MODEL = "claude-haiku-4-5";
let skillContent: string | null = null;

async function loadSkill(): Promise<string> {
  if (skillContent) return skillContent;
  const p = path.join(
    process.cwd(),
    "config",
    "skills",
    "cs-responder",
    "SKILL.md"
  );
  skillContent = await readFile(p, "utf-8");
  return skillContent;
}

function isChatChannel(channel: string): boolean {
  return channel === "threads" || channel === "ig_dm" || channel === "channeltalk" || channel === "kakao_bizchat";
}

function formatMessages(messages: CsMessage[]): string {
  return messages
    .map((m) => {
      const who = m.direction === "in" ? "고객" : "나(대표)";
      const text = m.body_text?.trim() || "(빈 메시지)";
      return `${who}: ${text}`;
    })
    .join("\n\n");
}

export interface DraftResult {
  draft: string;
  rationale: string;
  needsConfirmation: string[];
}

export async function generateDraft(threadId: string): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 누락");

  const data = await getThread(threadId);
  if (!data) throw new Error("thread not found");
  const { thread, messages } = data;

  const skill = await loadSkill();
  const client = new Anthropic({ apiKey });

  const brandLabel = BRAND_LABEL[thread.brand];
  const channelLabel = CHANNEL_LABEL[thread.channel];
  const chatMode = isChatChannel(thread.channel);

  const systemPrompt = `${skill}

---

## 자동 주입된 메타데이터

- 브랜드: ${brandLabel} (${thread.brand})
- 채널: ${channelLabel} (${thread.channel})
- 채널 유형: ${chatMode ? "채팅 (간결한 답변)" : "이메일/게시판 (풀 답변)"}
- 고객 이름: ${thread.customer_name ?? "(알 수 없음)"}
- 고객 연락처: ${thread.customer_handle ?? "(알 수 없음)"}
- 제목: ${thread.subject ?? "(없음)"}

이 메타데이터를 바탕으로 스킬의 규칙에 따라 답변 초안을 생성한다. 브랜드는 이미 확정돼 있으므로 재질문하지 말 것.`;

  const userPrompt = `아래는 고객과의 대화 내역이다. 가장 최근 고객 메시지에 대한 답변 초안을 작성하라.

<대화내역>
${formatMessages(messages)}
</대화내역>

반드시 아래 JSON 형식으로만 응답하라. 마크다운 코드블록 없이 순수 JSON만 출력한다:

{
  "draft": "복사 가능한 답변 전문",
  "rationale": "판단 근거 한 문장",
  "needsConfirmation": ["대표 확인 필요 항목 (없으면 빈 배열)"]
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude 응답 파싱 실패: text 블록 없음");
  }

  const raw = textBlock.text.trim();
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as DraftResult;
    return {
      draft: parsed.draft ?? "",
      rationale: parsed.rationale ?? "",
      needsConfirmation: parsed.needsConfirmation ?? [],
    };
  } catch {
    // JSON 파싱 실패 시 텍스트 그대로 반환
    return {
      draft: cleaned,
      rationale: "JSON 파싱 실패 — 원본 응답 그대로 반환",
      needsConfirmation: [],
    };
  }
}
