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
