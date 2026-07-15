/**
 * 인바운드 IG DM 자동판별 (인플루언서 파이프라인 Phase 2).
 *
 * 새 인스타 DM(인바운드)이 들어오면 → 등록 인플루언서인지 매칭 → 감정분석 →
 * 상태 자동전진(dm_sent→replied, replied+긍정→negotiating) → 텔레그램 알림.
 * instagramIngest 에서 "새로 삽입된 인바운드 메시지"에만 호출된다(중복 알림 방지).
 *
 * 로스터는 폴바이스 전용(paulvice_influencers_v1). 해리엇은 스킵.
 */
import { getInfluencerByHandle, patchInfluencerByHandle } from "./register";
import { sendTelegramMessage } from "@/lib/cs/telegram";

// dmTemplates.analyzeSentiment 과 동일 취지의 경량 휴리스틱(클라 모듈 의존 회피 위해 서버측 인라인).
const POSITIVE = ["좋아요", "감사", "해볼게요", "관심", "보내주세요", "좋아", "협찬", "가능", "네", "ㅎㅎ", "😊", "❤️", "💜", "✨", "ok", "okay", "yes", "sure", "협업", "해요"];
const NEGATIVE = ["안돼요", "힘들", "거절", "괜찮아요", "죄송", "못해요", "노", "no", "바빠", "다음에", "어렵"];

function sentiment(text: string): "positive" | "negative" | "neutral" {
  const lower = (text || "").toLowerCase();
  const pos = POSITIVE.filter((k) => lower.includes(k)).length;
  const neg = NEGATIVE.filter((k) => lower.includes(k)).length;
  if (neg > pos) return "negative";
  if (pos > 0) return "positive";
  return "neutral";
}

const PRE_REPLY = ["discovered", "reviewing", "approved", "dm_sent"];

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 인바운드 DM 1건 처리. 등록 인플루언서가 아니면 조용히 리턴.
 * ingest 를 절대 깨지 않도록 호출부에서 try/catch 로 감쌀 것.
 */
export async function handleInfluencerInbound(opts: {
  brand: string;
  handle?: string;
  text: string;
}): Promise<{ matched: boolean; advanced?: boolean }> {
  if (opts.brand !== "paulvice") return { matched: false };
  const handle = String(opts.handle ?? "").replace(/^@/, "").trim();
  if (!handle) return { matched: false };

  const inf = await getInfluencerByHandle(handle);
  if (!inf) return { matched: false }; // 등록 인플루언서 아님 → 일반 CS로만 남음

  const s = sentiment(opts.text);
  let newStatus = inf.status;
  if (PRE_REPLY.includes(inf.status)) newStatus = "replied";
  else if (inf.status === "replied" && s === "positive") newStatus = "negotiating";
  const advanced = newStatus !== inf.status;

  if (advanced) {
    await patchInfluencerByHandle(handle, { status: newStatus });
  }

  const emoji = s === "positive" ? "🟢" : s === "negative" ? "🔴" : "⚪";
  const nameSuffix = inf.name && inf.name.toLowerCase() !== handle.toLowerCase() ? ` (${esc(inf.name)})` : "";
  const statusLine = advanced
    ? `상태: ${inf.status} → <b>${newStatus}</b>`
    : `상태: ${inf.status}`;
  await sendTelegramMessage(
    `📣 <b>인플루언서 답장</b> ${emoji}\n@${esc(handle)}${nameSuffix}\n“${esc(opts.text.slice(0, 140))}”\n${statusLine}`,
    { buttons: [{ text: "인플루언서 관리 열기", url: "https://paulvice-dashboard.vercel.app/tools/influencer" }] },
  );

  return { matched: true, advanced };
}
