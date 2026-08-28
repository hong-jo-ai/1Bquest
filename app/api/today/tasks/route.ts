/**
 * /today 보드의 할일 (조직 축 domain 을 가진다).
 *
 *   GET → { ok, tasks }
 *   PUT { tasks } → 통째 저장
 *
 * 기존 today-hub 의 today_hub:tasks 와는 별도 키다. 저쪽은 기능 축(category)이고
 * 이쪽은 조직 축(domain)이라 스키마가 다르다. 섞으면 둘 다 깨진다.
 */
import type { NextRequest } from "next/server";
import { getTasks, putTasks } from "@/lib/today/tasks";
import type { Task } from "@/lib/today/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const { tasks, error } = await getTasks();
  if (error) return Response.json({ ok: false, error }, { status: 500 });
  return Response.json({ ok: true, tasks });
}

export async function PUT(req: NextRequest) {
  let body: { tasks?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!Array.isArray(body.tasks)) {
    return Response.json({ ok: false, error: "tasks 배열 필수" }, { status: 400 });
  }

  const { ok, error } = await putTasks(body.tasks as Task[]);
  if (!ok) return Response.json({ ok: false, error }, { status: 500 });
  return Response.json({ ok: true });
}
