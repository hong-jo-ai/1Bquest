import { appendTurn } from "@/lib/mori/memory";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(req: Request) {
  const { user, assistant } = (await req.json().catch(() => ({}))) as {
    user?: string;
    assistant?: string;
  };
  const userText = String(user ?? "").trim();
  const assistantText = String(assistant ?? "").trim();

  if (!userText || !assistantText) return Response.json({ ok: false }, { status: 400 });

  await appendTurn(userText, assistantText);
  return Response.json({ ok: true });
}
