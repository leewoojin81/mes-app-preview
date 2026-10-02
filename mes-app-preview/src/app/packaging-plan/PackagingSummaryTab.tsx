"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTabState } from "@/lib/use-tab-state";
import { addDays, type PackagingScheduleResult } from "@/lib/packaging-schedule";

// 계획정보(PLAN-03) "생산계획" 탭 — 월간계획.JPG·주간계획.JPG 형식: 구분(먼슬리 1·3 Line, 원데이 2 Line, 수동포장 4·5 Line)별
// 월간 계획·실적·달성률(총 포장수량)과 주차별(월~일, 월 경계로 자름) 계획·실적·달성률·누적 과부족. 바이알은 넣지 않는다.
// 값은 "일정" 탭의 계획 수량과 일일작업현황(PROD-10) 출하포장 실적에서 계산한다.

const GROUPS: { key: string; label: string; lines: string[] }[] = [
  { key: "monthly", label: "먼슬리", lines: ["line1", "line3"] },
  { key: "oneday", label: "원데이", lines: ["line2"] },
  { key: "manual", label: "수동포장", lines: ["line4", "line5"] },
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
function dash(n: number): string {
  return n > 0 ? fmt(n) : "-";
}

function weekdayIdx(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay(); // 일=0
}
function fridayOnOrBefore(dateStr: string): string {
  return addDays(dateStr, -((weekdayIdx(dateStr) - 5 + 7) % 7));
}
function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
/** 그 날이 속한 주의 목요일이 속한 ISO 주차 번호(주간업무보고와 같은 기준) */
function isoWeekOfThursday(thu: string): number {
  const [y, m, d] = thu.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const week1Thu = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + 3 * 86400000;
  return Math.round((t - week1Thu) / (7 * 86400000)) + 1;
}

type Wk = { plan: number; actual: number };

export default function PackagingSummaryTab() {
  const [month, setMonth] = useTabState("pkSumMonth", thisMonth);
  const [result, setResult] = useState<PackagingScheduleResult | null>(null);
  const [loading, setLoading] = useState(true);
  // 월 선택 줄은 페이지 위쪽 고정 영역(pk-sticky-slot)에 그려 스크롤해도 보이게 한다
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("pk-sticky-slot")), []);

  const n = daysInMonth(month);
  const first = `${month}-01`;
  const last = `${month}-${String(n).padStart(2, "0")}`;
  // 주간보고(금~목) 주차는 월 경계를 넘나드므로 월 앞뒤로 넓게 읽는다
  const fetchFrom = fridayOnOrBefore(first);
  const fetchDays = daysBetween(fetchFrom, addDays(last, 7)) ;

  useEffect(() => {
    setLoading(true);
    let alive = true;
    fetch(`/api/packaging-schedule?from=${fetchFrom}&days=${fetchDays}`, { cache: "no-store" })
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
  }, [fetchFrom, fetchDays]);

  // 월~일 주차(월 경계로 자름): 1주차 = 1일 ~ 첫 일요일
  const weeks = useMemo(() => {
    const out: { from: string; to: string; label: string }[] = [];
    let d = first;
    let i = 1;
    while (d <= last) {
      const end = addDays(mondayOf(d), 6);
      out.push({ from: d, to: end < last ? end : last, label: `${i++}주차` });
      d = addDays(end, 1);
    }
    return out;
  }, [first, last]);

  // 주간보고 주차(금~목): 첫 주는 월 경계를 넘어 앞쪽 금요일부터, 마지막 주는 월말(예: 10/30~10/31)까지만 표시한다.
  // 주차 번호는 그 주 목요일이 속한 ISO 주차.
  const reportWeeks = useMemo(() => {
    const out: { from: string; to: string; label: string }[] = [];
    let d = fridayOnOrBefore(first);
    while (d <= last) {
      const end = addDays(d, 6);
      if (end >= first) out.push({ from: d, to: end < last ? end : last, label: `${isoWeekOfThursday(end)}W` });
      d = addDays(d, 7);
    }
    return out;
  }, [first, last]);

  function buildTable(periods: { from: string; to: string }[]) {
    if (!result) return null;
    const planByLineDate = new Map<string, number>();
    for (const c of result.cells) planByLineDate.set(`${c.line_key}|${c.plan_date}`, c.plan_qty ?? 0);
    const rows = GROUPS.map((g) => {
      const wk: Wk[] = periods.map((w) => {
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
    const totalWk: Wk[] = periods.map((_, i) => ({
      plan: rows.reduce((s, r) => s + r.wk[i].plan, 0),
      actual: rows.reduce((s, r) => s + r.wk[i].actual, 0),
    }));
    return { rows, totalWk };
  }
  const table = useMemo(() => buildTable(weeks), [result, weeks]); // eslint-disable-line react-hooks/exhaustive-deps
  const reportTable = useMemo(() => buildTable(reportWeeks), [result, reportWeeks]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = "px-2 py-1.5 text-center font-semibold border border-slate-300 bg-[#D9E1F2] text-slate-700 text-sm";
  const cell = "px-3 py-1.5 border border-slate-300 text-right font-mono text-sm";

  const monthRows = table
    ? [
        ...table.rows.map((r) => ({
          label: r.label,
          plan: r.wk.reduce((s, w) => s + w.plan, 0),
          actual: r.wk.reduce((s, w) => s + w.actual, 0),
        })),
        {
          label: "총 포장수량",
          plan: table.totalWk.reduce((s, w) => s + w.plan, 0),
          actual: table.totalWk.reduce((s, w) => s + w.actual, 0),
        },
      ]
    : [];

  function weekBlock(label: string, wk: Wk[]) {
    const planSum = wk.reduce((s, w) => s + w.plan, 0);
    const actSum = wk.reduce((s, w) => s + w.actual, 0);
    return (
      <>
        <tr>
          <td rowSpan={3} className="px-2 py-1.5 border border-slate-300 text-center font-semibold text-slate-700 bg-white">
            {label}
          </td>
          <td className="px-2 py-1.5 border border-slate-300 text-center font-semibold text-slate-600 text-sm">계획</td>
          {wk.map((w, i) => (
            <td key={i} className={cell}>
              {dash(w.plan)}
            </td>
          ))}
          <td className={cell}>{dash(planSum)}</td>
        </tr>
        <tr>
          <td className="px-2 py-1.5 border border-slate-300 text-center font-semibold text-slate-600 text-sm">실적</td>
          {wk.map((w, i) => (
            <td key={i} className={cell}>
              {dash(w.actual)}
            </td>
          ))}
          <td className={cell}>{dash(actSum)}</td>
        </tr>
        <tr>
          <td className="px-2 py-1.5 border border-slate-300 text-center font-semibold text-slate-600 text-sm bg-[#D9E1F2]">달성률</td>
          {wk.map((w, i) => (
            <td key={i} className={`${cell} bg-[#D9E1F2]`}>
              {pct(w.actual, w.plan)}
            </td>
          ))}
          <td className={`${cell} bg-[#D9E1F2]`}>{pct(actSum, planSum)}</td>
        </tr>
      </>
    );
  }

  // 누적 과부족 = 실적 누계 − 계획 누계
  function cumDiffOf(t: { totalWk: Wk[] }): number[] {
    const out: number[] = [];
    let p = 0;
    let a = 0;
    for (const w of t.totalWk) {
      p += w.plan;
      a += w.actual;
      out.push(a - p);
    }
    return out;
  }

  function weekTable(
    t: NonNullable<ReturnType<typeof buildTable>>,
    periods: { from: string; to: string; label: string }[]
  ) {
    const cumDiff = cumDiffOf(t);
    const lastDiff = cumDiff.length ? cumDiff[cumDiff.length - 1] : 0;
    return (
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr>
            <th className={th}>품목</th>
            <th className={th}>구분</th>
            {periods.map((w, i) => (
              <th key={i} className={th}>
                {w.label}
                <div className="font-normal text-[10px] text-slate-400">
                  {mmdd(w.from)}~{mmdd(w.to)}
                </div>
              </th>
            ))}
            <th className={th}>누계</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <Fragment key={r.key}>{weekBlock(r.label, r.wk)}</Fragment>
          ))}
          {weekBlock("합계", t.totalWk)}
          <tr className="bg-[#B4C6E7] font-semibold">
            <td colSpan={2} className="px-2 py-2 border border-slate-300 text-center text-slate-800">
              누적 과부족
            </td>
            {cumDiff.map((v, i) => (
              <td key={i} className={`${cell} ${v < 0 ? "text-red-600" : ""}`}>
                {fmt(v)}
              </td>
            ))}
            <td className={`${cell} ${lastDiff < 0 ? "text-red-600" : ""}`}>{fmt(lastDiff)}</td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <div className="space-y-5">
      {slot && createPortal(
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
        , slot)}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 text-sm font-semibold text-slate-600">
          1. 월간 생산계획 <span className="font-normal text-xs text-slate-400">({Number(month.slice(5))}월 · 수량 기준)</span>
        </div>
        {loading || !table ? (
          <div className="p-6 text-sm text-slate-400">불러오는 중…</div>
        ) : (
          <table className="w-full max-w-3xl border-collapse m-3">
            <thead>
              <tr>
                <th className={th}>구분</th>
                <th className={th}>계획</th>
                <th className={th}>실적</th>
                <th className={th}>달성률</th>
                <th className={th}>비고</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r, i) => (
                <tr key={r.label} className={i === monthRows.length - 1 ? "font-semibold" : ""}>
                  <td className="px-3 py-2 border border-slate-300 text-center font-semibold text-slate-700">{r.label}</td>
                  <td className={cell}>{dash(r.plan)}</td>
                  <td className={cell}>{dash(r.actual)}</td>
                  <td className={`${cell} text-center`}>{pct(r.actual, r.plan)}</td>
                  <td className="px-3 py-2 border border-slate-300"></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 text-sm font-semibold text-slate-600">
          2. 주차별 생산계획 <span className="font-normal text-xs text-slate-400">(주차는 월~일, 월 경계로 자름)</span>
        </div>
        {loading || !table ? (
          <div className="p-6 text-sm text-slate-400">불러오는 중…</div>
        ) : (
          weekTable(table, weeks)
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 text-sm font-semibold text-slate-600">
          3. 주간보고 생산계획 <span className="font-normal text-xs text-slate-400">(금요일~목요일 기준 · 주차 번호는 목요일이 속한 주 · 첫 주는 전월 금요일부터, 마지막 주는 월말까지)</span>
        </div>
        {loading || !reportTable ? (
          <div className="p-6 text-sm text-slate-400">불러오는 중…</div>
        ) : (
          weekTable(reportTable, reportWeeks)
        )}
      </div>
    </div>
  );
}
