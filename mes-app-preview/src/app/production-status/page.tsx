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
  // 표의 생산성(UPH) 전일/이번달 누적/전월 세 칸 — 천단위 콤마 포함(2026-09-29 사용자 요청,
  // 그래프 데이터 레이블(fmtUphChart)과 같은 포맷으로 통일).
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
// 그래프 데이터 레이블·Y축·툴팁용 — 천단위 콤마 포함(1,344.5)
function fmtUphChart(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
  // 기준일 기본값은 서버가 계산한다 — 모든 공정에 실적이 있는 마지막 날의 다음날(예: 9/23까지
  // 실적이 있으면 9/24). 계산이 끝나기 전에는 빈 값이라 조회하지 않는다.
  const [date, setDate] = useState("");
  useEffect(() => {
    fetch("/api/production-status/default-date", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { date: string }) => setDate(data.date))
      .catch(() => setDate(today()));
  }, []);
  const [result, setResult] = useState<ProductionStatusResult | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    if (!date) return;
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

  return (
    <div className="w-full px-4 sm:px-6 py-8 space-y-8">
      {/* 제목·탭·상단 요약 카드(총 작업가능일/작업일수/잔여일수/진도율)는 스크롤해도 상단에 고정 —
          -mt-8/pt-8은 루트 위 여백까지 배경으로 덮어, 고정됐을 때 아래 내용이 비쳐 보이지 않게 한다.
          top-[34px]은 이 화면에서 같이 고정되는 최근 열어본 페이지 탭바(TabBar.tsx)의 높이. */}
      <div className="sticky top-[34px] z-20 bg-background -mx-4 sm:-mx-6 px-4 sm:px-6 -mt-8 pt-8 pb-4 space-y-4 shadow-[0_6px_8px_-6px_rgba(15,23,42,0.15)]">
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
            {date ? fmtDateLabel(date) : ""}
          </span>
          <button
            onClick={() => setDate((d) => addDays(d, 1))}
            disabled={!date || date >= today()}
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="다음날"
          >
            ›
          </button>
          {date !== "" && date !== today() && (
            <button
              onClick={() => setDate(today())}
              className="ml-1 text-xs font-medium text-navy hover:underline"
            >
              오늘
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SummaryCard label="총 작업가능일" value={result.totalWorkDays.toLocaleString()} unit="일" />
          <SummaryCard label="작업일수" value={result.doneWorkDays.toLocaleString()} unit="일" />
          <SummaryCard label="잔여일수" value={result.remainingWorkDays.toLocaleString()} unit="일" />
          <SummaryCard label="진도율" value={fmtPct(result.overallProgressRate)} unit="" emphasis />
        </div>
      )}
      </div>

      {loading && !result && <div className="text-center py-20 text-slate-400">불러오는 중...</div>}

      {result && (
        <>
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
                r.progressGap == null
                  ? "text-slate-400"
                  : r.progressGap >= 0
                    ? "bg-emerald-50 text-emerald-700 font-bold"
                    : "bg-red-50 text-red-600 font-bold";
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
// 데이터 최소~최대에 15% 여백을 붙인 뒤 눈금이 깔끔하도록 내림/올림한 축 범위. 최소가 0
// 아래로 내려가지 않게 하고, 값이 하나뿐이거나 전부 같으면 최대값의 10%를 여백으로 쓴다.
function niceRange(min: number, max: number): [number, number] {
  const range = max - min;
  const pad = range > 0 ? range * 0.15 : Math.max(max * 0.1, 1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const unit = Math.pow(10, Math.floor(Math.log10(hi - lo))) / 2;
  const nLo = Math.floor(lo / unit) * unit;
  const nHi = Math.ceil(hi / unit) * unit;
  return [nLo, nHi > nLo ? nHi : nLo + unit];
}

// MGMT-05 표 하단 그래프 — 공정필터(드롭다운) 선택에 따라 해당 공정의 올해 추이를
// 그린다(그래프.JPG 참고). 선택값은 탭 안에서 유지되고, 기준일이 바뀌면 같은 공정으로
// 다시 조회한다. 값은 생산수량이 아니라 생산성(UPH, 표 상단 요약의 yesterdayUph·mtdUph와
// 같은 산식) — 2026-09-28 사용자 요청.
function ProductionTrendSection({ rows, date }: { rows: ProductionStatusRow[]; date: string }) {
  // 기본 선택 공정은 착색인쇄(2026-09-29 사용자 요청) — 목록에 없으면(공정 필터로 걸렀거나
  // 데이터가 아예 없는 경우) 첫 번째 라인으로 대체한다.
  const [lineKey, setLineKey] = useState(
    rows.find((r) => r.key === "coloring")?.key ?? rows[0]?.key ?? ""
  );
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
      <div className="flex items-center justify-center flex-wrap gap-3">
        <h3 className="font-semibold text-sm text-navy">
          공정별 생산성 추이{" "}
          <span className="font-normal text-xs text-slate-400">(올해 월별 · 이번달 일별, UPH)</span>
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
          <div className="h-[340px] flex items-center justify-center text-slate-400 text-sm">
            불러오는 중...
          </div>
        ) : trend.points.length === 0 ? (
          <div className="h-[340px] flex items-center justify-center text-slate-400 text-sm">
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
  // 그래프 안 글씨는 전부 12pt(=16px) — SVG viewBox 폭이 컨테이너 폭과 1:1이라 px가 그대로 화면 px.
  const FS = 16;
  const CHAR_W = FS * 0.56;
  const LABEL_ROW_H = FS + 6;
  const rows = trend.points;
  const vals = rows.map((r) => r.uph);

  // 좌측 축 범위는 0~최대가 아니라 실제 데이터의 최소~최대(위아래 15% 여백, 눈금은 보기 좋은
  // 값으로 내림/올림)로 자동 지정 — 값들이 몰려 있어도 추이 변화가 잘 보이게 한다.
  // 목표 UPH(기준정보 BASE-04)가 있으면 목표선이 항상 축 안에 들어오도록 범위에 함께 포함한다.
  const target = trend.targetUph;
  const rangeVals = target != null ? [...vals, target] : vals;
  const [yMin, yMax] = niceRange(Math.min(...rangeVals), Math.max(...rangeVals));
  const yRange = yMax - yMin;

  const axisLabels = [0, 0.5, 1].map((f) => fmtUphChart(yMin + yRange * f));
  const PAD_L = Math.max(...axisLabels.map((t) => t.length)) * CHAR_W + 14;
  // 마지막 점의 데이터 레이블·X축 라벨은 점 중앙 기준이라 오른쪽 경계에서 잘리지 않게
  // 그 폭의 절반만큼 오른쪽 여백을 둔다.
  const labels = rows.map((r) => fmtUphChart(r.uph));
  const labelW = Math.max(...labels.map((t) => t.length)) * CHAR_W + 6;
  const xLabelW = Math.max(...rows.map((r) => r.label.length)) * CHAR_W + 6;
  const PAD_R = Math.max(labelW, xLabelW) / 2 + 4;
  const plotW = W - PAD_L - PAD_R;
  const slot = plotW / Math.max(1, rows.length - 1 || 1);

  // 글씨가 커서 이웃한 데이터 레이블·X축 라벨이 겹치므로, 겹치는 폭만큼 레이블을 위로 여러 줄
  // (i % 줄수)로 엇갈려 배치하고 X축 라벨은 k개마다 하나씩만 보여준다(마우스 올린 점은 항상 표시).
  const labelRows = Math.min(3, Math.max(1, Math.ceil(labelW / Math.max(slot, 1))));
  const xSkip = Math.max(1, Math.ceil(xLabelW / Math.max(slot, 1)));

  const PAD_T = 14 + LABEL_ROW_H * labelRows;
  const PAD_B = FS + 16;
  const H = 300 + LABEL_ROW_H * (labelRows - 1);
  const plotH = H - PAD_T - PAD_B;
  const yPos = (v: number): number => PAD_T + plotH - ((v - yMin) / yRange) * plotH;

  const points = rows.map((r, i) => {
    const x = rows.length === 1 ? PAD_L + plotW / 2 : PAD_L + slot * i;
    return { x, y: yPos(r.uph) };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  // 선 아래 그라데이션 채움(참고 이미지 "공정별 생산현황.png" 스타일) — 선 경로를 그대로
  // 따라가다 마지막 점에서 축 바닥으로 내려간 뒤 첫 점 바닥까지 닫는다.
  const baselineY = PAD_T + plotH;
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x},${baselineY} L${points[0].x},${baselineY} Z`
      : "";
  const avgY = yPos(trend.average);
  const targetY = target != null ? yPos(target) : null;

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, display: "block" }}
        role="img"
        aria-label={`${trend.label} 생산성 추이`}
      >
        <defs>
          <linearGradient id="productionTrendArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.32} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PAD_T + plotH - f * plotH;
          return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#eef0f4" strokeWidth={1} />;
        })}
        {[0, 0.5, 1].map((f, k) => (
          <text
            key={f}
            x={PAD_L - 6}
            y={PAD_T + plotH - f * plotH + FS * 0.35}
            textAnchor="end"
            fontSize={FS}
            fill="#94a3b8"
          >
            {axisLabels[k]}
          </text>
        ))}
        {areaPath && <path d={areaPath} fill="url(#productionTrendArea)" stroke="none" />}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={avgY}
          y2={avgY}
          stroke="#3a62c4"
          strokeWidth={1.5}
          strokeDasharray="5,4"
        />
        {targetY != null && (
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={targetY}
            y2={targetY}
            stroke="#15803d"
            strokeWidth={2}
            strokeDasharray="8,4"
          />
        )}
        <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth={2} />
        {points.map((p, i) => {
          const label = labels[i];
          const w = label.length * CHAR_W + 6;
          // 줄 번호만큼 위로 올리고, 올린 레이블은 점과 이어지는 가는 선으로 어느 점 값인지 표시
          const lift = (i % labelRows) * LABEL_ROW_H;
          const textY = p.y - 9 - lift;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={p.x - slot / 2} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {lift > 0 && (
                <line x1={p.x} x2={p.x} y1={textY + 3} y2={p.y} stroke="#f59e0b" strokeWidth={1} opacity={0.4} />
              )}
              <rect x={p.x - w / 2} y={textY - FS + 2} width={w} height={FS + 2} rx={2} fill="#fff" />
              <text
                x={p.x}
                y={textY}
                textAnchor="middle"
                fontSize={FS}
                fontWeight={600}
                fill={hover === i ? "#0b0b0b" : "#c2790a"}
              >
                {label}
              </text>
              <circle cx={p.x} cy={p.y} r={hover === i ? 4 : 2.5} fill="#fff" stroke="#f59e0b" strokeWidth={2} />
              {(i % xSkip === 0 || hover === i) && (
                <text
                  x={p.x}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={FS}
                  fill={hover === i ? "#0b0b0b" : "#94a3b8"}
                >
                  {rows[i].label}
                </text>
              )}
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
          <p className="font-mono">{fmtUphChart(rows[hover].uph)} UPH</p>
        </div>
      )}
      <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[2px] bg-amber-500 rounded-full" /> {trend.label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3" style={{ borderTop: "1.5px dashed #3a62c4" }} />
          평균 {fmtUphChart(trend.average)} UPH
        </span>
        {target != null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3" style={{ borderTop: "2px dashed #15803d" }} />
            목표 {fmtUphChart(target)} UPH
          </span>
        )}
      </div>
    </div>
  );
}
