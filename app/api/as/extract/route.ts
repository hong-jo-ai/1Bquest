import { type NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getThread } from "@/lib/cs/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/as/extract { threadId }
 * CS 대화 내용에서 AS 접수 필드(고객명·연락처·반송주소·모델·증상)를 AI로 추출.
 * 대화에 명시된 것만 반환(없으면 null) — 폼의 빈 칸만 채우는 용도.
 */
export async function POST(req: NextRequest) {
  try {
    const { threadId } = (await req.json()) as { threadId?: string };
    if (!threadId) return NextResponse.json({ error: "threadId 필요" }, { status: 400 });
    const data = await getThread(threadId);
    if (!data) return NextResponse.json({ error: "thread not found" }, { status: 404 });

    const convo = data.messages
      .map((m) => `[${m.direction === "in" ? "고객" : "운영자"}] ${(m.body_text ?? "").slice(0, 1200)}`)
      .join("\n---\n")
      .slice(0, 12000);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY 없음" }, { status: 500 });

    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system:
        "너는 시계 브랜드의 AS 접수 담당자다. 고객과의 대화에서 AS 접수에 필요한 정보를 추출한다. " +
        "대화에 명시된 것만 추출하고 절대 추측하지 마라. 반드시 JSON 하나만 출력한다.",
      messages: [
        {
          role: "user",
          content:
            `다음 CS 대화에서 AS 접수 정보를 추출해 JSON으로만 답하라.\n` +
            `형식: {"customerName":string|null,"customerPhone":string|null(하이픈 포함),"customerAddress":string|null(도로명+상세, 우편번호 있으면 포함),"model":string|null(제품/모델명),"symptom":string|null(증상 한 줄),"note":string|null(구매시기 등 참고사항)}\n\n대화:\n${convo}`,
        },
      ],
    });
    const raw = (res.content[0] as { text: string }).text.trim();
    const jsonStr = raw.startsWith("{")
      ? raw
      : raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const p = JSON.parse(jsonStr) as Record<string, string | null>;
    return NextResponse.json({
      ok: true,
      fields: {
        customerName: p.customerName ?? null,
        customerPhone: p.customerPhone ?? null,
        customerAddress: p.customerAddress ?? null,
        model: p.model ?? null,
        symptom: p.symptom ?? null,
        note: p.note ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
