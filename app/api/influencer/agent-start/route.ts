import { NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import path from "path";

let agentProcess: ChildProcess | null = null;

const AGENT_SCRIPT = ["agent", "js"].join(".");
const AGENT_URL = "http://localhost:7777";

async function isAgentRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// GET: health check 프록시
export async function GET() {
  const running = await isAgentRunning();
  return NextResponse.json({ connected: running });
}

// POST: 자동 시작 + health check
export async function POST() {
  if (await isAgentRunning()) {
    return NextResponse.json({ status: "already_running" });
  }

  // 이전 프로세스가 죽었으면 정리
  if (agentProcess) {
    agentProcess.removeAllListeners();
    agentProcess = null;
  }

  const agentDir = path.join(process.cwd(), "local-agent");

  return new Promise<NextResponse>((resolve) => {
    agentProcess = spawn("node", [AGENT_SCRIPT], {
      cwd: agentDir,
      stdio: "ignore",
      detached: true,
      env: { ...process.env },
    });

    agentProcess.unref();

    agentProcess.on("error", (err) => {
      agentProcess = null;
      resolve(
        NextResponse.json(
          { status: "error", message: err.message },
          { status: 500 }
        )
      );
    });

    // 서버가 뜰 때까지 폴링 (최대 10초)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`${AGENT_URL}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          clearInterval(poll);
          resolve(NextResponse.json({ status: "started" }));
        }
      } catch {
        if (attempts >= 20) {
          clearInterval(poll);
          resolve(
            NextResponse.json(
              { status: "timeout", message: "에이전트 시작 시간 초과" },
              { status: 504 }
            )
          );
        }
      }
    }, 500);
  });
}
