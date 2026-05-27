/**
 * 인플루언서 프로필 사진 영구화 cron.
 *
 * profileImage가 비어 있거나(=등록 시 미수집) 라이브 프록시(/api/...)에 의존하는 인플루언서를
 * 골라, 사진을 한 번 받아 Supabase Storage(public)에 올리고 그 **영구 URL**을 박아 넣는다.
 * → 카드가 매번 인스타를 라이브로 긁지 않아도 됨(들쭉날쭉/이니셜 fallback 해소). 신규 등록도 자동 커버.
 *
 * ⚠️ edge 런타임: 인스타가 Vercel serverless egress IP를 막으므로 Cloudflare 네트워크로 해석.
 * 한 번에 다 처리하면 시간 초과 → 회당 MAX_PER_RUN 건만(매일 반복되며 점진 충전).
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { captureAvatarToStorage } from "@/lib/influencer/avatarResolve";
import { INFLUENCERS_KEY, type StoredInfluencer } from "@/lib/influencer/register";

export const runtime = "edge";

const MAX_PER_RUN = 25;

/** 영구 저장이 필요한가 — 비었거나 라이브 프록시 경로면 채운다. 사용자가 박은 http URL은 보존. */
function needsCapture(profileImage: string): boolean {
  const v = (profileImage || "").trim();
  if (!v) return true;
  if (v.startsWith("/")) return true; // /api/influencer/avatar?... 같은 라이브 프록시
  return false;
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "DB 미설정" }), { status: 500 });
  }
  const supabase = createClient(url, key);

  // 인플루언서 리스트(kv) 로드
  const { data: row } = await supabase.from("kv_store").select("data").eq("key", INFLUENCERS_KEY).maybeSingle();
  const list = (Array.isArray(row?.data) ? row!.data : []) as StoredInfluencer[];

  const targets = list.filter((inf) => needsCapture(inf.profileImage)).slice(0, MAX_PER_RUN);
  let filled = 0;
  let failed = 0;

  for (const inf of targets) {
    const permanent = await captureAvatarToStorage(supabase, inf.platform, inf.handle);
    if (permanent) {
      inf.profileImage = permanent;
      inf.updatedAt = new Date().toISOString();
      filled++;
    } else {
      failed++;
    }
  }

  if (filled > 0) {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key: INFLUENCERS_KEY, data: list, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      return new Response(JSON.stringify({ error: `저장 실패: ${error.message}`, filled, failed }), { status: 500 });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, candidates: list.filter((i) => needsCapture(i.profileImage)).length, processed: targets.length, filled, failed }),
    { headers: { "Content-Type": "application/json" } },
  );
}
