import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

// GA4 Property ID를 쿠키에 저장
export async function POST(req: NextRequest) {
  const { propertyId } = await req.json() as { propertyId: string };

  if (!propertyId || !/^\d+$/.test(propertyId.trim())) {
    return Response.json({ error: "올바른 Property ID를 입력하세요 (숫자만)" }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set("ga4_prop", propertyId.trim(), {
    httpOnly: true,
    secure: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });

  return Response.json({ ok: true, propertyId: propertyId.trim() });
}

export async function GET() {
  const cookieStore = await cookies();
  const propertyId = cookieStore.get("ga4_prop")?.value ?? "";
  return Response.json({ propertyId });
}
