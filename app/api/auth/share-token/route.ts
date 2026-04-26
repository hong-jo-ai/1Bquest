import { NextRequest, NextResponse } from "next/server";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

/**
 * 다른 로컬 앱(products 관리 등)이 카페24 access token을 가져갈 수 있는 엔드포인트.
 * access token은 일회용이 아니므로 여러 앱에서 동시에 사용 가능.
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== "paulvice2026") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const accessToken = await getAccessTokenFromStore();
    if (!accessToken) {
      return NextResponse.json(
        { error: "카페24 인증이 필요합니다. 대시보드에서 먼저 로그인하세요." },
        { status: 401 }
      );
    }
    return NextResponse.json({ access_token: accessToken });
  } catch (e) {
    return NextResponse.json(
      { error: "토큰 가져오기 실패", detail: String(e) },
      { status: 500 }
    );
  }
}
