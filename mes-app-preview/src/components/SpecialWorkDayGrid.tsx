"use client";

import { useEffect, useState } from "react";
import type { SpecialGridResult } from "@/lib/special-work-grid";

// PSN-05 "특근일" 탭 그리드(2026-09-26 사용자 요청) — 양식 "2026년 09월 일요일근무.xlsx"
// ("■ 주말근무자 세부 List" 표)처럼 작업자 1명당 4행(출근시간/퇴근시간/기본근무 계/연장근무
// 계)을 쓰고, 달력에서 고른 특근일을 가로 열(월/일 + 요일)로 펼친 뒤 오른쪽에 계/TTL을
// 둔다. 데이터 계산은 서버(special-grid/route.ts, lib/special-work-grid.ts)가 한다.
//  - 목적: 양식 값이 전부 "생산"이라 고정값으로 쓴다(DB에 대응 항목 없음)
//  - 계: 그 행(기본근무/연장근무)의 선택 특근일 합계 — 양식의 =SUM(E9:L9)와 같다
//  - TTL: 양식에는 머리글만 있고 값이 비어 있어, 기본+연장 합계로 채웠다(작업자당 한 칸)
//  - 야간식대는 이 그리드가 아니라 위 패널의 입력 칸(시급/기본·연장근무 시급과 같은 자리)에서
//    입력하고, 다운로드 금액에만 반영된다(2026-09-26 사용자 요청)
const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
function weekdayClass(date: string): string {
  const d = weekdayOf(date);
  return d === 0 ? "text-red-600" : d === 6 ? "text-blue-600" : "text-slate-600";
}
// 0은 빈칸, 그 외는 최소 소수 1자리(8 → "8.0", 4.17 → "4.17")로 — 양식의 0.0 표시와 맞춘다.
function fmtHours(v: number): string {
  if (!v) return "";
  const s = v.toFixed(2);
  return s.endsWith("0") ? s.slice(0, -1) : s;
}

const CELL = "border border-slate-300 px-2 py-1 text-center align-middle";

export default function SpecialWorkDayGrid({
  workGroup,
  employeeNo,
  dates,
  enabled,
}: {
  workGroup: string;
  employeeNo: string;
  dates: string[];
  enabled: boolean;
}) {
  // 응답에는 어떤 조건으로 받은 것인지(key)를 같이 저장한다 — 지금 조건의 응답이 아직 안
  // 왔으면 loading, 이전 조건의 응답이면 보여주지 않는다(effect에서 로딩/초기화 상태를 직접
  // 바꾸지 않고 렌더에서 파생).
  const [response, setResponse] = useState<{ key: string; data: SpecialGridResult | null; error: string | null } | null>(
    null
  );

  const datesKey = [...dates].sort().join(",");
  const active = enabled && datesKey !== "";
  const requestKey = `${datesKey}|${employeeNo ? `e:${employeeNo}` : `g:${workGroup}`}`;
  const current = active && response?.key === requestKey ? response : null;
  const loading = active && current === null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const params = new URLSearchParams({ dates: datesKey });
    if (employeeNo) params.set("employeeNo", employeeNo);
    else if (workGroup) params.set("workGroup", workGroup);
    fetch(`/api/work-hours-lookup/special-grid?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setResponse({ key: requestKey, data: null, error: body.error ?? "조회에 실패했습니다." });
        else setResponse({ key: requestKey, data: body as SpecialGridResult, error: null });
      })
      .catch(() => {
        if (!cancelled) setResponse({ key: requestKey, data: null, error: "조회에 실패했습니다." });
      });
    return () => {
      cancelled = true;
    };
  }, [active, datesKey, workGroup, employeeNo, requestKey]);

  const cols = data?.dates ?? [];

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      {error && <p className="px-4 py-3 text-sm text-rose-600">{error}</p>}
      <div className="overflow-auto max-h-[calc(100vh-22rem)]">
        <table className="text-sm whitespace-nowrap border-collapse">
          <thead>
            <tr className="bg-[#D9E1F2] text-slate-700 font-bold">
              {["목적", "공정", "성명", "구분"].map((label) => (
                <th key={label} rowSpan={2} className={`${CELL} sticky top-0 z-10 bg-[#D9E1F2]`}>
                  {label}
                </th>
              ))}
              {cols.map((d) => (
                <th key={d} className={`${CELL} sticky top-0 z-10 bg-[#D9E1F2] border-b-0`}>
                  {d.slice(5, 7)}월 {d.slice(8, 10)}일
                </th>
              ))}
              <th rowSpan={2} className={`${CELL} sticky top-0 z-10 bg-[#D9E1F2]`}>
                계
              </th>
              <th rowSpan={2} className={`${CELL} sticky top-0 z-10 bg-[#D9E1F2]`}>
                TTL
              </th>
            </tr>
            <tr className="bg-[#D9E1F2] font-bold">
              {cols.map((d) => (
                <th key={d} className={`${CELL} sticky top-[29px] z-10 bg-[#D9E1F2] border-t-0 ${weekdayClass(d)}`}>
                  {WEEKDAYS[weekdayOf(d)]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!enabled && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-400">
                  사용자 정보를 불러오는 중...
                </td>
              </tr>
            )}
            {enabled && dates.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-400">
                  위 달력에서 특근일을 선택하면 작업자별 출근/퇴근/기본근무/연장근무가 여기에 표시됩니다.
                </td>
              </tr>
            )}
            {enabled && dates.length > 0 && loading && (
              <tr>
                <td colSpan={6 + cols.length} className="text-center py-10 text-slate-400">
                  불러오는 중...
                </td>
              </tr>
            )}
            {enabled && dates.length > 0 && !loading && data && data.workers.length === 0 && (
              <tr>
                <td colSpan={6 + cols.length} className="text-center py-10 text-slate-400">
                  선택한 특근일에 근무기록(PSN-01)이 있는 작업자가 없습니다.
                </td>
              </tr>
            )}
            {!loading &&
              data?.workers.map((w) => {
                const rows: { label: string; key: "in" | "out" | "base" | "ot" }[] = [
                  { label: "출근시간", key: "in" },
                  { label: "퇴근시간", key: "out" },
                  { label: "기본근무 계", key: "base" },
                  { label: "연장근무 계", key: "ot" },
                ];
                return rows.map((row, i) => {
                  const strong = row.key === "base" || row.key === "ot";
                  return (
                    <tr key={`${w.employee_no}-${row.key}`} className={i === 0 ? "border-t-2 border-slate-500" : ""}>
                      {i === 0 && (
                        <>
                          <td rowSpan={4} className={`${CELL} font-bold`}>
                            생산
                          </td>
                          <td rowSpan={4} className={`${CELL} font-bold`}>
                            {w.process || "-"}
                          </td>
                          <td rowSpan={4} className={`${CELL} font-bold`}>
                            {w.name}
                          </td>
                        </>
                      )}
                      <td className={`${CELL} font-bold ${strong ? "bg-slate-50" : ""}`}>{row.label}</td>
                      {cols.map((d) => {
                        const c = w.cells[d];
                        const v = !c
                          ? ""
                          : row.key === "in"
                            ? c.in_time
                            : row.key === "out"
                              ? c.out_time
                              : row.key === "base"
                                ? fmtHours(c.base)
                                : fmtHours(c.overtime);
                        return (
                          <td key={d} className={`${CELL} font-mono font-bold ${strong ? "bg-slate-50" : ""}`}>
                            {v}
                          </td>
                        );
                      })}
                      <td className={`${CELL} font-mono font-bold ${strong ? "bg-slate-50" : ""}`}>
                        {row.key === "base" ? fmtHours(w.base_total) : row.key === "ot" ? fmtHours(w.overtime_total) : ""}
                      </td>
                      {i === 0 && (
                        <td rowSpan={4} className={`${CELL} font-mono font-bold`}>
                          {fmtHours(Math.round((w.base_total + w.overtime_total) * 100) / 100)}
                        </td>
                      )}
                    </tr>
                  );
                });
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
