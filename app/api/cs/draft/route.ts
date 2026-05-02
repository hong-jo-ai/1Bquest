import { generateDraft } from "@/lib/cs/draft";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { threadId, operatorNotes } = (await req.json()) as {
    threadId?: string;
    operatorNotes?: string;
  };
  if (!threadId) {
    return Response.json({ error: "threadId required" }, { status: 400 });
  }
  try {
    const result = await generateDraft(threadId, { operatorNotes });
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
