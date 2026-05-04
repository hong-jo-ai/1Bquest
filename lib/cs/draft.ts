import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { getThread } from "./store";
import { getReplyExamples, type ReplyExample } from "./replyExamples";
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

function formatExamples(examples: ReplyExample[]): string {
  if (examples.length === 0) return "";
  const blocks = examples
    .map(
      (e, i) =>
        `예시 ${i + 1}\n[고객]\n${e.customer.slice(0, 1200)}\n\n[내 답변]\n${e.reply.slice(0, 1500)}`
    )
    .join("\n\n---\n\n");
  return `\n\n## 과거 답변 학습 예시 (같은 브랜드·채널의 최근 답변)\n\n아래는 같은 브랜드·채널에서 내가 실제로 보낸 답변 예시다. 톤·길이·구조·서명 유무를 이 예시들을 참고해서 일관되게 맞춰라. 내용은 그대로 베끼지 말고, 현재 문의에 맞게 작성하되 스타일만 따른다.\n\n${blocks}`;
}

const CRISP_TONE_BLOCK = `
## Crisp 채팅 톤 — 반드시 준수

Crisp는 웹사이트 실시간 채팅 위젯이다. 이메일 톤은 부적절하다.

- **서명 없음** — "폴바이스 대표 홍성조 드림", "Best regards" 등 서명 절대 작성 금지
- **거창한 인사말 없음** — "안녕하세요 😊 폴바이스입니다!", "안녕하십니까 해리엇 대표 홍성조입니다" 같은 풀 인사말 금지. 필요하면 "안녕하세요." 한 마디 정도만
- **이모지 없음** — 어떤 브랜드든 이모지 사용 금지
- **짧은 이메일 톤** — 정중한 존댓말은 유지하되 과하지 않게. 본문은 핵심만 2~5문장
- **마침 인사도 최소화** — "추가 문의 있으시면 편하게 말씀해 주세요" 정도면 충분, 그것조차 어색하면 생략

좋은 예 (폴바이스):
"문의 주셔서 감사합니다. 각인은 한글도 가능하며 최대 5자까지 새겨드립니다. 영문/한글 어느 쪽이든 동일한 폰트로 작업됩니다."

좋은 예 (해리엇):
"문의 주셔서 감사합니다. 각인은 한글도 가능하며 최대 5자까지 가능합니다. 추가로 궁금하신 점 있으시면 말씀해 주십시오."
`;

export interface DraftResult {
  draft: string;
  rationale: string;
  needsConfirmation: string[];
}

export interface DraftOptions {
  /** 운영자가 답변 작성 전 AI 에게 알려주는 핵심 정보/방향. AI 가 이를 반영해 완성된 답변을 작성. */
  operatorNotes?: string;
}

export async function generateDraft(
  threadId: string,
  options: DraftOptions = {}
): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 누락");

  const data = await getThread(threadId);
  if (!data) throw new Error("thread not found");
  const { thread, messages } = data;

  const skill = await loadSkill();
  const client = new Anthropic({ apiKey });

  const brandLabel = BRAND_LABEL[thread.brand];
  const channelLabel = CHANNEL_LABEL[thread.channel];
  const isCrisp = thread.channel === "crisp";
  const chatMode = isChatChannel(thread.channel);

  // 같은 브랜드·채널의 최근 답변 6개를 few-shot 예시로 주입
  const examples = await getReplyExamples(thread.brand, thread.channel, 6);
  const examplesBlock = formatExamples(examples);
  const crispBlock = isCrisp ? CRISP_TONE_BLOCK : "";

  const operatorNote = options.operatorNotes?.trim();
  const operatorBlock = operatorNote
    ? `\n\n## 운영자가 직접 작성한 답변 메모 (반드시 반영)\n\n아래는 대표가 이 문의에 대해 직접 알려준 핵심 정보·방향이다. 이 내용을 누락 없이 반영해서 자연스러운 완성 문장으로 작성하라. 내용을 임의로 추가하거나 추측하지 말 것.\n\n"""\n${operatorNote}\n"""`
    : "";

  const outputOverride = `

---

## 출력 규칙 (이전 모든 출력 형식 지침을 override)

이 시스템에서는 \`submit_draft\` 도구로만 답변을 제출한다. 일반 텍스트로 응답하지 말 것.

- **draft 필드**: 고객에게 그대로 복사·발송할 본문 텍스트만 작성한다.
  - 머리말/안내 문구 금지: "다음은 답변입니다", "초안:", "Here's the draft" 등 절대 금지
  - 메타 헤더 금지: \`[답변 초안]\`, \`[참고]\`, \`---\` 구분선 등 절대 금지
  - draft 끝에 판단 근거나 주석 붙이지 말 것 (그건 rationale 필드에 작성)
  - 운영자가 이 필드를 그대로 발송 버튼으로 보낼 수 있어야 한다
- **rationale 필드**: 판단 근거 한 문장 (운영자만 봄, 고객에겐 안 보임)
- **needsConfirmation 필드**: 운영자 확인 필요 항목 배열 (없으면 \`[]\`)`;

  const systemPrompt = `${skill}${crispBlock}${examplesBlock}

---

## 자동 주입된 메타데이터

- 브랜드: ${brandLabel} (${thread.brand})
- 채널: ${channelLabel} (${thread.channel})
- 채널 유형: ${isCrisp ? "Crisp 웹 채팅 (서명·이모지 없이 짧은 이메일 톤)" : chatMode ? "채팅 (간결한 답변)" : "이메일/게시판 (풀 답변)"}
- 고객 이름: ${thread.customer_name ?? "(알 수 없음)"}
- 고객 연락처: ${thread.customer_handle ?? "(알 수 없음)"}
- 제목: ${thread.subject ?? "(없음)"}

이 메타데이터를 바탕으로 스킬의 규칙에 따라 답변 초안을 생성한다. 브랜드는 이미 확정돼 있으므로 재질문하지 말 것.${operatorBlock}${outputOverride}`;

  const userPrompt = `아래는 고객과의 대화 내역이다. 가장 최근 고객 메시지에 대한 답변을 작성하고 \`submit_draft\` 도구로 제출하라.

<대화내역>
${formatMessages(messages)}
</대화내역>`;

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
    tools: [
      {
        name: "submit_draft",
        description:
          "고객에게 발송할 답변 초안을 제출한다. draft 필드는 그대로 발송 가능한 상태여야 하며, 어떤 메타 헤더나 안내 문구도 포함하지 않는다.",
        input_schema: {
          type: "object",
          properties: {
            draft: {
              type: "string",
              description:
                "고객에게 그대로 발송할 답변 본문. '[답변 초안]', '[참고]', '초안:', '다음은 답변입니다' 같은 머리말/메타 헤더 절대 금지. 판단 근거나 주석도 붙이지 말 것.",
            },
            rationale: {
              type: "string",
              description: "판단 근거 한 문장 (운영자 내부용, 고객에게 보이지 않음).",
            },
            needsConfirmation: {
              type: "array",
              items: { type: "string" },
              description: "운영자가 발송 전에 확인할 필요가 있는 항목들. 없으면 빈 배열.",
            },
          },
          required: ["draft", "rationale", "needsConfirmation"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_draft" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude 응답 파싱 실패: tool_use 블록 없음");
  }

  const input = toolUse.input as Partial<DraftResult>;
  return {
    draft: stripLeakage(input.draft ?? ""),
    rationale: input.rationale ?? "",
    needsConfirmation: input.needsConfirmation ?? [],
  };
}

/**
 * 도구 응답에 SKILL.md 출력 형식이 새어나오는 경우 대비한 안전망.
 * tool use 로 거의 다 잡히지만, 모델이 draft 필드 안에 [답변 초안] 헤더 등을
 * 굳이 박아넣을 가능성에 대비해 후처리.
 */
function stripLeakage(draft: string): string {
  let s = draft;
  // 선두의 "[답변 초안]" 또는 "초안:" 류 헤더 제거
  s = s.replace(/^\s*\[\s*답변\s*초안\s*\]\s*\n+/i, "");
  s = s.replace(/^\s*초안\s*[:：]\s*\n+/i, "");
  s = s.replace(/^\s*draft\s*[:：]\s*\n+/i, "");
  // 끝에 붙은 [참고] / [Note] 블록 제거
  s = s.replace(/\n+\s*\[\s*참고\s*\][\s\S]*$/i, "");
  s = s.replace(/\n+\s*\[\s*note\s*\][\s\S]*$/i, "");
  // 최종 trim
  return s.trim();
}
