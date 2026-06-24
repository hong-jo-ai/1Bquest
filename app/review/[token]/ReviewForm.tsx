"use client";
import { useState, useRef } from "react";

interface Media { type: "image" | "video"; url: string }
const GOLD = "#c9a96a", DARK = "#1a1a1a";

type Lang = "ko" | "en";

const STR = {
  ko: {
    headerSub: "해리엇 · 후기 작성",
    rewardBanner: (r: { text: string; photo: string; video: string }) => `후기 작성하고 적립금 받으세요 — 글 ${r.text} · 사진 ${r.photo} · 동영상 ${r.video}`,
    ratingLabel: "별점",
    reviewLabel: "후기",
    reviewPlaceholder: "해리엇 시계, 어떠세요? 누구를 위해, 왜 구매하셨나요? 솔직한 후기가 다른 분들께 큰 도움이 됩니다.",
    mediaLabel: "사진 / 동영상 첨부",
    mediaMore: "(적립금 더!)",
    uploadIdle: "📷 사진 또는 🎬 동영상 추가",
    uploading: "업로드 중…",
    nameLabel: "표시 이름",
    namePlaceholder: "예) 홍길동",
    submit: "후기 등록",
    submitting: "등록 중…",
    footer: "로그인 불필요 · 작성하신 후기는 상품 페이지에 노출될 수 있습니다.",
    errRating: "별점을 선택해 주세요.",
    errUpload: "업로드 실패",
    errGeneric: "오류가 발생했습니다",
    errNetwork: "네트워크 오류. 다시 시도해 주세요.",
    thanks: "감사합니다!",
    thanksBody: (product: string, reward: string) => `<b>${product}</b> 후기가 등록되었습니다.<br/>적립금 <b style="color:${GOLD}">${reward}</b>을 곧 지급해 드릴게요.`,
    back: "해리엇으로 돌아가기",
  },
  en: {
    headerSub: "HARRIOT · WRITE A REVIEW",
    rewardBanner: (r: { text: string; photo: string; video: string }) => `Get a reward for your review — Text ${r.text} · Photo ${r.photo} · Video ${r.video}`,
    ratingLabel: "Your rating",
    reviewLabel: "Your review",
    reviewPlaceholder: "How is your Harriot watch? Who did you buy it for, and why? Your story helps others.",
    mediaLabel: "Add photos / video",
    mediaMore: "(more reward!)",
    uploadIdle: "📷  Tap to add photo or 🎬 video",
    uploading: "Uploading…",
    nameLabel: "Display name",
    namePlaceholder: "e.g. James K.",
    submit: "Submit review",
    submitting: "Submitting…",
    footer: "No login required · Your review may appear on the product page.",
    errRating: "Please tap a star rating.",
    errUpload: "Upload failed",
    errGeneric: "Something went wrong",
    errNetwork: "Network error. Please try again.",
    thanks: "Thank you!",
    thanksBody: (product: string, reward: string) => `Your review for <b>${product}</b> has been received.<br/>We&apos;ll send your <b style="color:${GOLD}">${reward} reward</b> shortly.`,
    back: "Back to Harriot",
  },
} as const;

export default function ReviewForm({ token, productName, name: initialName, reward, lang = "en", homeUrl = "https://harriotwatches.com" }: {
  token: string; productName: string; name: string;
  reward: { text: string; photo: string; video: string };
  lang?: Lang; homeUrl?: string;
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

  const hasVideo = media.some((m) => m.type === "video");
  const hasPhoto = media.some((m) => m.type === "image");
  const tier = hasVideo ? reward.video : hasPhoto ? reward.photo : reward.text;

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setErr(""); setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10 - media.length)) {
        const fd = new FormData(); fd.append("file", file);
        const r = await fetch(`/api/reviews/upload?t=${encodeURIComponent(token)}`, { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) { setErr(j.error || t.errUpload); continue; }
        setMedia((m) => [...m, { type: j.type, url: j.url }]);
      }
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function submit() {
    if (!rating) { setErr(t.errRating); return; }
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
        <a href={homeUrl} style={{ marginTop: 24, color: GOLD, textDecoration: "underline", fontSize: 14 }}>{t.back}</a>
      </div></main>
    );
  }

  return (
    <main style={wrap}><div style={card}>
      <div style={{ background: DARK, color: "#fff", padding: "26px 24px", textAlign: "center" }}>
        <div style={{ color: GOLD, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>{t.headerSub}</div>
        <div style={{ fontSize: 19, fontWeight: 600 }}>{productName}</div>
      </div>

      <div style={{ background: "#faf6ee", borderBottom: "1px solid #eee", padding: "12px 24px", fontSize: 13, color: "#7a6a44", textAlign: "center" }}>
        {t.rewardBanner(reward)}
      </div>

      <div style={{ padding: 24 }}>
        {/* 별점 */}
        <label style={{ fontSize: 14, fontWeight: 600 }}>{t.ratingLabel}</label>
        <div style={{ fontSize: 38, margin: "8px 0 22px", letterSpacing: 4 }} onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((s) => (
            <span key={s} onClick={() => setRating(s)} onMouseEnter={() => setHover(s)}
              style={{ cursor: "pointer", color: (hover || rating) >= s ? GOLD : "#ddd" }}>★</span>
          ))}
        </div>

        {/* 글 */}
        <label style={{ fontSize: 14, fontWeight: 600 }}>{t.reviewLabel}</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5}
          placeholder={t.reviewPlaceholder}
          style={{ width: "100%", marginTop: 8, padding: 12, border: "1px solid #ddd", borderRadius: 8, fontSize: 15, resize: "vertical", boxSizing: "border-box" }} />

        {/* 미디어 — capture 미지정: 모바일에서 카메라/앨범 선택 가능 */}
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{t.mediaLabel} <span style={{ color: GOLD, fontWeight: 400 }}>{t.mediaMore}</span></label>
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
