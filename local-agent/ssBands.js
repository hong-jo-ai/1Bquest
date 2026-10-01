/**
 * 스마트스토어 20mm 밴드 정비 (형 지시 2026-09-10)
 *  - 20mm 밴드는 기원·설월·서해·성산 등 러그 20mm 모델에 모두 호환
 *  - 손목이 두꺼운 분은 기원용 롱타입(125/85mm)을 권장 → 상품명·설명에 선택 기준을 넣는다
 *  - 기원용 롱타입 가격 45,000 → 35,000
 *  - 카페24 30,000원 기본 밴드 2종(125·126) 신규 등록(전시중지로)
 */
const fs = require("fs");
const { api, token } = require("./smartstoreCs.js");
const CAFE = "/Users/mac/sungjo_ai/harriotwatches_website/tools/cafe24/client.mjs";
const COMPAT = "기원·설월·서해·성산 호환";

function detail(current) {
  const row = (key, name, spec, who) => {
    const on = key === current;
    return `<tr style="background:${on ? "#f3efe6" : "#fff"}">
      <td style="padding:14px 12px;border-bottom:1px solid #e8e3d8;font-size:14px;font-weight:700;color:#1f1f1f;vertical-align:top;width:34%">${name}${on ? '<br><span style="display:inline-block;margin-top:6px;font-size:11px;font-weight:500;color:#9a7b45;letter-spacing:.04em">지금 보고 계신 밴드</span>' : ""}</td>
      <td style="padding:14px 12px;border-bottom:1px solid #e8e3d8;font-size:13.5px;line-height:1.7;color:#444;vertical-align:top">${spec}</td>
      <td style="padding:14px 12px;border-bottom:1px solid #e8e3d8;font-size:13.5px;line-height:1.7;color:#444;vertical-align:top;width:28%">${who}</td></tr>`;
  };
  return `<div style="max-width:860px;margin:0 auto;padding:40px 18px 48px;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#2a2a2a">
  <p style="margin:0 0 8px;font-size:12px;letter-spacing:.3em;color:#9a7b45">HARRIOT · 20mm STRAP</p>
  <p style="margin:0 0 14px;font-size:24px;font-weight:700;color:#1f1f1f">어떤 20mm 밴드를 고를까요?</p>
  <p style="margin:0 0 22px;font-size:15px;line-height:1.85;color:#444">해리엇의 20mm 밴드는 러그 폭 20mm 모델인 <b>기원 · 설월 · 서해 · 성산</b> 등에 모두 호환됩니다. 손목 둘레와 원하는 분위기에 맞춰 골라 주세요.</p>
  <table style="width:100%;border-collapse:collapse;border-top:2px solid #1f1f1f">
    <tr><th style="padding:10px 12px;text-align:left;font-size:12.5px;color:#888;font-weight:500;background:#faf8f3">밴드</th><th style="padding:10px 12px;text-align:left;font-size:12.5px;color:#888;font-weight:500;background:#faf8f3">사양</th><th style="padding:10px 12px;text-align:left;font-size:12.5px;color:#888;font-weight:500;background:#faf8f3">이런 분께</th></tr>
    ${row("long", "롱타입 가죽밴드<br>(흑색 · 갈색)", "길이 125mm / 85mm · 폭 20mm → 16mm 테이퍼 · 천연 소가죽 · 로고 각인 스테인리스 버클", "<b>손목이 두꺼운 분</b>께 추천 · 기원에 기본 장착되는 밴드")}
    ${row("basic", "기본 가죽밴드<br>(블랙 실버버클 · 브라운 로즈골드버클)", "폭 20mm · 천연 가죽 · 핀 버클", "일반적인 손목 둘레 · 버클 색을 시계 케이스에 맞추고 싶은 분")}
    ${row("mesh", "메쉬 메탈밴드<br>(실버 · 로즈골드 · 블랙)", "폭 20mm · 스테인리스 메쉬", "가죽 대신 메탈 무드로 바꾸고 싶은 분")}
  </table>
  <div style="margin-top:22px;padding:16px 18px;background:#faf8f3;border:1px solid #ece6da">
    <p style="margin:0 0 6px;font-size:13.5px;line-height:1.8;color:#555">· 러그 폭 20mm 해리엇 시계에 교체 장착할 수 있습니다.</p>
    <p style="margin:0 0 6px;font-size:13.5px;line-height:1.8;color:#555">· 여성용 모델은 러그 폭이 다를 수 있으니 시계의 밴드 폭을 확인 후 선택해 주세요.</p>
    <p style="margin:0;font-size:13.5px;line-height:1.8;color:#555">· 천연 가죽은 사용 환경에 따라 색감과 질감이 자연스럽게 변할 수 있습니다.</p>
  </div>
</div>`;
}

async function upImg(url, name) {
  const u = url.startsWith("//") ? "https:" + url : url;
  const r = await fetch(u); if (!r.ok) throw new Error("이미지 다운로드 실패 " + u.slice(0, 80));
  const buf = Buffer.from(await r.arrayBuffer());
  const fd = new FormData();
  fd.append("imageFiles", new Blob([buf], { type: "image/jpeg" }), name + ".jpg");
  const up = await fetch("https://api.commerce.naver.com/external/v1/product-images/upload",
    { method: "POST", headers: { Authorization: "Bearer " + (await token()) }, body: fd });
  if (!up.ok) throw new Error("업로드 실패 " + up.status);
  return (await up.json()).images[0].url;
}

(async () => {
  const GO = process.argv.includes("--go");

  // ① 기존 3종 — 이름·설명·가격 정비
  const edits = [
    { no: 11691992228, name: `해리엇 20mm 가죽밴드 흑색 롱타입 (${COMPAT})`, price: 35000, key: "long" },
    { no: 11691997678, name: `해리엇 20mm 가죽밴드 갈색 롱타입 (${COMPAT})`, price: 35000, key: "long" },
    { no: 11918612198, name: `해리엇 20mm 메쉬 메탈밴드 실버 (${COMPAT})`, price: 40000, key: "mesh" },
  ];
  for (const e of edits) {
    const j = await api("GET", `/v2/products/origin-products/${e.no}`);
    const before = { name: j.originProduct.name, price: j.originProduct.salePrice, disp: j.smartstoreChannelProduct.channelProductDisplayStatusType };
    j.originProduct.name = e.name;
    j.originProduct.salePrice = e.price;
    j.originProduct.detailContent = detail(e.key);
    if (GO) await api("PUT", `/v2/products/origin-products/${e.no}`, j);
    const after = GO ? (await api("GET", `/v2/products/origin-products/${e.no}`)) : j;
    console.log(`[수정] ${before.name} ${before.price.toLocaleString()}원 → ${after.originProduct.name} ${after.originProduct.salePrice.toLocaleString()}원 · 전시 ${after.smartstoreChannelProduct.channelProductDisplayStatusType}`);
  }

  // ② 신규 2종 — 기존 흑색 밴드 설정(카테고리·배송·고시)을 그대로 복제
  const tplFull = await api("GET", "/v2/products/origin-products/11691992228");
  const { api: cafe } = await import(CAFE);
  const news = [
    { cafe: 125, name: `해리엇 20mm 가죽밴드 블랙 실버버클 (${COMPAT})` },
    { cafe: 126, name: `해리엇 20mm 가죽밴드 브라운 로즈골드버클 (${COMPAT})` },
  ];
  for (const n of news) {
    const p = (await cafe("GET", `/api/v2/admin/products/${n.cafe}`)).product;
    const qty = ((await cafe("GET", `/api/v2/admin/products/${n.cafe}/variants`)).variants || []).reduce((s, v) => s + Number(v.quantity || 0), 0);
    const srcs = [...new Set(((p.description || "").match(/<img[^>]+src=["']([^"']+)["']/gi) || []).map((t) => t.match(/src=["']([^"']+)["']/i)[1]))].slice(0, 4);
    const rep = await upImg(p.detail_image, `band${n.cafe}_rep`);
    const opt = [];
    for (let i = 0; i < srcs.length; i++) opt.push({ url: await upImg(srcs[i], `band${n.cafe}_${i}`) });
    const op = JSON.parse(JSON.stringify(tplFull.originProduct));
    op.name = n.name;
    op.salePrice = Math.round(+p.price);
    op.stockQuantity = qty;
    op.detailContent = detail("basic");
    op.images = { representativeImage: { url: rep }, optionalImages: opt };
    op.saleStartDate = "2026-09-10T00:00:00+09:00";
    op.saleEndDate = "2027-12-31T23:59:59.999+09:00";
    if (op.detailAttribute.optionInfo) delete op.detailAttribute.optionInfo;
    const payload = { originProduct: op, smartstoreChannelProduct: { ...tplFull.smartstoreChannelProduct, channelProductDisplayStatusType: "SUSPENSION" } };
    if (!GO) { console.log(`[신규·드라이런] ${n.name} ${op.salePrice.toLocaleString()}원 재고 ${qty} 이미지 ${1 + opt.length}`); continue; }
    const res = await api("POST", "/v2/products", payload);
    console.log(`[신규] ${n.name} ${op.salePrice.toLocaleString()}원 재고 ${qty} → originProductNo=${res.originProductNo} (전시중지)`);
  }
})().catch((e) => { console.error("실패:", e.message.slice(0, 400)); process.exit(1); });
