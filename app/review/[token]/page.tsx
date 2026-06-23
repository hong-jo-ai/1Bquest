import { verifyReviewToken, getMall, type MallConfig } from "@/lib/reviews/core";
import ReviewForm from "./ReviewForm";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

function money(mall: MallConfig, points: number): string {
  // 표시용: KRW reward 를 글로벌몰에선 대략 USD 로 환산해 보여줌(1$≈1,300원)
  if (mall.currency === "USD") return "$" + Math.round(points / 1300);
  return points.toLocaleString() + "P";
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tok = verifyReviewToken(token);

  if (!tok) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,Arial", background: "#f5f5f5", padding: 24 }}>
        <div style={{ textAlign: "center", color: "#666" }}>
          <h1 style={{ fontSize: 20, color: "#1a1a1a" }}>This link has expired</h1>
          <p>Please use the latest review link from your email, or contact us.</p>
        </div>
      </main>
    );
  }

  const mall = getMall(tok.mall)!;
  return (
    <ReviewForm
      token={token}
      productName={tok.productName}
      name={tok.name || ""}
      reward={{ text: money(mall, mall.reward.text), photo: money(mall, mall.reward.photo), video: money(mall, mall.reward.video) }}
    />
  );
}
