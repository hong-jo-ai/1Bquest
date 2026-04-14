import { type NextRequest } from "next/server";
import { getMetaAppCredentials } from "@/lib/cs/instagramClient";
import type { CsBrandId } from "@/lib/cs/types";

/**
 * GET /api/cs/auth/instagram/start?brand=paulvice
 * 브랜드별 Meta 앱으로 OAuth 리다이렉트.
 */
export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  if (brand !== "paulvice" && brand !== "harriot") {
    return Response.json(
      { error: "brand must be paulvice or harriot" },
      { status: 400 }
    );
  }

  const { appId } = getMetaAppCredentials(brand as CsBrandId);
  if (!appId) {
    return Response.json(
      {
        error: `${brand} Meta 앱 ID 누락. Vercel env에 ${brand === "harriot" ? "META_APP_ID_HARRIOT" : "META_APP_ID"}를 설정하세요.`,
      },
      { status: 500 }
    );
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/cs/auth/instagram/callback`;

  const params = new URLSearchParams({
    client_id: appId,
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
