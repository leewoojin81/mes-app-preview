"use client";

import { useEffect, useState } from "react";

// 로그인한 계정이 운영자인지 — 기준정보 화면의 "삭제" 버튼을 운영자에게만 보여줄 때 쓴다(2026-10-22).
// 서버(DELETE 라우트의 requireOperatorForDelete)가 다시 막으므로 이 값은 버튼 표시용일 뿐이다.
export function useIsOperator(): boolean {
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { operator?: boolean } | null) => {
        if (alive) setOperator(!!me?.operator);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return operator;
}
