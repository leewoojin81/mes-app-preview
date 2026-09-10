"use client";

import { useEffect, useMemo, useState } from "react";

// 대시보드(dashboard/page.tsx)와 같은 계열의 검증된 팔레트를 재사용한다. 달성률만
// dataviz 스킬의 고정 status 팔레트(good/warning/critical)로 상태를 표시한다 —
// 값 라벨을 항상 함께 보여줘 색상에만 의존하지 않게 한다.
const COLOR_ACTUAL = "#3a62c4"; // 대시보드 COLOR_GOOD과 동일 — 실적 계열
const COLOR_PLAN = "#9a9890"; // 중립 회색 — 계획(목표) 기준선
const COLOR_GOOD = "#0ca30c";
const COLOR_WARN = "#eda100";
const COLOR_CRIT = "#d03b3b";
const RATE_GOOD_THRESHOLD = 80;
const RATE_WARN_THRESHOLD = 50;

interface MonthlyRow {
  month: string; // YYYY-MM
  actual_qty: number;
  plan_qty: number | null;
  unplanned_qty: number | null;
}

interface RowWithRate extends MonthlyRow {
  rate: number | null;
}

function monthLabel(m: string): string {
  const [, mm] = m.split("-");
  return `${parseInt(mm, 10)}월`;
}

// 경영진 보고 헤드라인용 — 큰 수는 "344만" 처럼 만 단위로 축약한다.
function formatManwon(v: number): string {
  if (Math.abs(v) >= 10000) {
    const man = v / 10000;
    return `${man % 1 === 0 ? man.toFixed(0) : man.toFixed(1)}만`;
  }
  return v.toLocaleString();
}

function rateColor(rate: number | null): string {
  if (rate == null) return "#c3c2b7";
  if (rate >= RATE_GOOD_THRESHOLD) return COLOR_GOOD;
  if (rate >= RATE_WARN_THRESHOLD) return COLOR_WARN;
  return COLOR_CRIT;
}

// 계획(목표)이 정점을 찍고 마지막 달까지 계속 낮아지는 구간을 찾아 annotate한다.
function findDecliningPlanRange(rows: RowWithRate[]): { start: number; end: number } | null {
  let peakIdx = -1;
  rows.forEach((r, i) => {
    if (r.plan_qty == null) return;
    if (peakIdx === -1 || r.plan_qty! > rows[peakIdx].plan_qty!) peakIdx = i;
  });
  if (peakIdx === -1) return null;
  let endIdx = peakIdx;
  for (let i = peakIdx + 1; i < rows.length; i++) {
    const prev = rows[i - 1].plan_qty;
    const cur = rows[i].plan_qty;
    if (prev != null && cur != null && cur <= prev) endIdx = i;
    else break;
  }
  return endIdx > peakIdx ? { start: peakIdx, end: endIdx } : null;
}

export default function MonthlyOrdersPage() {
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editUnplanned, setEditUnplanned] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/analytics/monthly-orders", { cache: "no-store" });
    setRows(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const withRate = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        rate: r.plan_qty ? +((r.actual_qty / r.plan_qty) * 100).toFixed(1) : null,
      })),
    [rows]
  );

  const latest = withRate.length > 0 ? withRate[withRate.length - 1] : null;
  const totalQty = useMemo(() => rows.reduce((s, r) => s + r.actual_qty, 0), [rows]);
  const avgRate = useMemo(() => {
    const rates = withRate.map((r) => r.rate).filter((r): r is number => r != null);
    if (rates.length === 0) return null;
    return +(rates.reduce((s, r) => s + r, 0) / rates.length).toFixed(1);
  }, [withRate]);
  const periodLabel =
    withRate.length > 0 ? `${monthLabel(withRate[0].month)}~${monthLabel(withRate[withRate.length - 1].month)}` : "";
  const declineRange = useMemo(() => findDecliningPlanRange(withRate), [withRate]);

  function startEdit(r: MonthlyRow) {
    setEditingMonth(r.month);
    setEditPlan(r.plan_qty != null ? String(r.plan_qty) : "");
    setEditUnplanned(r.unplanned_qty != null ? String(r.unplanned_qty) : "");
  }

  async function savePlan(month: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/analytics/monthly-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          plan_qty: editPlan || 0,
          unplanned_qty: editUnplanned || 0,
        }),
      });
      if (!res.ok) throw new Error();
      setEditingMonth(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full px-5 sm:px-8 py-8 space-y-8 print:p-6 print:space-y-5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">월별수주현황</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            MGMT-02 · 수주량은 수주등록(SALES-02) 실시간 집계 · 계획(목표)은 영업 계획표 기준
            직접 입력
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="print:hidden px-4 py-2.5 rounded-md text-sm font-medium bg-navy text-white hover:bg-navy-light transition-colors flex items-center gap-2"
          title="인쇄 대화상자에서 '대상'을 PDF로 저장을 선택하면 PDF로 저장됩니다"
        >
          PDF로 내보내기
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-10 text-center">불러오는 중...</p>
      ) : rows.length === 0 || !latest ? (
        <p className="text-sm text-slate-400 py-10 text-center">수주 데이터가 없습니다.</p>
      ) : (
        <>
          {/* 핵심 요약 카드 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <HeadlineCard
              label={`${monthLabel(latest.month)} 수주`}
              value={formatManwon(latest.actual_qty)}
              note={
                latest.rate != null
                  ? `목표 대비 ${latest.rate}%`
                  : "계획 미등록"
              }
              accent={rateColor(latest.rate)}
            />
            <HeadlineCard
              label={`${periodLabel} 평균 달성률`}
              value={avgRate != null ? `${avgRate}%` : "—"}
              note={`월평균 수주량 ${formatManwon(Math.round(totalQty / withRate.length))}`}
              accent={rateColor(avgRate)}
            />
            <HeadlineCard
              label={`${periodLabel} 누적 수주량`}
              value={formatManwon(totalQty)}
              note={`${withRate.length}개월 합계`}
              accent={COLOR_ACTUAL}
            />
          </div>

          {/* 월별 수주량 vs 계획 */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <h3 className="font-semibold text-base text-navy">월별 수주량</h3>
                <p className="text-xs text-slate-400 mt-0.5">실적(막대) · 계획(점선 기준선)</p>
              </div>
              <div className="flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_ACTUAL }} />
                  실적
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0 border-t-2 border-dashed inline-block" style={{ borderColor: COLOR_PLAN }} />
                  계획
                </span>
              </div>
            </div>
            <QtyChart rows={withRate} declineRange={declineRange} />
          </div>

          {/* 월별 달성률 */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-baseline justify-between mb-4">
              <div>
                <h3 className="font-semibold text-base text-navy">월별 달성률</h3>
                <p className="text-xs text-slate-400 mt-0.5">실적 ÷ 계획</p>
              </div>
              <div className="flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_GOOD }} />
                  {RATE_GOOD_THRESHOLD}% 이상
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_WARN }} />
                  {RATE_WARN_THRESHOLD}~{RATE_GOOD_THRESHOLD}%
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_CRIT }} />
                  {RATE_WARN_THRESHOLD}% 미만
                </span>
              </div>
            </div>
            <RateChart rows={withRate} />
          </div>

          {/* 표 */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-center whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">구분</th>
                    {withRate.map((r) => (
                      <th key={r.month} className="px-4 py-3 font-semibold">
                        {monthLabel(r.month)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="text-left px-4 py-2.5 text-slate-500 bg-slate-50">수주량</td>
                    {withRate.map((r) => (
                      <td key={r.month} className="px-4 py-2.5 font-mono">
                        {r.actual_qty.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="text-left px-4 py-2.5 text-slate-500 bg-slate-50">계획</td>
                    {withRate.map((r) => (
                      <td key={r.month} className="px-4 py-2.5 font-mono">
                        {editingMonth === r.month ? (
                          <div className="flex items-center justify-center gap-1 print:hidden">
                            <input
                              value={editPlan}
                              onChange={(e) => setEditPlan(e.target.value)}
                              className="border border-slate-300 rounded px-1.5 py-1 text-xs w-24 text-right"
                              placeholder="계획"
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(r)}
                            className="hover:text-navy hover:underline decoration-dashed underline-offset-2 print:no-underline"
                            title="클릭해서 계획수량 수정"
                          >
                            {r.plan_qty != null ? r.plan_qty.toLocaleString() : "-"}
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                  {editingMonth && (
                    <tr className="print:hidden">
                      <td className="text-left px-4 py-2.5 text-slate-400 bg-slate-50 text-xs">
                        계획외(추가 예상)
                      </td>
                      <td colSpan={withRate.length} className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-xs text-slate-400">{monthLabel(editingMonth)} 계획외</span>
                          <input
                            value={editUnplanned}
                            onChange={(e) => setEditUnplanned(e.target.value)}
                            className="border border-slate-300 rounded px-1.5 py-1 text-xs w-24 text-right"
                            placeholder="0"
                          />
                          <button
                            onClick={() => setEditingMonth(null)}
                            className="text-xs px-2.5 py-1 rounded border border-slate-300 text-slate-600"
                          >
                            취소
                          </button>
                          <button
                            onClick={() => savePlan(editingMonth)}
                            disabled={saving}
                            className="text-xs px-2.5 py-1 rounded bg-navy text-white disabled:opacity-40"
                          >
                            {saving ? "저장 중..." : "저장"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="text-left px-4 py-2.5 text-slate-500 bg-slate-50">달성률</td>
                    {withRate.map((r) => (
                      <td
                        key={r.month}
                        className="px-4 py-2.5 font-mono font-semibold"
                        style={{ color: rateColor(r.rate) }}
                      >
                        {r.rate != null ? `${r.rate}%` : "-"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HeadlineCard({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-4xl font-bold font-mono tabular-nums" style={{ color: accent }}>
        {value}
      </p>
      <p className="text-xs text-slate-400 mt-2">{note}</p>
    </div>
  );
}

function QtyChart({
  rows,
  declineRange,
}: {
  rows: RowWithRate[];
  declineRange: { start: number; end: number } | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 260;
  const PAD_L = 56;
  const PAD_B = 28;
  const PAD_T = 40;
  const plotW = W - PAD_L - 12;
  const plotH = H - PAD_T - PAD_B;

  const maxVal = Math.max(1, ...rows.map((r) => Math.max(r.actual_qty, r.plan_qty ?? 0)));
  const step = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const yMax = Math.ceil((maxVal * 1.1) / step) * step;
  const ticks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax];

  const slot = plotW / rows.length;
  const barW = Math.min(48, slot * 0.5);

  const planPoints = rows
    .map((r, i) =>
      r.plan_qty != null
        ? `${PAD_L + slot * i + slot / 2},${PAD_T + plotH - (r.plan_qty / yMax) * plotH}`
        : null
    )
    .filter((p): p is string => p != null)
    .join(" ");

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: 280, display: "block" }}
        role="img"
        aria-label="월별 수주 실적/계획 차트"
      >
        {ticks.map((t) => {
          const y = PAD_T + plotH - (t / yMax) * plotH;
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - 12} y1={y} y2={y} stroke="#e1e0d9" strokeWidth={1} />
              <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill="#898781">
                {t >= 10000 ? `${Math.round(t / 10000)}만` : t.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* 계획 하향 조정 구간 주석 */}
        {declineRange && (
          <g>
            <rect
              x={PAD_L + slot * declineRange.start}
              y={PAD_T}
              width={slot * (declineRange.end - declineRange.start + 1)}
              height={plotH}
              fill="#eda100"
              opacity={0.06}
            />
            <line
              x1={PAD_L + slot * declineRange.start + 4}
              x2={PAD_L + slot * (declineRange.end + 1) - 4}
              y1={PAD_T - 18}
              y2={PAD_T - 18}
              stroke="#b5620a"
              strokeWidth={1}
            />
            <line x1={PAD_L + slot * declineRange.start + 4} x2={PAD_L + slot * declineRange.start + 4} y1={PAD_T - 22} y2={PAD_T - 14} stroke="#b5620a" strokeWidth={1} />
            <line x1={PAD_L + slot * (declineRange.end + 1) - 4} x2={PAD_L + slot * (declineRange.end + 1) - 4} y1={PAD_T - 22} y2={PAD_T - 14} stroke="#b5620a" strokeWidth={1} />
            <text
              x={PAD_L + slot * declineRange.start + (slot * (declineRange.end - declineRange.start + 1)) / 2}
              y={PAD_T - 24}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="#b5620a"
            >
              계획 하향 조정 구간
            </text>
          </g>
        )}

        {rows.map((r, i) => {
          const x = PAD_L + slot * i + (slot - barW) / 2;
          const h = (r.actual_qty / yMax) * plotH;
          const y = PAD_T + plotH - h;
          const isHover = hover === i;
          return (
            <g key={r.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(0, h)}
                rx={4}
                fill={COLOR_ACTUAL}
                opacity={hover === null || isHover ? 1 : 0.45}
              />
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={isHover ? "#0b0b0b" : "#898781"}>
                {monthLabel(r.month)}
              </text>
            </g>
          );
        })}
        {planPoints && (
          <polyline points={planPoints} fill="none" stroke={COLOR_PLAN} strokeWidth={2} strokeDasharray="5 4" />
        )}
        {rows.map((r, i) =>
          r.plan_qty != null ? (
            <circle
              key={`plan-${r.month}`}
              cx={PAD_L + slot * i + slot / 2}
              cy={PAD_T + plotH - (r.plan_qty / yMax) * plotH}
              r={3.5}
              fill="#fff"
              stroke={COLOR_PLAN}
              strokeWidth={2}
            />
          ) : null
        )}
      </svg>
      {hover !== null && rows[hover] && (
        <div
          className="absolute top-1 bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs pointer-events-none z-10"
          style={{
            left: `${((PAD_L + slot * hover + slot / 2) / W) * 100}%`,
            transform: hover > rows.length / 2 ? "translateX(-105%)" : "none",
          }}
        >
          <p className="font-semibold text-slate-700 mb-1">{monthLabel(rows[hover].month)}</p>
          <p>
            실적 <span className="font-mono ml-2">{rows[hover].actual_qty.toLocaleString()}</span>
          </p>
          <p>
            계획{" "}
            <span className="font-mono ml-2">
              {rows[hover].plan_qty != null ? rows[hover].plan_qty!.toLocaleString() : "-"}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function RateChart({ rows }: { rows: RowWithRate[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 200;
  const PAD_L = 44;
  const PAD_B = 28;
  const PAD_T = 24;
  const plotW = W - PAD_L - 12;
  const plotH = H - PAD_T - PAD_B;
  const yMax = 100;

  const slot = plotW / rows.length;
  const barW = Math.min(48, slot * 0.5);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: 200, display: "block" }}
        role="img"
        aria-label="월별 달성률 차트"
      >
        {[0, RATE_WARN_THRESHOLD, RATE_GOOD_THRESHOLD, 100].map((t) => {
          const y = PAD_T + plotH - (t / yMax) * plotH;
          const isThreshold = t === RATE_WARN_THRESHOLD || t === RATE_GOOD_THRESHOLD;
          return (
            <line
              key={t}
              x1={PAD_L}
              x2={W - 12}
              y1={y}
              y2={y}
              stroke={isThreshold ? "#c3c2b7" : "#e1e0d9"}
              strokeDasharray={isThreshold ? "3 3" : undefined}
              strokeWidth={1}
            />
          );
        })}
        {[0, RATE_WARN_THRESHOLD, RATE_GOOD_THRESHOLD, 100].map((t) => (
          <text key={t} x={PAD_L - 8} y={PAD_T + plotH - (t / yMax) * plotH + 3.5} textAnchor="end" fontSize={10} fill="#898781">
            {t}%
          </text>
        ))}
        {rows.map((r, i) => {
          const x = PAD_L + slot * i + (slot - barW) / 2;
          const val = r.rate ?? 0;
          const h = (val / yMax) * plotH;
          const y = PAD_T + plotH - h;
          const isHover = hover === i;
          return (
            <g key={r.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {r.rate != null && (
                <>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(0, h)}
                    rx={4}
                    fill={rateColor(r.rate)}
                    opacity={hover === null || isHover ? 1 : 0.45}
                  />
                  <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={rateColor(r.rate)}>
                    {r.rate}%
                  </text>
                </>
              )}
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={isHover ? "#0b0b0b" : "#898781"}>
                {monthLabel(r.month)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div
          className="absolute top-1 bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs pointer-events-none z-10"
          style={{
            left: `${((PAD_L + slot * hover + slot / 2) / W) * 100}%`,
            transform: hover > rows.length / 2 ? "translateX(-105%)" : "none",
          }}
        >
          <p className="font-semibold text-slate-700">{monthLabel(rows[hover].month)}</p>
          <p>
            달성률{" "}
            <span className="font-mono ml-2" style={{ color: rateColor(rows[hover].rate) }}>
              {rows[hover].rate != null ? `${rows[hover].rate}%` : "-"}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
