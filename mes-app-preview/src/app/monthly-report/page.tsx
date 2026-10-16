"use client";

import { useEffect, useState } from "react";
import {
  WEEKLY_DEFECT_TABLE1,
  WEEKLY_DEFECT_TABLE2,
  WEEKLY_YIELD_PROCESSES,
  type WeeklyDefectRow,
} from "@/lib/weekly-report-shared";
import type { MonthlyPrintingBlock, MonthlyProductionRow, MonthlyReportResult, MonthlyTrendPoint } from "@/lib/monthly-report-shared";

// PROD-12 월간업무보고 — 서식 "생산팀 월간 업무.docx"와 같은 구성(1. 공정별 생산실적 및 생산성 / 2. 생산 수율 /
// 3. 주요공정 불량률 / 4. 이슈사항)을 화면에서 미리 보고 Word(.docx)로 내려받는다. 집계 규칙은 src/lib/monthly-report.ts 참고.

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtQty(n: number | null): string {
  return n == null ? "" : Math.round(n).toLocaleString("ko-KR");
}
function fmtPct(n: number | null, digits: number): string {
  return n == null ? "" : `${(n * 100).toFixed(digits)}%`;
}
function fmtDefectPct(n: number | null): string {
  return n == null || n * 100 < 0.000001 ? "" : fmtPct(n, 2);
}
function fmtK(n: number): string {
  return Math.round(n / 1000).toLocaleString("ko-KR");
}
function fmtK1(n: number): string {
  return (n / 1000).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtUnits(n: number | null): string {
  return n == null ? "" : `${Number.isInteger(n) ? n : n.toFixed(1)} 대`;
}

const thCls = "px-2 py-1.5 text-center font-semibold text-slate-700 bg-slate-100 border border-slate-300";
const tdCls = "px-2 py-1.5 text-center font-mono border border-slate-300";

export default function MonthlyReportPage() {
  // ""이면 서버가 이미 끝난 가장 최근 달을 고른다.
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<MonthlyReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<MonthlyTrendPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/monthly-report${month ? `?month=${month}` : ""}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: MonthlyReportResult) => {
        if (cancelled) return;
        setResult(data);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  // 수율 추이 차트는 21개월치를 훑어 오래 걸려 본문을 먼저 보여준 뒤 따로 받는다.
  const ym = result?.yearMonth;
  useEffect(() => {
    if (!ym) return;
    let cancelled = false;
    fetch(`/api/monthly-report?month=${ym}&part=trend`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { trend: MonthlyTrendPoint[] }) => {
        if (!cancelled) setTrend(data.trend);
      });
    return () => {
      cancelled = true;
    };
  }, [ym]);

  function goto(next: string) {
    setLoading(true);
    setTrend(null);
    setMonth(next);
  }

  return (
    <div className="w-full px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">월간업무보고</h1>
          <p className="text-sm text-slate-500 mt-1">
            PROD-12 · 생산팀 월간 업무 서식 · 생산량은 일일작업현황(PROD-10), 수율·불량은 불량종합현황(PROD-07), 근무시간은 근무시간입력(PSN-01) 연동
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm">
            <button
              onClick={() => result && goto(shiftMonth(result.yearMonth, -1))}
              disabled={!result}
              className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="이전 달"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-navy min-w-40 text-center">
              {result ? `${result.yearMonth.slice(0, 4)}년 ${result.monthNo}월` : ""}
            </span>
            <button
              onClick={() => result && goto(shiftMonth(result.yearMonth, 1))}
              disabled={!result}
              className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="다음 달"
            >
              ›
            </button>
            {month !== "" && (
              <button onClick={() => goto("")} className="ml-1 text-xs font-medium text-navy hover:underline">
                최근 달
              </button>
            )}
          </div>
          <a
            href={result ? `/api/monthly-report/docx?month=${result.yearMonth}` : undefined}
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
            <h2 className="text-xl font-bold text-navy underline underline-offset-4">{result.monthNo}월 생산팀 월간 업무</h2>
            <p className="text-sm text-slate-500 text-right mt-1">보고일 {result.reportDate}</p>
          </div>

          <section className="space-y-5">
            <h3 className="font-bold text-navy">1. 공정별 생산실적 및 생산성</h3>
            <ProductionSection rows={result.production} />
            <PrintingSection block={result.printing} monthNo={result.monthNo} />
          </section>

          <section className="space-y-3">
            <h3 className="font-bold text-navy">2. 생산 수율</h3>
            <YieldSection result={result} trend={trend} />
          </section>

          <section className="space-y-3">
            <h3 className="font-bold text-navy">3. 주요공정 불량률</h3>
            <DefectSection defect={result.defect} from={result.dateFrom} to={result.dateTo} />
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-navy">4. 이슈사항</h3>
            <p className="text-sm text-slate-400">이슈사항은 Word 다운로드 후 직접 작성합니다.</p>
          </section>
        </div>
      )}
    </div>
  );
}

// 공정별 생산량(막대, K천대) · 생산성(꺾은선, 생산량 K천대 ÷ 근무시간) 콤보 차트와 값 표
function ProductionSection({ rows }: { rows: MonthlyProductionRow[] }) {
  const W = 760;
  const H = 280;
  const padL = 48;
  const padR = 48;
  const padT = 28;
  const padB = 34;
  const qtys = rows.map((r) => r.qty / 1000);
  const maxQ = Math.max(1, ...qtys);
  const prods = rows.map((r) => r.productivity);
  const maxP = Math.max(0.01, ...prods.filter((v): v is number => v != null));
  const slot = (W - padL - padR) / rows.length;
  const cx = (i: number) => padL + slot * (i + 0.5);
  const yQ = (v: number) => padT + (1 - v / (maxQ * 1.1)) * (H - padT - padB);
  const yP = (v: number) => padT + (1 - v / (maxP * 1.15)) * (H - padT - padB);
  const barW = Math.min(44, slot * 0.55);
  const line = rows
    .map((r, i) => (r.productivity == null ? null : `${cx(i)},${yP(r.productivity)}`))
    .filter((v): v is string => v != null)
    .join(" ");
  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl mx-auto" role="img" aria-label="공정별 생산실적 및 생산성">
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="#cbd5e1" />
        {rows.map((r, i) => (
          <g key={r.label}>
            <rect x={cx(i) - barW / 2} y={yQ(qtys[i])} width={barW} height={Math.max(0, H - padB - yQ(qtys[i]))} fill="#8FAADC" />
            <text x={cx(i)} y={H - padB - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1e293b">
              {Math.round(qtys[i]).toLocaleString("ko-KR")}
            </text>
            <text x={cx(i)} y={H - padB + 18} textAnchor="middle" fontSize="12" fill="#334155">
              {r.label}
            </text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke="#ED7D31" strokeWidth="2.5" />
        {rows.map((r, i) =>
          r.productivity == null ? null : (
            <g key={r.label}>
              <circle cx={cx(i)} cy={yP(r.productivity)} r="4" fill="#ED7D31" />
              <text x={cx(i)} y={yP(r.productivity) - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#C55A11">
                {r.productivity.toFixed(2)}
              </text>
            </g>
          )
        )}
      </svg>
      <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-[#8FAADC]" /> 생산량(K천대)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t-2 border-[#ED7D31]" /> 생산성(K천대/시간)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls}>구분</th>
              {rows.map((r) => (
                <th key={r.label} className={thCls}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${tdCls} font-bold`}>생산량(K천대)</td>
              {rows.map((r) => (
                <td key={r.label} className={tdCls}>
                  {fmtK(r.qty)}
                </td>
              ))}
            </tr>
            <tr>
              <td className={`${tdCls} font-bold`}>근무시간(h)</td>
              {rows.map((r) => (
                <td key={r.label} className={tdCls}>
                  {fmtQty(r.hours)}
                </td>
              ))}
            </tr>
            <tr>
              <td className={`${tdCls} font-bold`}>생산성</td>
              {rows.map((r) => (
                <td key={r.label} className={tdCls}>
                  {r.productivity == null ? "-" : r.productivity.toFixed(2)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        생산량 = 일일작업현황 양품수량(사출은 MOLD입고 상·하몰드에서 불량을 뺀 뒤 2로 나눈 렌즈 환산) · 생산성 = 생산량(K천대) ÷ 근무시간 · 근무시간은 근무시간입력(PSN-01)의
        공정별 합계(다른 공정 지원은 빼고 이 공정으로 온 지원은 더함)
      </p>
    </div>
  );
}

function PrintingSection({ block: p, monthNo }: { block: MonthlyPrintingBlock; monthNo: number }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-slate-700">□ 인쇄공정</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>인쇄기</th>
              <th className={thCls} rowSpan={2}>구분</th>
              <th className={thCls} rowSpan={2}>근무일수 {p.workDays}일</th>
              <th className={thCls} colSpan={p.weekLabels.length}>{monthNo}월</th>
              <th className={thCls} rowSpan={2}>평균가동대수<br />생산수량합계</th>
            </tr>
            <tr>
              {p.weekLabels.map((w, i) => (
                <th key={w} className={thCls} title={p.rangeLabels[i]}>{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.flatMap((r) => {
              const sum = r.label === "합계";
              const fill = sum ? "bg-orange-50" : "";
              return [
                <tr key={`${r.label}-u`} className={fill}>
                  <td className={`${tdCls} font-bold`} rowSpan={2}>{r.label}</td>
                  <td className={`${tdCls} font-bold`}>가동대수</td>
                  <td className={`${tdCls} font-bold`}>{fmtUnits(r.avgUnits)}</td>
                  {r.units.map((v, i) => <td key={i} className={tdCls}>{fmtUnits(v)}</td>)}
                  <td className={`${tdCls} font-bold`}>{fmtUnits(r.avgUnits)}</td>
                </tr>,
                <tr key={`${r.label}-q`} className={fill}>
                  <td className={`${tdCls} font-bold`}>생산수량</td>
                  <td className={`${tdCls} font-bold`}>{fmtQty(r.totalQty)}</td>
                  {r.qty.map((v, i) => <td key={i} className={tdCls}>{v > 0 ? fmtQty(v) : "-"}</td>)}
                  <td className={`${tdCls} font-bold`}>{fmtQty(r.totalQty)}</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        착색 인쇄(P220) 실적 기준 · 주차는 금~목 구간을 월 경계로 자른 값 · 평균 가동대수 = 가동대수 합 ÷ 실적이 있는 근무일수
      </p>
    </div>
  );
}

function YieldSection({ result: r, trend }: { result: MonthlyReportResult; trend: MonthlyTrendPoint[] | null }) {
  const heads = ["사출", ...WEEKLY_YIELD_PROCESSES];
  return (
    <>
      <p className="text-sm font-semibold text-slate-700">-. 월별 수율</p>
      {trend == null ? (
        <p className="text-sm text-slate-400 py-6 text-center">수율 추이를 계산하는 중입니다... (처음 한 번은 10초 넘게 걸릴 수 있습니다)</p>
      ) : (
        <YieldTrendChart points={trend} />
      )}
      <p className="text-sm font-semibold text-slate-700">-. 당월 수율</p>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>월별</th>
              <th className={thCls} colSpan={4}>몰드</th>
              <th className={thCls} colSpan={heads.length - 4}>렌즈</th>
              <th className={thCls} rowSpan={2}>TTL</th>
            </tr>
            <tr>
              {heads.map((h) => (
                <th key={h} className={thCls}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[r.yield.previous, r.yield.current].map((y) => (
              <tr key={y.monthLabel}>
                <td className={`${tdCls} font-bold`}>{y.monthLabel}</td>
                <td className={tdCls}>{y.injection == null ? "-" : fmtPct(y.injection, 1)}</td>
                {y.yields.map((v, i) => <td key={i} className={tdCls}>{v == null ? "-" : fmtPct(v, 1)}</td>)}
                <td className={`${tdCls} font-bold`}>{fmtPct(y.total, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        사출 수율 = (MOLD입고 − 사출창고→불량창고 이동 − MOLD입고의 불량창고 입고) ÷ MOLD입고 · TTL = 사출 × 렌즈 공정 수율의 곱 · 몰드 = 사출·Base 인쇄·착색 인쇄·정렬, 렌즈 = 조립 이후(서식 기준)
      </p>
    </>
  );
}

// 사출포함(막대) · 사출제외(꺾은선) 수율 추이. 분기=연녹색, 월=파랑.
function YieldTrendChart({ points }: { points: MonthlyTrendPoint[] }) {
  const vals = points.flatMap((p) => [p.total, p.exInjection]).filter((v): v is number => v != null);
  if (points.length === 0 || vals.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">수율 데이터가 있는 구간이 없습니다.</p>;
  }
  const W = 760;
  const H = 300;
  const padL = 44;
  const padR = 16;
  const padT = 24;
  const padB = 36;
  const lo = Math.floor((Math.min(...vals) - 0.02) * 50) / 50;
  const hi = Math.ceil((Math.max(...vals) + 0.01) * 50) / 50;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const slot = (W - padL - padR) / points.length;
  const cx = (i: number) => padL + slot * (i + 0.5);
  const barW = Math.min(48, slot * 0.55);
  const ticks = 5;
  const line = points
    .map((p, i) => (p.exInjection == null ? null : `${cx(i)},${y(p.exInjection)}`))
    .filter((v): v is string => v != null)
    .join(" ");
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl mx-auto" role="img" aria-label="월별 수율 추이">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = lo + ((hi - lo) * i) / ticks;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
              <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}
        {points.map((p, i) =>
          p.total == null ? (
            <text key={p.label} x={cx(i)} y={H - padB - 6} textAnchor="middle" fontSize="11" fill="#94a3b8">
              데이터 없음
            </text>
          ) : (
            <g key={p.label}>
              <rect x={cx(i) - barW / 2} y={y(p.total)} width={barW} height={H - padB - y(p.total)} fill={p.kind === "quarter" ? "#A9D18E" : "#4472C4"} />
              <text
                x={cx(i)}
                y={(y(p.total) + (H - padB)) / 2 + 4}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill={p.kind === "month" ? "#ffffff" : "#1e293b"}
              >
                {(p.total * 100).toFixed(1)}%
              </text>
            </g>
          )
        )}
        <polyline points={line} fill="none" stroke="#ED7D31" strokeWidth="2.5" />
        {points.map((p, i) =>
          p.exInjection == null ? null : (
            <g key={p.label}>
              <circle cx={cx(i)} cy={y(p.exInjection)} r="4" fill="#ED7D31" />
              <text x={cx(i)} y={y(p.exInjection) - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#C55A11">
                {(p.exInjection * 100).toFixed(1)}%
              </text>
            </g>
          )
        )}
        {points.map((p, i) => (
          <text key={p.label} x={cx(i)} y={H - padB + 18} textAnchor="middle" fontSize="12" fill="#334155">
            {p.label}
          </text>
        ))}
      </svg>
      <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-[#4472C4]" /> 사출포함(월)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-[#A9D18E]" /> 사출포함(분기)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t-2 border-[#ED7D31]" /> 사출제외
        </span>
      </div>
    </div>
  );
}

function DefectSection({ defect, from, to }: { defect: WeeklyDefectRow[]; from: string; to: string }) {
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
            <tr>
              {WEEKLY_DEFECT_TABLE1.map((c) => <th key={c.title} className={thCls}>{c.title}</th>)}
            </tr>
          </thead>
          <tbody>
            {defect.map((d) => (
              <tr key={d.label}>
                <td className={`${tdCls} font-bold`}>{d.label}</td>
                <td className={tdCls}>{fmtK(d.workQty)}</td>
                <td className={tdCls}>{fmtK(d.goodQty)}</td>
                <td className={tdCls}>{fmtK1(d.badQty)}</td>
                <td className={tdCls}>{fmtPct(d.yld, 1)}</td>
                {d.table1.map((v, i) => <td key={i} className={tdCls}>{fmtDefectPct(v)}</td>)}
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
              <th className={thCls} rowSpan={2}>기타</th>
              <th className={thCls} rowSpan={2}>비고(%)</th>
            </tr>
            <tr>{WEEKLY_DEFECT_TABLE2.map((c) => <th key={c.title} className={thCls}>{c.title}</th>)}</tr>
          </thead>
          <tbody>
            {defect.map((d) => (
              <tr key={d.label}>
                <td className={`${tdCls} font-bold`}>{d.label}</td>
                {d.table2.map((v, i) => <td key={i} className={tdCls}>{fmtDefectPct(v)}</td>)}
                <td className={tdCls}>{fmtDefectPct(d.etc)}</td>
                <td className={tdCls}>{d.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        집계기간 {from} ~ {to} · YLD = 양품수 ÷ (양품수 + 불량수) · 불량률 = 유형별 불량수 ÷ 작업량 · 비고는 표에 없는 불량유형 중 가장 큰 항목
      </p>
    </>
  );
}
