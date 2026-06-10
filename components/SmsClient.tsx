"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  MessageSquare, Filter, ClipboardList, Send, FlaskConical,
  AlertTriangle, CheckCircle2, XCircle, Loader2, Users, RefreshCw, RotateCcw,
} from "lucide-react";

// ── 메시지 타입/비용 (lib/sms/solapi.ts 와 동일 규칙) ──────────────────────
function byteLen(text: string): number {
  let b = 0;
  for (const ch of text) b += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return b;
}
function msgType(text: string): "SMS" | "LMS" {
  return byteLen(text) <= 90 ? "SMS" : "LMS";
}
const UNIT = { SMS: 20, LMS: 50 } as const;

function todayKST(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}
const won = (n: number) => n.toLocaleString("ko-KR") + "원";

/** #{이름} 토큰을 실제 표시값으로 치환 — 이름 없으면 "고객님"(발송 로직과 동일). */
const renderMsg = (tmpl: string, name?: string) => {
  const d = (name ?? "").trim() || "고객님";
  return (tmpl ?? "").replace(/#\{이름\}/g, d).replace(/#\{name\}/gi, d);
};

interface Recipient { name: string; phone: string; orderIds: string[]; sample: string }

const TEMPLATES: { label: string; subject: string; text: string }[] = [
  { label: "배송 지연", subject: "폴바이스 배송 안내",
    text: "안녕하세요 #{이름}님, 폴바이스입니다.\n주문해주신 상품의 배송이 예정보다 지연되어 안내드립니다. 최대한 빠르게 발송하겠습니다. 기다리게 해드려 죄송합니다." },
  { label: "에끌라 실버 지연(6/4)", subject: "폴바이스 배송 안내",
    text: "안녕하세요 #{이름}님, 폴바이스입니다.\n주문하신 에끌라 오벌 실버 시계가 생산 일정 지연으로 6월 4일 순차 출고 예정입니다. 기다려주셔서 감사하며, 출고되면 다시 안내드리겠습니다." },
  { label: "A/S 안내", subject: "폴바이스 A/S 안내",
    text: "안녕하세요 #{이름}님, 폴바이스 고객센터입니다.\n문의주신 A/S 관련하여 안내드립니다. 제품을 보내주실 주소와 절차는 회신 문자로 안내드릴게요. 감사합니다." },
];
const DEFAULT_SUBJECT = "폴바이스 고객 안내";

const SHIP_STATUSES = ["", "배송보류", "배송준비중", "배송중", "배송완료"];

interface HistoryRow {
  id: string; created_at: string; message_text: string; message_type: string;
  source_desc: string | null; recipient_count: number; success_count: number;
  fail_count: number; est_cost: number | null; is_test: boolean;
}

interface ResultItem {
  phone: string; status: "success" | "fail";
  name?: string; text?: string; error?: string; messageId?: string;
}
interface SendDetail extends HistoryRow { group_id: string | null; results: ResultItem[]; }

export default function SmsClient() {
  const [configured, setConfigured] = useState(true);
  const [missing, setMissing] = useState<string[]>([]);

  const [mode, setMode] = useState<"filter" | "manual">("filter");

  // 주문 필터
  const [startDate, setStartDate] = useState(todayKST(-30));
  const [endDate, setEndDate] = useState(todayKST(0));
  const [productNo, setProductNo] = useState("");
  const [optionContains, setOptionContains] = useState("");
  const [shipStatus, setShipStatus] = useState("");
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recipError, setRecipError] = useState("");

  // 수동 입력
  const [manualText, setManualText] = useState("");

  // 문안
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);

  // 발송
  const [testPhone, setTestPhone] = useState("");
  const [testSent, setTestSent] = useState(false);
  const [testing, setTesting] = useState(false);
  const [overrideTest, setOverrideTest] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; successCount: number; failCount: number; error?: string } | null>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);

  // 발송 이력 상세 모달
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<SendDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = useCallback(async (id: string) => {
    setDetailOpen(true); setDetail(null); setDetailLoading(true);
    try {
      const res = await fetch(`/api/sms/history/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setDetail(json.detail);
    } catch { /* 무시 */ } finally { setDetailLoading(false); }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/sms/history", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setHistory(json.history ?? []);
        setConfigured(json.configured);
        setMissing(json.missing ?? []);
      }
    } catch { /* noop */ }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── 수동 입력 파싱: "010-1234-5678 홍길동" 또는 "01012345678,홍길동" 한 줄당 1명 ──
  const manualRecipients = useMemo<Recipient[]>(() => {
    const out: Recipient[] = [];
    const seen = new Set<string>();
    for (const raw of manualText.split(/\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/([\d\-\s]{10,})/);
      if (!m) continue;
      const phone = m[1].replace(/\D/g, "");
      if (phone.length < 10 || seen.has(phone)) continue;
      seen.add(phone);
      const name = line.replace(m[1], "").replace(/[,|]/g, " ").trim();
      out.push({ name, phone, orderIds: [], sample: "수동입력" });
    }
    return out;
  }, [manualText]);

  // 현재 발송 대상 (선택된 것)
  const activeRecipients = useMemo<Recipient[]>(() => {
    if (mode === "manual") return manualRecipients;
    return recipients.filter((r) => selected.has(r.phone));
  }, [mode, manualRecipients, recipients, selected]);

  const sourceDesc = useMemo(() => {
    if (mode === "manual") return `수동입력 ${manualRecipients.length}명`;
    const parts = [productNo && `상품 ${productNo}`, optionContains && `"${optionContains}"`, shipStatus]
      .filter(Boolean).join(" / ");
    return `주문필터: ${parts || `${startDate}~${endDate}`}`;
  }, [mode, manualRecipients.length, productNo, optionContains, shipStatus, startDate, endDate]);

  const type = msgType(message);
  const bytes = byteLen(message);
  const estCost = UNIT[type] * activeRecipients.length;
  const canSend = message.trim().length > 0 && activeRecipients.length > 0 && (testSent || overrideTest);

  async function loadRecipients() {
    setLoadingRecipients(true);
    setRecipError("");
    try {
      const res = await fetch("/api/sms/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate, endDate,
          productNo: productNo ? Number(productNo) : undefined,
          optionContains: optionContains || undefined,
          shipStatus: shipStatus || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) { setRecipError(json.error ?? "조회 실패"); setRecipients([]); return; }
      setRecipients(json.recipients);
      setSelected(new Set(json.recipients.map((r: Recipient) => r.phone)));
    } catch (e) {
      setRecipError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoadingRecipients(false);
    }
  }

  function toggle(phone: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(phone) ? next.delete(phone) : next.add(phone);
      return next;
    });
  }

  async function sendTest() {
    const phone = testPhone.replace(/\D/g, "");
    if (phone.length < 10) { alert("본인 휴대폰 번호를 입력하세요"); return; }
    if (!message.trim()) { alert("메시지를 먼저 작성하세요"); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: [{ phone, name: "테스트" }],
          message, subject: subject || undefined,
          sourceDesc: "본인 테스트", isTest: true,
        }),
      });
      const json = await res.json();
      if (json.ok) { setTestSent(true); alert("테스트 발송 완료 — 본인 휴대폰을 확인하세요"); }
      else alert("테스트 발송 실패: " + (json.error ?? "알 수 없음"));
    } catch (e) {
      alert("테스트 발송 오류: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTesting(false);
      loadHistory();
    }
  }

  async function doSend() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: activeRecipients.map((r) => ({ phone: r.phone, name: r.name })),
          message, subject: subject || undefined, sourceDesc,
        }),
      });
      const json = await res.json();
      setSendResult({ ok: json.ok, successCount: json.successCount ?? 0, failCount: json.failCount ?? 0, error: json.error });
    } catch (e) {
      setSendResult({ ok: false, successCount: 0, failCount: activeRecipients.length, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
      setConfirming(false);
      setTestSent(false);
      loadHistory();
    }
  }

  // 원클릭 초기화 — 발송 이력(서버 기록)을 제외한 모든 입력/상태를 기본값으로 되돌림
  const resetAll = useCallback(() => {
    setMode("filter");
    setStartDate(todayKST(-30));
    setEndDate(todayKST(0));
    setProductNo("");
    setOptionContains("");
    setShipStatus("");
    setRecipients([]);
    setSelected(new Set());
    setRecipError("");
    setManualText("");
    setMessage("");
    setSubject(DEFAULT_SUBJECT);
    setTestPhone("");
    setTestSent(false);
    setTesting(false);
    setOverrideTest(false);
    setConfirming(false);
    setSendResult(null);
  }, []);

  // 초기 상태(되돌릴 내용이 있는지) — 버튼 활성화 판단용
  const isDirty =
    mode !== "filter" || productNo !== "" || optionContains !== "" || shipStatus !== "" ||
    recipients.length > 0 || manualText !== "" || message !== "" ||
    subject !== DEFAULT_SUBJECT || testPhone !== "" || testSent || overrideTest ||
    sendResult !== null;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 pt-16 md:pt-6 space-y-5">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl p-2.5">
          <MessageSquare size={22} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">고객 안내 SMS</h1>
          <p className="text-xs text-zinc-500">배송지연 · A/S 등 아웃바운드 공지 발송 (정보성)</p>
        </div>
        <button
          onClick={resetAll}
          disabled={sending || !isDirty}
          title="대상·문안·테스트 등 모든 입력을 처음 상태로 되돌립니다 (발송 이력은 유지)"
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 hover:text-red-500 hover:border-red-300 dark:hover:border-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <RotateCcw size={14} />
          초기화
        </button>
      </div>

      {!configured && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>Solapi 설정 누락: <b>{missing.join(", ")}</b>. 환경변수 설정 후 발송 가능합니다.</div>
        </div>
      )}

      {/* 1. 대상 선택 */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-emerald-500" />
          <h2 className="font-semibold text-zinc-800 dark:text-zinc-200">1. 대상 선택</h2>
        </div>

        <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg w-fit">
          {([["filter", "주문 필터", Filter], ["manual", "수동 입력", ClipboardList]] as const).map(([m, label, Icon]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === m ? "bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-400 shadow-sm" : "text-zinc-500"}`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>

        {mode === "filter" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-zinc-500">시작일
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
              </label>
              <label className="text-xs text-zinc-500">종료일
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-zinc-500">상품번호
                <input value={productNo} onChange={(e) => setProductNo(e.target.value)} placeholder="예: 226"
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
              </label>
              <label className="text-xs text-zinc-500">옵션 키워드
                <input value={optionContains} onChange={(e) => setOptionContains(e.target.value)} placeholder="예: 실버"
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
              </label>
              <label className="text-xs text-zinc-500">배송상태
                <select value={shipStatus} onChange={(e) => setShipStatus(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm">
                  {SHIP_STATUSES.map((s) => <option key={s} value={s}>{s || "전체"}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadRecipients} disabled={loadingRecipients}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
                {loadingRecipients ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
                대상 불러오기
              </button>
              <button onClick={() => { setProductNo("226"); setOptionContains("실버"); setShipStatus("배송보류"); }}
                className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                프리셋: 바이소이 실버 배송보류
              </button>
            </div>
            {recipError && <p className="text-sm text-red-500">{recipError}</p>}

            {recipients.length > 0 && (
              <div className="border border-zinc-100 dark:border-zinc-800 rounded-lg">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 text-xs">
                  <span className="text-zinc-500">{recipients.length}명 조회 · <b className="text-emerald-600">{selected.size}명 선택</b></span>
                  <div className="flex gap-2">
                    <button onClick={() => setSelected(new Set(recipients.map((r) => r.phone)))} className="text-zinc-500 hover:text-emerald-600">전체</button>
                    <button onClick={() => setSelected(new Set())} className="text-zinc-500 hover:text-red-500">해제</button>
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-zinc-50 dark:divide-zinc-800/60">
                  {recipients.map((r) => (
                    <label key={r.phone} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer">
                      <input type="checkbox" checked={selected.has(r.phone)} onChange={() => toggle(r.phone)} className="accent-emerald-600" />
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 w-20 truncate">{r.name}</span>
                      <span className="text-zinc-400 tabular-nums">{r.phone}</span>
                      <span className="ml-auto text-[11px] text-zinc-400 truncate max-w-[40%]">{r.sample}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} rows={5}
              placeholder={"한 줄에 한 명씩 입력\n01012345678 홍길동\n010-2222-3333"}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm font-mono" />
            <p className="text-xs text-zinc-500 mt-1">{manualRecipients.length}명 인식됨 (번호 뒤 이름은 #{"{"}이름{"}"} 치환에 사용)</p>
          </div>
        )}
      </section>

      {/* 2. 문안 작성 */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-emerald-500" />
          <h2 className="font-semibold text-zinc-800 dark:text-zinc-200">2. 문안 작성</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => (
            <button key={t.label} onClick={() => { setMessage(t.text); setSubject(t.subject); }}
              className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600">
              {t.label}
            </button>
          ))}
        </div>
        {type === "LMS" && (
          <div>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="LMS 제목 (예: 폴바이스 배송 안내)"
              className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
            <p className="text-[11px] text-zinc-400 mt-1">긴 문자(LMS)는 제목이 함께 표시돼요. 비우면 "{DEFAULT_SUBJECT}"로 나갑니다.</p>
          </div>
        )}
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5}
          placeholder="#{이름}님 안녕하세요, 폴바이스입니다…"
          className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span><b className={type === "LMS" ? "text-amber-600" : "text-emerald-600"}>{type}</b> · {bytes}byte {type === "SMS" && `/ 90`}</span>
          <span>예상 비용: <b className="text-zinc-700 dark:text-zinc-300">{won(estCost)}</b> ({activeRecipients.length}명 × {won(UNIT[type])})</span>
        </div>
      </section>

      {/* 3. 발송 */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-emerald-500" />
          <h2 className="font-semibold text-zinc-800 dark:text-zinc-200">3. 발송</h2>
        </div>

        {/* 본인 테스트 */}
        <div className="flex items-center gap-2">
          <input value={testPhone} onChange={(e) => { setTestPhone(e.target.value); setTestSent(false); }} placeholder="본인 휴대폰 (테스트용)"
            className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
          <button onClick={sendTest} disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50">
            {testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
            테스트 발송
          </button>
        </div>
        {testSent && <p className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={13} /> 테스트 발송됨 — 본인 확인 후 아래에서 일괄 발송</p>}

        {!testSent && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input type="checkbox" checked={overrideTest} onChange={(e) => setOverrideTest(e.target.checked)} className="accent-zinc-400" />
            테스트 없이 바로 발송 (권장하지 않음)
          </label>
        )}

        <button onClick={() => setConfirming(true)} disabled={!canSend}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
          <Send size={16} />
          {activeRecipients.length}명에게 발송
        </button>

        {sendResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${sendResult.ok ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"}`}>
            {sendResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>성공 {sendResult.successCount} · 실패 {sendResult.failCount}{sendResult.error ? ` — ${sendResult.error}` : ""}</span>
          </div>
        )}
      </section>

      {/* 발송 확인 모달 */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !sending && setConfirming(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl p-5 max-w-sm w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-zinc-900 dark:text-zinc-100">발송 확인</h3>
            <div className="text-sm text-zinc-600 dark:text-zinc-300 space-y-1">
              <p>· 대상: <b>{activeRecipients.length}명</b></p>
              <p>· 종류: <b>{type}</b> ({bytes}byte)</p>
              <p>· 예상 비용: <b>{won(estCost)}</b></p>
              <p>· 출처: {sourceDesc}</p>
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-500 whitespace-pre-wrap max-h-32 overflow-y-auto">{message}</div>
            <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> 실제 고객에게 즉시 발송됩니다. 되돌릴 수 없어요.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} disabled={sending}
                className="flex-1 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300">취소</button>
              <button onClick={doSend} disabled={sending}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 발송
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 발송 이력 상세 모달 */}
      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailOpen(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2"><MessageSquare size={16} className="text-emerald-500" /> 발송 상세</h3>
              <button onClick={() => setDetailOpen(false)} className="text-zinc-400 hover:text-zinc-600"><XCircle size={18} /></button>
            </div>

            {detailLoading || !detail ? (
              <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 size={20} className="animate-spin" /></div>
            ) : (
              <div className="p-4 space-y-3 overflow-y-auto">
                {/* 요약 */}
                <div className="text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="tabular-nums">{detail.created_at.slice(0, 16).replace("T", " ")}</span>
                  {detail.is_test && <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">테스트</span>}
                  <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{detail.message_type}</span>
                  <span className="text-emerald-600">성공 {detail.success_count}</span>
                  {detail.fail_count > 0 && <span className="text-red-500">실패 {detail.fail_count}</span>}
                  {detail.est_cost != null && <span>· {won(detail.est_cost)}</span>}
                </div>
                {detail.source_desc && <p className="text-xs text-zinc-500">대상: {detail.source_desc}</p>}

                {/* 문안 템플릿 */}
                <div>
                  <p className="text-[11px] text-zinc-400 mb-1">문안(템플릿)</p>
                  <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{detail.message_text}</div>
                </div>

                {/* 건별 수신자 — 실제 발송 본문 */}
                <div>
                  <p className="text-[11px] text-zinc-400 mb-1">수신자 {detail.results.length}명 · 실제 발송 내용</p>
                  <div className="space-y-2">
                    {detail.results.length === 0 ? (
                      <p className="text-xs text-zinc-400">건별 기록이 없습니다.</p>
                    ) : detail.results.map((r, i) => (
                      <div key={i} className="rounded-lg border border-zinc-100 dark:border-zinc-800 p-2.5">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium text-zinc-700 dark:text-zinc-200">{(r.name ?? "").trim() || "고객님"}</span>
                          <span className="text-zinc-400 tabular-nums">{r.phone}</span>
                          {r.status === "success"
                            ? <span className="ml-auto flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> 성공</span>
                            : <span className="ml-auto flex items-center gap-1 text-red-500"><XCircle size={12} /> 실패</span>}
                        </div>
                        <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{r.text || renderMsg(detail.message_text, r.name)}</p>
                        {r.error && <p className="mt-1 text-[11px] text-red-500">사유: {r.error}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. 이력 */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-emerald-500" />
            <h2 className="font-semibold text-zinc-800 dark:text-zinc-200">발송 이력</h2>
          </div>
          <button onClick={loadHistory} className="text-zinc-400 hover:text-emerald-600"><RefreshCw size={14} /></button>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-400 py-2">발송 내역이 없습니다.</p>
        ) : (
          <div className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
            {history.map((h) => (
              <button key={h.id} type="button" onClick={() => openDetail(h.id)}
                className="w-full text-left py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded-lg px-1 -mx-1 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-400 tabular-nums">{h.created_at.slice(5, 16).replace("T", " ")}</span>
                  {h.is_test && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">테스트</span>}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{h.message_type}</span>
                  <span className="text-emerald-600 text-xs">성공 {h.success_count}</span>
                  {h.fail_count > 0 && <span className="text-red-500 text-xs">실패 {h.fail_count}</span>}
                  {h.est_cost != null && <span className="ml-auto text-[11px] text-zinc-400">{won(h.est_cost)}</span>}
                </div>
                <p className="text-zinc-500 dark:text-zinc-400 text-xs truncate mt-0.5">{h.source_desc ? `${h.source_desc} · ` : ""}{renderMsg(h.message_text)}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
