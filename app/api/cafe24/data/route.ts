import { getDashboardData } from "@/lib/cafe24Data";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { NextResponse } from "next/server";

export async function GET() {
  const token = await getValidC24Token();

  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  try {
    const data = await getDashboardData(token);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("[Cafe24] data fetch error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
