"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import { addDays, type PackagingScheduleResult } from "@/lib/packaging-schedule";

// 계획정보(PLAN-03) "포장계획" 탭 — "출하포장 운용계획 10월_2026.10.02.xlsx" 종합 시트처럼 구분(먼슬리·원데이·수동포장·바이알)별
// 월 계획·실적·달성률을 주차별(월~일, 월 경계로 자름)·누계로 보여준다. 값은 모두 "일정" 탭(출하포장 일정)의 계획 수량과
// 일일작업현황(PROD-10) 출하포장 실적에서 계산한다.

const GROUPS: { key: string; label: string; lines: string[] }[] = [
  { key: "monthly", label: "먼슬리 (1·3 Line)", lines: ["line1", "line3"] },
  { key: "oneday", label: "원데이 (2 Line)", lines: ["line2"] },
  { key: "manual", label: "수동포장 (4·5 Line)", lines: ["line4", "line5"] },
  { key: "vial", label: "바이알", lines: ["vial"] },
];

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function thisMonth(): string {
  return toLocalDateStr(new Date()).slice(0, 7);
}
function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = (new Date(y, m - 1, d).getDay() + 6) % 7; // 월=0
  return addDays(dateStr, -wd);
}
function mmdd(s: string): string {
  return `${s.slice(5, 7)}/${s.slice(8, 10)}`;
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}
function pct(actual: number, plan: number): string {
  return plan > 0 ? `${((actual / plan) * 100).toFixed(1)}%` : "";
}

export default function PackagingSummaryTab() {
  const [month, setMonth] = useTabState("pkSumMonth", thisMonth);
  const [result, setResult] = useState<PackagingScheduleResult | null>(null);
  const [loading, setLoading] = useState(true);

  const n = daysInMonth(month);
  const first = `${month}-01`;
  const last = `${month}-${String(n).padStart(2, "0")}`;

  useEffect(() => {
    setLoading(true);
    let alive = true;
    fetch(`/api/packaging-schedule?from=${first}&days=${n}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PackagingScheduleResult) => {
        if (alive) {
          setResult(d);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [first, n]);

  // 월~일 주차(월 경계로 자름): 1주차 = 1일 ~ 첫 일요일
  const weeks = useMemo(() => {
    const out: { from: string; to: string }[] = [];
    let d = first;
    while (d <= last) {
      const end = addDays(mondayOf(d), 6);
      out.push({ from: d, to: end < last ? end : last });
      d = addDays(end, 1);
    }
    return out;
  }, [first, last]);

  const table = useMemo(() => {
    if (!result) return null;
    const planByLineDate = new Map<string, number>();
    for (const c of result.cells) planByLineDate.set(`${c.line_key}|${c.plan_date}`, c.plan_qty ?? 0);
    const rows = GROUPS.map((g) => {
      const wk = weeks.map((w) => {
        let plan = 0;
        let actual = 0;
        for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
          for (const l of g.lines) {
            plan += planByLineDate.get(`${l}|${d}`) ?? 0;
            actual += result.lineActuals[`${l}|${d}`]?.total ?? 0;
          }
        }
        return { plan, actual };
      });
      return { ...g, wk };
    });
    const totalWk = weeks.map((_, i) => ({
      plan: rows.reduce((s, r) => s + r.wk[i].plan, 0),
      actual: rows.reduce((s, r) => s + r.wk[i].actual, 0),
    }));
    return { rows, totalWk };
  }, [result, weeks]);

  const th = "px-2 py-1.5 text-center font-semibold border border-slate-300 bg-[#D9E1F2] text-slate-600 text-xs";
  const td = "px-2 py-1.5 border border-slate-200 text-right font-mono text-sm";

  function renderRows(label: string, wk: { plan: number; actual: number }[], strong: boolean) {
    const planSum = wk.reduce((s, w) => s + w.plan, 0);
    const actSum = wk.reduce((s, w) => s + w.actual, 0);
    const cls = strong ? "bg-slate-50 font-semibold" : "";
    // 누적 과부족 = 실적 누계 − 계획 누계(주차 단위로 쌓아 간다)
    let cumPlan = 0;
    let cumAct = 0;
    const cumDiff = wk.map((w) => {
      cumPlan += w.plan;
      cumAct += w.actual;
      return cumAct - cumPlan;
    });
    return (
      <>
        <tr className={cls}>
          <td rowSpan={4} className="px-2 py-1.5 border border-slate-200 text-center font-semibold text-slate-700 bg-white">
            {label}
          </td>
          <td className="px-2 py-1.5 border border-slate-200 text-center text-slate-500 text-xs">계획</td>
          {wk.map((w, i) => (
            <td key={i} className={td}>{w.plan > 0 ? fmt(w.plan) : ""}</td>
          ))}
          <td className={td}>{planSum > 0 ? fmt(planSum) : ""}</td>
        </tr>
        <tr className={cls}>
          <td className="px-2 py-1.5 border border-slate-200 text-center text-slate-500 text-xs">실적</td>
          {wk.map((w, i) => (
            <td key={i} className={`${td} text-emerald-700`}>{w.actual > 0 ? fmt(w.actual) : ""}</td>
          ))}
          <td className={`${td} text-emerald-700`}>{actSum > 0 ? fmt(actSum) : ""}</td>
        </tr>
        <tr className={cls}>
          <td className="px-2 py-1.5 border border-slate-200 text-center text-slate-500 text-xs">달성률</td>
          {wk.map((w, i) => (
            <td key={i} className={td}>{pct(w.actual, w.plan)}</td>
          ))}
          <td className={td}>{pct(actSum, planSum)}</td>
        </tr>
        <tr className={cls}>
          <td className="px-2 py-1.5 border border-slate-200 text-center text-slate-500 text-xs">누적 과부족</td>
          {cumDiff.map((v, i) => (
            <td key={i} className={`${td} ${v < 0 ? "text-red-600" : ""}`}>
              {wk[i].plan > 0 || wk[i].actual > 0 || v !== 0 ? fmt(v) : ""}
            </td>
          ))}
          <td className={`${td} ${actSum - planSum < 0 ? "text-red-600" : ""}`}>
            {planSum > 0 || actSum > 0 ? fmt(actSum - planSum) : ""}
          </td>
        </tr>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-medium text-slate-500 shrink-0">월</label>
        <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-2.5 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy">
          ◀
        </button>
        <span className="text-sm font-semibold text-slate-700 w-24 text-center">
          {month.slice(0, 4)}년 {Number(month.slice(5))}월
        </span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-2.5 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy">
          ▶
        </button>
        <button onClick={() => setMonth(thisMonth())} className="px-2.5 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy">
          이번 달
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 text-sm font-semibold text-slate-600">
          {Number(month.slice(5))}월 출하포장 종합 <span className="font-normal text-xs text-slate-400">(수량 기준 · 주차는 월~일, 월 경계로 자름)</span>
        </div>
        {loading || !table ? (
          <div className="p-6 text-sm text-slate-400">불러오는 중…</div>
        ) : (
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className={th}>구분</th>
                <th className={th}></th>
                {weeks.map((w, i) => (
                  <th key={i} className={th}>
                    {i + 1}주차
                    <div className="font-normal text-[10px] text-slate-400">
                      {mmdd(w.from)}~{mmdd(w.to)}
                    </div>
                  </th>
                ))}
                <th className={th}>누계</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <Fragment key={r.key}>{renderRows(r.label, r.wk, false)}</Fragment>
              ))}
              {renderRows("합계", table.totalWk, true)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
