import { type NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  console.log("[Threads] deauthorize callback received");
  return Response.json({ success: true });
}
