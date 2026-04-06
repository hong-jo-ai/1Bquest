export type AgentId =
  | "data-collector"
  | "research-analyst"
  | "strategy-planner"
  | "copywriter"
  | "designer"
  | "marketing"
  | "merchandiser"
  | "product-dev"
  | "prompt-engineer";

export type AgentStatus = "idle" | "running" | "success" | "error";
export type LlmProvider = "claude" | "gemini" | "none";

export interface AgentConfig {
  id: AgentId;
  name: string;
  nameEn: string;
  description: string;
  icon: string;
  llm: LlmProvider;
  capabilities: string[];
}

export interface TaskEvent {
  id: string;
  type: string;
  source: AgentId;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface AgentTask {
  id: string;
  agentId: AgentId;
  status: "pending" | "running" | "completed" | "failed";
  task: string;
  inputs?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface AgentResult {
  agentId: AgentId;
  taskId: string;
  status: "success" | "partial" | "error";
  output: Record<string, unknown>;
  events: TaskEvent[];
  timestamp: string;
}

export interface WorkflowStep {
  id: string;
  agentId: AgentId;
  task: string;
  dependsOn?: string[];
  inputs?: Record<string, unknown>;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "partial" | "failed";
  steps: Record<string, AgentTask>;
  startedAt: string;
  completedAt?: string;
}

export interface AgentStateSnapshot {
  agents: Record<AgentId, { status: AgentStatus; lastRun?: string; lastResult?: AgentResult }>;
  recentEvents: TaskEvent[];
  recentTasks: AgentTask[];
}
