/**
 * 모리↔Claude Code 브리지 큐 (kv_store claude_task:*).
 * 텔레그램 webhook 이 지시를 적재 → 아이맥 claudeBridge.js 워처가 헤드리스 Claude Code 로 수행.
 */
import { createClient } from "@supabase/supabase-js";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** "클로드 ..." / "코드 ..." / "cc ..." 접두 명령 → 지시 텍스트 추출 (아니면 null). */
export function parseClaudeCommand(text: string): string | null {
  const m = text.match(/^\s*(클로드|코드|cc)\s+([\s\S]+)/i);
  const task = m ? m[2].trim() : null;
  return task && task.length >= 2 ? task : null;
}

/** 확인 게이트 응답 파싱. 승인=true, 거부=false, 해당없음=null. */
export function parseYesNo(text: string): boolean | null {
  const t = text.trim().toLowerCase().replace(/[.!~\s]+$/g, "");
  if (/^(예|네|넵|응|어|그래|좋아|확인|승인|진행|ㅇㅇ|ㅇㅋ|ok|okay|yes|y|go|approve|허용)$/i.test(t)) return true;
  if (/^(아니|아니오|아니요|노|취소|중단|하지마|멈춰|ㄴㄴ|no|n|cancel|stop|거부|deny)$/i.test(t)) return false;
  return null;
}

/**
 * 가장 최근의 대기중(claude_confirm:* status="waiting") 확인요청을 승인/거부로 기록.
 * 처리한 작업 내용(action)을 반환, 대기중인 게 없으면 null.
 */
export async function resolveClaudeConfirm(approved: boolean): Promise<string | null> {
  const client = sb();
  const { data } = await client.from("kv_store").select("key,data").like("key", "claude_confirm:%");
  const waiting = (data || [])
    .filter((r: { data: { status?: string } }) => r.data && r.data.status === "waiting")
    .sort((a: { data: { createdAt?: string } }, b: { data: { createdAt?: string } }) =>
      String(b.data.createdAt).localeCompare(String(a.data.createdAt)));
  const target = waiting[0];
  if (!target) return null;
  await client
    .from("kv_store")
    .update({ data: { ...target.data, status: approved ? "approved" : "denied" }, updated_at: new Date().toISOString() })
    .eq("key", target.key);
  return target.data.action || "(작업)";
}

export async function enqueueClaudeTask(instruction: string, chatId: number | string): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await sb()
    .from("kv_store")
    .upsert(
      {
        key: `claude_task:${id}`,
        data: { instruction, chatId, status: "pending", createdAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
  return id;
}
