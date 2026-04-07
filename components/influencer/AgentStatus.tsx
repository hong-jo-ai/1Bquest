"use client";

import { useState, useEffect, useCallback } from "react";
import { Wifi, WifiOff, Bot, ExternalLink, RefreshCw } from "lucide-react";

const AGENT_API = "/api/influencer/agent-start";
const PROXY_API = "/api/influencer/agent-proxy";

interface AgentState {
  connected: boolean;
  checking: boolean;
  browser: string;
  instagram: string;
}

interface Props {
  onDiscoverWithAgent: (hashtags: string[]) => void;
}

export default function AgentStatus({ onDiscoverWithAgent }: Props) {
  const [state, setState] = useState<AgentState>({
    connected: false, checking: false, browser: "idle", instagram: "",
  });

  const check = useCallback(async () => {
    setState((s) => ({ ...s, checking: true }));
    try {
      const res = await fetch(AGENT_API);
      if (res.ok) {
        const data = await res.json();
        setState({ connected: data.connected, checking: false, browser: "idle", instagram: "" });
      } else {
        setState((s) => ({ ...s, connected: false, checking: false }));
      }
    } catch {
      setState((s) => ({ ...s, connected: false, checking: false }));
    }
  }, []);

  // 30초마다 자동 확인
  useEffect(() => {
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [check]);

  const handleOpenBrowser = async () => {
    try {
      await fetch(PROXY_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "/open-browser" }),
      });
      setTimeout(check, 2000);
    } catch { /* ignore */ }
  };

  if (!state.connected && !state.checking) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
        <WifiOff size={13} className="text-zinc-400" />
        <span className="text-xs text-zinc-400">로컬 에이전트 미연결</span>
        <button
          onClick={check}
          className="text-[10px] text-violet-500 hover:text-violet-700 underline ml-1"
        >
          연결 확인
        </button>
      </div>
    );
  }

  if (state.checking) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800">
        <RefreshCw size={13} className="text-zinc-400 animate-spin" />
        <span className="text-xs text-zinc-400">에이전트 확인 중...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
      <Bot size={14} className="text-emerald-600" />
      <div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">에이전트 연결됨</span>
        </div>
      </div>
    </div>
  );
}

// ── 훅: 에이전트 연결 여부 ────────────────────────────────────────────
export function useAgentConnected(): { connected: boolean; recheck: () => void } {
  const [connected, setConnected] = useState(false);
  const check = useCallback(async () => {
    try {
      const res = await fetch(AGENT_API);
      if (res.ok) {
        const data = await res.json();
        setConnected(data.connected);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    }
  }, []);
  useEffect(() => {
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [check]);
  return { connected, recheck: check };
}

// ── 에이전트 자동 시작 ──────────────────────────────────────────────
export async function agentAutoStart(): Promise<boolean> {
  try {
    const res = await fetch(AGENT_API, { method: "POST" });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === "started" || data.status === "already_running";
  } catch {
    return false;
  }
}

// ── 에이전트 API 헬퍼 ────────────────────────────────────────────────
export async function agentDiscover(opts: {
  hashtags: string[];
  targetCount: number;
  followerMin: number;
  followerMax: number;
}) {
  const res = await fetch(PROXY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "/discover", ...opts }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "에이전트 발굴 실패");
  return res.json();
}

export async function agentFindSimilar(opts: {
  seedHandles: string[];
  targetCount: number;
  followerMin: number;
  followerMax: number;
}) {
  const res = await fetch(PROXY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "/similar", ...opts }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "유사 계정 발굴 실패");
  return res.json();
}

export async function agentSendDM(handle: string, message: string) {
  const res = await fetch(PROXY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "/dm", handle, message }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "DM 발송 실패");
  return res.json();
}
