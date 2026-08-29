"use client";

/**
 * PAULVICE CARE 등록 — 5화면 30초.
 *
 * 설계 원칙(docs/paulvice-care.md):
 *   · 화면당 요구하는 것 하나. 스크롤 없이 끝나야 한다.
 *   · 시리얼·주문번호·구매처를 묻지 않는다 — 증빙을 찾게 만들면 거기서 이탈한다.
 *   · 동의는 필수(케어 제공)/선택(광고 수신)을 시각적으로 분리. 선택은 기본 해제.
 *   · 완료 화면에서 쿠폰을 바로 보여준다. 문자로 미루면 대부분 안 산다.
 *
 * BI: 모노톤(#111 / #fff / #B1AAA2), Pretendard, 골드 액센트 금지.
 */
import { useEffect, useState } from "react";

interface Product { no: number; name: string; image: string | null }

const SHOP = "https://paulvice.co.kr";
const GRAY = "#B1AAA2";

export default function CareClient({ source }: { source?: string }) {
  const [step, setStep] = useState(0);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [picked, setPicked] = useState<Product | null>(null);
  const [other, setOther] = useState(false);
  const [adConsent, setAdConsent] = useState(false);
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<string | null>(null);
  const [cool, setCool] = useState(0);

  useEffect(() => {
    if (step !== 2 || products.length) return;
    fetch("/api/care/products").then((r) => r.json()).then((j) => setProducts(j.products ?? [])).catch(() => {});
  }, [step, products.length]);

  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "처리에 실패했습니다");
    return j;
  };

  const sendOtp = async () => {
    setBusy(true); setErr(null);
    try { await post("/api/care/otp", { phone }); setCool(30); setStep(1); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setErr(null);
    try { await post("/api/care/otp?verify=1", { phone, code }); setStep(2); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!required) { setErr("필수 항목에 동의해 주세요"); return; }
    setBusy(true); setErr(null);
    try {
      // ⚠️ 인증번호는 등록 API 에서 소모된다 — 검증 단계에서 이미 지워지면 재발급이 필요하므로
      //    여기서 한 번 더 보낸다(서버가 남의 번호 등록을 막는 유일한 방어선).
      const j = await post("/api/care/register", {
        phone, code,
        productNo: picked?.no, productName: picked?.name,
        productOther: other ? "목록에 없음" : undefined,
        adConsent, source,
      });
      setCoupon(j.coupon); setStep(4);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const Btn = ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled || busy}
      style={{
        width: "100%", padding: "17px 0", borderRadius: 4, border: "none",
        background: disabled || busy ? "#8a8a8a" : "#111", color: "#fff",
        fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", cursor: disabled || busy ? "default" : "pointer",
      }}>{children}</button>
  );

  return (
    <div style={{
      minHeight: "100dvh", background: "#fff", color: "#111",
      fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
      display: "flex", flexDirection: "column", padding: "0 24px",
      maxWidth: 480, margin: "0 auto",
    }}>
      <div style={{ paddingTop: 56, paddingBottom: 28 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.24em", color: GRAY, fontWeight: 600 }}>PAULVICE CARE</div>
      </div>

      {step === 0 && (
        <>
          <h1 style={{ fontSize: 26, lineHeight: 1.35, fontWeight: 700, margin: "0 0 12px" }}>
            구매하신 PAULVICE를<br />등록하세요
          </h1>
          <p style={{ fontSize: 18, fontWeight: 600, margin: "0 0 40px" }}>배터리 교체 1회 무료</p>
          <input
            inputMode="numeric" placeholder="휴대폰 번호" value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, "").slice(0, 11))}
            style={{ width: "100%", padding: "16px 0", fontSize: 17, border: "none", borderBottom: "1px solid #111", outline: "none", marginBottom: 28, background: "transparent" }}
          />
          <Btn onClick={sendOtp} disabled={phone.length < 10}>등록 시작</Btn>
        </>
      )}

      {step === 1 && (
        <>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>인증번호를 입력하세요</h1>
          <p style={{ fontSize: 14, color: GRAY, margin: "0 0 32px" }}>{phone} 로 보냈습니다</p>
          <input
            inputMode="numeric" placeholder="6자리" value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
            style={{ width: "100%", padding: "16px 0", fontSize: 22, letterSpacing: "0.3em", border: "none", borderBottom: "1px solid #111", outline: "none", marginBottom: 20, background: "transparent" }}
          />
          <button onClick={sendOtp} disabled={cool > 0 || busy}
            style={{ background: "none", border: "none", color: GRAY, fontSize: 13, padding: 0, marginBottom: 28, cursor: cool > 0 ? "default" : "pointer" }}>
            {cool > 0 ? `재발송 ${cool}초` : "인증번호 재발송"}
          </button>
          <Btn onClick={verify} disabled={code.length < 6}>확인</Btn>
        </>
      )}

      {step === 2 && (
        <>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 28px" }}>구매하신 제품을 선택하세요</h1>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {products.map((p) => {
              const on = picked?.no === p.no;
              return (
                <button key={p.no} onClick={() => { setPicked(p); setOther(false); }}
                  style={{ border: on ? "1.5px solid #111" : "1px solid #E5E2DC", borderRadius: 4, padding: 8, background: "#fff", textAlign: "left", cursor: "pointer" }}>
                  {p.image && <img src={p.image} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 2 }} />}
                  <div style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.4, color: on ? "#111" : "#555" }}>{p.name}</div>
                </button>
              );
            })}
          </div>
          <button onClick={() => { setOther(true); setPicked(null); }}
            style={{ width: "100%", padding: 14, borderRadius: 4, border: other ? "1.5px solid #111" : "1px solid #E5E2DC", background: "#fff", fontSize: 14, color: other ? "#111" : "#666", marginBottom: 28, cursor: "pointer" }}>
            목록에 없어요
          </button>
          <Btn onClick={() => setStep(3)} disabled={!picked && !other}>다음</Btn>
        </>
      )}

      {step === 3 && (
        <>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>동의</h1>

          {/* 전체동의 — 개별 항목이 아래에 그대로 보이고 개별 해제가 가능해야 유효하다.
              선택 항목을 미리 체크해두는 건(다크패턴) 안 되지만, 고객이 능동적으로 누르는
              전체동의 버튼은 적법하다. '선택 포함'을 반드시 명시한다. */}
          <label style={{
            display: "block", border: `1.5px solid ${required && adConsent ? "#111" : "#111"}`,
            background: required && adConsent ? "#111" : "#fff",
            color: required && adConsent ? "#fff" : "#111",
            borderRadius: 4, padding: "20px 18px", marginBottom: 16, cursor: "pointer",
          }}>
            <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={required && adConsent}
                onChange={(e) => { setRequired(e.target.checked); setAdConsent(e.target.checked); }}
                style={{ width: 20, height: 20, accentColor: required && adConsent ? "#fff" : "#111" }}
              />
              <span>
                <b style={{ fontSize: 17 }}>모두 동의합니다</b>
                <span style={{ display: "block", fontSize: 12.5, opacity: 0.75, marginTop: 4 }}>
                  선택 항목(광고성 정보 수신)을 포함합니다
                </span>
              </span>
            </span>
          </label>

          <label style={{ display: "block", border: "1px solid #E5E2DC", borderRadius: 4, padding: 16, marginBottom: 12, cursor: "pointer" }}>
            <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} style={{ marginTop: 3, accentColor: "#111" }} />
              <span>
                <b style={{ fontSize: 14.5 }}>[필수] 케어 서비스 제공을 위한 개인정보 수집·이용</b>
                <span style={{ display: "block", fontSize: 12.5, color: GRAY, lineHeight: 1.6, marginTop: 6 }}>
                  수집항목: 휴대폰번호, 등록 제품<br />
                  이용목적: 케어 서비스(배터리 교체·A/S) 제공<br />
                  보유기간: 서비스 종료 또는 동의 철회 시까지
                </span>
              </span>
            </span>
          </label>

          <label style={{ display: "block", border: "1px solid #E5E2DC", borderRadius: 4, padding: 16, marginBottom: 20, cursor: "pointer" }}>
            <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input type="checkbox" checked={adConsent} onChange={(e) => setAdConsent(e.target.checked)} style={{ marginTop: 3, accentColor: "#111" }} />
              <span>
                <b style={{ fontSize: 14.5 }}>[선택] 광고성 정보 수신 동의 (문자)</b>
                <span style={{ display: "block", fontSize: 12.5, color: GRAY, lineHeight: 1.6, marginTop: 6 }}>
                  배터리 교체 시기 안내, 신제품 출시 소식, 케어 등록 고객 전용 혜택을 보내드립니다<br />
                  미동의해도 케어 서비스는 그대로 제공됩니다
                </span>
              </span>
            </span>
          </label>

          <Btn onClick={submit} disabled={!required}>등록 완료</Btn>
        </>
      )}

      {step === 4 && (
        <>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 10px" }}>등록 완료</h1>
          <p style={{ fontSize: 15, color: "#333", margin: "0 0 36px" }}>배터리 교체 1회 무료가 적용되었습니다</p>
          <div style={{ background: "#111", color: "#fff", borderRadius: 4, padding: "26px 20px", marginBottom: 20 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.18em", color: GRAY, marginBottom: 10 }}>STRAP COUPON</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.04em" }}>{coupon}</div>
            <div style={{ fontSize: 12.5, color: GRAY, marginTop: 10 }}>스트랩 구매 시 사용하실 수 있습니다</div>
          </div>
          <a href={`${SHOP}/category/스트랩/`} style={{ textDecoration: "none" }}>
            <div style={{ width: "100%", padding: "17px 0", borderRadius: 4, background: "#111", color: "#fff", fontSize: 16, fontWeight: 600, textAlign: "center" }}>
              스트랩 보러가기
            </div>
          </a>
        </>
      )}

      {err && <p style={{ color: "#B4472E", fontSize: 13.5, marginTop: 16 }}>{err}</p>}
      <div style={{ flex: 1 }} />
      <p style={{ fontSize: 11.5, color: GRAY, padding: "28px 0 32px", lineHeight: 1.7 }}>
        배터리 교체는 1회 무료이며, 작업 비용은 받지 않고 반송 택배비만 고객 부담입니다.
      </p>
    </div>
  );
}
