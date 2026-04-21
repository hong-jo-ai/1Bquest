import { listProposalTemplates, createProposalTemplate } from "@/lib/groupBuying/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const templates = await listProposalTemplates();
    return Response.json({ templates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const template = await createProposalTemplate({
      name: body.name,
      platform: body.platform ?? "all",
      body: body.body ?? "",
      notes: body.notes ?? null,
      sort_order: body.sort_order ?? 0,
    });
    return Response.json({ template });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
