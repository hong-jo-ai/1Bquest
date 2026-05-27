"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, NotebookPen, X } from "lucide-react";
import MoriWidgets from "@/components/mori/MoriWidgets";
import type { MoriWidget, WidgetEvent } from "@/lib/mori/widgetTypes";

type OrbState = "idle" | "listening" | "thinking" | "speaking";

interface Msg {
  role: "user" | "assistant";
  content: string;
}
interface Memo {
  id: string;
  text: string;
  ts: string;
}

const MEMO_RE = /^메모[\s,.:!~]*/;

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
  const [memos, setMemos] = useState<Memo[]>([]);
  const [input, setInput] = useState("");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [gold, setGold] = useState(false);
  const [memoMode, setMemoMode] = useState(false);
  const [clock, setClock] = useState(nowKst);
  const busy = orb === "thinking" || orb === "speaking";
  const recording = orb === "listening";
  const flowRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef(orb);
  orbRef.current = orb;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  // 메모 큐 초기 로드
  useEffect(() => {
    fetch("/api/mori/memo", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setMemos(j.memos ?? []))
      .catch(() => {});
  }, []);

  // 채팅 스크롤
  useEffect(() => {
    flowRef.current?.scrollTo({ top: flowRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 능동 발화 폴링
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
        setGold(true);
        setTimeout(() => alive && setGold(false), 3500);
      } catch {
        /* noop */
      }
    };
    const id = setInterval(poll, 120_000);
    const warmup = setTimeout(poll, 8_000);
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

  async function saveMemo(text: string) {
    const t = text.trim();
    if (!t) return;
    try {
      const res = await fetch("/api/mori/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const j = await res.json();
      if (j.memo) setMemos((cur) => [...cur, j.memo]);
    } catch {
      /* noop */
    }
  }

  async function deleteMemo(id: string) {
    setMemos((cur) => cur.filter((m) => m.id !== id));
    fetch(`/api/mori/memo?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  // 입력 한 줄을 처리: 메모 모드/'메모' 접두면 메모, 아니면 모리에게 전송
  async function handleUserText(text: string) {
    const t = text.trim();
    if (!t) return;
    if (memoMode || MEMO_RE.test(t)) {
      await saveMemo(t.replace(MEMO_RE, ""));
      return;
    }
    await chatSend(t);
  }

  async function chatSend(text: string) {
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

  function onSendClick() {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    handleUserText(t);
  }

  // ── 음성: 마이크 토글 녹음 → 전사 ──
  async function toggleMic() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setOrb("idle");
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        await transcribeAndHandle(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setOrb("listening");
    } catch {
      // 마이크 권한 거부 등
      setOrb("idle");
    }
  }

  async function transcribeAndHandle(blob: Blob) {
    setOrb("thinking");
    try {
      const b64 = await blobToBase64(blob);
      const res = await fetch("/api/mori/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: b64, mimeType: blob.type || "audio/webm" }),
      });
      const j = await res.json();
      const text = (j.text ?? "").trim();
      setOrb("idle");
      if (!text) return;
      await handleUserText(text);
    } catch {
      setOrb("idle");
    }
  }

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
      {/* 상단 65% — 구체 + 메모(좌) + 위젯(우) */}
      <div className="relative flex flex-[65] items-center justify-center overflow-hidden">
        <Orb state={orb} dimmed={mode === "quiet"} gold={gold} />
        <MemoPanel memos={memos} onDelete={deleteMemo} />
        <MoriWidgets widgets={widgets} onClear={() => setWidgets([])} />
      </div>

      {/* 하단 30% — 채팅 흐름 */}
      <div ref={flowRef} className="flex flex-[30] flex-col justify-end gap-2 overflow-y-auto px-6 pb-2 sm:px-10">
        {total === 0 ? (
          <p className="text-center text-sm text-[#7c8aa0]">
            모리입니다. 마이크로 말하거나 입력하세요. &quot;메모&quot;로 시작하면 답 없이 메모로 적어둡니다.
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

      {/* 입력 + 음성 */}
      <div className="px-6 pb-2 sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            onClick={() => setMemoMode((v) => !v)}
            title={memoMode ? "받아쓰기(메모) 모드 — 켜짐" : "받아쓰기(메모) 모드"}
            className={`rounded-full border p-2.5 transition ${
              memoMode ? "border-[#F4E4C1] bg-[#F4E4C1]/15 text-[#F4E4C1]" : "border-white/10 bg-white/5 text-[#7c8aa0] hover:text-white"
            }`}
          >
            <NotebookPen size={16} />
          </button>
          <button
            onClick={toggleMic}
            disabled={busy}
            title={recording ? "녹음 중지" : "말하기"}
            className={`rounded-full border p-2.5 transition disabled:opacity-30 ${
              recording ? "border-indigo-400 bg-indigo-400/20 text-indigo-200" : "border-white/10 bg-white/5 text-[#9fb0c8] hover:text-white"
            }`}
          >
            {recording ? <Square size={16} /> : <Mic size={16} />}
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendClick();
                }
              }}
              placeholder={
                recording ? "듣고 있어요…" : busy ? "모리가 응답 중…" : memoMode ? "메모할 내용…" : "모리에게 말하기"
              }
              disabled={busy || recording}
              className="flex-1 bg-transparent text-sm text-[#E8ECF0] placeholder:text-[#5f6e85] focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={onSendClick}
              disabled={busy || recording || !input.trim()}
              className="rounded-full bg-[#F4E4C1] px-4 py-1.5 text-xs font-semibold text-[#1A2332] transition disabled:opacity-30"
            >
              {memoMode ? "메모" : "보내기"}
            </button>
          </div>
        </div>
      </div>

      {/* 최하단 5% — 모드/시각/상태/인장 */}
      <div className="flex items-center justify-between border-t border-white/5 px-6 py-2 text-[11px] text-[#6b7a93] sm:px-10">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              recording ? "bg-indigo-400" : mode === "office" ? "bg-emerald-400" : "bg-zinc-500"
            }`}
            title={recording ? "듣는 중" : mode === "office" ? "사무실 모드 (활성)" : "조용 모드 (비활성)"}
          />
          <span>{recording ? "듣는 중" : mode === "office" ? "사무실" : "조용"}</span>
          {memoMode && <span className="text-[#F4E4C1]">· 메모</span>}
          <span className="opacity-50">·</span>
          <span>{clock}</span>
        </div>
        <span className="font-mono tracking-[0.3em] text-[#9fb0c8]">MORI</span>
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function MemoPanel({ memos, onDelete }: { memos: Memo[]; onDelete: (id: string) => void }) {
  if (memos.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute left-3 top-3 bottom-3 z-10 flex w-[min(300px,38vw)] flex-col gap-2 overflow-y-auto rounded-2xl border border-[#F4E4C1]/15 bg-[#0d1320]/80 p-3 backdrop-blur-md">
      <span className="px-1 text-[11px] font-semibold tracking-wide text-[#F4E4C1]/80">메모 ({memos.length})</span>
      {[...memos].reverse().map((m) => (
        <div key={m.id} className="group flex items-start gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
          <p className="flex-1 text-xs leading-relaxed text-[#cdd7e6]">{m.text}</p>
          <button onClick={() => onDelete(m.id)} className="opacity-0 transition group-hover:opacity-100" title="삭제">
            <X size={12} className="text-[#7c8aa0] hover:text-white" />
          </button>
        </div>
      ))}
    </div>
  );
}

function Orb({ state, dimmed, gold }: { state: OrbState; dimmed: boolean; gold?: boolean }) {
  const listening = state === "listening";
  return (
    <div className="relative" style={{ width: "min(42vh, 42vw)", height: "min(42vh, 42vw)", opacity: dimmed ? 0.7 : 1 }}>
      <div
        className="mori-orb absolute inset-0 rounded-full"
        style={{
          background: listening
            ? "radial-gradient(circle at 35% 30%, #cdd7e6 0%, #8ea0c8 36%, #3a4a7a 72%, #1A2332 100%)"
            : "radial-gradient(circle at 35% 30%, #E8ECF0 0%, #B8C4D0 38%, #4a5a72 72%, #1A2332 100%)",
          boxShadow: listening
            ? "0 0 90px 14px rgba(120,140,220,0.4), inset 0 0 60px rgba(26,35,50,0.6)"
            : "0 0 80px 10px rgba(184,196,208,0.25), inset 0 0 60px rgba(26,35,50,0.6)",
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
