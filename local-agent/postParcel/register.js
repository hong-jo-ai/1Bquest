/**
 * 우체국 소포신청 배치 — 출고대기 집계 → InsertOrder 접수 → pp_shipments 저장.
 *
 * - registerOutbound(): 채널 출고대기 전체를 일반소포(reqType=1)로 접수
 * - registerReturn():   단건 반품소포(reqType=2) 접수 (원클릭 반품)
 * - cancelShipment():   접수 취소
 *
 * 안전장치:
 *   - 이미 접수된(미취소) 주문은 재접수 스킵 (order_number+channel+req_type 유니크)
 *   - POSTPARCEL_TEST_YN=Y 면 우체국이 'TESTREGINOAPI' 반환(실접수 X) → is_test 기록
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: true });

const { collectOutboundRows, recipientKey } = require("../buildPostOffice");
const { mapOutbound, mapReturn } = require("./orderMapper");
const { addrToZip } = require("./addrToZip");
const { insertOrder, cancelOrder, PostParcelError } = require("./client");
const { createClient } = require(path.join(
  path.resolve(__dirname, "..", ".."),
  "node_modules/@supabase/supabase-js"
));

const log = (m) => console.log(`[${new Date().toISOString()}][postParcel] ${m}`);
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const isTestMode = () => (process.env.POSTPARCEL_TEST_YN ?? "Y").toUpperCase() === "Y";

async function alreadyRegistered(client, orderNo, channel, reqType) {
  // 진짜 접수(is_test=false, 미취소)만 재접수 차단. 테스트 접수(TESTREGINOAPI)는 차단 안 함
  // → testYn=N 전환 후 실접수가 테스트 행을 덮어쓰며 진행됨.
  const { data } = await client
    .from("pp_shipments")
    .select("id,regi_no,status,regipo_nm")
    .eq("order_number", orderNo)
    .eq("channel", channel)
    .eq("req_type", reqType)
    .neq("status", "cancelled")
    .eq("is_test", false)
    .maybeSingle();
  return data || null;
}

function shipmentRecord(row, params, result, extra = {}) {
  return {
    order_number: row.order,
    channel: row.seller,
    req_type: params.reqType,
    recipient_name: row.name || null,
    recipient_addr: (params.recAddr1 || "") + (params.recAddr2 ? " " + params.recAddr2 : ""),
    recipient_zip: params.recZip || null,
    recipient_mobile: params.recMob || null,
    recipient_tel: params.recTel || null,
    product_name: row.prod || null,
    qty: row.qty ? Number(row.qty) || null : null,
    regi_no: result?.regiNo || null,
    req_no: result?.reqNo || null,
    res_no: result?.resNo || null,
    price: result?.price || null,
    regipo_nm: result?.regipoNm || null,
    is_test: params.testYn === "Y",
    status: extra.status || (result?.regiNo ? "submitted" : "error"),
    error_code: extra.error_code || null,
    error_message: extra.error_message || null,
    raw: result?.raw ? { resp: String(result.raw).slice(0, 4000) } : null,
    registered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function persist(client, record) {
  const { error } = await client
    .from("pp_shipments")
    .upsert(record, { onConflict: "order_number,channel,req_type" });
  if (error) log(`pp_shipments 저장 실패(${record.order_number}): ${error.message}`);
}

/**
 * 합배송 — 동일 수취인(판매처+이름+연락처+우편번호+주소)의 여러 주문/상품을 송장 1건으로 묶음.
 * 한 사람=한 박스=운송장 1개. **goodsNm 에 주문한 모든 상품명(+각인)을 결합**해
 * 송장에 전부 인쇄되게 함(포장 기준이 송장이므로 필수). 수량은 합산.
 * 판매처는 키에 포함 → 채널 간엔 안 섞임(채널별 송장 역입력이 분리돼야 함).
 * members: 원본 주문 행들 — 같은 송장번호로 주문별 pp_shipments 저장(채널 역입력이 주문별로 동작).
 */
function groupByRecipient(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.order) continue;
    const key = recipientKey(r);
    if (!map.has(key)) map.set(key, { ...r, _prods: [], _qty: 0, members: [] });
    const g = map.get(key);
    const p = String(r.prod || "").trim();
    if (p && !g._prods.includes(p)) g._prods.push(p);
    g._qty += Number(String(r.qty).replace(/\D/g, "")) || 1;
    if (!g.msg && r.msg) g.msg = r.msg;
    g.members.push(r);
  }
  return [...map.values()].map((g) => {
    let prod = g._prods.join(" / ");
    if (prod.length > 400) prod = prod.slice(0, 397) + "..."; // goodsNm 최대 400byte
    const { _prods, _qty, ...rest } = g;
    return { ...rest, prod, qty: String(g._qty || 1) };
  });
}

/** 이미 수집된 행 배열을 접수 (12:30 빌더가 집계한 rows 재사용). opts: { skipExisting=true } */
async function registerRows(rows, opts = {}) {
  const client = sb();
  const grouped = groupByRecipient(rows);
  log(`접수 대상 ${rows.length}행 → ${grouped.length}건(수취인별 합배송) — test=${isTestMode()}`);

  const results = [];
  for (const group of grouped) {
    const members = group.members || [group];
    if (!group.order) { log("주문번호 없는 행 스킵"); continue; }
    try {
      // 멤버별 기존 접수 상태 조회. 이미 접수된 멤버가 있으면 그 송장번호 재사용(InsertOrder 생략).
      const status = [];
      for (const m of members) {
        status.push(opts.skipExisting !== false ? await alreadyRegistered(client, m.order, m.seller, "1") : null);
      }
      const existing = status.find((s) => s && s.regi_no);

      const params = mapOutbound(group); // 합배송 — goodsNm/qty 결합, 수취인 주소
      let result;
      if (existing) {
        // 같은 수취인 송장이 이미 존재 → 그 번호로 미저장 멤버만 채움(기존 멤버 행은 덮어쓰지 않음)
        result = { regiNo: existing.regi_no, regipoNm: existing.regipo_nm };
        results.push({ order: group.order, channel: group.seller, regiNo: existing.regi_no, skipped: true });
      } else {
        result = await insertOrder(params);
        results.push({ order: group.order, channel: group.seller, regiNo: result.regiNo, price: result.price, members: members.length, test: params.testYn === "Y" });
        log(`접수 OK ${group.seller}/${members.map((m) => m.order).join("+")} → ${result.regiNo} (상품 ${members.length})`);
      }
      // 묶음의 각 원본 주문을 같은 송장번호로 저장(주문별 product_name/qty 유지 → 역입력은 주문별).
      for (let i = 0; i < members.length; i++) {
        if (existing && status[i] && status[i].regi_no) continue; // 이미 저장된 멤버는 건드리지 않음
        const m = members[i];
        await persist(client, shipmentRecord(m, { ...params, orderNo: m.order, goodsNm: m.prod, qty: m.qty }, result));
      }
    } catch (e) {
      const code = e instanceof PostParcelError ? e.code : "ERR";
      const params = (() => { try { return mapOutbound(group); } catch { return { reqType: "1", testYn: isTestMode() ? "Y" : "N" }; } })();
      for (const m of members) {
        await persist(client, shipmentRecord(m, { ...params, orderNo: m.order, goodsNm: m.prod, qty: m.qty }, null, { status: "error", error_code: code, error_message: e.message }));
      }
      results.push({ order: group.order, channel: group.seller, error: e.message, code });
      log(`접수 실패 ${group.seller}/${members.map((m) => m.order).join("+")}: ${e.message}`);
    }
  }
  const ok = results.filter((r) => r.regiNo && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => r.error).length;
  return { total: grouped.length, rows: rows.length, ok, skipped, failed, results };
}

/** 출고대기 전체 집계 → 접수. opts: { limit, skipExisting=true } */
async function registerOutbound(opts = {}) {
  const { rows, counts } = await collectOutboundRows();
  const limited = opts.limit ? rows.slice(0, opts.limit) : rows;
  const summary = await registerRows(limited, opts);
  return { ...summary, counts };
}

/**
 * 단발 접수 — 임의 수취인 정보로 1건 접수 (다른 앱 연계: 인플루언서 협찬발송, AS 수리완료 발송 등).
 * @param {object} order { order, name, addr|addr1/addr2, zip, mobile|tel, prod, qty, color?, msg?, seller? }
 * @param {object} opts  { reqType='1', source } — source 는 채널 라벨(AS/influencer/manual 등)
 */
async function registerSingle(order, opts = {}) {
  const client = sb();
  const reqType = opts.reqType || "1";
  const channel = order.seller || opts.source || "manual";
  const row = { ...order, seller: channel };
  if (!row.order) throw new Error("주문/참조번호(order) 필요");
  // 우편번호가 비었으면 주소로 자동 조회 (워커=한국 IP+검증된 운영키 — 배포 라우트 환경/리전 우회)
  if (!String(row.zip || "").replace(/\D/g, "")) {
    const fullAddr = row.addr || [row.addr1, row.addr2].filter(Boolean).join(" ");
    const z = await addrToZip(fullAddr);
    if (z) { row.zip = z; console.log(`[${new Date().toISOString()}] 우편번호 자동조회: ${z} ← ${fullAddr}`); }
  }
  if (opts.skipExisting !== false) {
    const exists = await alreadyRegistered(client, row.order, channel, reqType);
    if (exists && exists.regi_no) {
      return { order: row.order, regiNo: exists.regi_no, regipoNm: exists.regipo_nm, skipped: true };
    }
  }
  const params = reqType === "2" ? mapReturn(row) : mapOutbound(row);
  const result = await insertOrder(params);
  await persist(client, shipmentRecord(row, params, result));
  return {
    order: row.order,
    regiNo: result.regiNo,
    price: result.price,
    regipoNm: result.regipoNm,
    test: params.testYn === "Y",
  };
}

/** 단건 반품 접수 (원클릭) — registerSingle(reqType=2) 위임 */
async function registerReturn(ret) {
  return registerSingle(ret, { reqType: "2", source: ret.seller || "반품" });
}

/** 접수 취소 */
async function cancelShipment({ order_number, channel, req_type = "1", delYn = "N" }) {
  const client = sb();
  const { data } = await client
    .from("pp_shipments")
    .select("*")
    .eq("order_number", order_number)
    .eq("channel", channel)
    .eq("req_type", req_type)
    .maybeSingle();
  if (!data) throw new Error("취소할 접수내역 없음");
  // reqYmd(신청일자)는 실서버에서 필수(ERR-111) — 접수일(registered_at)에서 KST YYYYMMDD 도출
  const reqYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(data.registered_at ? new Date(data.registered_at) : new Date())
    .replace(/-/g, "");
  const res = await cancelOrder({
    custNo: process.env.POSTPARCEL_CUST_NO,
    apprNo: process.env.POSTPARCEL_APPR_NO,
    reqType: req_type,
    reqNo: data.req_no,
    resNo: data.res_no,
    regiNo: data.regi_no,
    reqYmd,
    delYn,
  });
  // 취소 API 응답 키가 소문자(canceledyn)로 오는 경우 대응 — 대문자만 읽으면 취소 성공을 놓쳐 DB가 안 바뀜
  const canceledFlag = res.canceledYn ?? res.canceledyn;
  const cancelled = canceledFlag === "Y" || canceledFlag === "D";
  await client
    .from("pp_shipments")
    .update({
      status: cancelled ? "cancelled" : data.status,
      error_message: res.notCancelReason || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id);
  return { cancelled, ...res };
}

module.exports = { registerOutbound, registerRows, registerSingle, registerReturn, cancelShipment, groupByRecipient };

// CLI: node local-agent/postParcel/register.js [limit]
if (require.main === module) {
  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
  registerOutbound({ limit })
    .then((r) => { log(`완료: ok ${r.ok} / skip ${r.skipped} / fail ${r.failed}`); process.exit(0); })
    .catch((e) => { console.error("ERR", e); process.exit(1); });
}
