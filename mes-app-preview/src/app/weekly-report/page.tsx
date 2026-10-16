"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import {
  WEEKLY_DEFECT_TABLE1,
  WEEKLY_DEFECT_TABLE2,
  WEEKLY_YIELD_PROCESSES,
  type WeeklyPackagingBlock,
  type WeeklyPlanBlock,
  type WeeklyPrintingBlock,
  type WeeklyReportResult,
} from "@/lib/weekly-report-shared";
import type { WeeklySummary } from "@/lib/weekly-report";

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
// 불량유형 칸은 0.000001% 미만(사실상 없음)이면 0.00%를 찍지 않고 빈칸으로 둔다(2026-10-01 사용자 요청).
function fmtDefectPct(n: number | null): string {
  return n == null || n * 100 < 0.000001 ? "" : fmtPct(n, 2);
}
function fmtK(n: number): string {
  return Math.round(n / 1000).toLocaleString("ko-KR");
}
// 불량수(K천대)는 소수 첫째 자리까지(2026-10-16 사용자 요청) — 불량은 값이 작아 정수로 반올림하면 0으로 뭉개진다.
function fmtK1(n: number): string {
  return (n / 1000).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function negClass(n: number | null): string {
  return n != null && n < 0 ? "text-red-600" : "";
}

// 열 너비를 모두 같게 고정하는 colgroup — 내용 길이에 따라 열 너비가 들쭉날쭉해지는 걸 막는다
// (2026-10-01 사용자 요청: PROD-11 2. 생산공정 수율, 3. 주요공정 불량률 표).
function EqualCols({ n }: { n: number }) {
  return (
    <colgroup>
      {Array.from({ length: n }, (_, i) => (
        <col key={i} style={{ width: `${100 / n}%` }} />
      ))}
    </colgroup>
  );
}

const thCls = "px-2 py-1.5 text-center font-semibold text-slate-700 bg-slate-100 border border-slate-300";
const tdCls = "px-2 py-1.5 text-center font-mono border border-slate-300";

export default function WeeklyReportPage() {
  // ""이면 서버가 이미 끝난 가장 최근 금~목 주차를 고른다.
  const [date, setDate] = useState("");
  const [result, setResult] = useState<WeeklyReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // 주간업무보고(전체 보고서 + Word 다운로드) / 요약(생산실적·수율 추이 + 요약 다운로드) 탭(2026-10-14 사용자 요청)
  const [tab, setTab] = useTabState<"report" | "summary">("wrTab", "report");

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
  }, [date, reloadKey]);

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
            href={
              result
                ? `/api/weekly-report/${tab === "report" ? "docx" : "summary-docx"}?date=${result.weekStart}`
                : undefined
            }
            aria-disabled={!result}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white bg-navy shadow-sm hover:opacity-90 ${
              result ? "" : "pointer-events-none opacity-40"
            }`}
          >
            {tab === "report" ? "Word 다운로드" : "요약 다운로드"}
          </a>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {(
          [
            { key: "report", label: "주간업무보고" },
            { key: "summary", label: "요약" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 -mb-px text-sm font-semibold border-b-2 transition-colors ${
              tab === t.key ? "text-navy border-navy" : "text-slate-400 border-transparent hover:text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && !result && <div className="text-center py-20 text-slate-400">불러오는 중...</div>}

      {result && tab === "summary" && <SummaryTab key={result.weekStart} result={result} dimmed={loading} />}

      {result && tab === "report" && (
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
            <PackagingTable block={result.packaging} yearMonth={result.yearMonth} onSaved={() => setReloadKey((k) => k + 1)} />
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

// 출하공정 표(포장계획.JPG) — 주차별 기초계획(월)·포장 실적·계획대비실적·달성률을 팩수/수량 두 열로 보여준다.
// 0이면 "-", 아직 시작하지 않은 주차(null)는 빈칸.
function dashQty(n: number | null): string {
  if (n == null) return "";
  const r = Math.round(n);
  return r === 0 ? "-" : r.toLocaleString("ko-KR");
}
function PackagingTable({
  block: b,
  yearMonth,
  onSaved,
}: {
  block: WeeklyPackagingBlock;
  yearMonth: string;
  onSaved: () => void;
}) {
  const groups = ["기초계획(월)", "포장 실적", "계획대비실적", "달성률(%)"];
  // 기초계획 직접 수정(2026-10-16 사용자 요청) — 이 달 주차별 기초계획만 임의 값으로 바꾼다. 다른 달은 지금처럼 자동.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { packs: string; qty: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anyOverridden = b.weeks.some((w) => w.planOverridden);

  function startEdit() {
    const d: Record<string, { packs: string; qty: string }> = {};
    for (const w of b.weeks) {
      if (w.weekStart) d[w.weekStart] = { packs: String(Math.round(w.planPacks)), qty: String(Math.round(w.planQty)) };
    }
    setDraft(d);
    setError(null);
    setEditing(true);
  }

  async function save(resetAll: boolean) {
    setBusy(true);
    setError(null);
    const rows = b.weeks
      .filter((w) => w.weekStart)
      .map((w) => {
        const ws = w.weekStart as string;
        if (resetAll) return { weekStart: ws, planPacks: null, planQty: null };
        const cur = draft[ws];
        // 자동값 그대로면 수정값으로 저장하지 않는다(자동 계산을 계속 따라가게 둠)
        const same =
          Number(cur.packs) === Math.round(w.planPacks) && Number(cur.qty) === Math.round(w.planQty);
        if (same && !w.planOverridden) return { weekStart: ws, planPacks: null, planQty: null };
        return { weekStart: ws, planPacks: cur.packs, planQty: cur.qty };
      });
    const res = await fetch("/api/weekly-report/packaging-plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yearMonth, rows }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    setEditing(false);
    onSaved();
  }

  const inputCls = "w-24 border border-slate-300 rounded px-1.5 py-0.5 text-right font-mono text-xs bg-white";
  const row = (w: WeeklyPackagingBlock["month"], sum: boolean) => {
    const ed = editing && !sum && w.weekStart ? draft[w.weekStart] : null;
    const ovCls = w.planOverridden ? "bg-amber-50" : "";
    const setField = (k: "packs" | "qty", v: string) =>
      setDraft((d) => ({ ...d, [w.weekStart as string]: { ...d[w.weekStart as string], [k]: v } }));
    return (
      <tr key={w.weekLabel} className={sum ? "bg-orange-50 font-bold" : ""}>
        <td className={`${tdCls} font-bold`}>{w.weekLabel}</td>
        <td className={tdCls}>{w.rangeLabel}</td>
        <td className={`${tdCls} ${ovCls}`} title={w.planOverridden ? `수정됨 (자동 계산값 ${dashQty(w.autoPlanPacks ?? 0)})` : undefined}>
          {ed ? (
            <input className={inputCls} type="number" min={0} value={ed.packs} onChange={(e) => setField("packs", e.target.value)} />
          ) : (
            dashQty(w.planPacks)
          )}
        </td>
        <td className={`${tdCls} ${ovCls}`} title={w.planOverridden ? `수정됨 (자동 계산값 ${dashQty(w.autoPlanQty ?? 0)})` : undefined}>
          {ed ? (
            <input className={inputCls} type="number" min={0} value={ed.qty} onChange={(e) => setField("qty", e.target.value)} />
          ) : (
            dashQty(w.planQty)
          )}
        </td>
        <td className={tdCls}>{dashQty(w.actualPacks)}</td>
        <td className={tdCls}>{dashQty(w.actualQty)}</td>
        <td className={`${tdCls} ${negClass(w.diffPacks)}`}>{dashQty(w.diffPacks)}</td>
        <td className={`${tdCls} ${negClass(w.diffQty)}`}>{dashQty(w.diffQty)}</td>
        <td className={tdCls}>{fmtPct(w.ratePacks, 1)}</td>
        <td className={tdCls}>{fmtPct(w.rateQty, 1)}</td>
      </tr>
    );
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-slate-700">□ 출하공정</p>
        {!editing ? (
          <>
            <button onClick={startEdit} className="px-2.5 py-1 rounded-md text-xs border border-slate-300 bg-white text-slate-600 hover:border-navy">
              기초계획 수정
            </button>
            {anyOverridden && (
              <span className="text-xs text-amber-700">
                {Number(yearMonth.slice(5, 7))}월 기초계획 일부를 직접 수정한 값으로 표시 중 (다른 달은 자동)
              </span>
            )}
          </>
        ) : (
          <>
            <button onClick={() => save(false)} disabled={busy} className="px-2.5 py-1 rounded-md text-xs bg-navy text-white disabled:opacity-40">
              {busy ? "저장 중..." : "저장"}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy} className="px-2.5 py-1 rounded-md text-xs border border-slate-300 bg-white text-slate-600">
              취소
            </button>
            {anyOverridden && (
              <button
                onClick={() => {
                  if (window.confirm(`${Number(yearMonth.slice(5, 7))}월 기초계획 수정값을 모두 지우고 자동 계산값으로 되돌릴까요?`)) save(true);
                }}
                disabled={busy}
                className="px-2.5 py-1 rounded-md text-xs border border-rose-300 bg-white text-rose-600"
              >
                자동값으로 되돌리기
              </button>
            )}
            <span className="text-xs text-slate-500">{Number(yearMonth.slice(5, 7))}월 주차별 기초계획만 바뀌며 다음 달에는 영향이 없습니다.</span>
            {error && <span className="text-xs text-rose-600">{error}</span>}
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>주차별</th>
              <th className={thCls} rowSpan={2}>기간</th>
              {groups.map((g) => (
                <th key={g} className={thCls} colSpan={2}>{g}</th>
              ))}
            </tr>
            <tr>
              {groups.flatMap((g) => ["팩수", "수량"].map((c) => <th key={`${g}-${c}`} className={thCls}>{c}</th>))}
            </tr>
          </thead>
          <tbody>
            {b.weeks.map((w) => row(w, false))}
            {row(b.month, true)}
          </tbody>
        </table>
      </div>
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
        <table className="w-full table-fixed text-xs border-collapse">
          <EqualCols n={WEEKLY_YIELD_PROCESSES.length + 3} />
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
  // 화면에서는 "이물관리"(이물 1~3) 열을 위 표의 불량 유형 옆으로 옮겨 보여준다(2026-10-01 사용자
  // 요청). Word 서식은 기존 그대로(아래 표에 이물관리 포함)라 데이터 배열은 건드리지 않고 화면
  // 표시 위치만 나눈다 — moved는 WEEKLY_DEFECT_TABLE2 안의 원래 인덱스.
  const MOVED_GROUP = "이물관리";
  const movedIdx = WEEKLY_DEFECT_TABLE2.map((c, i) => (c.group === MOVED_GROUP ? i : -1)).filter((i) => i >= 0);
  const restIdx = WEEKLY_DEFECT_TABLE2.map((_, i) => i).filter((i) => !movedIdx.includes(i));
  // 아래 표도 위 표와 같은 열 격자(열 너비)를 써서 열 경계가 위아래로 맞는다(2026-10-01 사용자 요청) —
  // 공정·각 불량유형·비고 모두 1칸 폭(비고를 넓게 늘리지 않는다).
  const topCols = 5 + WEEKLY_DEFECT_TABLE1.length + movedIdx.length;
  const noteCols = 1;
  const t2Groups: { group: string; count: number }[] = [];
  for (const i of restIdx) {
    const c = WEEKLY_DEFECT_TABLE2[i];
    const last = t2Groups[t2Groups.length - 1];
    if (last && last.group === c.group) last.count++;
    else t2Groups.push({ group: c.group, count: 1 });
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs border-collapse">
          <EqualCols n={topCols} />
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>공정</th>
              <th className={thCls} rowSpan={2}>작업량(K천대)</th>
              <th className={thCls} rowSpan={2}>양품수(K천대)</th>
              <th className={thCls} rowSpan={2}>불량수(K천대)</th>
              <th className={thCls} rowSpan={2}>YLD</th>
              <th className={thCls} colSpan={WEEKLY_DEFECT_TABLE1.length}>불량 유형</th>
              {movedIdx.length > 0 && <th className={thCls} colSpan={movedIdx.length}>{MOVED_GROUP}</th>}
            </tr>
            <tr>
              {WEEKLY_DEFECT_TABLE1.map((c) => <th key={c.title} className={thCls}>{c.title}</th>)}
              {movedIdx.map((i) => <th key={WEEKLY_DEFECT_TABLE2[i].title} className={thCls}>{WEEKLY_DEFECT_TABLE2[i].title}</th>)}
            </tr>
          </thead>
          <tbody>
            {r.defect.map((d) => (
              <tr key={d.label}>
                <td className={`${tdCls} font-bold`}>{d.label}</td>
                <td className={tdCls}>{fmtK(d.workQty)}</td>
                <td className={tdCls}>{fmtK(d.goodQty)}</td>
                <td className={tdCls}>{fmtK1(d.badQty)}</td>
                <td className={tdCls}>{fmtPct(d.yld, 1)}</td>
                {d.table1.map((v, i) => <td key={i} className={tdCls}>{fmtDefectPct(v)}</td>)}
                {movedIdx.map((i) => <td key={`m${i}`} className={tdCls}>{fmtDefectPct(d.table2[i])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs border-collapse">
          <EqualCols n={topCols} />
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>공정</th>
              {t2Groups.map((g) => <th key={g.group} className={thCls} colSpan={g.count}>{g.group}</th>)}
              <th className={thCls} rowSpan={2}>기타</th>
              <th className={thCls} rowSpan={2} colSpan={noteCols}>비고(%)</th>
            </tr>
            <tr>{restIdx.map((i) => <th key={WEEKLY_DEFECT_TABLE2[i].title} className={thCls}>{WEEKLY_DEFECT_TABLE2[i].title}</th>)}</tr>
          </thead>
          <tbody>
            {r.defect.map((d) => (
              <tr key={d.label}>
                <td className={`${tdCls} font-bold`}>{d.label}</td>
                {restIdx.map((i) => <td key={i} className={tdCls}>{fmtDefectPct(d.table2[i])}</td>)}
                <td className={tdCls}>{fmtDefectPct(d.etc)}</td>
                <td className={tdCls} colSpan={noteCols}>{d.note}</td>
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

// ── 요약 탭 ────────────────────────────────────────────────────────────────
// Word "요약 다운로드"와 같은 값 — 1. 생산실적(상·하몰드/인쇄/출하 생산수량) / 2. 생산공정 수율 추이 차트.
// 이슈·주요이슈는 사람이 쓰는 항목이라 화면에는 없고 Word에서 직접 쓴다.
function SummaryTab({ result, dimmed }: { result: WeeklyReportResult; dimmed: boolean }) {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/weekly-report/summary?date=${result.weekStart}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { summary?: WeeklySummary; error?: string }) => {
        if (cancelled) return;
        if (data.summary) setSummary(data.summary);
        else setError(data.error ?? "요약을 불러오지 못했습니다.");
      })
      .catch(() => !cancelled && setError("요약을 불러오지 못했습니다."));
    return () => {
      cancelled = true;
    };
  }, [result.weekStart]);

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-8 ${dimmed ? "opacity-60" : ""}`}>
      <div className="text-center">
        <h2 className="text-xl font-bold text-navy underline underline-offset-4">
          {result.weekNo}주차 생산팀 주간 업무
        </h2>
        <p className="text-sm text-slate-500 text-right mt-1">보고일 {result.reportDate}</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!summary && !error && <div className="text-center py-10 text-slate-400">불러오는 중...</div>}
      {summary && (
        <>
          <section className="space-y-3">
            <h3 className="font-bold text-navy">1. 생산실적</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className={thCls} rowSpan={2}>공정항목</th>
                    <th className={thCls} colSpan={2}>사출공정</th>
                    <th className={thCls} rowSpan={2}>인쇄공정</th>
                    <th className={thCls} rowSpan={2}>출하공정</th>
                  </tr>
                  <tr>
                    <th className={thCls}>상몰드</th>
                    <th className={thCls}>하몰드</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={`${tdCls} font-bold`}>생산수량</td>
                    <td className={tdCls}>{fmtQty(summary.upperQty)}</td>
                    <td className={tdCls}>{fmtQty(summary.lowerQty)}</td>
                    <td className={tdCls}>{fmtQty(summary.printQty)}</td>
                    <td className={tdCls}>{fmtQty(summary.shipQty)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">
              집계기간 {result.weekStart} ~ {result.weekEnd} · 이슈는 Word 다운로드 후 직접 작성합니다
            </p>
          </section>
          <section className="space-y-3">
            <h3 className="font-bold text-navy">2. 생산공정 수율</h3>
            <YieldTrendChart points={summary.yieldTrend} />
          </section>
        </>
      )}
    </div>
  );
}

// 사출포함(막대) · 사출제외(꺾은선) 수율 추이. 분기=연녹색, 월=파랑, 주차=노랑. 값 범위에 맞춰 세로축을 잡는다.
function YieldTrendChart({ points }: { points: WeeklySummary["yieldTrend"] }) {
  if (points.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">수율 데이터가 있는 구간이 없습니다.</p>;
  }
  const W = 760;
  const H = 300;
  const padL = 44;
  const padR = 16;
  const padT = 24;
  const padB = 36;
  const vals = points.flatMap((p) => [p.total, p.exInjection]).filter((v): v is number => v != null);
  if (vals.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">수율 데이터가 있는 구간이 없습니다.</p>;
  }
  const lo = Math.floor((Math.min(...vals) - 0.02) * 50) / 50;
  const hi = Math.ceil((Math.max(...vals) + 0.01) * 50) / 50;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const slot = (W - padL - padR) / points.length;
  const cx = (i: number) => padL + slot * (i + 0.5);
  const barW = Math.min(48, slot * 0.55);
  const fill = (k: "quarter" | "month" | "week") => (k === "quarter" ? "#A9D18E" : k === "week" ? "#FFC000" : "#4472C4");
  const ticks = 5;
  const line = points
    .map((p, i) => (p.exInjection == null ? null : `${cx(i)},${y(p.exInjection)}`))
    .filter((v): v is string => v != null)
    .join(" ");
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl mx-auto" role="img" aria-label="생산공정 수율 추이">
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
              <rect x={cx(i) - barW / 2} y={y(p.total)} width={barW} height={H - padB - y(p.total)} fill={fill(p.kind)} />
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
          <span className="inline-block w-3 h-3 bg-[#4472C4]" /> 사출포함
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t-2 border-[#ED7D31]" /> 사출제외
        </span>
      </div>
      <p className="text-xs text-slate-400 text-center">
        수율 = 렌즈 공정 수율의 곱(사출포함은 사출 수율 포함) · 공정 중 하나라도 데이터가 없는 구간은 비워 둡니다(7월 등 불량종합현황이 올라오지 않은 달)
      </p>
    </div>
  );
}
