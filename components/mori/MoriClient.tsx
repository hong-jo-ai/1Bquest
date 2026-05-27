"use client";

import { useEffect, useRef, useState } from "react";
import MoriWidgets from "@/components/mori/MoriWidgets";
import type { MoriWidget, WidgetEvent } from "@/lib/mori/widgetTypes";

type OrbState = "idle" | "thinking" | "speaking";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function MoriClient({
  mode,
  nowKst,
  initialHistory = [],
}: {
  mode: "office" | "quiet";
  nowKst: string;
  initialHistory?: Msg[];
}) {
  const [messages, setMessages] = useState<Msg[]>(initialHistory);
  const [widgets, setWidgets] = useState<MoriWidget[]>([]);
  const [input, setInput] = useState("");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [gold, setGold] = useState(false);
  const [clock, setClock] = useState(nowKst);
  const streaming = orb !== "idle";
  const flowRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef(orb);
  orbRef.current = orb;

  // 실시간 시계 (KST)
  useEffect(() => {
    const tick = () => {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      setClock(kst.toISOString().replace("T", " ").slice(0, 16) + " (KST)");
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, []);

  // 새 메시지/델타마다 맨 아래로
  useEffect(() => {
    flowRef.current?.scrollTo({ top: flowRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 능동 발화 폴링 — 모리가 먼저 말 거는지 주기 확인(응답 중엔 건너뜀)
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (orbRef.current !== "idle") return;
      try {
        const res = await fetch("/api/mori/pulse", { cache: "no-store" });
        const json = await res.json();
        if (!alive || !json?.utterances?.length) return;
        for (const u of json.utterances as { text: string }[]) {
          setMessages((cur) => [...cur, { role: "assistant", content: u.text }]);
        }
        // 골드 펄스 한 번 + 짧은 빛 번짐
        setGold(true);
        setTimeout(() => alive && setGold(false), 3500);
      } catch {
        /* 폴링 실패 무시 */
      }
    };
    const id = setInterval(poll, 120_000);
    const warmup = setTimeout(poll, 8_000); // 진입 8초 후 1회
    return () => {
      alive = false;
      clearInterval(id);
      clearTimeout(warmup);
    };
  }, []);

  function applyWidget(w: WidgetEvent) {
    if (w.kind === "clear") setWidgets([]);
    else setWidgets((cur) => [...cur, w]);
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    setMessages((cur) => [...cur, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setOrb("thinking");

    try {
      const res = await fetch("/api/mori/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "응답 오류" }));
        throw new Error(err.error ?? "응답 오류");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let firstToken = true;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "text") {
            if (firstToken) {
              setOrb("speaking");
              firstToken = false;
            }
            setMessages((cur) => {
              const copy = [...cur];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + payload.text };
              return copy;
            });
          } else if (payload.type === "widget") {
            applyWidget(payload.widget as WidgetEvent);
          } else if (payload.type === "error") {
            throw new Error(payload.error);
          }
        }
      }
    } catch (e: any) {
      setMessages((cur) => {
        const copy = [...cur];
        const last = copy[copy.length - 1];
        const msg = `⚠️ ${e?.message ?? "오류가 발생했습니다."}`;
        if (last?.role === "assistant" && last.content === "") copy[copy.length - 1] = { ...last, content: msg };
        else copy.push({ role: "assistant", content: msg });
        return copy;
      });
    } finally {
      setOrb("idle");
    }
  }

  // 최신 메시지가 가장 크고 위로 갈수록 작아지며 페이드 (자막 역할)
  const total = messages.length;
  const styleFor = (i: number) => {
    const dist = total - 1 - i;
    const opacity = Math.max(0.28, 1 - dist * 0.22);
    const scale = Math.max(0.82, 1 - dist * 0.06);
    const fontSize = dist === 0 ? "1.35rem" : dist === 1 ? "1.1rem" : "0.95rem";
    return { opacity, fontSize, transformOrigin: "left center", transform: `scale(${scale})` };
  };

  return (
    <div className="flex h-screen flex-col bg-gradient-to-b from-[#0d1320] via-[#11192a] to-[#0a0f1a] text-[#E8ECF0]">
      {/* 상단 65% — 구체 + 위젯 패널 */}
      <div className="relative flex flex-[65] items-center justify-center overflow-hidden">
        <Orb state={orb} dimmed={mode === "quiet"} gold={gold} />
        <MoriWidgets widgets={widgets} onClear={() => setWidgets([])} />
      </div>

      {/* 하단 30% — 채팅 흐름 (자막) */}
      <div
        ref={flowRef}
        className="flex flex-[30] flex-col justify-end gap-2 overflow-y-auto px-6 pb-2 sm:px-10"
      >
        {total === 0 ? (
          <p className="text-center text-sm text-[#7c8aa0]">
            모리입니다. 매출·광고·CS·재고, 지금 화면을 같이 보고 있습니다. 차트나 지표를 띄워달라고 해보세요.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              style={styleFor(i)}
              className={`max-w-3xl transition-all duration-300 ${
                m.role === "user" ? "self-end text-right text-[#9fb0c8]" : "self-start text-[#E8ECF0]"
              }`}
            >
              <span className="whitespace-pre-wrap leading-relaxed">
                {m.content || (orb === "thinking" ? "…" : "")}
              </span>
            </div>
          ))
        )}
      </div>

      {/* 입력 */}
      <div className="px-6 pb-2 sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={streaming ? "모리가 응답 중…" : "모리에게 말하기"}
            disabled={streaming}
            className="flex-1 bg-transparent text-sm text-[#E8ECF0] placeholder:text-[#5f6e85] focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="rounded-full bg-[#F4E4C1] px-4 py-1.5 text-xs font-semibold text-[#1A2332] transition disabled:opacity-30"
          >
            보내기
          </button>
        </div>
      </div>

      {/* 최하단 5% — 모드/시각/상태/인장 */}
      <div className="flex items-center justify-between border-t border-white/5 px-6 py-2 text-[11px] text-[#6b7a93] sm:px-10">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${mode === "office" ? "bg-emerald-400" : "bg-zinc-500"}`}
            title={mode === "office" ? "사무실 모드 (활성)" : "조용 모드 (비활성)"}
          />
          <span>{mode === "office" ? "사무실" : "조용"}</span>
          <span className="opacity-50">·</span>
          <span>{clock}</span>
        </div>
        <span className="font-mono tracking-[0.3em] text-[#9fb0c8]">MORI</span>
      </div>
    </div>
  );
}

function Orb({ state, dimmed, gold }: { state: OrbState; dimmed: boolean; gold?: boolean }) {
  return (
    <div
      className="relative"
      style={{ width: "min(42vh, 42vw)", height: "min(42vh, 42vw)", opacity: dimmed ? 0.7 : 1 }}
    >
      <div
        className="mori-orb absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 35% 30%, #E8ECF0 0%, #B8C4D0 38%, #4a5a72 72%, #1A2332 100%)",
          boxShadow: "0 0 80px 10px rgba(184,196,208,0.25), inset 0 0 60px rgba(26,35,50,0.6)",
        }}
      />
      {state === "thinking" && (
        <div
          className="mori-particles absolute inset-[18%] rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(120,140,200,0.55) 60deg, transparent 140deg, rgba(120,140,200,0.4) 220deg, transparent 300deg)",
            filter: "blur(6px)",
          }}
        />
      )}
      {(state === "speaking" || gold) && (
        <div
          className="mori-gold-pulse absolute inset-[-6%] rounded-full"
          style={{ boxShadow: gold ? "0 0 90px 20px rgba(244,228,193,0.85)" : "0 0 60px 12px rgba(244,228,193,0.6)" }}
        />
      )}
    </div>
  );
}
