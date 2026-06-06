import { isHomeAppIconKind, renderHomeAppIcon } from "@/lib/homeAppIcons";

export const runtime = "edge";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; size: string }> },
) {
  const { kind, size } = await params;
  const numericSize = Number(size);

  if (!isHomeAppIconKind(kind) || !Number.isFinite(numericSize)) {
    return new Response("Not found", { status: 404 });
  }

  const boundedSize = Math.min(Math.max(Math.round(numericSize), 32), 1024);
  return renderHomeAppIcon(kind, boundedSize);
}
