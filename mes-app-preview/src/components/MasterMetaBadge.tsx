"use client";

import { useEffect, useState } from "react";

// 기준정보(BASE-01~09) 화면 제목 아래 부제 옆에 붙이는 "최근 업로드 / 최종 수정" 문구.
// refreshKey가 바뀌면(업로드·저장 후) 다시 조회한다.
export default function MasterMetaBadge({
  screen,
  refreshKey,
}: {
  screen: string;
  refreshKey?: unknown;
}) {
  const [meta, setMeta] = useState<{ uploadedAt: string | null; updatedAt: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/master-meta?screen=${encodeURIComponent(screen)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setMeta(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [screen, refreshKey]);

  if (!meta) return null;
  const hm = (s: string) => s.slice(0, 16);
  return (
    <>
      {meta.uploadedAt && ` · 최근 업로드 ${hm(meta.uploadedAt)}`}
      {meta.updatedAt && ` · 최종 수정 ${hm(meta.updatedAt)}`}
    </>
  );
}
