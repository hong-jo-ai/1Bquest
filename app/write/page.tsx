import type { Metadata } from "next";
import { getMall } from "@/lib/reviews/core";
import { productNameFor } from "@/lib/reviews/entry";
import WriteEntry from "./WriteEntry";

export const dynamic = "force-dynamic";

type Search = { mall?: string; product_no?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  const mall = getMall(String(sp.mall ?? ""));
  const brand = mall?.cafe24Mall === "paulvice" ? "PAULVICE" : "HARRIOT";
  return { title: mall?.currency === "KRW" ? `${brand} 리뷰` : `${brand} Review`, robots: { index: false, follow: false } };
}

/**
 * /write?mall=harriot_kr&product_no=136 — 상품페이지 "리뷰 작성하기"가 여기로 온다.
 * 연락처 하나로 주문을 찾아 토큰 리뷰 페이지로 넘긴다. 못 찾아도 작성은 된다(적립금 없음).
 */
export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const mall = getMall(String(sp.mall ?? ""));
  const productNo = Number(sp.product_no);
  const ko = mall?.currency === "KRW";

  if (!mall || !Number.isFinite(productNo) || productNo <= 0) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,Arial", background: "#f5f5f5", padding: 24 }}>
        <div style={{ textAlign: "center", color: "#666" }}>
          <h1 style={{ fontSize: 20, color: "#1a1a1a" }}>{ko ? "상품 정보를 찾을 수 없습니다" : "Product not found"}</h1>
          <p>{ko ? "상품 페이지의 리뷰 작성 버튼으로 다시 들어와 주세요." : "Please use the review button on the product page."}</p>
        </div>
      </main>
    );
  }

  const productName = await productNameFor(mall, productNo);
  return (
    <WriteEntry
      mall={mall.id}
      productNo={productNo}
      productName={productName}
      lang={ko ? "ko" : "en"}
      brand={mall.cafe24Mall === "harriot" ? (ko ? "해리엇" : "HARRIOT") : (ko ? "폴바이스" : "PAULVICE")}
    />
  );
}
