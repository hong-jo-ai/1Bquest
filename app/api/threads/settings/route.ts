import { NextRequest, NextResponse } from "next/server";
import { getAutopostSettings, saveAutopostSettings, type AutopostSettings } from "@/lib/threadsScheduler";
import type { BrandId } from "@/lib/threadsBrands";

const VALID_BRANDS = new Set(["paulvice", "harriot", "hongsungjo"]);

export async function GET() {
  const settings = await getAutopostSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { brand, postsPerDay } = body as { brand: BrandId; postsPerDay: number };

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json({ error: "잘못된 브랜드" }, { status: 400 });
  }
  if (typeof postsPerDay !== "number" || postsPerDay < 0 || postsPerDay > 12) {
    return NextResponse.json({ error: "게시 횟수는 0~12 사이여야 합니다" }, { status: 400 });
  }

  const settings = await getAutopostSettings();
  settings[brand] = { postsPerDay: Math.round(postsPerDay) };
  await saveAutopostSettings(settings);

  return NextResponse.json({ success: true, settings });
}
