"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type { WorkHoursSummaryResponse } from "@/lib/types";

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}
function firstDayOfMonth(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

export default function WorkHoursStatusPage() {
  const [dateFrom, setDateFrom] = useTabState("workHoursStatusFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("workHoursStatusTo", today);
  const [data, setData] = useState<WorkHoursSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/work-hours-status?dateFrom=${dateFrom}&dateTo=${dateTo}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: WorkHoursSummaryResponse) => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const byProcess = data?.byProcess ?? [];
  const matrix = data?.matrix ?? [];

  // 매트릭스를 "본공정" 행 x "지원공정" 열 표로 재구성.
  const fromProcesses = Array.from(new Set(matrix.map((m) => m.from_process_name))).sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const toProcesses = Array.from(new Set(matrix.map((m) => m.to_process_name))).sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const cellByPair = new Map(matrix.map((m) => [`${m.from_process_name}|${m.to_process_name}`, m]));

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-navy">공정별근무현황</h1>
        <p className="text-sm text-slate-500 mt-1">
          PSN-04 · 조회기간 동안 공정(BASE-04 공정등록 기준)별 본공정 근무·지원받음·지원나감
          연인원(person-day)과 공정간 지원 매트릭스를 봅니다. 일일근태입력(PSN-01)에 입력된
          데이터를 집계합니다.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-medium text-slate-500 shrink-0">기간</label>
        <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
        <span className="text-slate-400">~</span>
        <DateSegmentInput value={dateTo} onChange={setDateTo} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-sm text-navy">공정별 근무현황 (연인원)</h3>
        </div>
        <div className="overflow-auto max-h-[24rem]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
              <tr>
                {["공정", "본공정 근무", "지원받음", "지원받은시간", "지원나감", "지원나간시간"].map((h) => (
                  <th
                    key={h}
                    className="text-center px-3 py-2.5 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && byProcess.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    조회기간에 입력된 근태 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                byProcess.map((r) => (
                  <tr key={r.process_name} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-700">{r.process_name}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.normal_person_days.toLocaleString()}명일
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">
                      {r.support_in_person_days.toLocaleString()}명일
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">
                      {r.support_in_hours.toLocaleString()}h
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-rose-700">
                      {r.support_out_person_days.toLocaleString()}명일
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">
                      {r.support_out_hours.toLocaleString()}h
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-sm text-navy">공정간 지원 매트릭스</h3>
          <p className="text-xs text-slate-400 mt-0.5">행 = 본공정(보낸 쪽) · 열 = 지원처(받은 쪽), 값 = 연인원(시간합)</p>
        </div>
        <div className="overflow-auto max-h-[24rem]">
          {!loading && fromProcesses.length === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">조회기간에 지원 기록이 없습니다.</p>
          ) : (
            <table className="text-sm whitespace-nowrap">
              <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
                <tr>
                  <th className="text-center px-3 py-2.5 font-semibold sticky top-0 left-0 z-20 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                    본공정 \ 지원공정
                  </th>
                  {toProcesses.map((p) => (
                    <th
                      key={p}
                      className="text-center px-3 py-2.5 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]"
                    >
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fromProcesses.map((fromProcess) => (
                  <tr key={fromProcess} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-700 sticky left-0 z-10 bg-white border-r border-slate-200">
                      {fromProcess}
                    </td>
                    {toProcesses.map((toProcess) => {
                      const cell = cellByPair.get(`${fromProcess}|${toProcess}`);
                      return (
                        <td key={toProcess} className="px-3 py-2 text-center font-mono text-xs text-slate-600">
                          {cell ? `${cell.person_days}명일 (${cell.total_hours}h)` : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
