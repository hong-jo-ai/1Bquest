import { verifyReviewToken, getMall, reviewsDb, type MallConfig, type MallId } from "@/lib/reviews/core";
import ReviewForm from "./ReviewForm";

function money(mall: MallConfig, points: number): string {
  // 표시용: KRW reward 를 글로벌몰에선 대략 USD 로 환산해 보여줌(1$≈1,300원)
  if (mall.currency === "USD") return "$" + Math.round(points / 1300);
  return points.toLocaleString() + "원";
}

const HOME_URL: Record<MallId, string> = {
  harriot_kr: "https://harriotwatches.co.kr",
  harriot_global: "https://harriotwatches.com",
  paulvice_kr: "https://paulvice.co.kr",
  paulvice_global: "https://paulvice.co.kr",
};

function langOf(mall: MallId): "ko" | "en" {
  return mall === "harriot_kr" || mall === "paulvice_kr" ? "ko" : "en";
}

function Notice({ title, body, home, backLabel }: { title: string; body: React.ReactNode; home: string; backLabel: string }) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,Arial", background: "#f5f5f5", padding: 24 }}>
      <div style={{ textAlign: "center", color: "#444", maxWidth: 420 }}>
        <div style={{ fontSize: 44 }}>🙏</div>
        <h1 style={{ fontSize: 21, color: "#1a1a1a", margin: "14px 0 8px" }}>{title}</h1>
        <p style={{ lineHeight: 1.7, color: "#666" }}>{body}</p>
        <a href={home} style={{ display: "inline-block", marginTop: 22, color: "#c9a96a", textDecoration: "underline", fontSize: 14 }}>{backLabel}</a>
      </div>
    </main>
  );
}

/** 토큰으로 리뷰 폼을 렌더 — /review/[token] 과 /r/[code] 가 공유. */
export default async function ReviewPage({ token }: { token: string | null }) {
  const tok = token ? verifyReviewToken(token) : null;

  if (!tok || !token) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,Arial", background: "#f5f5f5", padding: 24 }}>
        <div style={{ textAlign: "center", color: "#666" }}>
          <h1 style={{ fontSize: 20, color: "#1a1a1a" }}>링크가 만료되었습니다</h1>
          <p>최신 후기 링크로 다시 접속하시거나, 문의해 주세요.<br /><span style={{ color: "#aaa", fontSize: 13 }}>This link has expired.</span></p>
        </div>
      </main>
    );
  }

  const mall = getMall(tok.mall)!;
  const lang = langOf(mall.id);
  const home = HOME_URL[mall.id];
  const ko = lang === "ko";

  // 이미 작성한 사람이 다시 들어온 경우 — 안내(중복 작성·중복 보상 방지)
  if (tok.orderRef || tok.phone || tok.email) {
    const sb = reviewsDb();
    let q = sb.from("reviews").select("id").eq("mall", mall.id).limit(1);
    if (tok.orderRef) q = q.eq("order_ref", tok.orderRef);
    else if (tok.phone) q = q.eq("customer_phone", tok.phone.replace(/\D/g, "")).eq("product_no", tok.productNo);
    else q = q.eq("customer_email", tok.email!).eq("product_no", tok.productNo);
    const { data: existing } = await q;
    if (existing && existing.length > 0) {
      return (
        <Notice
          title={ko ? "이미 후기를 남겨주셨어요" : "You've already reviewed this"}
          body={ko ? "소중한 후기 감사합니다. 적립금은 순차적으로 지급해 드립니다." : "Thank you — your reward will be sent shortly."}
          home={home}
          backLabel={ko ? "해리엇으로 돌아가기" : "Back to Harriot"}
        />
      );
    }
  }

  return (
    <ReviewForm
      token={token}
      productName={tok.productName}
      name={tok.name || ""}
      lang={lang}
      homeUrl={home}
      reward={{ text: money(mall, mall.reward.text), photo: money(mall, mall.reward.photo), video: money(mall, mall.reward.video) }}
    />
  );
}
