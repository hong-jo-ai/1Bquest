import Link from "next/link";

export const metadata = { title: "로그인 — Paulwise" };

interface SearchParams {
  next?: string;
  error?: string;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = params.next || "/";
  const error = params.error;

  const signInHref = `/api/auth/sign-in?next=${encodeURIComponent(next)}`;

  const errorMessage =
    error === "unauthorized"
      ? "허용되지 않은 계정입니다. shong@harriotwatches.com 로 로그인해주세요."
      : error === "oauth_failed"
        ? "Google 로그인 실패. 다시 시도해주세요."
        : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-8 shadow-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-2xl font-bold">
            P
          </div>
          <h1 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
            Paulwise Dashboard
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Google 계정으로 로그인하세요
          </p>
        </div>

        {errorMessage && (
          <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-xs">
            {errorMessage}
          </div>
        )}

        <Link
          href={signInHref}
          className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          <GoogleIcon />
          Google로 로그인
        </Link>

        <p className="text-[11px] text-zinc-400 text-center mt-5 leading-relaxed">
          shong@harriotwatches.com 만 접근 가능합니다.
          <br />
          한 번 로그인하면 90일간 유지됩니다.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
