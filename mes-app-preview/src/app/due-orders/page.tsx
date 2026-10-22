"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { DueOrderLine, DueOrderRow, DueOrdersResult } from "@/lib/due-orders";

// 생산계획 "납기별수주현황(PLAN-04)" — 생산계획 엑셀 「납기별」 시트 + 수주별 시트를 한 화면으로 옮긴 것.
// 목록에서 수주를 누르면 오른쪽 상세 창에서 품목(모델)별 요약 → 모델을 누르면 도수별 공정재공·부족분·조립투입을 본다.
// 계산식과 데이터 출처는 lib/due-orders.ts 머리 주석 참고.

const STAGES = ["조립", "분리3", "습윤", "외관검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "마킹", "출하포장"];
const th = "px-2 py-2 border border-slate-300 bg-[#B4C6E7] text-xs font-semibold text-slate-800 text-center whitespace-nowrap";
const td = "px-2 py-1.5 border border-slate-200 text-xs text-slate-700 whitespace-nowrap";
const num = `${td} text-right tabular-nums`;

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const dash = (n: number) => (n > 0 ? fmt(n) : "-");
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dday(due: string | null, base: string): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
  return Math.round((new Date(due.slice(0, 10) + "T00:00:00").getTime() - new Date(base + "T00:00:00").getTime()) / 864e5);
}
function DueBadge({ row, base }: { row: DueOrderRow; base: string }) {
  if (row.order_qty > 0 && row.shipped >= row.order_qty) return <span className="ml-1 px-1.5 rounded bg-emerald-100 text-emerald-700 text-[11px] font-semibold">출하완료</span>;
  const n = dday(row.due_date, base);
  if (n == null) return null;
  const cls = n < 0 ? "bg-red-100 text-red-700" : n <= 14 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500";
  return <span className={`ml-1 px-1.5 rounded text-[11px] font-semibold tabular-nums ${cls}`}>{n < 0 ? `D+${-n}` : n === 0 ? "D-day" : `D-${n}`}</span>;
}
function powerText(p: number | null): string {
  if (p == null) return "-";
  return p > 0 ? `+${p.toFixed(2)}` : p.toFixed(2);
}

function StageFlow({ wip }: { wip: number[] }) {
  return (
    <div className="grid grid-cols-11 gap-1 min-w-[720px]">
      {STAGES.map((s, i) => (
        <div key={s} className={`rounded border px-1 py-1.5 text-center ${wip[i] > 0 ? "border-[#002060] bg-[#E8EEF9]" : "border-slate-200 bg-white"}`}>
          <div className="text-[11px] text-slate-500">{s}</div>
          <div className="text-sm font-semibold tabular-nums text-slate-800">{wip[i] > 0 ? fmt(wip[i]) : "·"}</div>
        </div>
      ))}
    </div>
  );
}

type Detail = { row: DueOrderRow | null; lines: DueOrderLine[] };

function DetailPanel({ soNo, onClose, base }: { soNo: string; onClose: () => void; base: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/due-orders?so=${encodeURIComponent(soNo)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Detail) => alive && setDetail(d))
      .catch(() => alive && setError("상세 데이터를 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [soNo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const models = useMemo(() => {
    const g = new Map<string, { model: string; name: string | null; n: number; qty: number; wip: number[]; shipped: number; assy: number; short: number }>();
    for (const l of detail?.lines ?? []) {
      const x = g.get(l.model) ?? { model: l.model, name: l.item_name, n: 0, qty: 0, wip: STAGES.map(() => 0), shipped: 0, assy: 0, short: 0 };
      x.n += 1;
      x.qty += l.order_qty;
      l.wip.forEach((v, i) => (x.wip[i] += v));
      x.shipped += l.shipped;
      x.assy += l.assy_in;
      x.short += l.shorts[9] ?? 0;
      g.set(l.model, x);
    }
    return [...g.values()];
  }, [detail]);

  const row = detail?.row;
  const powers = (detail?.lines ?? []).filter((l) => l.model === model);
  const pw = STAGES.map((_, i) => sum(powers.map((l) => l.wip[i])));

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 modal-overlay-bg" onClick={onClose} />
      <aside className="absolute top-0 right-0 bottom-0 w-full max-w-[1100px] bg-slate-50 shadow-2xl flex flex-col" role="dialog" aria-modal="true">
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-navy">
              {soNo} {row && <DueBadge row={row} base={base} />}
            </h2>
            {row && (
              <p className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>고객 <b className="text-slate-700">{row.customer ?? "-"}</b></span>
                <span>브랜드 <b className="text-slate-700">{row.brand ?? "-"}</b></span>
                <span>납기 <b className="text-slate-700">{row.due_date ?? "-"}</b></span>
                <span>순위 {row.rank}</span>
                {row.mo_no && <span>{row.mo_no}</span>}
                {row.pack_method && <span>포장 {row.pack_method}</span>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="text-sm text-red-600">{error}</div>}
          {!detail && !error && <div className="text-sm text-slate-400">불러오는 중…</div>}
          {row && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  ["주문량", fmt(row.order_qty), ""],
                  ["출고", fmt(row.shipped), ""],
                  ["조립투입 필요", fmt(row.assy_in), row.assy_in > 0 ? "text-red-600" : ""],
                  ["출하부족(누적)", fmt(row.ship_short), ""],
                  ["품목 수", `${row.line_count}개`, ""],
                ].map(([l, v, c]) => (
                  <div key={l} className="bg-white border border-slate-200 rounded px-3 py-2">
                    <div className="text-[11px] text-slate-500">{l}</div>
                    <div className={`text-base font-semibold tabular-nums ${c}`}>{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-1.5">공정별 재공</h3>
                <div className="overflow-x-auto">
                  <StageFlow wip={model ? pw : row.wip} />
                </div>
              </div>
            </>
          )}

          {detail && !model && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-1.5">
                품목(모델)별 요약 <span className="font-normal text-xs text-slate-400">모델을 누르면 도수별 상세가 열립니다</span>
              </h3>
              <div className="bg-white border border-slate-200 rounded overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>모델</th>
                      <th className={th}>품목명</th>
                      <th className={th}>도수 수</th>
                      <th className={th}>주문량</th>
                      <th className={th}>공정재공</th>
                      <th className={th}>출고</th>
                      <th className={th}>조립투입</th>
                      <th className={th}>출하부족</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.model} className="hover:bg-slate-50 cursor-pointer" onClick={() => setModel(m.model)}>
                        <td className={`${td} text-[#0070C0] font-medium`}>{m.model}</td>
                        <td className={`${td} max-w-[280px] truncate`} title={m.name ?? ""}>{m.name ?? ""}</td>
                        <td className={num}>{m.n}</td>
                        <td className={num}>{fmt(m.qty)}</td>
                        <td className={num}>{dash(sum(m.wip))}</td>
                        <td className={num}>{dash(m.shipped)}</td>
                        <td className={`${num} ${m.assy > 0 ? "text-red-600 font-semibold" : ""}`}>{dash(m.assy)}</td>
                        <td className={num}>{dash(m.short)}</td>
                      </tr>
                    ))}
                    {models.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-sm text-slate-400">품목 줄이 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail && model && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-2">
                <button onClick={() => setModel(null)} className="px-2 py-0.5 text-xs border border-slate-300 rounded bg-white hover:bg-slate-50">
                  ← 모델 목록
                </button>
                {model} 도수별 상세 <span className="font-normal text-xs text-slate-400">{powers.length}개 도수</span>
              </h3>
              <div className="bg-white border border-slate-200 rounded overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>도수</th>
                      <th className={th}>품목코드</th>
                      <th className={th}>주문량</th>
                      <th className={th}>누적주문</th>
                      {STAGES.map((s) => (
                        <th key={s} className={th}>{s}</th>
                      ))}
                      <th className={th}>기초재고</th>
                      <th className={th}>출고</th>
                      <th className={th}>검사부족</th>
                      <th className={th}>조립투입</th>
                      <th className={th}>출하부족</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powers.map((l) => (
                      <tr key={l.item_code} className="hover:bg-slate-50">
                        <td className={`${td} font-semibold tabular-nums`}>{powerText(l.power)}</td>
                        <td className={`${td} text-slate-500`}>{l.item_code}</td>
                        <td className={num}>{fmt(l.order_qty)}</td>
                        <td className={num}>{fmt(l.cum_order)}</td>
                        {l.wip.map((v, i) => (
                          <td key={i} className={num}>{dash(v)}</td>
                        ))}
                        <td className={num}>{dash(l.base_stock)}</td>
                        <td className={num}>{dash(l.shipped)}</td>
                        <td className={num}>{l.shorts[2] == null ? <span className="text-emerald-600">완료</span> : fmt(l.shorts[2])}</td>
                        <td className={`${num} ${l.assy_in > 0 ? "text-red-600 font-semibold" : ""}`}>{dash(l.assy_in)}</td>
                        <td className={num}>{l.shorts[9] == null ? <span className="text-emerald-600">완료</span> : fmt(l.shorts[9])}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#B4C6E7] font-semibold">
                      <td colSpan={2} className={`${td} text-center bg-[#B4C6E7]`}>합계</td>
                      <td className={`${num} bg-[#B4C6E7]`}>{fmt(sum(powers.map((l) => l.order_qty)))}</td>
                      <td className={`${td} bg-[#B4C6E7]`} />
                      {pw.map((v, i) => (
                        <td key={i} className={`${num} bg-[#B4C6E7]`}>{dash(v)}</td>
                      ))}
                      <td className={`${td} bg-[#B4C6E7]`} />
                      <td className={`${num} bg-[#B4C6E7]`}>{dash(sum(powers.map((l) => l.shipped)))}</td>
                      <td className={`${td} bg-[#B4C6E7]`} />
                      <td className={`${num} bg-[#B4C6E7]`}>{dash(sum(powers.map((l) => l.assy_in)))}</td>
                      <td className={`${num} bg-[#B4C6E7]`}>{dash(sum(powers.map((l) => l.shorts[9] ?? 0)))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function DueOrdersPage() {
  const [data, setData] = useState<DueOrdersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useTabState("dueOrdSearch", "");
  const [customer, setCustomer] = useTabState("dueOrdCustomer", "");
  const [needOnly, setNeedOnly] = useTabState("dueOrdNeedOnly", false);
  const [hideDone, setHideDone] = useTabState("dueOrdHideDone", true);
  const [selected, setSelected] = useState<string | null>(null);

  const request = (fresh: boolean) =>
    fetch(`/api/due-orders${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DueOrdersResult) => {
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        setError("납기별 수주 데이터를 불러오지 못했습니다.");
        setLoading(false);
      });
  const load = (fresh = false) => {
    setLoading(true);
    request(fresh);
  };
  useEffect(() => {
    request(false);
  }, []);

  const base = today();
  const customers = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.customer ?? ""))].filter(Boolean).sort(), [data]);
  const rows = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (hideDone && r.order_qty > 0 && r.shipped >= r.order_qty) return false;
      if (needOnly && r.assy_in <= 0) return false;
      if (customer && r.customer !== customer) return false;
      if (!kw) return true;
      return [r.so_no, r.mo_no, r.customer, r.brand].some((v) => (v ?? "").toLowerCase().includes(kw));
    });
  }, [data, search, customer, needOnly, hideDone]);

  const kpi = {
    count: rows.length,
    qty: sum(rows.map((r) => r.order_qty)),
    need: rows.filter((r) => r.assy_in > 0).length,
    assy: sum(rows.map((r) => r.assy_in)),
    late: rows.filter((r) => (dday(r.due_date, base) ?? 1) < 0 && r.shipped < r.order_qty).length,
  };

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">납기별수주현황</h1>
          <p className="text-sm text-slate-500 mt-1">
            PLAN-04 · 수주등록·공정재공현황·현재고현황·제품출고 데이터로 자동 계산 · 직진율 {Math.round((data?.straight_rate ?? 0.88) * 100)}%
            {data && ` · 공정재공 기준 ${data.as_of.wip ?? "-"} · 출고 ${data.as_of.shipment ?? "-"}까지`}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-[#002060] text-white hover:bg-[#0b2f7a] transition-colors"
        >
          다시 계산
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          ["진행 수주", `${kpi.count}건`],
          ["총 주문량", fmt(kpi.qty)],
          ["조립투입 필요", `${kpi.need}건`],
          ["조립투입 수량", fmt(kpi.assy)],
          ["납기 경과·미출하", `${kpi.late}건`],
        ].map(([l, v]) => (
          <div key={l} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
            <div className="text-xs text-slate-500">{l}</div>
            <div className="text-lg font-semibold tabular-nums text-slate-800">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="수주번호·MO·고객·브랜드 검색"
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md w-64"
        />
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} className="px-2 py-1.5 text-sm border border-slate-300 rounded-md">
          <option value="">전체 고객</option>
          {customers.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={needOnly} onChange={(e) => setNeedOnly(e.target.checked)} />
          조립투입 필요만
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          출하 완료 수주 숨기기
        </label>
        <span className="text-xs text-slate-400 ml-auto">{rows.length.toLocaleString("ko-KR")}건 · 수주를 누르면 품목·도수별 상세가 열립니다</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-auto max-h-[calc(100vh-300px)]">
        {loading ? (
          <div className="p-6 text-sm text-slate-400">계산 중… (수주·재공·재고·출고를 모두 읽어 몇 초 걸립니다)</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={th}>순위</th>
                <th className={th}>수주번호</th>
                <th className={th}>고객</th>
                <th className={th}>브랜드</th>
                <th className={th}>납기일</th>
                <th className={th}>포장</th>
                <th className={th}>주문량</th>
                {STAGES.map((s) => (
                  <th key={s} className={th}>{s}</th>
                ))}
                <th className={th}>출고</th>
                <th className={th}>조립투입<br />필요</th>
                <th className={th}>출하부족</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.so_no}
                  tabIndex={0}
                  onClick={() => setSelected(r.so_no)}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(r.so_no)}
                  className={`cursor-pointer hover:bg-slate-50 ${selected === r.so_no ? "bg-[#E8EEF9]" : ""}`}
                >
                  <td className={`${td} text-center bg-[#FFFFCC]`}>{r.rank}</td>
                  <td className={`${td} text-[#0070C0] font-medium`}>{r.so_no}</td>
                  <td className={`${td} text-[#002060]`}>{r.customer ?? ""}</td>
                  <td className={td}>{r.brand ?? ""}</td>
                  <td className={td}>
                    {r.due_date ?? ""}
                    <DueBadge row={r} base={base} />
                  </td>
                  <td className={`${td} text-center`}>{r.pack_method ?? ""}</td>
                  <td className={num}>{fmt(r.order_qty)}</td>
                  {r.wip.map((v, i) => (
                    <td key={i} className={num}>{dash(v)}</td>
                  ))}
                  <td className={num}>{dash(r.shipped)}</td>
                  <td className={`${num} ${r.assy_in > 0 ? "text-red-600 font-semibold" : ""}`}>{dash(r.assy_in)}</td>
                  <td className={num}>{dash(r.ship_short)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={21} className="p-6 text-center text-sm text-slate-400">조건에 맞는 수주가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        엑셀 수주별 시트 계산식과 같습니다: 공정 부족분 = 누적주문 − 기초재고(제품창고A+조립창고) − 누적출고 − 다음 공정~출하포장 재공,
        조립투입 = 검사부족분 ÷ 직진율 − 조립 − 분리3 − 습윤 − 외관검사×108%(60 단위 올림). 공정재공은 품목코드 기준이라 같은 품목을 가진 수주에 똑같이 보입니다.
        순위는 납기일 → 생산순위지정(PLAN-01) 작업순서 순입니다.
      </p>

      {selected && <DetailPanel key={selected} soNo={selected} onClose={() => setSelected(null)} base={base} />}
    </div>
  );
}
