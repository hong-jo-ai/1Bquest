import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = "http://localhost:7777";

// POST: local-agent의 엔드포인트를 프록시
// body에 { endpoint, ...params } 형태로 전달
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint, ...params } = body;

    if (!endpoint || typeof endpoint !== "string") {
      return NextResponse.json(
        { error: "endpoint is required" },
        { status: 400 }
      );
    }

    const res = await fetch(`${AGENT_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(120000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent proxy error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
