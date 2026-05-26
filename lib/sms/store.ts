/** SMS 발송 이력 저장/조회 (Supabase sms_sends). */
import { getCsSupabase } from "../cs/store";
import type { SmsResult } from "./solapi";

export interface SmsSendRecord {
  messageText: string;
  messageType: "SMS" | "LMS";
  sourceDesc?: string;
  recipientCount: number;
  successCount: number;
  failCount: number;
  estCost?: number;
  groupId?: string;
  results: SmsResult[];
  isTest?: boolean;
}

export async function logSmsSend(rec: SmsSendRecord): Promise<void> {
  const db = getCsSupabase();
  const { error } = await db.from("sms_sends").insert({
    message_text: rec.messageText,
    message_type: rec.messageType,
    source_desc: rec.sourceDesc ?? null,
    recipient_count: rec.recipientCount,
    success_count: rec.successCount,
    fail_count: rec.failCount,
    est_cost: rec.estCost ?? null,
    group_id: rec.groupId ?? null,
    results: rec.results,
    is_test: rec.isTest ?? false,
  });
  if (error) throw new Error(`sms_sends insert 실패: ${error.message}`);
}

export interface SmsHistoryRow {
  id: string;
  created_at: string;
  message_text: string;
  message_type: string;
  source_desc: string | null;
  recipient_count: number;
  success_count: number;
  fail_count: number;
  est_cost: number | null;
  is_test: boolean;
}

export async function listSmsSends(limit = 30): Promise<SmsHistoryRow[]> {
  const db = getCsSupabase();
  const { data, error } = await db
    .from("sms_sends")
    .select("id, created_at, message_text, message_type, source_desc, recipient_count, success_count, fail_count, est_cost, is_test")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listSmsSends 실패: ${error.message}`);
  return (data ?? []) as SmsHistoryRow[];
}
