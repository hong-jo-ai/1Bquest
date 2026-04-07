import { type NextRequest } from "next/server";

// 추후 구현 예정
export async function GET(req: NextRequest) {
  return Response.redirect(new URL("/tools/threads", req.url));
}
