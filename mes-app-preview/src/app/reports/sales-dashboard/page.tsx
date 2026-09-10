"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";

// 카테고리 색상은 dataviz 스킬의 8색 고정 순서(파랑→주황→아쿠아→노랑→마젠타→초록→보라→빨강)를
// 쓰고, "기타"는 색상 없는 중립 회색으로 묶는다 — 고객사별 상위 10위 도넛은 범례에 이름/비율이
// 항상 함께 표시되므로 색만으로 구분하지 않는다(9번째부터는 색이 다시 순환된다).
const CAT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OTHER_COLOR = "#c3c2b7";
const COLOR_LINE = "#3a62c4";
const COLOR_UP = "#0ca30c";
const COLOR_DOWN = "#d03b3b";

// 서버(analytics/sales-dashboard/route.ts)의 SALES01_CUTOVER_MONTH와 반드시 같은 값을
// 유지해야 한다 — 이 달(포함) 이후는 목표량이 SALES-01 자동합산이라 읽기전용, 이전
// 달은 기존처럼 셀을 클릭해 직접 입력한다(2026-09-07 사용자 요청).
const SALES01_CUTOVER_MONTH = "2026-09";

interface MonthlyPoint {
  month: string;
  qty: number;
  order_count: number;
  plan_qty: number | null;
}
interface BreakdownItem {
  name: string;
  qty: number;
  pct: number;
}
interface DashboardData {
  dateFrom: string;
  dateTo: string;
  kpi: {
    total_qty: number;
    avg_monthly_qty: number;
    avg_monthly_qty_month_count: number;
    avg_monthly_qty_excluded_partial_month: boolean;
    max_month: { month: string; qty: number } | null;
    order_count: number;
    mom_change_pct: number | null;
    yoy_change_pct: number | null;
  };
  priorYear: {
    dateFrom: string;
    dateTo: string;
    has_data: boolean;
    total_qty: number;
    order_count: number;
    qty_change_pct: number | null;
    count_change_pct: number | null;
  };
  monthly: MonthlyPoint[];
  byCustomer: BreakdownItem[];
  /** 품목코드 마스터의 "주기"(1Day/Monthly/Half Yearly/...) 기준 구성비 */
  byCycle: BreakdownItem[];
}
interface FilterOptions {
  customers: { customer_code: string; customer_name: string }[];
  /** 품목코드 마스터의 "주기"(1Day/Monthly/Half Yearly/...) — "전체 제품" 필터 옵션 */
  cycles: string[];
}

function monthLabel(m: string): string {
  const [, mm] = m.split("-");
  return `${parseInt(mm, 10)}월`;
}
function monthDot(m: string): string {
  const [yy, mm] = m.split("-");
  return `${yy}.${mm}`;
}
// 정수 수량을 천 단위 콤마로 표시.
function fmtQty(v: number): string {
  return Math.round(v).toLocaleString();
}
// "만개" 단위(소수 1자리)로 표시 — 월별수주현황비교 표 전용.
function fmtManGae(v: number): string {
  const man = v / 10000;
  return man % 1 === 0 ? man.toFixed(0) : man.toFixed(1);
}
// 경영진 보고 헤드라인용 — 큰 수는 "344만" 처럼 만 단위로 축약 (월별수주현황(MGMT-02)과 동일한 표기).
function formatManwon(v: number): string {
  if (Math.abs(v) >= 10000) {
    const man = v / 10000;
    return `${man % 1 === 0 ? man.toFixed(0) : man.toFixed(1)}만`;
  }
  return Math.round(v).toLocaleString();
}
// 차트 y축 상한을 값의 자릿수에 맞춰 보기 좋은 값으로 올림 (예: 5,678,300 → 6,000,000).
function niceCeil(v: number): number {
  if (v <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / magnitude) * magnitude;
}

export default function SalesDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ customers: [], cycles: [] });

  // 탭을 전환했다 돌아와도 보고 있던 필터는 유지되도록 세션 단위로 저장한다.
  const [dateFrom, setDateFrom] = useTabState("dateFrom", "");
  const [dateTo, setDateTo] = useTabState("dateTo", "");
  const [customer, setCustomer] = useTabState("customer", "");
  const [cycle, setCycle] = useTabState("cycle", "");
  const [rangeReady, setRangeReady] = useTabState("rangeReady", false);

  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editPlanQty, setEditPlanQty] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/analytics/sales-dashboard/filters", { cache: "no-store" })
      .then((res) => res.json())
      .then(setFilterOptions);
  }, []);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (customer) params.set("customer", customer);
    if (cycle) params.set("cycle", cycle);
    const res = await fetch(`/api/analytics/sales-dashboard?${params.toString()}`, { cache: "no-store" });
    const json: DashboardData = await res.json();
    setData(json);
    if (!rangeReady) {
      setDateFrom(json.dateFrom);
      setDateTo(json.dateTo);
      setRangeReady(true);
    }
    setLoading(false);
  }

  // 최초 1회는 기간 미지정으로 불러와 서버 기본값(2026-01-01 ~ 오늘)을 받는다.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!rangeReady) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, customer, cycle]);

  async function savePlanQty(month: string) {
    setSaving(true);
    try {
      // 입력/표시는 "만개" 단위, 저장은 EA(raw) 단위 — 여기서 되돌려 환산한다.
      const raw = editPlanQty === "" ? 0 : Number(editPlanQty) * 10000;
      await fetch("/api/analytics/sales-dashboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, plan_qty: raw }),
      });
      setEditingMonth(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const momSeries = useMemo(() => {
    if (!data) return [];
    return data.monthly.map((r, i) => {
      const prev = data.monthly[i - 1];
      const pct = prev && prev.qty > 0 ? +(((r.qty - prev.qty) / prev.qty) * 100).toFixed(1) : null;
      return { month: r.month, pct };
    });
  }, [data]);

  return (
    <div className="w-full px-5 sm:px-8 py-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#1a7f45" }}>
            월별 수주현황 분석
          </h1>
          <p className="text-sm text-slate-500 mt-1.5">
            MGMT-04 · 수주등록(SALES-02) 수주량(EA) 실시간 집계 · 대쉬보드_영업(디자인 2) 레이아웃 재현
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rangeReady && (
            <div className="flex items-center gap-1.5">
              <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
              <span className="text-slate-400 text-sm">~</span>
              <DateSegmentInput value={dateTo} onChange={setDateTo} />
            </div>
          )}
          <select
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            className="border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white text-slate-600 max-w-40"
          >
            <option value="">전체 고객사</option>
            {filterOptions.customers.map((c) => (
              <option key={c.customer_code} value={c.customer_code}>
                {c.customer_name}
              </option>
            ))}
          </select>
          <select
            value={cycle}
            onChange={(e) => setCycle(e.target.value)}
            className="border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white text-slate-600 max-w-40"
          >
            <option value="">전체 제품</option>
            {filterOptions.cycles.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading || !data ? (
        <p className="text-sm text-slate-400 py-10 text-center">불러오는 중...</p>
      ) : data.monthly.length === 0 ? (
        <p className="text-sm text-slate-400 py-10 text-center">조건에 맞는 수주 데이터가 없습니다.</p>
      ) : (
        <>
          {/* KPI 6종 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="총 수주량" value={formatManwon(data.kpi.total_qty)} unit="EA" />
            <KpiCard
              label="평균 월 수주량"
              value={formatManwon(data.kpi.avg_monthly_qty)}
              unit="EA"
              note={
                data.kpi.avg_monthly_qty_excluded_partial_month
                  ? `진행 중인 달 제외, ${data.kpi.avg_monthly_qty_month_count}개월 평균`
                  : undefined
              }
            />
            <KpiCard
              label="최대 월 수주량"
              value={data.kpi.max_month ? formatManwon(data.kpi.max_month.qty) : "—"}
              unit="EA"
              note={data.kpi.max_month ? monthDot(data.kpi.max_month.month) : undefined}
            />
            <KpiCard label="수주 건수" value={data.kpi.order_count.toLocaleString()} unit="건" />
            <KpiCard
              label="전월 대비"
              value={data.kpi.mom_change_pct != null ? `${data.kpi.mom_change_pct > 0 ? "▲" : data.kpi.mom_change_pct < 0 ? "▼" : ""} ${Math.abs(data.kpi.mom_change_pct)}` : "—"}
              unit="%"
              color="#0000CC"
            />
            <KpiCard
              label="전년 동기 대비"
              value={
                data.priorYear.has_data && data.kpi.yoy_change_pct != null
                  ? `${data.kpi.yoy_change_pct > 0 ? "▲" : data.kpi.yoy_change_pct < 0 ? "▼" : ""} ${Math.abs(data.kpi.yoy_change_pct)}`
                  : "데이터 없음"
              }
              unit={data.priorYear.has_data && data.kpi.yoy_change_pct != null ? "%" : ""}
              note={data.priorYear.has_data ? `전년 동기 ${formatManwon(data.priorYear.total_qty)} EA` : "전년도 수주 이력 없음"}
              color="#FF0000"
              small={!data.priorYear.has_data}
            />
          </div>

          {/* 4패널: 추이 / 증감률(넓게) · 고객사별 / 제품별(좁게) — 10칸 그리드로 3:3:2:2 비율 */}
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
            <Panel title="월별 수주량 추이" sub="만EA" className="lg:col-span-3">
              <LineTrendChart rows={data.monthly} />
            </Panel>
            <Panel title="전월 대비 증감률" sub="%" className="lg:col-span-3">
              <MomBarChart rows={momSeries} />
            </Panel>
            <Panel title="고객사별 수주량" sub="EA" className="lg:col-span-2">
              <DonutPanel items={data.byCustomer} totalLabel={formatManwon(data.kpi.total_qty)} />
            </Panel>
            <Panel title="제품별 수주량" sub="EA" className="lg:col-span-2">
              <DonutPanel items={data.byCycle} totalLabel={formatManwon(data.kpi.total_qty)} />
            </Panel>
          </div>

          {/* 비교 표: 월별 표(좌) + 전년동기대비 누계 표(우) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100">
                <h3 className="font-semibold text-sm text-navy">월별수주현황비교</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-center whitespace-nowrap">
                  <thead className="bg-[#B4C6E7] text-slate-600 text-xs">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold">구분</th>
                      {data.monthly.map((r) => (
                        <th key={r.month} className="px-3 py-2.5 font-semibold">
                          {monthLabel(r.month)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">수주량(만개)</td>
                      {data.monthly.map((r) => (
                        <td key={r.month} className="px-3 py-2 font-mono">
                          {fmtManGae(r.qty)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">수주 건수(건)</td>
                      {data.monthly.map((r) => (
                        <td key={r.month} className="px-3 py-2 font-mono">
                          {r.order_count.toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">목표량(만개)</td>
                      {data.monthly.map((r) => {
                        const editable = r.month < SALES01_CUTOVER_MONTH;
                        if (!editable) {
                          return (
                            <td key={r.month} className="px-3 py-2 font-mono">
                              {r.plan_qty != null ? fmtManGae(r.plan_qty) : "-"}
                            </td>
                          );
                        }
                        return (
                          <td key={r.month} className="px-3 py-2 font-mono">
                            {editingMonth === r.month ? (
                              <input
                                autoFocus
                                value={editPlanQty}
                                onChange={(e) => setEditPlanQty(e.target.value)}
                                onBlur={() => savePlanQty(r.month)}
                                onKeyDown={(e) => e.key === "Enter" && savePlanQty(r.month)}
                                disabled={saving}
                                className="border border-slate-300 rounded px-1.5 py-1 text-xs w-20 text-right"
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  setEditingMonth(r.month);
                                  setEditPlanQty(r.plan_qty != null ? String(r.plan_qty / 10000) : "");
                                }}
                                className="hover:text-navy hover:underline decoration-dashed underline-offset-2"
                                title="클릭해서 목표량(만개) 수정"
                              >
                                {r.plan_qty != null ? fmtManGae(r.plan_qty) : "-"}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">달성률(%)</td>
                      {data.monthly.map((r) => {
                        const rate = r.plan_qty ? +((r.qty / r.plan_qty) * 100).toFixed(1) : null;
                        return (
                          <td key={r.month} className="px-3 py-2 font-mono font-semibold text-navy">
                            {rate != null ? rate : "-"}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 px-5 py-2.5 border-t border-slate-100">
                2026년 9월부터 목표량은 월별수주(목표)등록(SALES-01)에 등록된 값을 자동으로
                합산해 보여줍니다(이 화면에서 직접 수정 불가, 고객사 필터를 걸면 그 고객사
                목표만 표시). 2026년 1~8월은 기존처럼 셀을 클릭해 직접 입력합니다.
              </p>
            </div>

            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-slate-100">
                <h3 className="font-semibold text-sm text-navy">전년동기대비누계</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-center whitespace-nowrap">
                  <thead className="bg-[#B4C6E7] text-slate-600 text-xs">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold">구분</th>
                      <th className="px-3 py-2.5 font-semibold">누계</th>
                      <th className="px-3 py-2.5 font-semibold">전년동기</th>
                      <th className="px-3 py-2.5 font-semibold">증감율</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">수주량(EA)</td>
                      <td className="px-3 py-2 font-mono font-semibold">{fmtQty(data.kpi.total_qty)}</td>
                      <td className="px-3 py-2 font-mono">
                        {data.priorYear.has_data ? fmtQty(data.priorYear.total_qty) : "-"}
                      </td>
                      <td
                        className="px-3 py-2 font-mono font-semibold"
                        style={{
                          color:
                            data.priorYear.qty_change_pct == null
                              ? undefined
                              : data.priorYear.qty_change_pct >= 0
                                ? COLOR_UP
                                : COLOR_DOWN,
                        }}
                      >
                        {data.priorYear.qty_change_pct != null ? `${data.priorYear.qty_change_pct}%` : "-"}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">수주 건수(건)</td>
                      <td className="px-3 py-2 font-mono font-semibold">{data.kpi.order_count.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono">
                        {data.priorYear.has_data ? data.priorYear.order_count.toLocaleString() : "-"}
                      </td>
                      <td
                        className="px-3 py-2 font-mono font-semibold"
                        style={{
                          color:
                            data.priorYear.count_change_pct == null
                              ? undefined
                              : data.priorYear.count_change_pct >= 0
                                ? COLOR_UP
                                : COLOR_DOWN,
                        }}
                      >
                        {data.priorYear.count_change_pct != null ? `${data.priorYear.count_change_pct}%` : "-"}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">목표량(EA)</td>
                      <td className="px-3 py-2 text-slate-300">-</td>
                      <td className="px-3 py-2 text-slate-300">-</td>
                      <td className="px-3 py-2 text-slate-300">-</td>
                    </tr>
                    <tr>
                      <td className="text-left px-4 py-2 text-slate-500 bg-slate-50">달성률(%)</td>
                      <td className="px-3 py-2 text-slate-300">-</td>
                      <td className="px-3 py-2 text-slate-300">-</td>
                      <td className="px-3 py-2 text-slate-300">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 px-5 py-2.5 border-t border-slate-100">
                {data.priorYear.has_data
                  ? `전년 동기(${data.priorYear.dateFrom} ~ ${data.priorYear.dateTo}) 수주 이력 기준으로 집계합니다.`
                  : "전년 동기 데이터는 MES에 수주 이력이 없어 비교할 수 없습니다."}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  note,
  tone,
  small,
  color: colorOverride,
}: {
  label: string;
  value: string;
  unit: string;
  note?: string;
  tone?: "up" | "down" | "neutral";
  small?: boolean;
  /** 지정하면 tone(등락)에 따른 색 대신 이 색을 그대로 쓴다. */
  color?: string;
}) {
  const color = colorOverride ?? (tone === "up" ? COLOR_UP : tone === "down" ? COLOR_DOWN : "#0b2a5b");
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1.5 font-bold font-mono tabular-nums ${small ? "text-base" : "text-2xl"}`}
        style={{ color }}
      >
        {value}
        {unit && <span className="text-xs font-sans font-medium text-slate-400 ml-1">{unit}</span>}
      </p>
      {note && <p className="text-[11px] text-slate-400 mt-1">{note}</p>}
    </div>
  );
}

function Panel({
  title,
  sub,
  children,
  className,
  stackedHeader,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
  className?: string;
  /** 제목과 단위를 두 줄로 분리해 차트가 확실히 글씨 아래에 오도록 한다 */
  stackedHeader?: boolean;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm ${className ?? ""}`}>
      {stackedHeader ? (
        <div>
          <h3 className="font-semibold text-sm text-navy">{title}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
        </div>
      ) : (
        <h3 className="font-semibold text-sm text-navy">
          {title} <span className="font-normal text-xs text-slate-400">({sub})</span>
        </h3>
      )}
      <div className={stackedHeader ? "mt-3" : "mt-2"}>{children}</div>
    </div>
  );
}

// 카드(부모 요소) 실제 픽셀 폭을 측정 — SVG viewBox를 이 값으로 그대로 써서 CSS로 늘리는 게
// 아니라 좌표계 자체가 카드 폭에 맞게 반응형으로 커지도록 한다.
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

function LineTrendChart({ rows }: { rows: MonthlyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useContainerWidth(532);
  const H = 240;
  const PAD_L = 20;
  const PAD_R = 6;
  const PAD_B = 20;
  const PAD_T = 26;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const vals = rows.map((r) => r.qty);
  const maxVal = Math.max(1, ...vals);
  const yMax = niceCeil(maxVal * 1.2);
  const slot = plotW / Math.max(1, rows.length - 1 || 1);

  const points = rows.map((r, i) => {
    const x = rows.length === 1 ? PAD_L + plotW / 2 : PAD_L + slot * i;
    const y = PAD_T + plotH - (r.qty / yMax) * plotH;
    return { x, y };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: 240, display: "block" }}
        role="img"
        aria-label="월별 수주량 추이"
      >
        {[0, 0.5, 1].map((f) => {
          const y = PAD_T + plotH - f * plotH;
          return <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e1e0d9" strokeWidth={1} />;
        })}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={PAD_L - 4} y={PAD_T + plotH - f * plotH + 3} textAnchor="end" fontSize={9} fill="#898781">
            {Math.round(yMax * f / 10000).toLocaleString()}
          </text>
        ))}
        <path d={linePath} fill="none" stroke={COLOR_LINE} strokeWidth={2} />
        {points.map((p, i) => {
          const label = formatManwon(rows[i].qty);
          const labelY = p.y - 9;
          const labelW = label.length * 5.6 + 4;
          return (
            <g key={rows[i].month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={p.x - slot / 2} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {/* 점을 잇는 선이 라벨 뒤로 지나갈 수 있어 흰 배경으로 가려 겹침 없이 깔끔하게 보이게 한다. */}
              <rect x={p.x - labelW / 2} y={labelY - 8} width={labelW} height={11} rx={2} fill="#fff" />
              <text
                x={p.x}
                y={labelY}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={hover === i ? "#0b0b0b" : COLOR_LINE}
              >
                {label}
              </text>
              <circle cx={p.x} cy={p.y} r={hover === i ? 4 : 3} fill="#fff" stroke={COLOR_LINE} strokeWidth={2} />
              <text x={p.x} y={H - 5} textAnchor="middle" fontSize={9} fill={hover === i ? "#0b0b0b" : "#898781"}>
                {monthLabel(rows[i].month)}
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
          <p className="font-semibold text-slate-700">{monthDot(rows[hover].month)}</p>
          <p className="font-mono">{fmtQty(rows[hover].qty)} EA</p>
        </div>
      )}
    </div>
  );
}

function MomBarChart({ rows }: { rows: { month: string; pct: number | null }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useContainerWidth(532);
  const H = 240;
  const PAD_T = 22;
  const PAD_B = 20;
  const plotH = H - PAD_T - PAD_B;
  const zeroY = PAD_T + plotH / 2;

  const vals = rows.map((r) => r.pct ?? 0);
  const maxAbs = Math.max(10, ...vals.map((v) => Math.abs(v)));
  const slot = W / rows.length;
  const barW = Math.min(28, slot * 0.5);

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: 240, display: "block" }}
        role="img"
        aria-label="전월 대비 증감률"
      >
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="#c3c2b7" strokeWidth={1} />
        {rows.map((r, i) => {
          const x = slot * i + (slot - barW) / 2;
          const h = r.pct != null ? (Math.abs(r.pct) / maxAbs) * (plotH / 2) : 0;
          const y = r.pct != null && r.pct >= 0 ? zeroY - h : zeroY;
          const isHover = hover === i;
          return (
            <g key={r.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={slot * i} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {r.pct != null && (
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(1, h)}
                  rx={2}
                  fill={r.pct >= 0 ? COLOR_UP : COLOR_DOWN}
                  opacity={hover === null || isHover ? 1 : 0.45}
                />
              )}
              <text
                x={x + barW / 2}
                y={r.pct != null && r.pct >= 0 ? y - 4 : y + h + 12}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={r.pct == null ? "#c3c2b7" : r.pct >= 0 ? COLOR_UP : COLOR_DOWN}
              >
                {r.pct != null ? r.pct : "-"}
              </text>
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={9} fill={isHover ? "#0b0b0b" : "#898781"}>
                {monthLabel(r.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function donutArcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number) {
  const so = polarToCartesian(cx, cy, rOuter, end);
  const eo = polarToCartesian(cx, cy, rOuter, start);
  const si = polarToCartesian(cx, cy, rInner, end);
  const ei = polarToCartesian(cx, cy, rInner, start);
  const large = end - start <= 180 ? 0 : 1;
  return [
    `M${so.x},${so.y}`,
    `A${rOuter},${rOuter} 0 ${large} 0 ${eo.x},${eo.y}`,
    `L${ei.x},${ei.y}`,
    `A${rInner},${rInner} 0 ${large} 1 ${si.x},${si.y}`,
    "Z",
  ].join(" ");
}

function DonutPanel({ items, totalLabel }: { items: BreakdownItem[]; totalLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const size = 150;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter * 0.6;

  const cumPct = items.reduce<number[]>((acc, it) => [...acc, (acc[acc.length - 1] ?? 0) + it.pct], []);
  const slices = items.map((it, i) => {
    const start = (cumPct[i - 1] ?? 0) * 3.6;
    const end = cumPct[i] * 3.6;
    const color = it.name === "기타" ? OTHER_COLOR : CAT_COLORS[i % CAT_COLORS.length];
    return { ...it, start, end, color };
  });

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="구성비 도넛 차트">
          {slices.map((s, i) => (
            <path
              key={s.name}
              d={donutArcPath(cx, cy, rOuter, rInner, s.start, s.end)}
              fill={s.color}
              opacity={hover === null || hover === i ? 1 : 0.4}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-[13px] font-bold text-navy font-mono">{totalLabel}</p>
          <p className="text-[9px] text-slate-400">EA</p>
        </div>
      </div>
      <ul className="text-xs space-y-1 min-w-0 flex-1">
        {slices.map((s, i) => (
          <li
            key={s.name}
            className={`flex items-center gap-1.5 ${hover === i ? "font-semibold" : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="w-2 h-2 rounded-sm inline-block shrink-0" style={{ background: s.color }} />
            <span className="truncate text-slate-600 flex-1 min-w-0">{s.name}</span>
            <span className="text-slate-700 font-semibold shrink-0">{s.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
