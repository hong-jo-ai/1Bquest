import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  // 레거시 쿠키 제거 (호환)
  const cookieStore = await cookies();
  cookieStore.delete("c24_at");
  cookieStore.delete("c24_rt");

  // Supabase SSOT 에서 토큰 삭제
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const db = createClient(url, key);
    await db.from("kv_store").delete().eq("key", "cafe24_refresh_token");
  }

  redirect("/");
}
