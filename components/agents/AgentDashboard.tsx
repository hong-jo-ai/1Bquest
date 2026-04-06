"use client";

import { useState, useCallback, useEffect } from "react";
import { Bot, Workflow, Activity, RefreshCw } from "lucide-react";
import type { AgentId, AgentStatus, AgentResult } from "@/lib/agents/types";
import { AGENTS } from "@/lib/agents/registry";
import { WORKFLOWS } from "@/lib/agents/orchestrator";
import AgentCard from "./AgentCard";
import EventLog from "./EventLog";

interface AgentState {
  status: AgentStatus;
  lastRun?: string;
  lastResult?: Record<string, unknown> | null;
}

interface LogEntry {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  message?: string;
}

export default function AgentDashboard() {
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
  const [runningWorkflow, setRunningWorkflow] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"agents" | "workflows" | "events">("agents");

  // 에이전트 상태 초기화
  useEffect(() => {
    const initial: Record<string, AgentState> = {};
    for (const a of AGENTS) {
      initial[a.id] = { status: "idle" };
    }
    setAgents(initial);
  }, []);

  // 개별 에이전트 실행
  const runAgent = useCallback(async (agentId: AgentId) => {
    setRunningAgents((prev) => new Set(prev).add(agentId));
    setAgents((prev) => ({
      ...prev,
      [agentId]: { ...prev[agentId], status: "running" },
    }));

    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });

      const data = await res.json();

      if (data.ok && data.result) {
        const result: AgentResult = data.result;

        setAgents((prev) => ({
          ...prev,
          [agentId]: {
            status: result.status === "error" ? "error" : "success",
            lastRun: result.timestamp,
            lastResult: result.output,
          },
        }));

        // 이벤트 추가
        if (result.events?.length > 0) {
          setEvents((prev) => [
            ...result.events.map((e) => ({
              id: e.id,
              type: e.type,
              source: e.source,
              timestamp: e.timestamp,
              message: JSON.stringify(e.payload).slice(0, 100),
            })),
            ...prev,
          ].slice(0, 100));
        }

        // data-collector 결과로 research-analyst 자동 실행 가능하도록 저장
        if (agentId === "data-collector" && result.status === "success") {
          setEvents((prev) => [{
            id: `log_${Date.now()}`,
            type: "system.info",
            source: "orchestrator",
            timestamp: new Date().toISOString(),
            message: "데이터 수집 완료. '리서치' 에이전트를 실행하면 수집 데이터를 분석합니다.",
          }, ...prev]);
        }
      } else {
        setAgents((prev) => ({
          ...prev,
          [agentId]: {
            ...prev[agentId],
            status: "error",
            lastRun: new Date().toISOString(),
            lastResult: { error: data.error || "Unknown error" },
          },
        }));
      }
    } catch (err) {
      setAgents((prev) => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          status: "error",
          lastRun: new Date().toISOString(),
          lastResult: { error: err instanceof Error ? err.message : "Network error" },
        },
      }));
    } finally {
      setRunningAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }
  }, []);

  // 워크플로우 실행
  const runWorkflow = useCallback(async (workflowId: string) => {
    setRunningWorkflow(workflowId);

    const workflow = WORKFLOWS.find((w) => w.id === workflowId);
    if (!workflow) return;

    // 워크플로우의 모든 에이전트를 running 상태로
    for (const step of workflow.steps) {
      setAgents((prev) => ({
        ...prev,
        [step.agentId]: { ...prev[step.agentId], status: "running" },
      }));
    }

    try {
      const res = await fetch("/api/agents/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId }),
      });

      const data = await res.json();

      if (data.ok && data.run) {
        // 각 스텝의 결과를 에이전트 상태에 반영
        for (const [stepId, task] of Object.entries(data.run.steps)) {
          const t = task as { agentId: string; status: string; output?: Record<string, unknown>; completedAt?: string };
          setAgents((prev) => ({
            ...prev,
            [t.agentId]: {
              status: t.status === "completed" ? "success" : t.status === "failed" ? "error" : "idle",
              lastRun: t.completedAt ?? new Date().toISOString(),
              lastResult: t.output ?? null,
            },
          }));
        }

        setEvents((prev) => [{
          id: `wf_${Date.now()}`,
          type: `workflow.${data.run.status}`,
          source: "orchestrator",
          timestamp: data.run.completedAt ?? new Date().toISOString(),
          message: `워크플로우 '${workflow.name}' ${data.run.status === "completed" ? "완료" : "부분 완료"}`,
        }, ...prev]);
      }
    } catch (err) {
      setEvents((prev) => [{
        id: `wf_err_${Date.now()}`,
        type: "workflow.failed",
        source: "orchestrator",
        timestamp: new Date().toISOString(),
        message: `워크플로우 오류: ${err instanceof Error ? err.message : "Unknown"}`,
      }, ...prev]);
    } finally {
      setRunningWorkflow(null);
    }
  }, []);

  const runningCount = runningAgents.size + (runningWorkflow ? 1 : 0);
  const successCount = Object.values(agents).filter((a) => a.status === "success").length;
  const errorCount = Object.values(agents).filter((a) => a.status === "error").length;

  return (
    <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Bot size={22} className="text-violet-500" />
            에이전트 팀
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            9개 AI 에이전트가 매출 극대화를 위해 유기적으로 작동합니다
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            {runningCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                실행 중 {runningCount}
              </span>
            )}
            {successCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                완료 {successCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                오류 {errorCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1 w-fit">
        {([
          { key: "agents" as const, label: "에이전트", icon: Bot },
          { key: "workflows" as const, label: "워크플로우", icon: Workflow },
          { key: "events" as const, label: "이벤트 로그", icon: Activity },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === key
                ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            <Icon size={14} />
            {label}
            {key === "events" && events.length > 0 && (
              <span className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1.5 rounded-full">
                {events.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 에이전트 그리드 */}
      {activeTab === "agents" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENTS.map((config) => (
            <AgentCard
              key={config.id}
              config={config}
              status={agents[config.id]?.status ?? "idle"}
              lastRun={agents[config.id]?.lastRun}
              lastResult={agents[config.id]?.lastResult}
              onRun={() => runAgent(config.id)}
              isRunning={runningAgents.has(config.id)}
            />
          ))}
        </div>
      )}

      {/* 워크플로우 */}
      {activeTab === "workflows" && (
        <div className="space-y-4">
          {WORKFLOWS.map((wf) => (
            <div
              key={wf.id}
              className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Workflow size={16} className="text-violet-500" />
                    {wf.name}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">{wf.description}</p>
                </div>
                <button
                  onClick={() => runWorkflow(wf.id)}
                  disabled={!!runningWorkflow}
                  className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white transition-colors"
                >
                  {runningWorkflow === wf.id ? (
                    <><RefreshCw size={12} className="animate-spin" /> 실행 중...</>
                  ) : (
                    <><Workflow size={12} /> 워크플로우 실행</>
                  )}
                </button>
              </div>
              {/* Steps */}
              <div className="flex items-center gap-2 flex-wrap">
                {wf.steps.map((step, i) => {
                  const agentName = AGENTS.find((a) => a.id === step.agentId)?.name ?? step.agentId;
                  const agentState = agents[step.agentId];
                  const dotColor =
                    agentState?.status === "running" ? "bg-amber-400 animate-pulse" :
                    agentState?.status === "success" ? "bg-emerald-400" :
                    agentState?.status === "error" ? "bg-red-400" : "bg-zinc-300";
                  return (
                    <div key={step.id} className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700">
                        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                        <span className="text-xs text-zinc-600 dark:text-zinc-300">{agentName}</span>
                      </div>
                      {i < wf.steps.length - 1 && (
                        <span className="text-zinc-300 dark:text-zinc-600 text-xs">&rarr;</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 이벤트 로그 */}
      {activeTab === "events" && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Activity size={16} className="text-violet-500" />
              이벤트 로그
            </h3>
            {events.length > 0 && (
              <button
                onClick={() => setEvents([])}
                className="text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                초기화
              </button>
            )}
          </div>
          <EventLog entries={events} />
        </div>
      )}
    </main>
  );
}
