"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Mic, Square, NotebookPen, X, Volume2, VolumeX, ScrollText } from "lucide-react";
import MoriWidgets from "@/components/mori/MoriWidgets";
import type { MoriWidget, WidgetEvent } from "@/lib/mori/widgetTypes";

// R3F 구체는 클라 전용(WebGL) — SSR 끄고, 로딩 동안 CSS 플레이스홀더.
const MoriOrb = dynamic(() => import("@/components/mori/MoriOrb"), {
  ssr: false,
  loading: () => <OrbFallback />,
});

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
  const [speakOn, setSpeakOn] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [arming, setArming] = useState(false); // 마이크 잡는 중(첫 클릭만 잠깐)
  const [clock, setClock] = useState(nowKst);
  const meterRef = useRef<HTMLSpanElement>(null); // 녹음 중 실시간 진폭 막대
  const streamRef = useRef<MediaStream | null>(null); // 마이크 스트림 세션 내 재사용
  const analyserRef = useRef<AnalyserNode | null>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const speakRef = useRef(speakOn);
  speakRef.current = speakOn;
  const playCtxRef = useRef<AudioContext | null>(null);
  const busy = orb === "thinking" || orb === "speaking";
  const recording = orb === "listening";
  const flowRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef(orb);
  orbRef.current = orb;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ampRef = useRef<number>(0); // 0~1 마이크 진폭 → 구체
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

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

  // 언마운트 시 마이크 스트림/오디오 컨텍스트 해제(세션 동안만 살려둠)
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
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

  // 기록 패널 열리면 맨 아래로
  useEffect(() => {
    if (historyOpen) {
      requestAnimationFrame(() => {
        historyScrollRef.current?.scrollTo({ top: historyScrollRef.current.scrollHeight });
      });
    }
  }, [historyOpen]);

  // 능동 발화 폴링
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (orbRef.current !== "idle") return;
      try {
        const res = await fetch("/api/mori/pulse", { cache: "no-store" });
        const json = await res.json();
        if (!alive || !json?.utterances?.length) return;
        setGold(true);
        setTimeout(() => alive && setGold(false), 3500);
        try {
          for (const u of json.utterances as { text: string }[]) {
            setMessages((cur) => [...cur, { role: "assistant", content: u.text }]);
            await speak(u.text); // 능동 발화도 소리로(켜져 있으면)
          }
        } finally {
          // 재생/오류와 무관하게 '말하는 중'에서 idle로 복귀 — 입력 잠금 해제(버그 수정)
          setOrb("idle");
        }
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

  // ── 음성 출력: OpenAI 신경망 TTS → Web Audio 재생 + 실제 진폭 → 구체 ──
  function playWithAmplitude(ab: ArrayBuffer): Promise<void> {
    return new Promise(async (resolve) => {
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        const ac = playCtxRef.current ?? new AC();
        playCtxRef.current = ac;
        if (ac.state === "suspended") await ac.resume();
        const buf = await ac.decodeAudioData(ab);
        const src = ac.createBufferSource();
        src.buffer = buf;
        const analyser = ac.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analyser.connect(ac.destination);
        const data = new Uint8Array(analyser.frequencyBinCount);
        setOrb("speaking");
        let raf = 0;
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let s = 0;
          for (const v of data) {
            const x = (v - 128) / 128;
            s += x * x;
          }
          ampRef.current = Math.min(1, Math.sqrt(s / data.length) * 3.2);
          raf = requestAnimationFrame(loop);
        };
        loop();
        src.onended = () => {
          cancelAnimationFrame(raf);
          ampRef.current = 0;
          resolve();
        };
        src.start();
      } catch {
        resolve();
      }
    });
  }
  // 능동 발화 등 한 덩어리 발화(즉시 합성·재생)
  async function speak(text: string) {
    const t = text.trim();
    if (!t || !speakRef.current) return;
    const ab = await synthTts(t);
    if (ab) await playWithAmplitude(ab);
  }

  async function chatSend(text: string) {
    setMessages((cur) => [...cur, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setOrb("thinking");
    let full = "";
    // 문장이 완성될 때마다 즉시 합성 시작(병렬), 완성 순서대로 재생 → 첫 문장부터 빨리 말함.
    const audioJobs: Promise<ArrayBuffer | null>[] = [];
    let sentBuf = "";
    let streamDone = false;
    const ttsOn = speakRef.current;
    const pushSentences = (force: boolean) => {
      if (!ttsOn) return;
      const [sents, rest] = cutSentences(sentBuf, force);
      sentBuf = rest;
      for (const s of sents) {
        const txt = s.trim();
        if (txt) audioJobs.push(synthTts(txt));
      }
    };
    const player = (async () => {
      if (!ttsOn) return;
      let i = 0;
      for (;;) {
        if (i < audioJobs.length) {
          const ab = await audioJobs[i++];
          if (ab) await playWithAmplitude(ab);
        } else if (streamDone) {
          break;
        } else {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    })();
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
            full += payload.text;
            sentBuf += payload.text;
            pushSentences(false); // 완성된 문장 즉시 합성 시작
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
      streamDone = true;
      setOrb("idle");
      return;
    }
    // 스트림 완료 → 남은 문장 flush 후 재생 워커가 끝날 때까지 대기.
    pushSentences(true);
    streamDone = true;
    await player;
    setOrb("idle");
  }

  function onSendClick() {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    handleUserText(t);
  }

  // ── 음성: 마이크 토글 녹음 → 전사 ──
  // 스트림/AudioContext/analyser를 세션 내내 재사용 → 첫 클릭만 getUserMedia 비용을
  // 치르고 이후 녹음은 즉시 시작(클릭→녹음 지연 제거).
  async function getMicStream(): Promise<MediaStream> {
    const live = streamRef.current?.getAudioTracks().some((t) => t.readyState === "live");
    if (streamRef.current && live) return streamRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    // 진폭 분석 그래프를 이 스트림에 한 번만 연결.
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ac = audioCtxRef.current ?? new AC();
      audioCtxRef.current = ac;
      if (ac.state === "suspended") await ac.resume();
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      ac.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
    } catch {
      /* 진폭 실패해도 녹음/전사는 됨 */
    }
    return stream;
  }

  async function toggleMic() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (busy || arming) return;
    setArming(true); // 클릭 즉시 시각 피드백(첫 클릭은 마이크 잡느라 잠깐 걸림)
    try {
      const stream = await getMicStream();
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stopAmplitude();
        // 스트림은 살려둔다(다음 녹음 즉시 시작). 트랙 stop은 언마운트 때만.
        setOrb("idle");
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        await transcribeAndHandle(blob);
      };
      recorderRef.current = rec;
      rec.start();
      startAmplitude();
      setOrb("listening");
    } catch {
      // 마이크 권한 거부 등
      setOrb("idle");
    } finally {
      setArming(false);
    }
  }

  // 마이크 진폭(RMS) → ampRef. 재사용 analyser를 RAF로 샘플(React 리렌더 없음).
  function startAmplitude() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const amp = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
      ampRef.current = amp;
      // 마이크 버튼 옆 막대를 직접 갱신(상태 없이) — "내 말이 들어가고 있다" 확인용.
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${0.06 + amp * 0.94})`;
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }
  function stopAmplitude() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    ampRef.current = 0;
    if (meterRef.current) meterRef.current.style.transform = "scaleX(0.06)";
  }

  // 화면 하단에 잠깐 뜨는 안내(전사 중·실패 등) — 입력이 묻히지 않게.
  function flashNotice(text: string) {
    setMessages((cur) => [...cur, { role: "assistant", content: text }]);
  }

  async function transcribeAndHandle(blob: Blob) {
    setTranscribing(true);
    setOrb("thinking");
    try {
      const b64 = await blobToBase64(blob);
      const res = await fetch("/api/mori/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: b64, mimeType: blob.type || "audio/webm" }),
      });
      const j = await res.json().catch(() => ({}));
      setTranscribing(false);
      setOrb("idle");
      if (!res.ok || j.error) {
        flashNotice(`⚠️ 음성 전사 실패: ${j.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const text = (j.text ?? "").trim();
      if (!text) {
        flashNotice("⚠️ 음성을 알아듣지 못했어요. 다시 말씀해 주세요.");
        return;
      }
      await handleUserText(text);
    } catch (e: any) {
      setTranscribing(false);
      setOrb("idle");
      flashNotice(`⚠️ 음성 전사 오류: ${e?.message ?? "네트워크 오류"}`);
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
    <div className="relative flex h-screen flex-col bg-gradient-to-b from-[#0d1320] via-[#11192a] to-[#0a0f1a] text-[#E8ECF0]">
      {/* 대화 기록 오버레이 — 또렷하게 스크롤해서 지난 대화 읽기 */}
      {historyOpen && (
        <div className="absolute inset-0 z-30 flex flex-col bg-[#0a0f1a]/96 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-3">
            <span className="text-sm font-semibold text-[#cdd7e6]">대화 기록</span>
            <button onClick={() => setHistoryOpen(false)} className="rounded-full p-1.5 text-[#7c8aa0] transition hover:bg-white/10 hover:text-white" title="닫기">
              <X size={18} />
            </button>
          </div>
          <div ref={historyScrollRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4 sm:px-10">
            {messages.length === 0 ? (
              <p className="pt-6 text-center text-sm text-[#7c8aa0]">아직 대화가 없습니다.</p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user" ? "bg-[#F4E4C1]/15 text-[#E8ECF0]" : "bg-white/[0.06] text-[#cdd7e6]"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 상단 65% — 구체 + 메모(좌) + 위젯(우) */}
      <div className="relative flex flex-[65] items-center justify-center overflow-hidden">
        <MoriOrb state={orb} ampRef={ampRef} gold={gold} dimmed={mode === "quiet"} />
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
            onClick={() => setSpeakOn((v) => !v)}
            title={speakOn ? "음성 출력 켜짐" : "음성 출력 꺼짐"}
            className={`rounded-full border p-2.5 transition ${
              speakOn ? "border-[#F4E4C1]/60 bg-white/5 text-[#9fb0c8] hover:text-white" : "border-white/10 bg-white/5 text-[#5f6e85] hover:text-white"
            }`}
          >
            {speakOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
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
            disabled={busy || arming}
            title={recording ? "녹음 중지" : arming ? "마이크 켜는 중…" : "말하기"}
            className={`rounded-full border p-2.5 transition disabled:opacity-50 ${
              recording
                ? "border-indigo-400 bg-indigo-400/20 text-indigo-200"
                : arming
                ? "animate-pulse border-indigo-400/60 bg-indigo-400/10 text-indigo-200"
                : "border-white/10 bg-white/5 text-[#9fb0c8] hover:text-white"
            }`}
          >
            {recording ? <Square size={16} /> : <Mic size={16} />}
          </button>
          <div className="relative flex flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur">
            {/* 녹음 중 실시간 진폭 막대 — 마이크가 내 말을 듣고 있다는 확인 */}
            {recording && (
              <span className="pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full">
                <span
                  ref={meterRef}
                  className="block h-full w-full origin-left rounded-full bg-indigo-400 transition-none"
                  style={{ transform: "scaleX(0.06)" }}
                />
              </span>
            )}
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
                arming
                  ? "마이크 켜는 중…"
                  : recording
                  ? "듣고 있어요… (말이 끝나면 ⏹ 버튼)"
                  : transcribing
                  ? "음성 전사 중…"
                  : busy
                  ? "모리가 응답 중…"
                  : memoMode
                  ? "메모할 내용…"
                  : "모리에게 말하기"
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-1 text-[#7c8aa0] transition hover:text-white"
            title="대화 기록 보기"
          >
            <ScrollText size={13} />
            <span>기록</span>
          </button>
          <span className="font-mono tracking-[0.3em] text-[#9fb0c8]">MORI</span>
        </div>
      </div>
    </div>
  );
}

// 스트리밍 텍스트에서 완성된 문장만 잘라낸다(나머지는 버퍼에 남김). force=true면 잔여도 flush.
function cutSentences(buf: string, force: boolean): [string[], string] {
  const out: string[] = [];
  const re = /[^.!?。…\n]*[.!?。…\n]+/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(buf))) {
    out.push(m[0]);
    last = re.lastIndex;
  }
  let rest = buf.slice(last);
  if (force && rest.trim()) {
    out.push(rest);
    rest = "";
  }
  return [out, rest];
}

// 문장 1개 → OpenAI TTS 오디오(ArrayBuffer). 실패 시 null.
async function synthTts(text: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch("/api/mori/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
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

// R3F 로딩/비WebGL 폴백 — 콜드 플래티넘 호흡 구체(CSS).
function OrbFallback() {
  return (
    <div className="pointer-events-none" style={{ width: "min(16vh, 16vw)", height: "min(16vh, 16vw)" }}>
      <div
        className="mori-orb h-full w-full rounded-full"
        style={{
          background: "radial-gradient(circle at 35% 30%, #E8ECF0 0%, #B8C4D0 38%, #4a5a72 72%, #1A2332 100%)",
          boxShadow: "0 0 80px 10px rgba(184,196,208,0.25), inset 0 0 60px rgba(26,35,50,0.6)",
        }}
      />
    </div>
  );
}
