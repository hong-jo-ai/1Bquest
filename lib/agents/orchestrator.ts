import type { AgentId, AgentTask, AgentResult, TaskEvent, WorkflowDef, WorkflowRun, WorkflowStep } from "./types";

// ── Agent Runner Interface ──
export type AgentRunner = (task: AgentTask) => Promise<AgentResult>;

const runners: Partial<Record<AgentId, AgentRunner>> = {};

export function registerRunner(agentId: AgentId, runner: AgentRunner) {
  runners[agentId] = runner;
}

export function getRunner(agentId: AgentId): AgentRunner | undefined {
  return runners[agentId];
}

// ── Task Execution ──

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTask(agentId: AgentId, task: string, inputs?: Record<string, unknown>): AgentTask {
  return {
    id: `task_${makeId()}`,
    agentId,
    status: "pending",
    task,
    inputs,
    createdAt: new Date().toISOString(),
  };
}

export function createEvent(type: string, source: AgentId, payload: Record<string, unknown> = {}): TaskEvent {
  return {
    id: `evt_${makeId()}`,
    type,
    source,
    payload,
    timestamp: new Date().toISOString(),
  };
}

export async function executeTask(task: AgentTask): Promise<AgentResult> {
  const runner = runners[task.agentId];
  if (!runner) {
    return {
      agentId: task.agentId,
      taskId: task.id,
      status: "error",
      output: { error: `No runner registered for agent: ${task.agentId}` },
      events: [],
      timestamp: new Date().toISOString(),
    };
  }

  task.status = "running";
  task.startedAt = new Date().toISOString();

  try {
    const result = await runner(task);
    task.status = result.status === "error" ? "failed" : "completed";
    task.completedAt = new Date().toISOString();
    task.output = result.output;
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    task.status = "failed";
    task.completedAt = new Date().toISOString();
    task.error = message;
    return {
      agentId: task.agentId,
      taskId: task.id,
      status: "error",
      output: { error: message },
      events: [],
      timestamp: new Date().toISOString(),
    };
  }
}

// ── Workflow Execution ──

export async function executeWorkflow(
  workflow: WorkflowDef,
  onStepComplete?: (stepId: string, result: AgentResult) => void
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id: `wf_${makeId()}`,
    workflowId: workflow.id,
    status: "running",
    steps: {},
    startedAt: new Date().toISOString(),
  };

  const completed = new Set<string>();
  const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));

  function canRun(step: WorkflowStep): boolean {
    if (!step.dependsOn || step.dependsOn.length === 0) return true;
    return step.dependsOn.every((depId) => completed.has(depId));
  }

  const pending = new Set(workflow.steps.map((s) => s.id));

  while (pending.size > 0) {
    const runnable = workflow.steps.filter((s) => pending.has(s.id) && canRun(s));
    if (runnable.length === 0) break;

    const results = await Promise.allSettled(
      runnable.map(async (step) => {
        const task = createTask(step.agentId, step.task, step.inputs);
        run.steps[step.id] = task;
        const result = await executeTask(task);
        run.steps[step.id] = task;
        return { stepId: step.id, result };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        completed.add(r.value.stepId);
        pending.delete(r.value.stepId);
        onStepComplete?.(r.value.stepId, r.value.result);
      } else {
        const failedStep = runnable.find((s) => !completed.has(s.id));
        if (failedStep) {
          completed.add(failedStep.id);
          pending.delete(failedStep.id);
        }
      }
    }
  }

  const allCompleted = Object.values(run.steps).every((t) => t.status === "completed");
  const anyFailed = Object.values(run.steps).some((t) => t.status === "failed");
  run.status = allCompleted ? "completed" : anyFailed ? "partial" : "completed";
  run.completedAt = new Date().toISOString();

  return run;
}

// ── Pre-built Workflows ──

export const WORKFLOWS: WorkflowDef[] = [
  {
    id: "daily-optimization",
    name: "일일 최적화",
    description: "데이터 수집 → 분석 → 전략 수립 → 실행",
    steps: [
      { id: "collect", agentId: "data-collector", task: "전체 데이터 수집 (Cafe24+재고+GA4+Meta)" },
      { id: "analyze", agentId: "research-analyst", task: "수집 데이터 분석 및 저조 상품 식별", dependsOn: ["collect"] },
      { id: "plan", agentId: "strategy-planner", task: "분석 결과 기반 당일 액션 플랜 수립", dependsOn: ["analyze"] },
    ],
  },
  {
    id: "underperformer-rescue",
    name: "저조 상품 구출",
    description: "분석 → 전략 → 카피+디자인+머천다이징 → 마케팅",
    steps: [
      { id: "analyze", agentId: "research-analyst", task: "저조 상품 심층 원인 분석" },
      { id: "plan", agentId: "strategy-planner", task: "구출 전략 수립", dependsOn: ["analyze"] },
      { id: "copy", agentId: "copywriter", task: "프로모션 카피 작성 (배너+상세+SNS)", dependsOn: ["plan"] },
      { id: "design", agentId: "designer", task: "할인 배너 + 상세페이지 이미지 프롬프트 생성", dependsOn: ["plan"] },
      { id: "merch", agentId: "merchandiser", task: "진열 순서 변경 + 가격 조정 전략", dependsOn: ["plan"] },
      { id: "marketing", agentId: "marketing", task: "Meta 리타겟팅 캠페인 + SNS 발행 계획", dependsOn: ["copy", "design"] },
    ],
  },
  {
    id: "inventory-aging",
    name: "재고 에이징 긴급 조치",
    description: "에이징 상품 소진 전략 → 카피+배너 → 마케팅",
    steps: [
      { id: "merch", agentId: "merchandiser", task: "에이징 상품 클리어런스 전략 수립 (할인율, 번들, 진열)" },
      { id: "copy", agentId: "copywriter", task: "긴급 특가 카피 작성", dependsOn: ["merch"] },
      { id: "design", agentId: "designer", task: "세일 배너 이미지 프롬프트 생성", dependsOn: ["merch"] },
      { id: "marketing", agentId: "marketing", task: "리타겟팅 캠페인 + 프로모션 발행", dependsOn: ["copy", "design"] },
    ],
  },
  {
    id: "content-pipeline",
    name: "콘텐츠 파이프라인",
    description: "트렌드 리서치 → 카피 → 디자인 → 발행",
    steps: [
      { id: "research", agentId: "research-analyst", task: "트렌딩 토픽 + 시즌 키워드 조사" },
      { id: "copy", agentId: "copywriter", task: "SNS 콘텐츠 카피 작성", dependsOn: ["research"] },
      { id: "design", agentId: "designer", task: "인스타/스레드 비주얼 에셋 프롬프트 생성", dependsOn: ["copy"] },
      { id: "evaluate", agentId: "prompt-engineer", task: "생성 콘텐츠 품질 평가", dependsOn: ["copy", "design"] },
      { id: "marketing", agentId: "marketing", task: "발행 스케줄링", dependsOn: ["evaluate"] },
    ],
  },
  {
    id: "weekly-product-dev",
    name: "주간 상품개발",
    description: "데이터 수집 → 갭 분석 → ROI 평가",
    steps: [
      { id: "collect", agentId: "data-collector", task: "최근 4주 매출 + 재고 데이터 수집" },
      { id: "productdev", agentId: "product-dev", task: "갭 분석 + 신상품 아이디어 + 소싱 키워드", dependsOn: ["collect"] },
      { id: "evaluate", agentId: "strategy-planner", task: "ROI 예측 + 우선순위 평가", dependsOn: ["productdev"] },
    ],
  },
];
