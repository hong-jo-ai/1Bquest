"use client";

/**
 * 인플루언서 데이터 긴급 구조(rescue) 페이지.
 *
 * 목적: 어제 데이터가 아직 살아있는 기기(localStorage)에서, 인플루언서 관리
 * 화면을 마운트하지 않고(=서버 시드로 덮어쓰는 폴링을 트리거하지 않고) 그 데이터를
 * 서버의 별도 rescue 키로 안전하게 백업한다. 콘솔/복사 없이 링크만 열면 동작한다.
 *
 * 이 페이지는 실데이터 키(paulvice_influencers_v1)에 절대 쓰지 않는다 — 읽기만 하고
 * rescue 키로만 업로드하므로 추가 오염 위험이 없다.
 */

import { useEffect, useState, useCallback } from "react";

const KEY = "paulvice_influencers_v1";
const EXC = "paulvice_influencers_excluded_v1";
const RESCUE_KEY = "paulvice_influencers_rescue_v1";
const RESCUE_EXC = "paulvice_influencers_excluded_rescue_v1";

type Phase = "reading" | "empty" | "saving" | "done" | "error";

export default function InfluencerRescuePage() {
  const [phase, setPhase] = useState<Phase>("reading");
  const [total, setTotal] = useState(0);
  const [june, setJune] = useState(0);
  const [msg, setMsg] = useState("");
  const [raw, setRaw] = useState("");

  const run = useCallback(async () => {
    setPhase("reading");
    setMsg("");

    let infRaw = "";
    let excRaw = "";
    try {
      infRaw = localStorage.getItem(KEY) || "";
      excRaw = localStorage.getItem(EXC) || "";
    } catch {
      /* ignore */
    }
    setRaw(infRaw);

    let list: unknown[] = [];
    try {
      list = infRaw ? JSON.parse(infRaw) : [];
    } catch {
      list = [];
    }
    if (!Array.isArray(list) || list.length === 0) {
      setPhase("empty");
      return;
    }

    const t = list.length;
    const j = list.filter((x) =>
      String((x as { updatedAt?: string })?.updatedAt || "").startsWith("2026-06")
    ).length;
    setTotal(t);
    setJune(j);
    setPhase("saving");

    try {
      const res = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: RESCUE_KEY, data: list }),
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || out.reason || "서버 저장 실패");

      if (excRaw) {
        try {
          await fetch("/api/store", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: RESCUE_EXC, data: JSON.parse(excRaw) }),
          });
        } catch {
          /* 제외목록 백업 실패는 치명적이지 않음 */
        }
      }
      setPhase("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "전송 실패");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const download = () => {
    try {
      const blob = new Blob([raw || "[]"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "influencers_backup.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 space-y-4">
        <h1 className="text-lg font-bold text-zinc-800">인플루언서 데이터 백업</h1>

        {phase === "reading" && (
          <p className="text-sm text-zinc-500">이 기기의 데이터를 읽는 중…</p>
        )}

        {phase === "empty" && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-amber-600">
              이 기기에는 백업할 인플루언서 데이터가 없습니다.
            </p>
            <p className="text-xs text-zinc-500">
              어제 데이터를 정리한 다른 기기/브라우저에서 이 페이지를 열어 주세요.
            </p>
          </div>
        )}

        {(phase === "saving" || phase === "done" || phase === "error") && (
          <div className="space-y-3">
            <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-4">
              <p className="text-sm text-zinc-500">발견한 인플루언서</p>
              <p className="text-3xl font-bold text-zinc-800">{total}건</p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  june > 0 ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                이 중 6월 작업분: {june}건{" "}
                {june > 0 ? "✅ 정상 데이터로 보입니다" : "⚠️ 시드일 수 있음"}
              </p>
            </div>

            {phase === "saving" && (
              <p className="text-sm text-zinc-500">서버에 백업하는 중…</p>
            )}
            {phase === "done" && (
              <p className="text-sm font-semibold text-emerald-600">
                ✅ 서버 백업 완료. 이 화면 그대로 두고 담당자에게 알려 주세요.
              </p>
            )}
            {phase === "error" && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-600">
                  서버 백업 실패: {msg}
                </p>
                <button
                  onClick={download}
                  className="w-full rounded-xl bg-zinc-800 text-white text-sm font-medium py-2.5"
                >
                  파일로 저장하기 (대체 방법)
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={run}
          className="w-full rounded-xl border border-zinc-300 text-zinc-700 text-sm font-medium py-2.5"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
