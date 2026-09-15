"use client";
import { useState } from "react";

const GOLD = "#c9a96a", DARK = "#1a1a1a";

const STR = {
  ko: {
    headerSub: (b: string) => `${b} · 후기 작성`,
    lead: "주문하신 휴대폰 번호를 입력해 주세요",
    sub: "구매 확인이 되면 후기 적립금이 지급됩니다. 로그인은 필요 없어요.",
    placeholder: "010-0000-0000",
    go: "후기 작성하러 가기",
    busy: "확인 중…",
    skip: "구매 확인 없이 작성하기 (적립금 없음)",
    errNet: "네트워크 오류. 다시 시도해 주세요.",
    note: "입력하신 번호는 주문 확인에만 사용됩니다.",
  },
  en: {
    headerSub: (b: string) => `${b} · WRITE A REVIEW`,
    lead: "Enter the email you used for your order",
    sub: "We'll verify your purchase so you can get your review reward. No login needed.",
    placeholder: "you@example.com",
    go: "Write a review",
    busy: "Checking…",
    skip: "Continue without purchase verification (no reward)",
    errNet: "Network error. Please try again.",
    note: "Your email is used only to find your order.",
  },
} as const;

export default function WriteEntry({ mall, productNo, productName, lang, brand }: {
  mall: string; productNo: number; productName: string; lang: "ko" | "en"; brand: string;
}) {
  const t = STR[lang];
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go(skip: boolean) {
    setErr(""); setBusy(true);
    try {
      const body = skip
        ? { mall, productNo, skip: true }
        : lang === "ko" ? { mall, productNo, phone: contact } : { mall, productNo, email: contact };
      const r = await fetch("/api/reviews/entry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) { setErr(j.error || t.errNet); return; }
      window.location.href = j.url;
    } catch { setErr(t.errNet); }
    finally { setBusy(false); }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f5f5f5", fontFamily: "system-ui,-apple-system,Arial", color: DARK }}>
      <div style={{ maxWidth: 460, margin: "0 auto", background: "#fff", minHeight: "100vh" }}>
        <div style={{ background: DARK, color: "#fff", padding: "26px 24px", textAlign: "center" }}>
          <div style={{ color: GOLD, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>{t.headerSub(brand)}</div>
          <div style={{ fontSize: 19, fontWeight: 600 }}>{productName}</div>
        </div>
        <form style={{ padding: 28 }} onSubmit={(e) => { e.preventDefault(); if (!busy) void go(false); }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{t.lead}</div>
          <div style={{ fontSize: 13, color: "#777", margin: "6px 0 16px", lineHeight: 1.6 }}>{t.sub}</div>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            type={lang === "ko" ? "tel" : "email"}
            inputMode={lang === "ko" ? "tel" : "email"}
            autoComplete={lang === "ko" ? "tel" : "email"}
            placeholder={t.placeholder}
            autoFocus
            style={{ width: "100%", padding: 14, border: "1px solid #ddd", borderRadius: 8, fontSize: 17, boxSizing: "border-box" }}
          />
          {err && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 12 }}>{err}</p>}
          <button type="submit" disabled={busy || !contact.trim()}
            style={{ marginTop: 16, width: "100%", padding: 16, background: DARK, color: "#fff", border: 0, borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy || !contact.trim() ? .6 : 1 }}>
            {busy ? t.busy : t.go}
          </button>
          <button type="button" disabled={busy} onClick={() => void go(true)}
            style={{ marginTop: 14, width: "100%", background: "none", border: 0, color: "#999", fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>
            {t.skip}
          </button>
          <p style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 18 }}>{t.note}</p>
        </form>
      </div>
    </main>
  );
}
