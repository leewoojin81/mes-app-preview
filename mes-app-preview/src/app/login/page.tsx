"use client";

import { useState, Suspense } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "로그인에 실패했습니다.");
      return;
    }
    const redirect = searchParams.get("redirect");
    router.replace(redirect && redirect.startsWith("/") ? redirect : "/");
    router.refresh();
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white border border-slate-200 rounded-lg shadow-sm p-8"
      >
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-md bg-navy-dark flex items-center justify-center p-1.5">
            <Image
              src="/medios-logo.png"
              alt="메디오스"
              width={40}
              height={40}
              priority
              className="w-full h-full object-contain"
            />
          </div>
          <div className="text-center">
            <p className="font-semibold text-navy">메디오스 MES</p>
            <p className="text-xs text-slate-500">1단계 프로토타입</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">아이디</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-5 bg-navy text-white text-sm font-medium rounded-md py-2.5 hover:bg-navy-light transition-colors disabled:opacity-50"
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
