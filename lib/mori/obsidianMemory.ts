/**
 * Obsidian Vault 기반 장기 기억 로더.
 *
 * 원본 운영 데이터는 DB/도구가 담당하고, Obsidian은 대표님이 직접 읽고 고치는
 * "기억 편집실" 역할을 한다. 서버에서만 Markdown 파일을 읽어 모리 system context에
 * 짧은 장기 기억 블록으로 주입한다.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_VAULT_PATH = "/Users/mac/sungjo_ai/MORI Memory";
const DB_MEMORY_KEY = "mori:obsidian_memory_notes";
const MAX_FILES = 60;
const MAX_FILE_CHARS = 1_800;
const MAX_CONTEXT_CHARS = 12_000;

const TYPE_LABELS: Record<string, string> = {
  owner_preference: "대표님 선호",
  brand_rule: "브랜드 규칙",
  product_memory: "제품 기억",
  decision_log: "결정 기록",
  playbook: "플레이북",
  prompt: "프롬프트",
};

const TYPE_FOLDERS: Record<string, string> = {
  owner_preference: "10_Profile",
  brand_rule: "20_Brand_Rules",
  product_memory: "30_Products",
  decision_log: "40_Decisions",
  playbook: "50_Playbooks",
  prompt: "60_Prompts",
  memory: "00_Inbox",
};

const ALLOWED_TYPES = new Set(Object.keys(TYPE_FOLDERS));

interface MemoryNote {
  title: string;
  relPath: string;
  type: string;
  status: string;
  updatedAt: string;
  body: string;
}

export interface SaveObsidianMemoryInput {
  title?: string;
  body?: string;
  type?: string;
  status?: string;
  source?: string;
}

export type SaveObsidianMemoryResult =
  | { ok: true; relPath: string; message: string }
  | { ok: false; error: string };

function vaultPath(): string {
  return process.env.MORI_OBSIDIAN_VAULT?.trim() || DEFAULT_VAULT_PATH;
}

function memoryDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = stripBom(raw);
  if (!text.startsWith("---\n")) return { meta: {}, body: text.trim() };

  const end = text.indexOf("\n---", 4);
  if (end < 0) return { meta: {}, body: text.trim() };

  const metaText = text.slice(4, end).trim();
  const body = text.slice(end + 4).trim();
  const meta: Record<string, string> = {};

  for (const line of metaText.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    meta[m[1]] = value;
  }

  return { meta, body };
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(path.relative(root, full));
    }
  }
}

function priority(note: MemoryNote): number {
  const p = note.relPath;
  if (p.startsWith("10_Profile")) return 0;
  if (p.startsWith("20_Brand_Rules")) return 1;
  if (p.startsWith("50_Playbooks")) return 2;
  if (p.startsWith("30_Products")) return 3;
  if (p.startsWith("40_Decisions")) return 4;
  if (p.startsWith("60_Prompts")) return 5;
  return 9;
}

function titleFrom(relPath: string, body: string): string {
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (h1) return h1;
  return path.basename(relPath, path.extname(relPath)).replace(/_/g, " ");
}

function normalizeBody(body: string): string {
  return body
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_FILE_CHARS);
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeType(raw: unknown): string {
  const t = String(raw ?? "memory").trim();
  return ALLOWED_TYPES.has(t) ? t : "memory";
}

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? "active").trim();
  return s === "archived" || s === "draft" ? s : "active";
}

function slugFileName(title: string): string {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return base || `memory_${Date.now()}`;
}

async function uniqueRelPath(folder: string, title: string): Promise<string> {
  const root = vaultPath();
  const safeFolder = TYPE_FOLDERS[folder] ? TYPE_FOLDERS[folder] : folder;
  const fileBase = slugFileName(title);
  let rel = path.join(safeFolder, `${fileBase}.md`);
  for (let i = 2; ; i++) {
    try {
      await stat(path.join(root, rel));
      rel = path.join(safeFolder, `${fileBase}_${i}.md`);
    } catch {
      return rel;
    }
  }
}

function yamlScalar(s: string): string {
  return JSON.stringify(s);
}

function asDbNote(row: any): MemoryNote | null {
  const title = String(row?.title ?? "").trim();
  const body = normalizeBody(String(row?.body ?? ""));
  if (!title || !body) return null;

  return {
    title,
    relPath: String(row?.relPath ?? row?.rel_path ?? "db/memory.md"),
    type: normalizeType(row?.type),
    status: normalizeStatus(row?.status),
    updatedAt: String(row?.updatedAt ?? row?.updated_at ?? ""),
    body,
  };
}

async function loadDbMemoryNotes(): Promise<MemoryNote[]> {
  const db = memoryDb();
  if (!db) return [];

  const { data, error } = await db
    .from("kv_store")
    .select("data")
    .eq("key", DB_MEMORY_KEY)
    .maybeSingle();

  if (error || !Array.isArray(data?.data)) return [];

  return data.data
    .map(asDbNote)
    .filter((note): note is MemoryNote => note !== null && note.status === "active");
}

async function saveDbMemoryNote(note: MemoryNote): Promise<SaveObsidianMemoryResult> {
  const db = memoryDb();
  if (!db) {
    return { ok: false, error: "Obsidian Vault 접근 실패, Supabase memory fallback 미설정" };
  }

  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", DB_MEMORY_KEY)
    .maybeSingle();

  const current = Array.isArray(data?.data)
    ? data.data.map(asDbNote).filter((n): n is MemoryNote => n !== null)
    : [];
  const next = [...current, note].slice(-200);

  const { error } = await db
    .from("kv_store")
    .upsert(
      {
        key: DB_MEMORY_KEY,
        data: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true, relPath: note.relPath, message: `Obsidian 기억 저장 완료(DB): ${note.relPath}` };
}

export async function saveObsidianMemoryNote(
  input: SaveObsidianMemoryInput,
): Promise<SaveObsidianMemoryResult> {
  const title = String(input.title ?? "").trim();
  const body = normalizeBody(String(input.body ?? ""));
  if (!title) return { ok: false, error: "title 필수" };
  if (!body) return { ok: false, error: "body 필수" };

  const type = normalizeType(input.type);
  const status = normalizeStatus(input.status);
  const source = String(input.source ?? "mori").trim() || "mori";
  const folder = TYPE_FOLDERS[type] ?? TYPE_FOLDERS.memory;
  const relPath = await uniqueRelPath(folder, title);
  const root = vaultPath();
  const fullPath = path.join(root, relPath);

  try {
    await mkdir(path.dirname(fullPath), { recursive: true });
    const markdown = `---\ntype: ${yamlScalar(type)}\nstatus: ${yamlScalar(status)}\nupdated_at: ${yamlScalar(todayKst())}\nsource: ${yamlScalar(source)}\n---\n\n# ${title}\n\n${body}\n`;
    await writeFile(fullPath, markdown, "utf8");
    return { ok: true, relPath, message: `Obsidian 기억 저장 완료: ${relPath}` };
  } catch (e: any) {
    return saveDbMemoryNote({
      title,
      relPath: `db/${relPath}`,
      type,
      status,
      updatedAt: todayKst(),
      body,
    });
  }
}

async function loadFileMemoryNotes(): Promise<MemoryNote[]> {
  const root = vaultPath();
  try {
    const s = await stat(root);
    if (!s.isDirectory()) return [];
  } catch {
    return [];
  }

  const relPaths: string[] = [];
  await walk(root, root, relPaths);

  const notes: MemoryNote[] = [];
  for (const relPath of relPaths.slice(0, MAX_FILES * 2)) {
    try {
      const raw = await readFile(path.join(root, relPath), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const status = meta.status || "active";
      if (status !== "active") continue;

      notes.push({
        title: titleFrom(relPath, body),
        relPath,
        type: meta.type || "memory",
        status,
        updatedAt: meta.updated_at || meta.updated || "",
        body: normalizeBody(body),
      });
    } catch {
      // 파일 하나가 깨져도 나머지 기억은 계속 읽는다.
    }
  }

  return notes
    .filter((n) => n.body)
    .sort((a, b) => {
      const byPriority = priority(a) - priority(b);
      if (byPriority !== 0) return byPriority;
      return b.updatedAt.localeCompare(a.updatedAt) || a.relPath.localeCompare(b.relPath);
    })
    .slice(0, MAX_FILES);
}

export async function loadObsidianMemoryNotes(): Promise<MemoryNote[]> {
  const notes = [...(await loadFileMemoryNotes()), ...(await loadDbMemoryNotes())];

  return notes
    .filter((n) => n.body)
    .sort((a, b) => {
      const byPriority = priority(a) - priority(b);
      if (byPriority !== 0) return byPriority;
      return b.updatedAt.localeCompare(a.updatedAt) || a.relPath.localeCompare(b.relPath);
    })
    .slice(0, MAX_FILES);
}

export async function buildObsidianMemoryContext(): Promise<string> {
  const notes = await loadObsidianMemoryNotes();
  if (notes.length === 0) return "";

  let used = 0;
  const chunks: string[] = [];
  for (const note of notes) {
    const label = TYPE_LABELS[note.type] ?? note.type;
    const header = `### ${note.title}\n- 분류: ${label}\n- 파일: ${note.relPath}`;
    const updated = note.updatedAt ? `\n- 갱신: ${note.updatedAt}` : "";
    const chunk = `${header}${updated}\n${note.body}`;
    if (used + chunk.length > MAX_CONTEXT_CHARS) break;
    chunks.push(chunk);
    used += chunk.length;
  }

  if (chunks.length === 0) return "";

  return `# 모리 장기 기억 (Obsidian Vault)

아래 내용은 대표님이 직접 관리하는 장기 기억입니다. 현재 대시보드 데이터보다 오래된 운영 원칙·선호·플레이북으로 사용하세요.
대시보드 실시간 수치와 충돌하면 실시간 수치를 우선하고, 장기 기억은 판단 기준으로만 쓰세요.

${chunks.join("\n\n")}`;
}
