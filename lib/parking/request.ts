/**
 * 텔레그램 on-demand 주차 2시간 할인권 등록 트리거.
 *
 * 사장님이 봇에 "주차 4330" 보내면 webhook이 여기에 차량번호를 기록하고,
 * 아이맥 triggerWatcher.js가 /api/parking/request 폴링 중 새 요청을 보면
 * parkingRegister.js <차량번호>를 실행해 사무실 주차시스템에 2시간 할인 등록 후 결과를 텔레그램 회신.
 * (배포 서버는 사무실 주차사이트(내부 IP)에 못 닿으므로 아이맥이 폴링·실행)
 */
import { createClient } from "@supabase/supabase-js";

const KV_KEY = "parking_request";

export interface ParkingRequest {
  carNo: string; // 4자리
  ts: string;    // ISO
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function storeParkingRequest(carNo: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const entry: ParkingRequest = { carNo, ts: new Date().toISOString() };
  const { error } = await db
    .from("kv_store")
    .upsert({ key: KV_KEY, data: entry, updated_at: entry.ts }, { onConflict: "key" });
  if (error) throw error;
}

export async function getParkingRequest(): Promise<ParkingRequest | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle();
  const e = (data as { data?: ParkingRequest } | null)?.data;
  return e && e.carNo ? e : null;
}

/** 텔레그램 메시지가 주차등록 명령이면 차량번호 4자리 반환, 아니면 null. ("주차 4330", "주차등록 4330번") */
export function parseParkingCommand(text: string): string | null {
  if (!/주차/.test(text)) return null;
  const m = text.match(/(\d{4})/);
  return m ? m[1] : null;
}
