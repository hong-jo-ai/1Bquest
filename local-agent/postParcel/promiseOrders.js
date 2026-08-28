/**
 * 고객 약속 — "이 주문 보낼 때 쇼핑백 3개 넣기" 같은 상담 중 약속.
 *
 * 왜 여기서 읽나: 약속은 CS 대화 안에만 남아서, 정작 포장·출고하는 순간엔 아무 데도 안 뜬다.
 * 그래서 새 제품만 나가고 약속이 조용히 깨진다(2026-08-28 무신사 김수현 쇼핑백 3개 건).
 * 출고 집계에 약속을 얹어 텔레그램 캡션에 띄우면, 엑셀 열기 전에 눈에 들어온다.
 *
 * 저장: kv_store 'cs_promises' — 대시보드 /inbox 의 "약속 남기기" 버튼이 쓴다.
 *   { items: [{ id, text, orderNumber, seller, dueOn, status, ... }], updatedAt }
 *
 * ⚠️ 보류(holdOrders)와 달리 이건 **제외하지 않는다**. 약속은 "빼라"가 아니라 "같이 넣어라"라서
 *    출고는 그대로 나가고 경고만 붙인다.
 */
const path = require("path");

const KEY = "cs_promises";
const DASH = path.resolve(__dirname, "..", "..");

function sb() {
  const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function listPromises() {
  const { data, error } = await sb().from("kv_store").select("data").eq("key", KEY).maybeSingle();
  if (error) throw error;
  const items = data?.data?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * 주문번호 → 약속 텍스트 배열. 미완료만.
 * 판매처 표기가 화면마다 달라(카페24/cafe24…) 주문번호만으로 매칭한다 —
 * 놓치는 것보다 조금 넓게 잡는 편이 낫다.
 * ⚠️ 실패는 삼킨다(빈 Map): 약속 조회가 깨졌다고 출고 집계가 멈추면 안 된다.
 */
async function promiseMap() {
  try {
    const items = await listPromises();
    const map = new Map();
    for (const p of items) {
      if (!p || p.status === "done" || !p.orderNumber) continue;
      const key = String(p.orderNumber).trim();
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), String(p.text || "").trim()]);
    }
    return map;
  } catch (e) {
    console.warn("[promiseOrders] 약속 조회 실패(무시):", e.message);
    return new Map();
  }
}

module.exports = { promiseMap, listPromises, KEY };
