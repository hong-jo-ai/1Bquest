"use client";
import { useState, useRef } from "react";

interface Media { type: "image" | "video"; url: string }
const GOLD = "#c9a96a", DARK = "#1a1a1a";

type Lang = "ko" | "en";

const STR = {
  ko: {
    headerSub: (b: string) => `${b} · 후기 작성`,
    rewardBanner: (r: { text: string; photo: string; video: string }) => `후기 작성하고 적립금 받으세요 — 글 ${r.text} · 📷 사진 ${r.photo} · 🎬 동영상 ${r.video}`,
    ratingPrompt: "직접 써보시니 어떠셨어요?",
    ratingHint: "별점을 눌러주세요",
    ratingWords: ["", "아쉬워요", "그저 그래요", "괜찮아요", "좋아요 👍", "최고예요! 🙌"],
    reviewLabel: "한 줄이면 충분해요",
    aspectHint: "👇 눌러서 시작해 보세요",
    aspects: ["디자인", "가성비", "사이즈", "선물용", "배송"],
    reviewPlaceholder: "예) 생각보다 고급스럽고 가벼워서 매일 차게 돼요. 선물했는데 정말 좋아하더라고요!",
    mediaLabel: "사진 / 동영상 첨부",
    mediaMore: "사진·동영상은 적립금 UP ⬆",
    uploadIdle: "📷 사진 또는 🎬 동영상 추가",
    uploading: "업로드 중…",
    nameLabel: "표시 이름",
    namePlaceholder: "예) 홍길동",
    submit: "후기 등록하고 적립금 받기",
    submitting: "등록 중…",
    footer: "로그인 불필요 · 작성하신 후기는 상품 페이지에 노출될 수 있습니다.",
    errRating: "별점을 선택해 주세요.",
    errUpload: "업로드 실패",
    errGeneric: "오류가 발생했습니다",
    errNetwork: "네트워크 오류. 다시 시도해 주세요.",
    thanks: "감사합니다!",
    thanksBody: (product: string, reward: string) => `<b>${product}</b> 후기가 등록되었습니다.<br/>적립금 <b style="color:${GOLD}">${reward}</b>을 곧 지급해 드릴게요.`,
    back: (b: string) => `${b} 홈으로 →`,
  },
  en: {
    headerSub: (b: string) => `${b} · WRITE A REVIEW`,
    rewardBanner: (r: { text: string; photo: string; video: string }) => `Get a reward for your review — Text ${r.text} · 📷 Photo ${r.photo} · 🎬 Video ${r.video}`,
    ratingPrompt: "How was it for you?",
    ratingHint: "Tap to rate",
    ratingWords: ["", "Poor", "Fair", "Good", "Great 👍", "Love it! 🙌"],
    reviewLabel: "One line is enough",
    aspectHint: "👇 Tap to get started",
    aspects: ["Design", "Value", "Fit", "As a gift", "Shipping"],
    reviewPlaceholder: "e.g. Lighter and more premium than I expected — I wear it every day. Gave one as a gift and they loved it!",
    mediaLabel: "Add photos / video",
    mediaMore: "Photo/video = bigger reward ⬆",
    uploadIdle: "📷  Tap to add photo or 🎬 video",
    uploading: "Uploading…",
    nameLabel: "Display name",
    namePlaceholder: "e.g. James K.",
    submit: "Submit & get reward",
    submitting: "Submitting…",
    footer: "No login required · Your review may appear on the product page.",
    errRating: "Please tap a star rating.",
    errUpload: "Upload failed",
    errGeneric: "Something went wrong",
    errNetwork: "Network error. Please try again.",
    thanks: "Thank you!",
    thanksBody: (product: string, reward: string) => `Your review for <b>${product}</b> has been received.<br/>We&apos;ll send your <b style="color:${GOLD}">${reward} reward</b> shortly.`,
    back: (b: string) => `Back to ${b} →`,
  },
} as const;

export default function ReviewForm({ token, productName, name: initialName, reward, lang = "en", homeUrl = "https://harriotwatches.com", brand = "HARRIOT" }: {
  token: string; productName: string; name: string;
  reward: { text: string; photo: string; video: string };
  lang?: Lang; homeUrl?: string; brand?: string;
}) {
  const t = STR[lang];
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [content, setContent] = useState("");
  const [name, setName] = useState(initialName);
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { reward: string }>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const hasVideo = media.some((m) => m.type === "video");
  const hasPhoto = media.some((m) => m.type === "image");
  const tier = hasVideo ? reward.video : hasPhoto ? reward.photo : reward.text;

  function addAspect(a: string) {
    setContent((c) => (c.trim() ? c.replace(/\s+$/, "") + " " : "") + a + " ");
    setTimeout(() => textRef.current?.focus(), 0);
  }

  /**
   * 업로드는 **Supabase 로 직접** 올린다. 우리 API 를 거치면 Vercel 함수 페이로드 한도
   * (4.5MB)에 걸려 동영상이 전부 실패한다 — 실측 4MB 통과 / 6MB 부터 413.
   * 서버는 '올릴 자리'(서명 URL)만 내주고 파일은 지나가지 않는다.
   *
   * ⚠️ 예전엔 413 응답이 JSON 이 아니라(HTML) r.json() 이 throw 했고, catch 가 없어
   *    에러 메시지도 없이 조용히 아무 일도 안 일어났다. 그래서 고객은 "안 된다"고만 느꼈다.
   *    이제 모든 실패에 이유를 보여준다.
   */
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setErr(""); setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10 - media.length)) {
        try {
          const r = await fetch(`/api/reviews/upload-url?t=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mime: file.type, size: file.size, filename: file.name }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.uploadUrl) { setErr(j.error || t.errUpload); continue; }

          const up = await fetch(j.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": j.mime },
            body: file,
          });
          if (!up.ok) { setErr(t.errUpload); continue; }
          setMedia((m) => [...m, { type: j.type, url: j.url }]);
        } catch {
          setErr(t.errUpload);
        }
      }
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function submit() {
    if (!rating) { setErr(t.errRating); textRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    setErr(""); setSubmitting(true);
    try {
      const r = await fetch("/api/reviews/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, content, name, media }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || t.errGeneric); return; }
      setDone({ reward: tier });
    } catch { setErr(t.errNetwork); }
    finally { setSubmitting(false); }
  }

  const wrap: React.CSSProperties = { minHeight: "100vh", background: "#f5f5f5", fontFamily: "system-ui,-apple-system,Arial", padding: "0 0 40px", color: DARK };
  const card: React.CSSProperties = { maxWidth: 460, margin: "0 auto", background: "#fff", minHeight: "100vh" };

  if (done) {
    return (
      <main style={wrap}><div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 48 }}>🙏</div>
        <h1 style={{ fontSize: 22, margin: "16px 0 8px" }}>{t.thanks}</h1>
        <p style={{ color: "#666", lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: t.thanksBody(productName, done.reward) }} />
        <a href={homeUrl} style={{ marginTop: 24, color: GOLD, textDecoration: "underline", fontSize: 14 }}>{t.back(brand)}</a>
      </div></main>
    );
  }

  const ratingWord = (hover || rating) ? t.ratingWords[hover || rating] : "";

  return (
    <main style={wrap}><div style={card}>
      <div style={{ background: DARK, color: "#fff", padding: "26px 24px", textAlign: "center" }}>
        <div style={{ color: GOLD, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>{t.headerSub(brand)}</div>
        <div style={{ fontSize: 19, fontWeight: 600 }}>{productName}</div>
      </div>

      <div style={{ background: "#faf6ee", borderBottom: "1px solid #eee", padding: "12px 24px", fontSize: 13, color: "#7a6a44", textAlign: "center" }}>
        {t.rewardBanner(reward)}
      </div>

      <div style={{ padding: 24 }}>
        {/* 별점 — 큼직하게 먼저, 선택 시 한마디 표시 */}
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{t.ratingPrompt}</div>
          <div style={{ fontSize: 44, margin: "10px 0 2px", letterSpacing: 6 }} onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((s) => (
              <span key={s} role="button" aria-label={`${s}`} onClick={() => setRating(s)} onMouseEnter={() => setHover(s)}
                style={{ cursor: "pointer", color: (hover || rating) >= s ? GOLD : "#ddd" }}>★</span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: ratingWord ? GOLD : "#bbb", fontWeight: 600, height: 18 }}>{ratingWord || t.ratingHint}</div>
        </div>

        {/* 글 — 질문 칩으로 빈 페이지 공포 제거 */}
        <label style={{ fontSize: 14, fontWeight: 600, marginTop: 20, display: "block" }}>{t.reviewLabel}</label>
        <div style={{ fontSize: 12, color: "#999", margin: "6px 0 8px" }}>{t.aspectHint}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
          {t.aspects.map((a) => (
            <button key={a} type="button" onClick={() => addAspect(a)}
              style={{ padding: "7px 13px", border: `1px solid ${GOLD}`, background: "#fffdf8", color: "#7a6a44", borderRadius: 999, fontSize: 13, cursor: "pointer" }}>
              {a}
            </button>
          ))}
        </div>
        <textarea ref={textRef} value={content} onChange={(e) => setContent(e.target.value)} rows={4}
          placeholder={t.reviewPlaceholder}
          style={{ width: "100%", padding: 12, border: "1px solid #ddd", borderRadius: 8, fontSize: 15, resize: "vertical", boxSizing: "border-box" }} />

        {/* 미디어 — capture 미지정: 모바일에서 카메라/앨범 선택 가능 */}
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t.mediaLabel} <span style={{ color: GOLD, fontWeight: 600, fontSize: 12 }}>{t.mediaMore}</span></label>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={(e) => onFiles(e.target.files)} style={{ display: "none" }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || media.length >= 10}
            style={{ marginTop: 8, width: "100%", padding: "14px", border: `1.5px dashed ${GOLD}`, background: "#fffdf8", color: "#7a6a44", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>
            {uploading ? t.uploading : t.uploadIdle}
          </button>
          {media.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {media.map((m, i) => (
                <div key={i} style={{ position: "relative", width: 76, height: 76, borderRadius: 8, overflow: "hidden", background: "#000" }}>
                  {m.type === "video"
                    ? <video src={m.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
                    : <img src={m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  <button type="button" onClick={() => setMedia((arr) => arr.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.6)", color: "#fff", border: 0, borderRadius: "50%", width: 20, height: 20, cursor: "pointer", lineHeight: "18px" }}>×</button>
                  {m.type === "video" && <span style={{ position: "absolute", bottom: 2, left: 4, color: "#fff", fontSize: 11 }}>🎬</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 이름 */}
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t.nameLabel}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder}
            style={{ width: "100%", marginTop: 8, padding: 12, border: "1px solid #ddd", borderRadius: 8, fontSize: 15, boxSizing: "border-box" }} />
        </div>

        {err && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 14 }}>{err}</p>}

        <button type="button" onClick={submit} disabled={submitting || uploading}
          style={{ marginTop: 22, width: "100%", padding: 16, background: DARK, color: "#fff", border: 0, borderRadius: 8, fontSize: 15, fontWeight: 600, letterSpacing: .5, cursor: "pointer", opacity: submitting ? .6 : 1 }}>
          {submitting ? t.submitting : t.submit}
        </button>
        <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 12 }}>{t.footer}</p>
      </div>
    </div></main>
  );
}
