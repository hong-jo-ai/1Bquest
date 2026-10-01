/**
 * 카페24 해리엇 상품 → 스마트스토어 등록 (상세 그대로 이식).
 *
 * 카페24 상세 HTML 의 이미지는 카페24 CDN 에 있는데, 네이버 상세에서 외부 이미지를 그대로 쓰면
 * 정책·표시 문제가 생긴다 → **전부 내려받아 네이버 이미지 서버로 옮기고 URL 을 치환**한다.
 * 네이버 커머스 API 는 IP 화이트리스트라 이 스크립트는 반드시 로컬에서 돈다([[naver-commerce-api-ip-whitelist]]).
 *
 * 실행: node ssUpload.js <cafe24ProductNo> [--go]
 *       --go 없으면 준비만 하고 등록은 하지 않는다(드라이런).
 */
const fs = require("fs");
const { api: ncApi } = require("./smartstoreCs.js");
const { inlineCss } = require("./_inlineCss.js");

const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
const CAFE24_CLIENT = "/Users/mac/sungjo_ai/harriotwatches_website/tools/cafe24/client.mjs";
const TEMPLATE_ORIGIN = 11618636640;          // 기원 = 배송·AS·고시 템플릿
const abs = (u) => (u.startsWith("//") ? "https:" + u : u);

async function uploadImage(url, name) {
  const r = await fetch(abs(url));
  if (!r.ok) throw new Error(`이미지 다운로드 실패 ${r.status} ${url.slice(0, 80)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const fd = new FormData();
  const ext = (url.match(/\.(jpe?g|png|gif)/i) || [, "jpg"])[1].toLowerCase();
  fd.append("imageFiles", new Blob([buf], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }), `${name}.${ext}`);
  const { token } = require("./smartstoreCs.js");
  const t = await token();
  const up = await fetch("https://api.commerce.naver.com/external/v1/product-images/upload", {
    method: "POST", headers: { Authorization: "Bearer " + t }, body: fd,
  });
  if (!up.ok) throw new Error(`네이버 업로드 실패 ${up.status} ${(await up.text()).slice(0, 150)}`);
  return (await up.json()).images[0].url;
}

(async () => {
  const pno = Number(process.argv[2]);
  const GO = process.argv.includes("--go");
  if (!pno) throw new Error("카페24 상품번호 필요");

  const { api } = await import(CAFE24_CLIENT);
  const p = (await api("GET", `/api/v2/admin/products/${pno}`)).product;
  console.log(`[${pno}] ${p.product_name} · ${Math.round(+p.price).toLocaleString()}원`);

  const inv = (await api("GET", `/api/v2/admin/products/${pno}/variants`)).variants || [];
  const qty = inv.reduce((s, v) => s + Number(v.quantity || 0), 0);

  // 네이버는 <style> 태그를 잘라내고 CSS 를 본문 텍스트로 노출시킨다 → 먼저 인라인 style 로 변환.
  // 이미지가 실제로 로드된 상태에서 computed style 을 떠야 폭·비율이 맞으므로 URL 치환보다 먼저 한다.
  let desc = await inlineCss(p.description || "");
  console.log(`  CSS 인라인화 ${(p.description||"").length} → ${desc.length}자`);
  const srcs = [...new Set((desc.match(/<img[^>]+src=["']([^"']+)["']/gi) || [])
    .map((t) => (t.match(/src=["']([^"']+)["']/i) || [])[1]).filter(Boolean))];
  console.log(`  상세 이미지 ${srcs.length}장 이관 시작`);

  const map = {};
  for (let i = 0; i < srcs.length; i++) {
    map[srcs[i]] = await uploadImage(srcs[i], `p${pno}_d${i}`);
    process.stdout.write(`\r  이관 ${i + 1}/${srcs.length}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log("");
  for (const [from, to] of Object.entries(map)) desc = desc.split(from).join(to);

  // 대표 + 추가 이미지 — 대표는 카페24 detail_image, 추가는 상세 앞쪽 컷 재사용
  const rep = await uploadImage(p.detail_image, `p${pno}_rep`);
  const extra = Object.values(map).slice(0, 7).map((u) => ({ url: u }));

  const tpl = (await ncApi("GET", `/v2/products/origin-products/${TEMPLATE_ORIGIN}`)).originProduct;

  // 상품별 카테고리·고시 — 카페24 상세 스펙표에서 뽑은 값(/tmp/ss_specs.json)
  const specs = JSON.parse(fs.readFileSync("/tmp/ss_specs.json", "utf8"));
  const sp = specs.find((x) => x.no === pno) || {};
  const isStrap = /밴드|스트랩/.test(p.product_name) && !sp.무브먼트;
  const isMesh = /메쉬/.test(sp.밴드소재 || p.product_name);
  const category = isStrap ? "50004146" : isMesh ? "50004141" : "50004140";
  const notice = JSON.parse(JSON.stringify(tpl.detailAttribute.productInfoProvidedNotice));
  Object.assign(notice.jewellery, {
    material: isStrap ? "상품상세 참조" : "316L 스테인리스 스틸",
    bandMaterial: isStrap ? (isMesh ? "스테인리스 스틸" : "상품상세 참조") : (isMesh ? "스테인리스 메쉬" : "천연 가죽"),
    size: sp.케이스지름 || "상품상세 참조",
    specification: sp.방수 || "상품상세 참조",
    weight: "상품상세 참조",
    afterServiceDirector: "해리엇와치스 070-4571-4944, 전화연결이 어려울 수 있습니다. harriotwatches@gmail.com로 연락주시면 누락없이 최대한 빨리 처리해드리겠습니다.",
  });
  console.log(`  카테고리 ${category} (${isStrap ? "시계줄" : isMesh ? "메탈밴드" : "가죽밴드"}) · 방수 ${sp.방수 || "-"}`);
  const payload = {
    originProduct: {
      statusType: "SALE", saleType: "NEW",
      leafCategoryId: category,
      name: `해리엇 ${p.product_name}`,
      detailContent: desc,
      images: { representativeImage: { url: rep }, optionalImages: extra },
      saleStartDate: new Date().toISOString().slice(0, 10) + "T00:00:00+09:00",
      saleEndDate: "2027-12-31T23:59:59.999+09:00",
      salePrice: Math.round(+p.price),
      stockQuantity: qty,
      deliveryInfo: tpl.deliveryInfo,
      customerBenefit: tpl.customerBenefit,
      detailAttribute: {
        naverShoppingSearchInfo: tpl.detailAttribute.naverShoppingSearchInfo,
        afterServiceInfo: tpl.detailAttribute.afterServiceInfo,
        originAreaInfo: tpl.detailAttribute.originAreaInfo,
        optionInfo: isStrap ? undefined : { simpleOptionSortType: "CREATE", optionSimple: [],
          optionCustom: [{ groupName: "각인문구(원치않으시면 '각인안함')", usable: true }] },
        purchaseReviewInfo: { purchaseReviewExposure: true },
        taxType: "TAX",
        certificationTargetExcludeContent: { kcCertifiedProductExclusionYn: "TRUE" },
        sellerCommentUsable: false, minorPurchasable: true,
        productInfoProvidedNotice: notice,
        itselfProductionProductYn: false,
      },
    },
    smartstoreChannelProduct: {
      storeKeepExclusiveProduct: false, naverShoppingRegistration: true,
      channelProductDisplayStatusType: "SUSPENSION",   // 검수 전까지 노출 차단
    },
  };
  fs.writeFileSync(`/tmp/ss_payload_${pno}.json`, JSON.stringify(payload, null, 1));
  console.log(`  페이로드 준비 완료 (재고 ${qty} · 상세 ${desc.length}자)`);

  if (!GO) { console.log("  드라이런 — 등록하려면 --go"); return; }
  const upd = (process.argv.find((a) => a.startsWith("--update=")) || "").split("=")[1];
  if (upd) {
    await ncApi("PUT", `/v2/products/origin-products/${upd}`, payload);
    console.log(`  ✅ 갱신 originProductNo=${upd}`);
  } else {
    const res = await ncApi("POST", "/v2/products", payload);
    console.log(`  ✅ 등록 originProductNo=${res.originProductNo} channel=${res.smartstoreChannelProductNo}`);
  }
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
