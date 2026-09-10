"use client";

import { useEffect, useMemo, useState } from "react";

const POLL_MS = 5000;

// validated categorical palette (scripts/validate_palette.js — all checks pass on light surface)
const COLOR_GOOD = "#3a62c4";
const COLOR_DEFECT = "#a87a10";

interface DashboardData {
  todayProduced: { qty: number; cnt: number };
  todayDefects: { qty: number; cnt: number };
  woSummary: {
    status: string;
    cnt: number;
    order_qty: number;
    produced_qty: number;
  }[];
  activeWos: {
    wo_no: string;
    item_code: string;
    item_name: string;
    line_id: string;
    order_qty: number;
    produced_qty: number;
    status: string;
    due_date: string | null;
  }[];
  overdueWos: {
    wo_no: string;
    item_name: string;
    due_date: string;
    status: string;
    order_qty: number;
    produced_qty: number;
  }[];
  lowStock: {
    item_code: string;
    item_name: string;
    category: string;
    unit: string;
    safety_stock: number;
    stock_qty: number;
  }[];
  defectsByType: { defect_type: string; qty: number }[];
  dailyProduction: { prod_date: string; good_qty: number; defect_qty: number }[];
  recentResults: {
    result_id: string;
    wo_no: string;
    lot_no: string;
    qty: number;
    reg_time: string;
    item_name: string;
    equipment_name: string | null;
  }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load() {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    setData(await res.json());
    setLastUpdated(new Date());
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const kpi = useMemo(() => {
    if (!data) return null;
    const good = data.todayProduced.qty;
    const bad = data.todayDefects.qty;
    const total = good + bad;
    const defectRate = total > 0 ? (bad / total) * 100 : 0;

    const active = data.woSummary.filter(
      (s) => s.status === "진행" || s.status === "발행"
    );
    const activeOrder = active.reduce((s, r) => s + r.order_qty, 0);
    const activeProduced = active.reduce((s, r) => s + r.produced_qty, 0);
    const achieveRate = activeOrder > 0 ? (activeProduced / activeOrder) * 100 : 0;
    const activeCnt = active.reduce((s, r) => s + r.cnt, 0);
    const doneCnt =
      data.woSummary.find((s) => s.status === "완료")?.cnt ?? 0;

    return { good, bad, defectRate, achieveRate, activeCnt, doneCnt };
  }, [data]);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">경영정보 대시보드</h1>
          <p className="text-sm text-slate-500 mt-1">
            MGMT-01 · 생산·품질·재고 핵심 지표 실시간 집계 (5초 자동 갱신)
          </p>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {lastUpdated
            ? `마지막 갱신 ${lastUpdated.toLocaleTimeString("ko-KR")}`
            : "불러오는 중..."}
          <button
            onClick={load}
            className="ml-1 text-navy font-medium hover:underline"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="금일 생산량 (양품)"
          value={kpi ? kpi.good.toLocaleString() : "—"}
          unit="ea"
          note={data ? `실적 ${data.todayProduced.cnt}건` : ""}
        />
        <KpiCard
          label="금일 불량률"
          value={kpi ? kpi.defectRate.toFixed(2) : "—"}
          unit="%"
          note={kpi ? `불량 ${kpi.bad.toLocaleString()} ea` : ""}
          warn={!!kpi && kpi.defectRate >= 3}
        />
        <KpiCard
          label="진행 작업지시 달성률"
          value={kpi ? kpi.achieveRate.toFixed(1) : "—"}
          unit="%"
          note={kpi ? `진행·발행 ${kpi.activeCnt}건` : ""}
        />
        <KpiCard
          label="작업지시 현황"
          value={kpi ? `${kpi.activeCnt}` : "—"}
          unit="건 진행중"
          note={kpi ? `완료 ${kpi.doneCnt}건` : ""}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 7일 생산 추이 */}
        <Card
          title="일별 생산 추이"
          sub="최근 7일 · 양품/불량 수량"
        >
          {data ? <ProductionChart rows={data.dailyProduction} /> : <Empty />}
        </Card>

        {/* 알림 */}
        <Card title="알림" sub="조치 필요 항목 자동 집계">
          {data &&
          data.overdueWos.length === 0 &&
          data.lowStock.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              조치가 필요한 항목이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {data?.overdueWos.map((wo) => (
                <li key={wo.wo_no} className="flex items-center gap-3 py-2.5">
                  <Tag color="red">납기</Tag>
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-mono text-xs mr-1.5">{wo.wo_no}</span>
                    {wo.item_name} — 납기 {wo.due_date} ({wo.status},{" "}
                    {Math.round((wo.produced_qty / wo.order_qty) * 100)}% 생산)
                  </span>
                </li>
              ))}
              {data?.lowStock.map((it) => (
                <li key={it.item_code} className="flex items-center gap-3 py-2.5">
                  <Tag color="amber">재고</Tag>
                  <span className="flex-1 min-w-0 truncate">
                    {it.item_name}{" "}
                    <span className="font-mono text-xs">({it.item_code})</span>{" "}
                    — 현재고 {it.stock_qty.toLocaleString()} / 안전재고{" "}
                    {it.safety_stock.toLocaleString()} {it.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 작업지시 진척 */}
        <Card title="작업지시 진척 현황" sub="발행·진행중 작업지시 · 지시수량 대비">
          {data && data.activeWos.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              진행중인 작업지시가 없습니다.
            </p>
          ) : (
            <div className="space-y-3">
              {data?.activeWos.map((wo) => {
                const pct = Math.min(
                  100,
                  wo.order_qty > 0
                    ? (wo.produced_qty / wo.order_qty) * 100
                    : 0
                );
                return (
                  <div key={wo.wo_no}>
                    <div className="flex items-baseline justify-between text-xs mb-1">
                      <span className="truncate">
                        <span className="font-mono mr-1.5">{wo.wo_no}</span>
                        <span className="text-slate-600">{wo.item_name}</span>
                      </span>
                      <span className="font-mono text-slate-500 shrink-0 ml-2">
                        {wo.produced_qty.toLocaleString()} /{" "}
                        {wo.order_qty.toLocaleString()} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: pct >= 90 ? "#15803d" : COLOR_GOOD,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 최근 실적 */}
        <Card title="최근 생산실적" sub="POP 실적입력 최신 6건">
          {data && data.recentResults.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              등록된 생산실적이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 pr-3 font-semibold">시각</th>
                    <th className="text-left py-2 pr-3 font-semibold">작업지시</th>
                    <th className="text-left py-2 pr-3 font-semibold">품목</th>
                    <th className="text-left py-2 pr-3 font-semibold">설비</th>
                    <th className="text-right py-2 font-semibold">수량</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.recentResults.map((r) => (
                    <tr key={r.result_id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-mono text-xs text-slate-500">
                        {r.reg_time.slice(5, 16)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.wo_no}</td>
                      <td className="py-2 pr-3 truncate max-w-40">
                        {r.item_name}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {r.equipment_name ?? "—"}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {r.qty.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* 불량 유형 요약 */}
      {data && data.defectsByType.length > 0 && (
        <Card title="불량 유형별 집계" sub="최근 7일 누적">
          <div className="flex flex-wrap gap-3">
            {data.defectsByType.map((d) => (
              <div
                key={d.defect_type}
                className="border border-slate-200 rounded-md px-4 py-2.5 bg-slate-50"
              >
                <p className="text-xs text-slate-500">{d.defect_type}</p>
                <p className="font-mono font-semibold text-navy mt-0.5">
                  {d.qty.toLocaleString()} ea
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  note,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold font-mono ${
          warn ? "text-red-600" : "text-navy"
        }`}
      >
        {value}
        <span className="text-sm font-sans font-medium text-slate-400 ml-1">
          {unit}
        </span>
      </p>
      {note && <p className="text-[11px] text-slate-400 mt-1">{note}</p>}
    </div>
  );
}

function Card({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <h3 className="font-semibold text-sm text-navy mb-3">
        {title}{" "}
        <span className="font-normal text-xs text-slate-400 ml-1">{sub}</span>
      </h3>
      {children}
    </div>
  );
}

function Tag({
  color,
  children,
}: {
  color: "red" | "amber";
  children: React.ReactNode;
}) {
  const cls =
    color === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span
      className={`shrink-0 text-[11px] font-medium border rounded px-1.5 py-0.5 ${cls}`}
    >
      {children}
    </span>
  );
}

function Empty() {
  return <p className="text-sm text-slate-400 py-6 text-center">불러오는 중...</p>;
}

/* 7일 양품/불량 스택 바 차트 (인라인 SVG) */
function ProductionChart({
  rows,
}: {
  rows: { prod_date: string; good_qty: number; defect_qty: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 560;
  const H = 200;
  const PAD_L = 44;
  const PAD_B = 24;
  const PAD_T = 12;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;

  const max = Math.max(1, ...rows.map((r) => r.good_qty + r.defect_qty));
  // round max up to a clean tick step
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const yMax = Math.ceil(max / step) * step;
  const ticks = [0, yMax / 2, yMax];

  const slot = plotW / rows.length;
  const barW = Math.min(36, slot * 0.55);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="최근 7일 일별 양품·불량 생산량 차트"
      >
        {ticks.map((t) => {
          const y = PAD_T + plotH - (t / yMax) * plotH;
          return (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - 8}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={PAD_L - 6}
                y={y + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="#94a3b8"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {t >= 1000 ? `${t / 1000}k` : t}
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const x = PAD_L + slot * i + (slot - barW) / 2;
          const goodH = (r.good_qty / yMax) * plotH;
          const badH = (r.defect_qty / yMax) * plotH;
          const yGood = PAD_T + plotH - goodH;
          const yBad = yGood - 2 - badH; // 2px surface gap between stacked segments
          const day = r.prod_date.slice(5).replace("-", "/");
          const isHover = hover === i;
          return (
            <g
              key={r.prod_date}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* hit target wider than the mark */}
              <rect
                x={PAD_L + slot * i}
                y={PAD_T}
                width={slot}
                height={plotH}
                fill="transparent"
              />
              {goodH > 0 && (
                <rect
                  x={x}
                  y={yGood}
                  width={barW}
                  height={goodH}
                  rx={badH > 0 ? 0 : 4}
                  fill={COLOR_GOOD}
                  opacity={hover === null || isHover ? 1 : 0.45}
                />
              )}
              {badH > 0 && (
                <rect
                  x={x}
                  y={yBad}
                  width={barW}
                  height={badH}
                  rx={4}
                  fill={COLOR_DEFECT}
                  opacity={hover === null || isHover ? 1 : 0.45}
                />
              )}
              <text
                x={x + barW / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={10}
                fill={isHover ? "#334155" : "#94a3b8"}
              >
                {day}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div
          className="absolute top-1 bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs pointer-events-none"
          style={{
            left: `${((PAD_L + slot * hover + slot / 2) / W) * 100}%`,
            transform: hover > rows.length / 2 ? "translateX(-105%)" : "none",
          }}
        >
          <p className="font-semibold text-slate-700 mb-1">
            {rows[hover].prod_date}
          </p>
          <p className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm inline-block"
              style={{ background: COLOR_GOOD }}
            />
            양품{" "}
            <span className="font-mono ml-auto pl-3">
              {rows[hover].good_qty.toLocaleString()}
            </span>
          </p>
          <p className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm inline-block"
              style={{ background: COLOR_DEFECT }}
            />
            불량{" "}
            <span className="font-mono ml-auto pl-3">
              {rows[hover].defect_qty.toLocaleString()}
            </span>
          </p>
        </div>
      )}
      <div className="flex gap-4 mt-2 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-sm inline-block"
            style={{ background: COLOR_GOOD }}
          />
          양품
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-sm inline-block"
            style={{ background: COLOR_DEFECT }}
          />
          불량
        </span>
      </div>
    </div>
  );
}
