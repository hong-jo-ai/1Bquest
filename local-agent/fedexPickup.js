/**
 * 페덱스 픽업 자동 예약 — 라벨을 뽑으면 픽업도 함께 잡는다(사장님 2026-10-02: "물어보지 말고 자동으로 함께 예약해줘").
 *
 * 왜: 라벨 발급(Ship API)은 기사를 부르지 않는다. 픽업을 따로 잡지 않으면 박스가 사무실에 그대로 남는다
 *   (shipping.md §6 "라벨 발급 ≠ 픽업 예약"). 매번 묻고 답하는 단계를 없앤다.
 *
 * 규칙:
 *   - 하루에 픽업은 한 번만. 같은 날 두 번째 라벨부터는 이미 잡힌 예약에 얹는다(kv `fedex_pickups`).
 *   - 평일 15:20 전이면 당일 15:00~18:00(지금까지 손으로 잡던 시간대). 15:00 을 넘겼으면 지금+5분부터.
 *   - 당일 마감(15:30)을 넘겼거나 주말·집하 휴무일이면 다음 영업일 15:00~18:00.
 *     휴무일은 우체국용 목록(parcelHolidays.NO_PICKUP)을 같이 쓴다 — 페덱스도 공휴일엔 픽업이 없다.
 *   - 예약 실패는 throw 하지 않고 { error } 로 돌려준다. 라벨은 이미 발급됐으므로 호출한 쪽이 크게 알려야 한다.
 */
const { createPickup } = require("./fedexShip");
const { isNoPickupDay } = require("./parcelHolidays");

const KEY = "fedex_pickups";
const kstParts = (d = new Date()) => {
  const s = d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // "YYYY-MM-DD HH:mm:ss"
  return { date: s.slice(0, 10), hm: s.slice(11, 16), dow: new Date(s.slice(0, 10) + "T12:00:00+09:00").getUTCDay() };
};
const isBusinessDay = (date) => { const dow = new Date(date + "T12:00:00+09:00").getUTCDay(); return dow >= 1 && dow <= 5 && !isNoPickupDay(date); };
const addDay = (date) => new Date(new Date(date + "T12:00:00+09:00").getTime() + 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/** 지금 기준으로 잡아야 할 픽업 날짜·준비 시각. */
function planPickup(now = new Date()) {
  const { date, hm } = kstParts(now);
  if (isBusinessDay(date) && hm < "15:20") {
    let ready = "15:00:00";
    if (hm >= "15:00") { const t = new Date(now.getTime() + 5 * 60000).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(11, 16); ready = `${t}:00`; }
    return { date, readyTime: ready, closeTime: "18:00:00", sameDay: true };
  }
  let d = addDay(date);
  for (let i = 0; i < 10 && !isBusinessDay(d); i++) d = addDay(d);
  return { date: d, readyTime: "15:00:00", closeTime: "18:00:00", sameDay: false };
}

/**
 * @param db supabase client
 * @param {{ trackingNumber: string, weightKg?: number, remarks?: string }} p
 * @returns {{ date, confirmation, window, existing?: boolean } | { error: string, date }}
 */
async function ensurePickup(db, p) {
  const plan = planPickup();
  const window = `${plan.readyTime.slice(0, 5)}~${plan.closeTime.slice(0, 5)}`;
  try {
    const { data } = await db.from("kv_store").select("data").eq("key", KEY).maybeSingle();
    const all = (data && data.data) || {};
    const cur = all[plan.date];
    if (cur && cur.confirmation) {
      cur.trackings = [...new Set([...(cur.trackings || []), p.trackingNumber])];
      await db.from("kv_store").upsert({ key: KEY, data: all, updated_at: new Date().toISOString() }, { onConflict: "key" });
      return { date: plan.date, confirmation: cur.confirmation, window: cur.window || window, existing: true };
    }
    const r = await createPickup({ date: plan.date, readyTime: plan.readyTime, closeTime: plan.closeTime, weightKg: p.weightKg || 0.8, packageCount: 1, trackingNumbers: [p.trackingNumber], remarks: p.remarks || "" });
    all[plan.date] = { confirmation: r.confirmation, location: r.location || "", window, bookedAt: new Date().toISOString(), trackings: [p.trackingNumber] };
    // 지난 날짜는 60일치만 남긴다
    for (const k of Object.keys(all).sort().slice(0, -60)) delete all[k];
    await db.from("kv_store").upsert({ key: KEY, data: all, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return { date: plan.date, confirmation: r.confirmation, window };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 300), date: plan.date };
  }
}

module.exports = { ensurePickup, planPickup };
