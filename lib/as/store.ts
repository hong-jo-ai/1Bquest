import { getCsSupabase } from "@/lib/cs/store";
import type { CsBrandId } from "@/lib/cs/types";
import type { AsRequest, AsDestination, AsStatus } from "./types";

const TABLE = "as_requests";

/** KST 기준 YYMMDD (접수번호 prefix용) */
function kstDateStamp(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

export interface CreateAsInput {
  brand: CsBrandId;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  channel?: string | null;
  model?: string | null;
  symptom?: string | null;
  destination?: AsDestination | null;
  note?: string | null;
  csThreadId?: string | null;
}

/**
 * AS 접수 생성. 접수번호 AS-YYMMDD-NNN 자동 발번 (당일 순번).
 * 단일 운영자 환경이라 순번 경합은 사실상 없음.
 */
export async function createAsRequest(input: CreateAsInput): Promise<AsRequest> {
  const db = getCsSupabase();
  const stamp = kstDateStamp();

  const { count, error: cntErr } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .like("as_number", `AS-${stamp}-%`);
  if (cntErr) throw new Error(`AS 순번 조회 실패: ${cntErr.message}`);

  const seq = String((count ?? 0) + 1).padStart(3, "0");
  const as_number = `AS-${stamp}-${seq}`;

  const { data, error } = await db
    .from(TABLE)
    .insert({
      as_number,
      brand: input.brand,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      customer_address: input.customerAddress ?? null,
      channel: input.channel ?? null,
      model: input.model ?? null,
      symptom: input.symptom ?? null,
      destination: input.destination ?? null,
      note: input.note ?? null,
      cs_thread_id: input.csThreadId ?? null,
      status: "intake",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`AS 접수 생성 실패: ${error?.message}`);
  return data as AsRequest;
}

export async function listAsRequests(opts: {
  status?: AsStatus | "all";
  brand?: CsBrandId | "all";
  q?: string;
  limit?: number;
}): Promise<AsRequest[]> {
  const db = getCsSupabase();
  let qb = db
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);

  if (opts.status && opts.status !== "all") qb = qb.eq("status", opts.status);
  if (opts.brand && opts.brand !== "all") qb = qb.eq("brand", opts.brand);

  if (opts.q && opts.q.trim()) {
    // 콤마/퍼센트는 or-필터 파싱을 깨뜨리므로 제거
    const term = opts.q.trim().replace(/[%,]/g, " ");
    const like = `%${term}%`;
    qb = qb.or(
      [
        `model.ilike.${like}`,
        `symptom.ilike.${like}`,
        `customer_name.ilike.${like}`,
        `customer_phone.ilike.${like}`,
        `as_number.ilike.${like}`,
        `repair_detail.ilike.${like}`,
      ].join(",")
    );
  }

  const { data, error } = await qb;
  if (error) throw new Error(`listAsRequests 실패: ${error.message}`);
  return (data ?? []) as AsRequest[];
}

/** 상태별 개수 (탭 배지용) */
export async function countAsByStatus(opts: {
  brand?: CsBrandId | "all";
}): Promise<Record<AsStatus | "all", number>> {
  const db = getCsSupabase();
  const statuses: AsStatus[] = [
    "intake",
    "repairing",
    "repaired",
    "notified",
    "shipped",
  ];
  const entries = await Promise.all(
    statuses.map(async (status) => {
      let q = db
        .from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (opts.brand && opts.brand !== "all") q = q.eq("brand", opts.brand);
      const { count, error } = await q;
      if (error) throw new Error(`countAsByStatus 실패: ${error.message}`);
      return [status, count ?? 0] as const;
    })
  );
  const m = Object.fromEntries(entries) as Record<AsStatus, number>;
  return {
    ...m,
    all: m.intake + m.repairing + m.repaired + m.notified + m.shipped,
  };
}

export async function getAsRequestsByIds(ids: string[]): Promise<AsRequest[]> {
  if (ids.length === 0) return [];
  const db = getCsSupabase();
  const { data, error } = await db.from(TABLE).select("*").in("id", ids);
  if (error) throw new Error(`getAsRequestsByIds 실패: ${error.message}`);
  return (data ?? []) as AsRequest[];
}

export interface UpdateAsInput {
  status?: AsStatus;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  channel?: string | null;
  model?: string | null;
  symptom?: string | null;
  destination?: AsDestination | null;
  repairDetail?: string | null;
  repairCost?: number | null;
  returnTrackingNo?: string | null;
  note?: string | null;
}

const FIELD_MAP: Record<keyof UpdateAsInput, string> = {
  status: "status",
  customerName: "customer_name",
  customerPhone: "customer_phone",
  customerAddress: "customer_address",
  channel: "channel",
  model: "model",
  symptom: "symptom",
  destination: "destination",
  repairDetail: "repair_detail",
  repairCost: "repair_cost",
  returnTrackingNo: "return_tracking_no",
  note: "note",
};

export async function updateAsRequest(
  id: string,
  patch: UpdateAsInput
): Promise<AsRequest> {
  const db = getCsSupabase();
  const fields: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(FIELD_MAP)) {
    const v = patch[k as keyof UpdateAsInput];
    if (v !== undefined) fields[col] = v;
  }
  // 발송완료로 전환되면 발송 시각 기록
  if (patch.status === "shipped") {
    fields.shipped_at = new Date().toISOString();
  }
  if (Object.keys(fields).length === 0) {
    const { data } = await db.from(TABLE).select("*").eq("id", id).single();
    return data as AsRequest;
  }

  const { data, error } = await db
    .from(TABLE)
    .update(fields)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`AS 갱신 실패: ${error?.message}`);
  return data as AsRequest;
}

/** AS 접수 삭제 (중복/오등록 제거용). */
export async function deleteAsRequest(id: string): Promise<void> {
  const db = getCsSupabase();
  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`AS 삭제 실패: ${error.message}`);
}
