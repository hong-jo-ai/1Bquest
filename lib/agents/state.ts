import { saveWithSync, loadFromServer } from "../syncStorage";
import type { AgentId, AgentTask, TaskEvent, AgentResult, AgentStateSnapshot, AgentStatus } from "./types";

const KEYS = {
  state: "paulvice_agent_state_v1",
  tasks: "paulvice_agent_tasks_v1",
  events: "paulvice_agent_events_v1",
  results: "paulvice_agent_results_v1",
} as const;

function ls(key: string): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── Agent Status ──

export function getAgentStatuses(): Record<AgentId, { status: AgentStatus; lastRun?: string }> {
  return (ls(KEYS.state) as Record<AgentId, { status: AgentStatus; lastRun?: string }>) ?? {} as Record<AgentId, { status: AgentStatus; lastRun?: string }>;
}

export function setAgentStatus(agentId: AgentId, status: AgentStatus) {
  const current = getAgentStatuses();
  current[agentId] = { status, lastRun: status !== "idle" ? new Date().toISOString() : current[agentId]?.lastRun };
  saveWithSync(KEYS.state, current);
}

// ── Tasks ──

export function getTasks(): AgentTask[] {
  return (ls(KEYS.tasks) as AgentTask[]) ?? [];
}

export function addTask(task: AgentTask) {
  const tasks = getTasks();
  tasks.unshift(task);
  if (tasks.length > 100) tasks.length = 100;
  saveWithSync(KEYS.tasks, tasks);
}

export function updateTask(taskId: string, patch: Partial<AgentTask>) {
  const tasks = getTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], ...patch };
    saveWithSync(KEYS.tasks, tasks);
  }
}

// ── Events ──

export function getEvents(): TaskEvent[] {
  return (ls(KEYS.events) as TaskEvent[]) ?? [];
}

export function addEvent(event: TaskEvent) {
  const events = getEvents();
  events.unshift(event);
  if (events.length > 500) events.length = 500;
  saveWithSync(KEYS.events, events);
}

// ── Results ──

export function getResults(agentId?: AgentId): AgentResult[] {
  const all = (ls(KEYS.results) as AgentResult[]) ?? [];
  return agentId ? all.filter((r) => r.agentId === agentId) : all;
}

export function addResult(result: AgentResult) {
  const results = getResults();
  results.unshift(result);
  if (results.length > 200) results.length = 200;
  saveWithSync(KEYS.results, results);
}

// ── Sync from server ──

export async function syncAgentState() {
  const keys = [KEYS.state, KEYS.tasks, KEYS.events, KEYS.results] as const;
  await Promise.allSettled(keys.map((k) => loadFromServer(k)));
}

// ── Snapshot ──

export function getSnapshot(): AgentStateSnapshot {
  return {
    agents: getAgentStatuses(),
    recentEvents: getEvents().slice(0, 50),
    recentTasks: getTasks().slice(0, 50),
  };
}
