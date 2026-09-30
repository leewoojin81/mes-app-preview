"use client";

import { useEffect, useState } from "react";
import {
  WEEKLY_DEFECT_TABLE1,
  WEEKLY_DEFECT_TABLE2,
  WEEKLY_YIELD_PROCESSES,
  type WeeklyPlanBlock,
  type WeeklyPrintingBlock,
  type WeeklyReportResult,
} from "@/lib/weekly-report-shared";

// PROD-11 주간업무보고 — 서식 "생산팀 주간 업무_38W.docx"와 같은 구성(1. 생산계획 및 실적 /
// 2. 생산공정 수율 / 3. 주요공정 불량률)을 화면에서 미리 보고, Word(.docx)로 내려받는다.
// 집계 규칙은 src/lib/weekly-report.ts 참고. 주차는 금~목 구간이다.

function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(y, m - 1, d + delta);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function fmtRange(from: string, to: string): string {
  const f = (s: string) => `${s.slice(0, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}`;
  return `${f(from)} ~ ${f(to)}`;
}
function fmtQty(n: number | null): string {
  return n == null ? "" : Math.round(n).toLocaleString("ko-KR");
}
function fmtPct(n: number | null, digits: number): string {
  return n == null ? "" : `${(n * 100).toFixed(digits)}%`;
}
function fmtK(n: number): string {
  return Math.round(n / 1000).toLocaleString("ko-KR");
}
function negClass(n: number | null): string {
  return n != null && n < 0 ? "text-red-600" : "";
}

const thCls = "px-2 py-1.5 text-center font-semibold text-slate-700 bg-slate-100 border border-slate-300";
const tdCls = "px-2 py-1.5 text-center font-mono border border-slate-300";

export default function WeeklyReportPage() {
  // ""이면 서버가 이미 끝난 가장 최근 금~목 주차를 고른다.
  const [date, setDate] = useState("");
  const [result, setResult] = useState<WeeklyReportResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/weekly-report${date ? `?date=${date}` : ""}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: WeeklyReportResult) => {
        if (cancelled) return;
        setResult(data);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // 주차를 바꾸면 새 결과가 올 때까지 기존 표를 흐리게 보여준다.
  function goto(next: string) {
    setLoading(true);
    setDate(next);
  }

  return (
    <div className="w-full px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">주간업무보고</h1>
          <p className="text-sm text-slate-500 mt-1">
            PROD-11 · 생산팀 주간 업무 서식 · 주차는 금~목 기준 · 수율·불량은 불량종합현황(PROD-07), 계획은 계획정보(PLAN-02)
            연동
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm">
            <button
              onClick={() => result && goto(addDays(result.weekStart, -7))}
              disabled={!result}
              className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="이전 주차"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-navy min-w-52 text-center">
              {result ? `${result.weekNo}주차 · ${fmtRange(result.weekStart, result.weekEnd)}` : ""}
            </span>
            <button
              onClick={() => result && goto(addDays(result.weekStart, 7))}
              disabled={!result}
              className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="다음 주차"
            >
              ›
            </button>
            {date !== "" && (
              <button onClick={() => goto("")} className="ml-1 text-xs font-medium text-navy hover:underline">
                최근 주차
              </button>
            )}
          </div>
          <a
            href={result ? `/api/weekly-report/docx?date=${result.weekStart}` : undefined}
            aria-disabled={!result}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white bg-navy shadow-sm hover:opacity-90 ${
              result ? "" : "pointer-events-none opacity-40"
            }`}
          >
            Word 다운로드
          </a>
        </div>
      </div>

      {loading && !result && <div className="text-center py-20 text-slate-400">불러오는 중...</div>}

      {result && (
        <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-8 ${loading ? "opacity-60" : ""}`}>
          <div className="text-center">
            <h2 className="text-xl font-bold text-navy underline underline-offset-4">
              {result.weekNo}주차 생산팀 주간 업무
            </h2>
            <p className="text-sm text-slate-500 text-right mt-1">보고일 {result.reportDate}</p>
          </div>

          <section className="space-y-5">
            <h3 className="font-bold text-navy">1. 생산계획 및 실적</h3>
            {result.plan
              .filter((b) => b.key === "injection")
              .map((b) => (
                <PlanTable key={b.key} block={b} monthNo={Number(result.yearMonth.slice(5, 7))} showProgress />
              ))}
            <PrintingTable block={result.printing} />
            {result.plan
              .filter((b) => b.key === "shipping")
              .map((b) => (
                <PlanTable key={b.key} block={b} monthNo={Number(result.yearMonth.slice(5, 7))} />
              ))}
          </section>

          <section className="space-y-3">
            <h3 className="font-bold text-navy">2. 생산공정 수율</h3>
            <YieldSection result={result} />
          </section>

          <section className="space-y-3">
            <h3 className="font-bold text-navy">3. 주요공정 불량률</h3>
            <DefectSection result={result} />
          </section>
        </div>
      )}
    </div>
  );
}

function PlanTable({ block: b, monthNo, showProgress }: { block: WeeklyPlanBlock; monthNo: number; showProgress?: boolean }) {
  const n = b.columns.length;
  const groups = ["계획(월)", "실적", "계획대비실적", "달성률(%)"];
  const m = b.month;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-slate-700">□ {b.title}공정</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls} colSpan={2} rowSpan={2}>
                {monthNo}월 {b.title} 계획
              </th>
              {groups.map((g) => (
                <th key={g} className={thCls} colSpan={n}>
                  {g}
                </th>
              ))}
            </tr>
            <tr>
              {groups.flatMap((g) => b.columns.map((c) => <th key={`${g}-${c}`} className={thCls}>{c}</th>))}
            </tr>
          </thead>
          <tbody>
            {b.weeks.map((w) => (
              <tr key={w.weekLabel}>
                <td className={`${tdCls} font-bold`}>{w.weekLabel}</td>
                <td className={tdCls}>{w.rangeLabel}</td>
                {w.plan.map((v, i) => <td key={`p${i}`} className={tdCls}>{fmtQty(v)}</td>)}
                {w.actual.map((v, i) => <td key={`a${i}`} className={tdCls}>{fmtQty(v)}</td>)}
                {w.diff.map((v, i) => <td key={`d${i}`} className={`${tdCls} ${negClass(v)}`}>{fmtQty(v)}</td>)}
                {w.rate.map((v, i) => <td key={`r${i}`} className={tdCls}>{fmtPct(v, 2)}</td>)}
              </tr>
            ))}
            <tr className="bg-amber-50 font-bold">
              <td className={tdCls}>{m.label}</td>
              <td className={tdCls}>{m.rangeLabel}</td>
              {m.plan.map((v, i) => <td key={`p${i}`} className={tdCls}>{fmtQty(v)}</td>)}
              {m.actual.map((v, i) => <td key={`a${i}`} className={tdCls}>{fmtQty(v)}</td>)}
              {m.diff.map((v, i) => <td key={`d${i}`} className={`${tdCls} ${negClass(v)}`}>{fmtQty(v)}</td>)}
              {m.rate.map((v, i) => <td key={`r${i}`} className={tdCls}>{fmtPct(v, 2)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {showProgress && (
      <p className="text-sm text-slate-700">
        {b.capaMissing
          ? "☞ 계획정보(PLAN-02)에 이 공정의 일CAPA가 등록되지 않아 계획·달성율을 계산하지 못했습니다."
          : `☞ 근무일(${b.totalWorkDays}일)수 대비 ${b.elapsedWorkDays}일 경과_ 계획 진도율: ${fmtPct(b.progressRate, 1)},  달성율 ${fmtPct(b.achievementRate, 1)}`}
      </p>
      )}
    </div>
  );
}

// 가동대수는 소수 첫째 자리까지, 단위("대") 없이 표시한다.
function fmtUnits(n: number | null): string {
  return n == null ? "" : n.toFixed(1);
}

function PrintingTable({ block: p }: { block: WeeklyPrintingBlock }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-slate-700">□ 인쇄공정</p>
      <div className="overflow-x-auto">
        {/* 인쇄기·구분·전주·요일 7열·주간 합계 = 11열을 똑같은 폭으로 */}
        <table className="w-full min-w-[720px] text-xs border-collapse table-fixed">
          <colgroup>
            {Array.from({ length: p.dates.length + 4 }, (_, i) => (
              <col key={i} style={{ width: `${100 / (p.dates.length + 4)}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>인쇄기</th>
              <th className={thCls} rowSpan={2}>구분</th>
              <th className={thCls}>{p.prevWeekLabel}</th>
              <th className={thCls} colSpan={p.dates.length}>{p.weekLabel}</th>
              <th className={thCls} rowSpan={2}>주간 합계</th>
            </tr>
            <tr>
              <th className={thCls}>{p.prevWorkDays}일 근무</th>
              {p.dates.map((d) => <th key={d} className={thCls}>{`${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.rows.flatMap((r) => {
              const bg = r.label === "합계" ? "bg-orange-50" : "";
              return [
                <tr key={`${r.label}-q`} className={bg}>
                  <td className={`${tdCls} font-bold`} rowSpan={2}>{r.label}</td>
                  <td className={`${tdCls} font-bold`}>생산수량</td>
                  <td className={`${tdCls} font-bold`}>{fmtQty(r.prevQty)}</td>
                  {r.qty.map((v, i) => <td key={i} className={tdCls}>{v > 0 ? fmtQty(v) : "-"}</td>)}
                  <td className={`${tdCls} font-bold`}>{fmtQty(r.totalQty)}</td>
                </tr>,
                <tr key={`${r.label}-u`} className={bg}>
                                    <td className={`${tdCls} font-bold`}>가동대수</td>
                  <td className={`${tdCls} font-bold`}>{fmtUnits(r.prevAvgUnits)}</td>
                  {r.units.map((v, i) => <td key={i} className={tdCls}>{fmtUnits(v)}</td>)}
                  <td className={`${tdCls} font-bold`}>{fmtUnits(r.avgUnits)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        자동인쇄기 = 자동인쇄N호기, 수동인쇄기 = 착색 NN호기 · 가동대수 = 그날 실적이 있는 설비 수(평균은 근무일수 기준)
      </p>
    </div>
  );
}

function YieldSection({ result: r }: { result: WeeklyReportResult }) {
  const line = (label: string, cur: number | null, prev: number | null, diff: number | null): string | null => {
    if (cur == null) return null;
    let s = `${label} : ${fmtPct(cur, 1)}`;
    if (prev != null && diff != null) {
      const d = Math.abs(diff * 100).toFixed(1);
      s += ` (전주 : ${fmtPct(prev, 1)} 전주 比 ${Math.abs(diff) < 0.0005 ? "동일" : diff > 0 ? `${d}% 증가` : `${d}% 감소`})`;
    }
    return s;
  };
  const y = r.yield;
  const summary = line("당주", y.current.total, y.previous.total, y.diffPct) ?? "해당 주차 수율 데이터가 없습니다.";
  const exInjection = line("사출제외 : 당주", y.current.totalExInjection, y.previous.totalExInjection, y.diffPctExInjection);
  return (
    <>
      <p className="text-sm text-slate-700">□ {summary}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>공정</th>
              <th className={thCls}>몰드</th>
              <th className={thCls} colSpan={WEEKLY_YIELD_PROCESSES.length}>렌즈</th>
              <th className={thCls} rowSpan={2}>TTL</th>
            </tr>
            <tr>
              <th className={thCls}>사출</th>
              {WEEKLY_YIELD_PROCESSES.map((p) => <th key={p} className={thCls}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {[r.yield.previous, r.yield.current].map((y) => (
              <tr key={y.weekLabel}>
                <td className={`${tdCls} font-bold`}>{y.weekLabel}</td>
                <td className={tdCls}>{y.injection == null ? "-" : fmtPct(y.injection, 1)}</td>
                {y.yields.map((v, i) => <td key={i} className={tdCls}>{v == null ? "-" : fmtPct(v, 1)}</td>)}
                <td className={`${tdCls} font-bold`}>{fmtPct(y.total, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {exInjection && <p className="text-sm text-slate-700">☞ {exInjection}</p>}
      <p className="text-xs text-slate-400">
        사출 수율 = (MOLD입고 − 사출창고→불량창고 이동) ÷ MOLD입고 · TTL = 사출 × 렌즈 공정 수율의 곱, 사출제외 = 렌즈 공정 수율의 곱
      </p>
    </>
  );
}

function DefectSection({ result: r }: { result: WeeklyReportResult }) {
  const t2Groups: { group: string; count: number }[] = [];
  for (const c of WEEKLY_DEFECT_TABLE2) {
    const last = t2Groups[t2Groups.length - 1];
    if (last && last.group === c.group) last.count++;
    else t2Groups.push({ group: c.group, count: 1 });
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>공정</th>
              <th className={thCls} rowSpan={2}>작업량(K천대)</th>
              <th className={thCls} rowSpan={2}>양품수(K천대)</th>
              <th className={thCls} rowSpan={2}>불량수(K천대)</th>
              <th className={thCls} rowSpan={2}>YLD</th>
              <th className={thCls} colSpan={WEEKLY_DEFECT_TABLE1.length}>불량 유형</th>
            </tr>
            <tr>{WEEKLY_DEFECT_TABLE1.map((c) => <th key={c.title} className={thCls}>{c.title}</th>)}</tr>
          </thead>
          <tbody>
            {r.defect.map((d) => (
              <tr key={d.label}>
                <td className={`${tdCls} font-bold`}>{d.label}</td>
                <td className={tdCls}>{fmtK(d.workQty)}</td>
                <td className={tdCls}>{fmtK(d.goodQty)}</td>
                <td className={tdCls}>{fmtK(d.badQty)}</td>
                <td className={tdCls}>{fmtPct(d.yld, 1)}</td>
                {d.table1.map((v, i) => <td key={i} className={tdCls}>{fmtPct(v, 2)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>공정</th>
              {t2Groups.map((g) => <th key={g.group} className={thCls} colSpan={g.count}>{g.group}</th>)}
              <th className={thCls} rowSpan={2}>비고(%)</th>
            </tr>
            <tr>{WEEKLY_DEFECT_TABLE2.map((c) => <th key={c.title} className={thCls}>{c.title}</th>)}</tr>
          </thead>
          <tbody>
            {r.defect.map((d) => (
              <tr key={d.label}>
                <td className={`${tdCls} font-bold`}>{d.label}</td>
                {d.table2.map((v, i) => <td key={i} className={tdCls}>{fmtPct(v, 2)}</td>)}
                <td className={tdCls}>{d.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        집계기간 {r.weekStart} ~ {r.weekEnd} · YLD = 양품수 ÷ (양품수 + 불량수) · 불량률 = 유형별 불량수 ÷ 작업량 · 비고는 표에 없는 불량유형 중 가장 큰 항목
      </p>
    </>
  );
}
