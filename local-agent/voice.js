/**
 * 음성 출력(TTS) 공용 헬퍼 — 아이맥 측. OpenAI gpt-4o-mini-tts → ogg/opus → 텔레그램 sendVoice.
 * 클로드 브리지가 "음성으로 받은 지시"의 결과/확인질문을 음성노트로도 회신할 때 사용.
 * 필요 env: OPENAI_API_KEY, TELEGRAM_BOT_TOKEN (호출자가 .env.local 등에서 로드).
 */
const VOICE = process.env.MORI_OPENAI_VOICE || "shimmer";
const TTS_INSTRUCTIONS =
  "한국어로 자연스럽게 말하세요. 책 읽는 톤이 아니라 옆자리 동료가 짧게 보고·지시하는 톤. 차분하고 빠릿하게, 숫자는 또렷하게.";

/** 텍스트 → ogg/opus 오디오 Buffer (텔레그램 sendVoice 호환). 실패 시 null. */
async function ttsOgg(text) {
  const key = process.env.OPENAI_API_KEY;
  const t = (text || "").trim();
  if (!key || !t) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: VOICE,
        input: t.slice(0, 1200),
        response_format: "opus", // ogg/opus → sendVoice 직접 호환
        instructions: TTS_INSTRUCTIONS,
      }),
    });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** 텔레그램 음성노트 전송. ogg Buffer + 선택 캡션. 성공 여부 boolean. */
async function sendVoice(chatId, ogg, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !ogg) return false;
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("voice", new Blob([new Uint8Array(ogg)], { type: "audio/ogg" }), "voice.ogg");
    if (caption) form.append("caption", String(caption).slice(0, 1024));
    const r = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: "POST", body: form });
    return r.ok;
  } catch {
    return false;
  }
}

/** 텍스트를 음성으로 만들어 바로 전송(편의). 실패해도 throw 안 함. */
async function speak(chatId, text, caption) {
  const ogg = await ttsOgg(text);
  if (!ogg) return false;
  return sendVoice(chatId, ogg, caption);
}

module.exports = { ttsOgg, sendVoice, speak };
