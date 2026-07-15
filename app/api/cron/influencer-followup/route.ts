/**
 * 인플루언서 팔로업 자동화 크론 (Phase 3).
 *
 * DM은 보냈는데(status=dm_sent) N일째 답이 없는 인플루언서를 찾아 텔레그램으로
 * 넛지(딥링크 포함)한다. 인스타 정책상 콜드/미응답 팔로업은 API 자동발송이 막히므로
 * "사람이 원클릭 발송"하도록 리마인드만 한다. 한 번 넛지하면 RENUDGE_DAYS 동안 재알림 안 함.
 *
 * 보정(self-heal): dm_sent 인데 실제 인바운드 답장(cs_messages)이 있으면 넛지 대신
 * 상태를 replied 로 올린다(과거 답장이 Phase2 배포 전 유입돼 상태 미반영된 케이스 정리).
 */
import { createClient } from "@supabase/supabase-js";
import { INFLUENCERS_KEY, type StoredInfluencer } from "@/lib/influencer/register";
import { withCron } from "@/lib/cron/withCron";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STALE_DAYS = 3; // DM 후 3일 무응답이면 팔로업 대상
const RENUDGE_DAYS = 4; // 한 번 넛지하면 4일 뒤 재알림
const MAX = 12;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const norm = (h: string) => String(h ?? "").replace(/^@/, "").toLowerCase();

export const GET = withCron("influencer-followup", async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "DB 미설정" });
  const sb = createClient(url, key);

  const { data } = await sb.from("kv_store").select("data").eq("key", INFLUENCERS_KEY).maybeSingle();
  const list: StoredInfluencer[] = Array.isArray(data?.data) ? (data!.data as StoredInfluencer[]) : [];
  const now = Date.now();
  const staleMs = STALE_DAYS * 86_400_000;
  const renudgeMs = RENUDGE_DAYS * 86_400_000;

  const candidates = list
    .filter((inf) => {
      if (inf.status !== "dm_sent") return false;
      const updated = new Date(inf.updatedAt || inf.addedAt || 0).getTime();
      if (now - updated < staleMs) return false;
      const last = inf.lastFollowupNudgeAt ? new Date(inf.lastFollowupNudgeAt).getTime() : 0;
      if (last && now - last < renudgeMs) return false;
      return true;
    })
    .slice(0, MAX);

  if (!candidates.length) return Response.json({ ok: true, nudged: 0, reconciled: 0 });

  // 실제 인바운드(답장) 있는 후보 가려내기 → 넛지 대신 상태 보정
  const candHandles = new Set(candidates.map((c) => norm(c.handle)));
  const { data: threads } = await sb
    .from("cs_threads")
    .select("id, customer_handle")
    .eq("channel", "ig_dm")
    .eq("brand", "paulvice");
  const threadIdsByHandle = new Map<string, string[]>();
  for (const t of threads ?? []) {
    const h = norm(t.customer_handle as string);
    if (!candHandles.has(h)) continue;
    if (!threadIdsByHandle.has(h)) threadIdsByHandle.set(h, []);
    threadIdsByHandle.get(h)!.push(t.id as string);
  }
  const allThreadIds = [...threadIdsByHandle.values()].flat();
  const inboundHandles = new Set<string>();
  if (allThreadIds.length) {
    const { data: inMsgs } = await sb
      .from("cs_messages")
      .select("thread_id")
      .in("thread_id", allThreadIds)
      .eq("direction", "in");
    const inboundThreadIds = new Set((inMsgs ?? []).map((m) => m.thread_id as string));
    for (const [h, tids] of threadIdsByHandle) {
      if (tids.some((id) => inboundThreadIds.has(id))) inboundHandles.add(h);
    }
  }

  const replied = candidates.filter((c) => inboundHandles.has(norm(c.handle))); // 이미 답장 → 보정
  const noReply = candidates.filter((c) => !inboundHandles.has(norm(c.handle))); // 진짜 무응답 → 넛지

  if (noReply.length) {
    const lines = noReply.map((inf) => {
      const days = Math.floor((now - new Date(inf.updatedAt || inf.addedAt || 0).getTime()) / 86_400_000);
      const nm = inf.name && inf.name !== inf.handle ? ` (${esc(inf.name)})` : "";
      return `• @${esc(inf.handle)}${nm} — ${days}일째 무응답\n  https://ig.me/m/${inf.handle}`;
    });
    await sendTelegramMessage(
      `⏰ <b>인플루언서 팔로업 알림</b>\nDM 보냈는데 답이 없는 <b>${noReply.length}명</b>이에요. 한 번 더 가볍게 여쭤볼까요?\n\n${lines.join("\n")}\n\n인플루언서 관리에서 대화를 열고 “AI 초안 → 팔로업”으로 문안을 받으실 수 있어요.`,
      { buttons: [{ text: "인플루언서 관리 열기", url: "https://paulvice-dashboard.vercel.app/tools/influencer" }] },
    );
  }

  // 배치 저장: 답장한 후보는 replied 로 보정, 넛지한 후보는 lastFollowupNudgeAt 기록
  const repliedIds = new Set(replied.map((s) => s.id));
  const nudgedIds = new Set(noReply.map((s) => s.id));
  if (repliedIds.size || nudgedIds.size) {
    const stamp = new Date().toISOString();
    const updated = list.map((inf) => {
      if (repliedIds.has(inf.id)) return { ...inf, status: "replied", updatedAt: stamp };
      if (nudgedIds.has(inf.id)) return { ...inf, lastFollowupNudgeAt: stamp };
      return inf;
    });
    await sb.from("kv_store").upsert({ key: INFLUENCERS_KEY, data: updated, updated_at: stamp }, { onConflict: "key" });
  }

  return Response.json({ ok: true, nudged: noReply.length, reconciled: replied.length });
});
