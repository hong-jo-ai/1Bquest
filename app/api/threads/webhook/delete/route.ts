import { type NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  console.log("[Threads] data deletion callback received");
  // Meta requires a confirmation_code in response
  return Response.json({
    url: "https://paulvice-dashboard.vercel.app",
    confirmation_code: crypto.randomUUID(),
  });
}
