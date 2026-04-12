"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Mail, Check, AlertCircle, ArrowLeft, Loader2, X, RefreshCw } from "lucide-react";

interface Account {
  id: string;
  brand: "paulvice" | "harriot";
  channel: string;
  display_name: string;
  status: "active" | "paused" | "error";
  last_synced_at: string | null;
  error_message: string | null;
}

interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

const BRAND_LABEL = {
  paulvice: "폴바이스",
  harriot: "해리엇",
} as const;

const EXPECTED_EMAIL = {
  paulvice: "plvekorea@gmail.com",
  harriot: "harriotwatches@gmail.com",
} as const;

export default function InboxSetupClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthCheck[] | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const params = useSearchParams();
  const connected = params.get("connected");
  const error = params.get("error");

  useEffect(() => {
    fetch("/api/cs/accounts")
      .then((r) => r.json())
      .then((json) => setAccounts(json.accounts ?? []))
      .finally(() => setLoading(false));
  }, [connected]);

  const runHealthCheck = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/cs/health");
      const json = await res.json();
      setHealth(json.checks ?? []);
      setHealthOk(json.ok ?? false);
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    runHealthCheck();
  }, []);

  const gmailAccount = (brand: "paulvice" | "harriot") =>
    accounts.find((a) => a.brand === brand && a.channel === "gmail");

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link
        href="/inbox"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4"
      >
        <ArrowLeft size={14} />
        인박스로 돌아가기
      </Link>

      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
        채널 연결
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        CS 인박스가 각 채널에서 고객 문의를 가져올 수 있도록 계정을 연결하세요.
      </p>

      {connected && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
          <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm text-emerald-700 dark:text-emerald-300">
            {BRAND_LABEL[connected as "paulvice" | "harriot"]} Gmail 연결 완료
          </span>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-2">
          <AlertCircle
            size={16}
            className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
          />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide mb-3">
          Gmail
        </h2>
        <div className="space-y-3">
          {(["paulvice", "harriot"] as const).map((brand) => {
            const account = gmailAccount(brand);
            const connected = !!account;
            return (
              <div
                key={brand}
                className="flex items-center justify-between p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      connected
                        ? "bg-emerald-100 dark:bg-emerald-900/30"
                        : "bg-zinc-100 dark:bg-zinc-800"
                    }`}
                  >
                    <Mail
                      size={18}
                      className={
                        connected
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-zinc-400"
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {BRAND_LABEL[brand]}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {account?.display_name ?? EXPECTED_EMAIL[brand]}
                    </div>
                    {account?.last_synced_at && (
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        마지막 동기화:{" "}
                        {new Date(account.last_synced_at).toLocaleString(
                          "ko-KR"
                        )}
                      </div>
                    )}
                    {account?.error_message && (
                      <div className="text-[10px] text-red-500 mt-0.5 truncate">
                        {account.error_message}
                      </div>
                    )}
                  </div>
                </div>
                <a
                  href={`/api/cs/auth/gmail/start?brand=${brand}`}
                  className={`px-4 py-2 rounded-md text-sm font-medium flex-shrink-0 ${
                    connected
                      ? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      : "bg-violet-600 text-white hover:bg-violet-700"
                  }`}
                >
                  {connected ? "재연결" : "연결"}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 size={14} className="animate-spin" />
          불러오는 중…
        </div>
      )}

      <section className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
            시스템 상태
          </h2>
          <button
            onClick={runHealthCheck}
            disabled={healthLoading}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-50"
            title="다시 확인"
          >
            <RefreshCw size={13} className={healthLoading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
          {!health && healthLoading && (
            <div className="p-4 text-sm text-zinc-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              검사 중…
            </div>
          )}
          {health?.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                {c.ok ? (
                  <Check
                    size={14}
                    className="text-emerald-500 flex-shrink-0"
                  />
                ) : (
                  <X size={14} className="text-red-500 flex-shrink-0" />
                )}
                <span className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                  {c.name}
                </span>
              </div>
              {c.detail && (
                <span
                  className={`text-[11px] ml-2 flex-shrink-0 ${
                    c.ok ? "text-zinc-400" : "text-red-500"
                  }`}
                >
                  {c.detail}
                </span>
              )}
            </div>
          ))}
        </div>
        {healthOk === false && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            빨간 항목을 먼저 해결해야 CS 인박스가 정상 작동합니다.
          </p>
        )}
      </section>

      <section className="mt-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">
          ⚠️ Google Cloud Console 설정 필수
        </h3>
        <div className="text-xs text-amber-700 dark:text-amber-400 space-y-1.5">
          <p>
            처음 연결 시 Google Cloud Console에서 아래 redirect URI를
            OAuth 2.0 클라이언트에 추가해야 합니다:
          </p>
          <code className="block mt-1 p-2 bg-white dark:bg-zinc-900 rounded text-[11px] text-zinc-700 dark:text-zinc-300 break-all">
            {typeof window !== "undefined"
              ? `${window.location.origin}/api/cs/auth/gmail/callback`
              : "/api/cs/auth/gmail/callback"}
          </code>
          <p className="mt-2">
            또한 Gmail API가 해당 프로젝트에서 활성화돼 있어야 하고,
            OAuth 동의 화면에 테스트 사용자로{" "}
            <code>plvekorea@gmail.com</code>,{" "}
            <code>harriotwatches@gmail.com</code>이 추가돼 있어야 합니다.
          </p>
        </div>
      </section>
    </div>
  );
}
