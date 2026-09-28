"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProcessUphTargetRow } from "@/app/api/process-uph-target/route";

// 기준정보 공정정보(BASE-04) 하단 "공정별 목표 UPH" 섹션 — 경영정보 공정별생산현황(MGMT-05)
// 추이 그래프의 목표선에 쓰는 고정 목표. 연도별로 저장하고, 그 연도 값이 비어 있으면 직전
// 연도 값을 이어받는다(1년에 한 번만 바꾸면 됨). 저장 위치·근거는 src/lib/process-uph-target.ts.
const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

export default function ProcessUphTargetSection() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rows, setRows] = useState<ProcessUphTargetRow[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/process-uph-target?year=${year}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { rows: ProcessUphTargetRow[] }) => {
        setRows(data.rows);
        setInputs(
          Object.fromEntries(data.rows.map((r) => [r.lineKey, r.ownUph != null ? String(r.ownUph) : ""]))
        );
        setLoading(false);
      });
  }, [year]);

  useEffect(load, [load]);

  const normalize = (s: string) => s.replace(/,/g, "").trim();
  const changed = rows.filter((r) => normalize(inputs[r.lineKey] ?? "") !== (r.ownUph != null ? String(r.ownUph) : ""));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/process-uph-target", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        targets: changed.map((r) => ({ lineKey: r.lineKey, targetUph: normalize(inputs[r.lineKey] ?? "") })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ ok: true, text: `${year}년 목표 UPH ${changed.length}건을 저장했습니다.` });
      load();
    } else {
      const data = await res.json().catch(() => null);
      setMessage({ ok: false, text: data?.error ?? "저장에 실패했습니다." });
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-navy">공정별 목표 UPH</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            MGMT-05 공정별 생산성 추이 그래프의 목표선 · 연도별 저장 · 비워두면 직전 연도 값을 이어받음
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
              setMessage(null);
            }}
            className="text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white text-slate-700"
          >
            {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <button
            onClick={save}
            disabled={saving || changed.length === 0}
            className="px-3.5 py-1.5 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
          <tr>
            <th className="text-center px-4 py-2.5 font-semibold w-16">No</th>
            <th className="text-left px-4 py-2.5 font-semibold">공정(라인)</th>
            <th className="text-right px-4 py-2.5 font-semibold w-56">{year}년 목표 UPH</th>
            <th className="text-left px-4 py-2.5 font-semibold">적용 중인 값</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && (
            <tr>
              <td colSpan={4} className="text-center py-8 text-slate-400">
                불러오는 중...
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((r, idx) => {
              const own = normalize(inputs[r.lineKey] ?? "");
              return (
                <tr key={r.lineKey} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-center text-slate-500">{idx + 1}</td>
                  <td className="px-4 py-2 font-medium">{r.label}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={inputs[r.lineKey] ?? ""}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [r.lineKey]: e.target.value }))}
                      placeholder={r.effectiveUph != null ? fmt(r.effectiveUph) : "미등록"}
                      className="w-40 text-right border border-slate-300 rounded-md px-2.5 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-navy/20"
                    />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {own !== ""
                      ? `${year}년 값 (저장 후 적용)`
                      : r.effectiveUph != null
                        ? `${fmt(r.effectiveUph)} — ${r.fromYear}년 값을 이어받는 중`
                        : "목표 미등록 (그래프에 목표선 없음)"}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {message && (
        <p className={`px-4 py-2.5 text-xs border-t border-slate-100 ${message.ok ? "text-emerald-700" : "text-rose-600"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
