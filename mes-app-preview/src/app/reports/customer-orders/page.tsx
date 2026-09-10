"use client";

import { useEffect, useMemo, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";

const COLOR_ACTUAL = "#3a62c4"; // 대시보드(dashboard/page.tsx) COLOR_GOOD과 동일 계열

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 자정 근처에 날짜가 밀릴 수 있음)
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function currentYearStart(): string {
  const now = new Date();
  return toLocalDateStr(new Date(now.getFullYear(), 0, 1));
}
function today(): string {
  return toLocalDateStr(new Date());
}

interface CustomerSummary {
  customer_code: string;
  customer_name: string;
  total_qty: number;
  order_days: number;
  last_order: string;
}

interface CustomerDetail {
  customer: { customer_code: string; customer_name: string };
  history: { date: string; qty: number; line_count: number }[];
  stats: {
    total_qty: number;
    order_days: number;
    avg_interval_days: number | null;
    std_interval_days: number | null;
    last_order: string | null;
    gap_from_last_days: number | null;
  };
}

export default function CustomerOrdersPage() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // 탭을 전환했다 돌아와도 보고 있던 거래처/검색어/조회기간은 유지되도록 세션 단위로 저장한다.
  const [selected, setSelected] = useTabState<string>("selected", "");
  const [search, setSearch] = useTabState("search", "");
  // 필터 없이 열면 전체 수주 이력이 대상이 되므로 기본은 당해년도 1월 1일부터로 좁힌다.
  const [dateFrom, setDateFrom] = useTabState("dateFrom", currentYearStart);
  const [dateTo, setDateTo] = useTabState("dateTo", today);

  function buildDateParams() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }

  useEffect(() => {
    setLoadingList(true);
    fetch(`/api/analytics/customers?${buildDateParams().toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: CustomerSummary[]) => {
        setCustomers(data);
        setLoadingList(false);
        // 탭 복귀로 이미 선택된 거래처가 저장돼있으면 그대로 두고, 처음 여는
        // 경우에만 기본 선택 규칙(가장 최근에 수주가 있었던 거래처)을 적용한다.
        if (data.length > 0 && !selected) {
          const latest = [...data].sort((a, b) => (a.last_order < b.last_order ? 1 : -1))[0];
          setSelected(latest.customer_code);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!selected) return;
    setLoadingDetail(true);
    fetch(
      `/api/analytics/customers/${encodeURIComponent(selected)}?${buildDateParams().toString()}`,
      { cache: "no-store" }
    )
      .then((res) => res.json())
      .then((data: CustomerDetail) => {
        setDetail(data);
        setLoadingDetail(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, dateFrom, dateTo]);

  const filteredCustomers = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.trim().toLowerCase();
    return customers.filter(
      (c) => c.customer_name.toLowerCase().includes(q) || c.customer_code.toLowerCase().includes(q)
    );
  }, [customers, search]);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-navy">거래처별 수주 추이분석</h1>
          <p className="text-sm text-slate-500 mt-1">
            MGMT-03 · 수주등록(SALES-02) 실시간 집계 · 거래처별 수주일자 이력과 발주 주기
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
            <span className="text-slate-400 text-sm">~</span>
            <DateSegmentInput value={dateTo} onChange={setDateTo} />
          </div>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white text-slate-600 max-w-48"
          >
            {customers.length === 0 && <option value="">거래처 없음</option>}
            {customers.map((c) => (
              <option key={c.customer_code} value={c.customer_code}>
                {c.customer_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col max-h-[calc(100vh-13rem)]">
          <div className="p-3 border-b border-slate-100 shrink-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="거래처 검색"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm w-full"
            />
          </div>
          <div className="overflow-y-auto">
            {loadingList && <p className="text-sm text-slate-400 py-6 text-center">불러오는 중...</p>}
            {!loadingList &&
              filteredCustomers.map((c) => (
                <button
                  key={c.customer_code}
                  onClick={() => setSelected(c.customer_code)}
                  className={`w-full text-left px-3 py-2.5 border-b border-slate-50 text-sm transition-colors ${
                    selected === c.customer_code ? "bg-navy/5 border-l-2 border-l-navy" : "hover:bg-slate-50 border-l-2 border-l-transparent"
                  }`}
                >
                  <p className={`truncate font-medium ${selected === c.customer_code ? "text-navy" : "text-slate-700"}`}>
                    {c.customer_name}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {c.total_qty.toLocaleString()} EA · {c.order_days}회 · 최근 {c.last_order}
                  </p>
                </button>
              ))}
          </div>
        </div>

        <div className="space-y-4">
          {loadingDetail || !detail ? (
            <p className="text-sm text-slate-400 py-10 text-center">불러오는 중...</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <StatCard label="총 수주량" value={detail.stats.total_qty.toLocaleString()} unit="EA" />
                <StatCard label="발주 횟수" value={String(detail.stats.order_days)} unit="회" />
                <StatCard
                  label="평균 발주 간격"
                  value={detail.stats.avg_interval_days != null ? detail.stats.avg_interval_days.toFixed(1) : "—"}
                  unit="일"
                />
                <StatCard label="마지막 수주일" value={detail.stats.last_order ?? "—"} unit="" />
                <StatCard
                  label="경과일"
                  value={detail.stats.gap_from_last_days != null ? String(detail.stats.gap_from_last_days) : "—"}
                  unit="일"
                  warn={
                    detail.stats.gap_from_last_days != null &&
                    detail.stats.avg_interval_days != null &&
                    detail.stats.gap_from_last_days > detail.stats.avg_interval_days * 1.5
                  }
                />
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                <h3 className="font-semibold text-sm text-navy mb-1">{detail.customer.customer_name}</h3>
                <p className="text-xs text-slate-400 mb-3">수주일자별 수주량 이력</p>
                {detail.history.length === 0 ? (
                  <p className="text-sm text-slate-400 py-10 text-center">수주 이력이 없습니다.</p>
                ) : (
                  <HistoryChart rows={detail.history} />
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                <div className="overflow-y-auto max-h-72">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">수주일자</th>
                        <th className="text-right px-4 py-2.5 font-semibold">수주량</th>
                        <th className="text-right px-4 py-2.5 font-semibold">라인수</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...detail.history].reverse().map((h) => (
                        <tr key={h.date} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-mono text-xs text-slate-600">{h.date}</td>
                          <td className="px-4 py-2 text-right font-mono">{h.qty.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-slate-400">{h.line_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold font-mono ${warn ? "text-red-600" : "text-navy"}`}>
        {value}
        {unit && <span className="text-xs font-sans font-medium text-slate-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function HistoryChart({ rows }: { rows: { date: string; qty: number; line_count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const PAD_L = 56;
  const PAD_B = 32;
  const PAD_T = 16;
  const plotH = H - PAD_T - PAD_B;

  const maxVal = Math.max(1, ...rows.map((r) => r.qty));
  const step = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const yMax = Math.ceil((maxVal * 1.1) / step) * step;

  // 이력이 많으면 막대 폭을 줄이고 가로 스크롤 — 세로 스케일은 고정.
  const slotW = rows.length > 40 ? 20 : rows.length > 20 ? 28 : 44;
  const plotW = slotW * rows.length;
  const W = PAD_L + plotW + 12;
  const barW = Math.min(28, slotW * 0.6);

  const ticks = [0, yMax / 2, yMax];

  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="거래처 수주일자별 수주량 차트"
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
        {rows.map((r, i) => {
          const x = PAD_L + slotW * i + (slotW - barW) / 2;
          const h = (r.qty / yMax) * plotH;
          const y = PAD_T + plotH - h;
          const isHover = hover === i;
          return (
            <g key={r.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD_L + slotW * i} y={PAD_T} width={slotW} height={plotH} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(0, h)}
                rx={3}
                fill={COLOR_ACTUAL}
                opacity={hover === null || isHover ? 1 : 0.4}
              />
              {(rows.length <= 20 || i % Math.ceil(rows.length / 20) === 0) && (
                <text
                  x={x + barW / 2}
                  y={H - 12}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isHover ? "#0b0b0b" : "#898781"}
                  transform={`rotate(-40 ${x + barW / 2} ${H - 12})`}
                >
                  {r.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div
          className="absolute top-1 bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs pointer-events-none z-10"
          style={{ left: PAD_L + slotW * hover + slotW / 2 - 40 }}
        >
          <p className="font-semibold text-slate-700 mb-1">{rows[hover].date}</p>
          <p>
            수주량 <span className="font-mono ml-2">{rows[hover].qty.toLocaleString()}</span>
          </p>
          <p>
            라인수 <span className="font-mono ml-2">{rows[hover].line_count}</span>
          </p>
        </div>
      )}
    </div>
  );
}
