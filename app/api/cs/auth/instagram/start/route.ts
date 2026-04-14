import { type NextRequest } from "next/server";

const APP_ID = process.env.META_APP_ID ?? "";

/**
 * GET /api/cs/auth/instagram/start?brand=paulvice
 * Facebook OAuth로 리다이렉트. 스코프는 IG DM 관리에 필요한 것들.
 */
export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  if (brand !== "paulvice" && brand !== "harriot") {
    return Response.json(
      { error: "brand must be paulvice or harriot" },
      { status: 400 }
    );
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/cs/auth/instagram/callback`;

  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      "pages_show_list",
      "pages_messaging",
      "pages_read_engagement",
      "business_management",
    ].join(","),
    state: `cs_ig_${brand}`,
    auth_type: "rerequest",
  });

  return Response.redirect(
    `https://www.facebook.com/v22.0/dialog/oauth?${params}`
  );
}
