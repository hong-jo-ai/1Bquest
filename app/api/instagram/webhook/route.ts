import { type NextRequest } from "next/server";

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN ?? "paulvice_instagram_verify_2026";

// Meta Webhook 검증 (GET)
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// Webhook 이벤트 수신 (POST)
export async function POST(req: NextRequest) {
  console.log("[Instagram Webhook] event received");
  return Response.json({ received: true });
}
