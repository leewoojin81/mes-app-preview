"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProductionStatusResult, ProductionStatusRow, ProductionTrendResult } from "@/lib/types";

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}
function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toLocalDateStr(new Date(y, m - 1, d + delta));
}
function fmtDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, m - 1, d).getDay()];
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${wd})`;
}

function fmtQty(n: number | null | undefined): string {
  if (n == null) return "-";
  return Math.round(n).toLocaleString("ko-KR");
}
function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}
function fmtSignedQty(n: number | null | undefined): string {
  if (n == null) return "-";
  const v = Math.round(n);
  return `${v >= 0 ? "+" : ""}${v.toLocaleString("ko-KR")}`;
}
function fmtSignedPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "-";
  const v = n * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%p`;
}
function fmtUph(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toFixed(1);
}

// "생산실적현황" 탭 전용 라인 라벨 — 요약 대시보드 탭의 라벨(사출상몰드 등)보다 짧게
// 표에 맞춰 줄인다(2026-09-13 사용자 요청). 실제 값(key)은 동일한 라인을 그대로 가리킨다.
const TABLE_LABELS: Record<string, string> = {
  injection_upper: "사출(상)",
  injection_lower: "사출(하)",
  coloring: "착색",
  assembly: "조립",
  separation: "분리",
  appearance: "외관",
  sealing: "실링",
  marking: "마킹",
  shipping: "포장",
};

export default function ProductionStatusPage() {
  const [tab, setTab] = useState<"dashboard" | "table">("dashboard");
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<ProductionStatusResult | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch(`/api/production-status?date=${date}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ProductionStatusResult) => {
        setResult(data);
        setLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [date]);

  const shortageRows = result?.rows.filter((r) => r.shortage != null && r.shortage < 0) ?? [];
  const sortedShortageRows = [...shortageRows].sort((a, b) => (a.shortage ?? 0) - (b.shortage ?? 0));

  return (
    <div className="w-full px-4 sm:px-6 py-8 space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">공정별생산현황</h1>
          <p className="text-sm text-slate-500 mt-1">
            MGMT-05 · 매일 아침 회의용 · 전일 실적 기준 · 목표는 계획정보(PLAN-02)에서 자동 연동
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm">
          <button
            onClick={() => setDate((d) => addDays(d, -1))}
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="전날"
          >
            ‹
          </button>
          <span className="text-sm font-semibold text-navy w-32 text-center">
            {fmtDateLabel(date)}
          </span>
          <button
            onClick={() => setDate((d) => addDays(d, 1))}
            disabled={date >= today()}
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="다음날"
          >
            ›
          </button>
          {date !== today() && (
            <button
              onClick={() => setDate(today())}
              className="ml-1 text-xs font-medium text-navy hover:underline"
            >
              오늘
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab("dashboard")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "dashboard" ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          요약 대시보드
        </button>
        <button
          onClick={() => setTab("table")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "table" ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          생산실적현황
        </button>
      </div>

      {loading && !result && <div className="text-center py-20 text-slate-400">불러오는 중...</div>}

      {result && tab === "dashboard" && (
        <>
          {/* 상단 요약 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="총 작업가능일" value={result.totalWorkDays.toLocaleString()} unit="일" />
            <SummaryCard label="작업일수" value={result.doneWorkDays.toLocaleString()} unit="일" />
            <SummaryCard label="잔여일수" value={result.remainingWorkDays.toLocaleString()} unit="일" />
            <SummaryCard
              label="진도율"
              value={fmtPct(result.overallProgressRate)}
              unit=""
              emphasis
            />
          </div>

          {/* 부족 공정 우선 표시 */}
          {sortedShortageRows.length > 0 && (
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5 space-y-3">
              <h2 className="text-base font-bold text-red-700 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                부족 공정 ({sortedShortageRows.length}개) — 전일 목표 미달
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {sortedShortageRows.map((r) => (
                  <div
                    key={r.key}
                    className="bg-white border border-red-200 rounded-lg px-4 py-3"
                  >
                    <p className="text-sm font-semibold text-slate-700">{r.label}</p>
                    <p className="mt-1 text-2xl font-black font-mono text-red-600">
                      {fmtQty(r.shortage)}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      달성율 {fmtPct(r.achievementRate)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 공정별 카드 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {result.rows.map((r) => (
              <ProcessCard key={r.key} row={r} />
            ))}
          </div>
        </>
      )}

      {result && tab === "table" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="총 작업가능일" value={result.totalWorkDays.toLocaleString()} unit="일" />
            <SummaryCard label="작업일수" value={result.doneWorkDays.toLocaleString()} unit="일" />
            <SummaryCard label="잔여일수" value={result.remainingWorkDays.toLocaleString()} unit="일" />
            <SummaryCard
              label="진도율"
              value={fmtPct(result.overallProgressRate)}
              unit=""
              emphasis
            />
          </div>
          <ProductionStatusTable result={result} />
          <ProductionTrendSection rows={result.rows} date={date} />
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  unit,
  emphasis,
}: {
  label: string;
  value: string;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 font-black font-mono ${
          emphasis ? "text-3xl text-navy" : "text-2xl text-slate-700"
        }`}
      >
        {value}
        {unit && <span className="text-sm font-sans font-medium text-slate-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function ProcessCard({ row }: { row: ProductionStatusRow }) {
  const rate = row.achievementRate;
  const toneClass =
    rate == null
      ? "bg-white border-slate-200"
      : rate >= 1
        ? "bg-emerald-50 border-emerald-300"
        : "bg-red-50 border-red-300";
  const badgeClass =
    rate == null
      ? "bg-slate-100 text-slate-500"
      : rate >= 1
        ? "bg-emerald-600 text-white"
        : "bg-red-600 text-white";
  const shortageClass =
    row.shortage == null
      ? "text-slate-400"
      : row.shortage >= 0
        ? "text-emerald-700"
        : "text-red-600";

  return (
    <div className={`rounded-xl border-2 p-5 shadow-sm ${toneClass}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-navy">{row.label}</h3>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${badgeClass}`}>
          달성율 {fmtPct(rate)}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-4xl font-black font-mono text-navy">{fmtQty(row.yesterdayQty)}</span>
        <span className="text-sm text-slate-400">전일생산량</span>
      </div>
      <p className={`mt-1 text-sm font-semibold ${shortageClass}`}>
        {row.shortage == null
          ? "과부족 -"
          : `${row.shortage >= 0 ? "+" : ""}${fmtQty(row.shortage)} 과부족`}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm border-t border-slate-200/70 pt-3.5">
        <div>
          <p className="text-xs text-slate-400">일 목표생산량</p>
          <p className="font-mono font-semibold text-slate-700">{fmtQty(row.dailyTarget)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">월 목표생산량</p>
          <p className="font-mono font-semibold text-slate-700">{fmtQty(row.monthlyTarget)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">진도율</p>
          <p className="font-mono font-semibold text-slate-700">{fmtPct(row.progressRate)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">재공품</p>
          <p className="font-mono font-semibold text-slate-700">{fmtQty(row.wip)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">인원</p>
          <p className="font-mono font-semibold text-slate-700">{row.headcount.toLocaleString()} 명</p>
        </div>
      </div>
    </div>
  );
}

function ProductionStatusTable({ result }: { result: ProductionStatusResult }) {
  const currentMonthLabel = `${Number(result.yearMonth.slice(5, 7))}월`;
  const prevMonthLabel = `${Number(result.prevYearMonth.slice(5, 7))}월`;
  const thCls =
    "text-center px-3 py-2.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]";

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <div className="overflow-auto max-h-[calc(100vh-19rem)]">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
            <tr>
              <th rowSpan={2} className={thCls}>
                공정
              </th>
              <th colSpan={5} className={`${thCls} border-l-2 border-slate-300`}>
                월간목표대비실적
              </th>
              <th colSpan={4} className={`${thCls} border-l-2 border-slate-300`}>
                일간목표대비실적
              </th>
              <th rowSpan={2} className={`${thCls} border-l-2 border-slate-300`}>
                재공품
              </th>
              <th colSpan={3} className={`${thCls} border-l-2 border-slate-300`}>
                생산성 (UPH)
              </th>
            </tr>
            <tr>
              <th className={`${thCls} border-l-2 border-slate-300`}>월간목표</th>
              <th className={thCls}>누적실적</th>
              <th className={thCls}>누적과부족수량</th>
              <th className={thCls}>진도율</th>
              <th className={thCls}>진도율부족</th>
              <th className={`${thCls} border-l-2 border-slate-300`}>목표(일)</th>
              <th className={thCls}>전일실적</th>
              <th className={thCls}>과부족</th>
              <th className={thCls}>달성율</th>
              <th className={`${thCls} border-l-2 border-slate-300`}>전일</th>
              <th className={thCls}>{currentMonthLabel} 누적</th>
              <th className={thCls}>{prevMonthLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.rows.map((r) => {
              const rate = r.achievementRate;
              const rateClass =
                rate == null
                  ? "text-slate-400"
                  : rate >= 1
                    ? "bg-emerald-50 text-emerald-700 font-bold"
                    : "bg-red-50 text-red-600 font-bold";
              const gapClass =
                r.progressGap == null ? "text-slate-400" : r.progressGap >= 0 ? "text-emerald-700" : "text-red-600";
              const cumClass =
                r.cumulativeShortage == null
                  ? "text-slate-400"
                  : r.cumulativeShortage >= 0
                    ? "text-emerald-700"
                    : "text-red-600";
              const shortageClass =
                r.shortage == null ? "text-slate-400" : r.shortage >= 0 ? "text-emerald-700" : "text-red-600";
              return (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-semibold text-navy">{TABLE_LABELS[r.key] ?? r.label}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-700 border-l-2 border-slate-200">
                    {fmtQty(r.monthlyTarget)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtQty(r.mtdQty)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${cumClass}`}>
                    {fmtSignedQty(r.cumulativeShortage)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-500">{fmtPct(r.progressRate)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${gapClass}`}>{fmtSignedPct(r.progressGap)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-500 border-l-2 border-slate-200">
                    {fmtQty(r.dailyTarget)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-700">{fmtQty(r.yesterdayQty)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${shortageClass}`}>{fmtSignedQty(r.shortage)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${rateClass}`}>{fmtPct(rate)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-500 border-l-2 border-slate-200">
                    {fmtQty(r.wip)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-500 border-l-2 border-slate-200">
                    {fmtUph(r.yesterdayUph)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-500">{fmtUph(r.mtdUph)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-500">{fmtUph(r.prevMonthUph)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 카드 실제 픽셀 폭을 측정해 SVG viewBox를 그 폭에 맞춰 반응형으로 그린다.
function useContainerWidth(defaultWidth: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(defaultWidth);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
function niceCeil(v: number): number {
  if (v <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / magnitude) * magnitude;
}

// MGMT-05 표 하단 그래프 — 공정필터(드롭다운) 선택에 따라 해당 공정의 올해 추이를
// 그린다(그래프.JPG 참고). 선택값은 탭 안에서 유지되고, 기준일이 바뀌면 같은 공정으로
// 다시 조회한다.
function ProductionTrendSection({ rows, date }: { rows: ProductionStatusRow[]; date: string }) {
  const [lineKey, setLineKey] = useState(rows[0]?.key ?? "");
  const [trend, setTrend] = useState<ProductionTrendResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lineKey) return;
    setLoading(true);
    fetch(`/api/production-status/trend?line=${lineKey}&date=${date}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ProductionTrendResult) => {
        setTrend(data);
        setLoading(false);
      });
  }, [lineKey, date]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-sm text-navy">
          공정별 생산 추이{" "}
          <span className="font-normal text-xs text-slate-400">(올해 월별 · 이번달 일별)</span>
        </h3>
        <select
          value={lineKey}
          onChange={(e) => setLineKey(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-navy/20"
        >
          {rows.map((r) => (
            <option key={r.key} value={r.key}>
              {TABLE_LABELS[r.key] ?? r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3">
        {loading || !trend ? (
          <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">
            불러오는 중...
          </div>
        ) : trend.points.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">
            표시할 데이터가 없습니다.
          </div>
        ) : (
          <ProductionTrendLineChart trend={trend} />
        )}
      </div>
    </div>
  );
}

function ProductionTrendLineChart({ trend }: { trend: ProductionTrendResult }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useContainerWidth(900);
  const H = 260;
  const PAD_L = 46;
  const PAD_R = 10;
  const PAD_B = 24;
  const PAD_T = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const rows = trend.points;
  const vals = rows.map((r) => r.qty);
  const maxVal = Math.max(1, ...vals);
  const yMax = niceCeil(maxVal * 1.15);
  const slot = plotW / Math.max(1, rows.length - 1 || 1);

  const points = rows.map((r, i) => {
    const x = rows.length === 1 ? PAD_L + plotW / 2 : PAD_L + slot * i;
    const y = PAD_T + plotH - (r.qty / yMax) * plotH;
    return { x, y };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const avgY = PAD_T + plotH - (trend.average / yMax) * plotH;

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, display: "block" }}
        role="img"
        aria-label={`${trend.label} 생산 추이`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PAD_T + plotH - f * plotH;
          return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#eef0f4" strokeWidth={1} />;
        })}
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x={PAD_L - 6}
            y={PAD_T + plotH - f * plotH + 3}
            textAnchor="end"
            fontSize={9}
            fill="#94a3b8"
          >
            {fmtQty(yMax * f)}
          </text>
        ))}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={avgY}
          y2={avgY}
          stroke="#3a62c4"
          strokeWidth={1.5}
          strokeDasharray="5,4"
        />
        <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth={2} />
        {points.map((p, i) => {
          const label = fmtQty(rows[i].qty);
          const labelW = label.length * 5.4 + 4;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={p.x - slot / 2} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              <rect x={p.x - labelW / 2} y={p.y - 17} width={labelW} height={11} rx={2} fill="#fff" />
              <text
                x={p.x}
                y={p.y - 9}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={hover === i ? "#0b0b0b" : "#c2790a"}
              >
                {label}
              </text>
              <circle cx={p.x} cy={p.y} r={hover === i ? 4 : 2.5} fill="#fff" stroke="#f59e0b" strokeWidth={2} />
              <text x={p.x} y={H - 6} textAnchor="middle" fontSize={8} fill={hover === i ? "#0b0b0b" : "#94a3b8"}>
                {rows[i].label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="absolute top-0 bg-white border border-slate-200 rounded-md shadow-md px-2.5 py-1.5 text-xs pointer-events-none z-10"
          style={{
            left: `${(points[hover].x / W) * 100}%`,
            transform: hover > rows.length / 2 ? "translateX(-105%)" : "none",
          }}
        >
          <p className="font-semibold text-slate-700">{rows[hover].label}</p>
          <p className="font-mono">{fmtQty(rows[hover].qty)}</p>
        </div>
      )}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px] bg-amber-500 rounded-full" /> {trend.label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3" style={{ borderTop: "1.5px dashed #3a62c4" }} />
          평균
        </span>
      </div>
    </div>
  );
}
