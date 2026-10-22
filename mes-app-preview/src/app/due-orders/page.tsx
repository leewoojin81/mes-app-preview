"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { DueOrderLine, DueOrderRow, DueOrdersResult } from "@/lib/due-orders";

// 생산계획 "납기별수주현황(PLAN-04)" — 생산계획 엑셀 「납기별」 시트 + 수주별 시트를 한 화면으로 옮긴 것.
// 목록에서 수주를 누르면 오른쪽 상세 창에서 품목(모델)별 요약 → 모델을 누르면 도수별 공정재공·부족분·조립투입을 본다.
// 계산식과 데이터 출처는 lib/due-orders.ts 머리 주석 참고.
// 화면 디자인은 시안 「메디오스 MES 납기별 수주현황.html」의 CSS를 .po 아래로 옮겨 그대로 맞췄다(착색재고 = 모델별 BOM 착색 반제품의 조립창고 재고).

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap");
.po{--navy:#002060;--accent:#2457d6;--bg:#f3f5f9;--surface:#fff;--surface-2:#f7f9fc;--line:#dfe4ee;--line-2:#eef1f6;--fg:#16203a;--fg-2:#4a5672;--fg-3:#7c88a3;--red:#c62f2f;--red-bg:#fdecec;--amber:#a86400;--amber-bg:#fff4e0;--green:#1d7a46;--green-bg:#e6f5ec;--blue-bg:#e9efff;
 --sans:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
 font-family:var(--sans);font-size:14px;line-height:1.45;color:var(--fg);background:var(--bg);display:flex;flex-direction:column;gap:14px;padding:20px 16px 40px;min-height:100%}
.po *{box-sizing:border-box}
.po .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.po .head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px}
.po h1{margin:0;font-size:22px;font-weight:700;color:var(--fg)}
.po .crumb{font-size:12px;color:var(--fg-3);margin-bottom:2px}
.po .meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--fg-2);align-items:center}
.po .meta b{color:var(--fg);font-weight:600}
.po .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.po .kpi{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.po .kpi .l{font-size:12px;color:var(--fg-3)}.po .kpi .v{font-size:20px;font-weight:600}.po .kpi .s{font-size:11.5px;color:var(--fg-3)}
.po .tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.po .tools input,.po .tools select{font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--fg);min-width:0}
.po .tools input{width:220px;max-width:100%}
.po .chip{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--surface);color:var(--fg-2);border-radius:999px;padding:5px 11px;cursor:pointer}
.po .chip[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:#fff}
.po .cnt{font-size:12px;color:var(--fg-3);margin-left:auto}
.po .tbl-wrap{background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow:auto}
.po table{border-collapse:collapse;width:100%;font-size:13px}
.po th{position:sticky;top:0;background:var(--surface-2);color:var(--fg-2);font-weight:600;font-size:12px;text-align:left;padding:4px 8px;line-height:1.25;border-bottom:1px solid var(--line);white-space:nowrap}
.po td{padding:2px 8px;line-height:1.25;border-bottom:1px solid var(--line-2);white-space:nowrap;color:var(--fg)}
.po th.r,.po td.r{text-align:right}
.po th.grp{text-align:center;cursor:pointer;user-select:none;border-bottom:1px solid var(--line);color:var(--navy)}
.po th.grp:hover{background:var(--blue-bg)}
.po thead tr.h2 th{top:24px}
.po thead tr.h1 th{height:24px}
.po tbody tr.row{cursor:pointer}.po tbody tr.row:hover{background:var(--surface-2)}.po tbody tr.row.sel{background:var(--blue-bg)}
.po tbody tr.row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.po .so{font-family:var(--mono);font-size:12.5px;color:var(--accent);font-weight:500}
.po .pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:3px;font-family:var(--mono)}
.po .p-red{background:var(--red-bg);color:var(--red)}.po .p-amb{background:var(--amber-bg);color:var(--amber)}.po .p-grn{background:var(--green-bg);color:var(--green)}.po .p-gry{background:var(--line-2);color:var(--fg-3)}
.po .bar{width:90px;height:6px;background:var(--line-2);border-radius:3px;overflow:hidden;display:inline-block;vertical-align:middle}
.po .bar i{display:block;height:100%;background:var(--accent)}
.po .zero{color:var(--fg-3)}.po .need{color:var(--red);font-weight:600}
.po .scrim{position:fixed;inset:0;background:rgba(10,18,40,.35);z-index:40}
.po .drawer{position:fixed;top:0;right:0;bottom:0;width:min(980px,100%);background:var(--bg);border-left:1px solid var(--line);display:flex;flex-direction:column;box-shadow:-12px 0 30px rgba(0,20,60,.18);z-index:41;animation:po-slide .18s ease-out}
@keyframes po-slide{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}
.po .dh{background:var(--surface);border-bottom:1px solid var(--line);padding:14px 18px;display:flex;gap:12px;align-items:flex-start}
.po .dh .t{flex:1;min-width:0}
.po .dh h2{margin:0;font-size:18px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.po .dh .sub{font-size:12.5px;color:var(--fg-2);margin-top:3px;display:flex;flex-wrap:wrap;gap:4px 14px}
.po .x{font:inherit;font-size:20px;border:0;background:transparent;color:var(--fg-2);cursor:pointer;padding:2px 8px;border-radius:4px}
.po .db{overflow-y:auto;padding:16px 18px 30px;display:flex;flex-direction:column;gap:16px}
.po .sec h3{margin:0 0 8px;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.po .sec h3 small{font-weight:400;color:var(--fg-3);font-size:12px}
.po .flow{display:grid;grid-template-columns:repeat(11,minmax(64px,1fr));gap:4px;overflow-x:auto}
.po .st{background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:6px 6px 7px;text-align:center;min-width:64px}
.po .st .n{font-size:11px;color:var(--fg-3)}.po .st .v{font-size:14px;font-weight:600}
.po .st.has{border-color:var(--accent);background:var(--blue-bg)}
.po .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.po .fact{background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:7px 10px}
.po .fact .l{font-size:11.5px;color:var(--fg-3)}.po .fact .v{font-size:14px;font-weight:600}
.po .back{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--surface);color:var(--fg-2);border-radius:4px;padding:3px 9px;cursor:pointer}
.po .empty{background:var(--surface);border:1px dashed var(--line);border-radius:6px;padding:22px;text-align:center;color:var(--fg-2)}
.po td.pw{font-weight:600}
.po tr.tot td{background:var(--surface-2);font-weight:600;border-top:1px solid var(--line)}
.po .note{font-size:12px;color:var(--fg-3);line-height:1.6}
`;

const STAGES = ["조립", "분리3", "습윤", "외관검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "마킹", "출하포장"];

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
function Z({ n }: { n: number }) {
  return n > 0 ? <>{fmt(n)}</> : <span className="zero">0</span>;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dday(due: string | null, base: string): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
  return Math.round((new Date(due.slice(0, 10) + "T00:00:00").getTime() - new Date(base + "T00:00:00").getTime()) / 864e5);
}
function DueBadge({ row, base }: { row: DueOrderRow; base: string }) {
  if (row.order_qty > 0 && row.shipped >= row.order_qty) return <span className="pill p-grn">출하완료</span>;
  const n = dday(row.due_date, base);
  if (n == null) return <span className="pill p-gry">미정</span>;
  const cls = n < 0 ? "p-red" : n <= 14 ? "p-amb" : "p-gry";
  return <span className={`pill ${cls}`}>{n < 0 ? `D+${-n}` : n === 0 ? "D-day" : `D-${n}`}</span>;
}
function powerText(p: number | null): string {
  if (p == null) return "-";
  return p > 0 ? `+${p.toFixed(2)}` : p.toFixed(2);
}
function progress(r: DueOrderRow): number {
  if (!r.order_qty) return 0;
  return Math.max(0, Math.min(1, (r.order_qty - r.ship_short) / r.order_qty));
}

function StageFlow({ wip }: { wip: number[] }) {
  return (
    <div className="flow">
      {STAGES.map((s, i) => (
        <div key={s} className={`st${wip[i] > 0 ? " has" : ""}`}>
          <div className="n">{s}</div>
          <div className="v num">{wip[i] > 0 ? fmt(wip[i]) : "·"}</div>
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
    const g = new Map<string, { model: string; name: string | null; n: number; qty: number; wip: number[]; color: number; shipped: number; assy: number; short: number }>();
    for (const l of detail?.lines ?? []) {
      const x = g.get(l.model) ?? { model: l.model, name: l.item_name, n: 0, qty: 0, wip: STAGES.map(() => 0), color: l.color_stock, shipped: 0, assy: 0, short: 0 };
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
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="dh">
          <div className="t">
            <h2>
              <span className="num">{soNo}</span> {row && <DueBadge row={row} base={base} />}
            </h2>
            {row && (
              <div className="sub">
                <span>고객 <b>{row.customer ?? "-"}</b></span>
                <span>브랜드 <b>{row.brand ?? "-"}</b></span>
                <span>납기 <b className="num">{row.due_date ?? "-"}</b></span>
                {row.pack_method && <span>포장 {row.pack_method}</span>}
                <span>순위 {row.rank}</span>
                {row.mo_no && <span className="num">{row.mo_no}</span>}
              </div>
            )}
          </div>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="db">
          {error && <div className="empty"><b>{error}</b></div>}
          {!detail && !error && <div className="empty">불러오는 중…</div>}
          {row && (
            <>
              <div className="facts">
                {([
                  ["주문량", fmt(row.order_qty), ""],
                  ["착색재고", fmt(row.color_stock), ""],
                  ["출고", fmt(row.shipped), ""],
                  ["조립투입 필요", fmt(row.assy_in), row.assy_in > 0 ? "need" : ""],
                  ["출하부족(누적)", fmt(row.ship_short), ""],
                  ["품목 수", `${row.line_count}개`, ""],
                ] as const).map(([l, v, c]) => (
                  <div key={l} className="fact">
                    <div className="l">{l}</div>
                    <div className={`v num ${c}`}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="sec">
                <h3>공정별 재공 <small>{model ? `${model} 모델 합계` : "수주 전체"}</small></h3>
                <StageFlow wip={model ? pw : row.wip} />
              </div>
            </>
          )}

          {detail && !model && (
            <div className="sec">
              <h3>품목(모델)별 요약 <small>모델을 누르면 도수별 상세가 열립니다</small></h3>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>모델</th><th>품목명</th><th className="r">도수 수</th><th className="r">주문량</th><th className="r">착색재고</th><th className="r">공정재공</th>
                      <th className="r">출고</th><th className="r">조립투입 필요</th><th className="r">출하부족</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.model} className="row" tabIndex={0} onClick={() => setModel(m.model)} onKeyDown={(e) => e.key === "Enter" && setModel(m.model)}>
                        <td className="so">{m.model}</td>
                        <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }} title={m.name ?? ""}>{m.name ?? ""}</td>
                        <td className="r num">{m.n}</td>
                        <td className="r num">{fmt(m.qty)}</td>
                        <td className="r num"><Z n={m.color} /></td>
                        <td className="r num"><Z n={sum(m.wip)} /></td>
                        <td className="r num"><Z n={m.shipped} /></td>
                        <td className={`r num ${m.assy > 0 ? "need" : ""}`}><Z n={m.assy} /></td>
                        <td className="r num"><Z n={m.short} /></td>
                      </tr>
                    ))}
                    {models.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>품목 줄이 없습니다.</td></tr>
                    )}
                    {models.length > 0 && (
                      <tr className="tot">
                        <td colSpan={3}>합계</td>
                        <td className="r num">{fmt(sum(models.map((m) => m.qty)))}</td>
                        <td className="r num">{fmt(sum(models.map((m) => m.color)))}</td>
                        <td className="r num">{fmt(sum(models.map((m) => sum(m.wip))))}</td>
                        <td className="r num">{fmt(sum(models.map((m) => m.shipped)))}</td>
                        <td className="r num">{fmt(sum(models.map((m) => m.assy)))}</td>
                        <td className="r num">{fmt(sum(models.map((m) => m.short)))}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail && model && (
            <div className="sec">
              <h3>
                <button className="back" onClick={() => setModel(null)}>← 모델 목록</button>
                <span className="num">{model}</span> 도수별 상세 <small>{powers.length}개 도수</small>
              </h3>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>도수</th><th>품목코드</th><th className="r">주문량</th><th className="r">누적주문</th><th className="r">착색재고</th>
                      {STAGES.map((s) => (<th key={s} className="r">{s}</th>))}
                      <th className="r">기초재고</th><th className="r">출고</th><th className="r">검사부족</th><th className="r">조립투입</th><th className="r">출하부족</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powers.map((l) => (
                      <tr key={l.item_code}>
                        <td className="num pw">{powerText(l.power)}</td>
                        <td className="num" style={{ fontSize: 12, color: "var(--fg-2)" }}>{l.item_code}</td>
                        <td className="r num"><Z n={l.order_qty} /></td>
                        <td className="r num"><Z n={l.cum_order} /></td>
                        <td className="r num"><Z n={l.color_stock} /></td>
                        {l.wip.map((v, i) => (<td key={i} className="r num"><Z n={v} /></td>))}
                        <td className="r num"><Z n={l.base_stock} /></td>
                        <td className="r num"><Z n={l.shipped} /></td>
                        <td className="r">{l.shorts[2] == null ? <span className="pill p-grn">완료</span> : <span className="num">{fmt(l.shorts[2])}</span>}</td>
                        <td className={`r num ${l.assy_in > 0 ? "need" : ""}`}><Z n={l.assy_in} /></td>
                        <td className="r">{l.shorts[9] == null ? <span className="pill p-grn">완료</span> : <span className="pill p-red">{fmt(l.shorts[9])}</span>}</td>
                      </tr>
                    ))}
                    <tr className="tot">
                      <td colSpan={2}>합계</td>
                      <td className="r num">{fmt(sum(powers.map((l) => l.order_qty)))}</td>
                      <td />
                      <td />
                      {pw.map((v, i) => (<td key={i} className="r num"><Z n={v} /></td>))}
                      <td />
                      <td className="r num">{fmt(sum(powers.map((l) => l.shipped)))}</td>
                      <td />
                      <td className="r num">{fmt(sum(powers.map((l) => l.assy_in)))}</td>
                      <td className="r num">{fmt(sum(powers.map((l) => l.shorts[9] ?? 0)))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export default function DueOrdersPage() {
  const [data, setData] = useState<DueOrdersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useTabState("dueOrdSearch", "");
  const [customer, setCustomer] = useTabState("dueOrdCustomer", "");
  const [needOnly, setNeedOnly] = useTabState("dueOrdNeedOnly", false);
  const [dueSoon, setDueSoon] = useTabState("dueOrdDueSoon", false);
  const [hideDone, setHideDone] = useTabState("dueOrdHideDone", true);
  const [wipOpen, setWipOpen] = useTabState("dueOrdWipOpen", false);
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
      if (dueSoon && (dday(r.due_date, base) ?? 999) > 14) return false;
      if (customer && r.customer !== customer) return false;
      if (!kw) return true;
      return [r.so_no, r.mo_no, r.customer, r.brand].some((v) => (v ?? "").toLowerCase().includes(kw));
    });
  }, [data, search, customer, needOnly, dueSoon, hideDone, base]);

  const kpis = [
    ["진행 수주", `${rows.length}건`, "표시 중인 수주"],
    ["총 주문량", fmt(sum(rows.map((r) => r.order_qty))), "렌즈 매수"],
    ["조립투입 필요", `${rows.filter((r) => r.assy_in > 0).length}건`, `${fmt(sum(rows.map((r) => r.assy_in)))} 매`],
    ["공정재공", fmt(sum(rows.map((r) => sum(r.wip)))), "조립~출하포장"],
    ["납기 경과·미출하", `${rows.filter((r) => (dday(r.due_date, base) ?? 1) < 0 && r.shipped < r.order_qty).length}건`, "출하부족 남은 수주"],
  ];

  return (
    <div className="po">
      <style>{CSS}</style>
      <div className="head">
        <div>
          <div className="crumb">생산계획 › 납기별 수주현황</div>
          <h1>납기별 수주현황</h1>
        </div>
        <div className="meta">
          <span>PLAN-04</span>
          <span>직진율 <b>{Math.round((data?.straight_rate ?? 0.88) * 100)}%</b></span>
          {data && <span>공정재공 <b>{data.as_of.wip ?? "-"}</b></span>}
          {data && <span>출고 <b>{data.as_of.shipment ?? "-"}</b></span>}
          <button className="chip" onClick={() => load(true)}>다시 계산</button>
        </div>
      </div>

      <div className="kpis">
        {kpis.map(([l, v, s]) => (
          <div key={l} className="kpi">
            <span className="l">{l}</span>
            <span className="v num">{v}</span>
            <span className="s">{s}</span>
          </div>
        ))}
      </div>

      <div className="tools">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SO번호·MO·고객·브랜드 검색" aria-label="검색" />
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="고객 선택">
          <option value="">전체 고객</option>
          {customers.map((c) => (<option key={c}>{c}</option>))}
        </select>
        <button className="chip" aria-pressed={needOnly} onClick={() => setNeedOnly(!needOnly)}>조립투입 필요만</button>
        <button className="chip" aria-pressed={dueSoon} onClick={() => setDueSoon(!dueSoon)}>납기 14일 이내</button>
        <button className="chip" aria-pressed={hideDone} onClick={() => setHideDone(!hideDone)}>출하 완료 숨기기</button>
        <span className="cnt">{rows.length.toLocaleString("ko-KR")}건 표시</span>
      </div>

      <div className="tbl-wrap" style={{ maxHeight: "calc(100vh - 330px)" }}>
        {loading ? (
          <div className="empty" style={{ border: 0 }}>계산 중… (수주·재공·재고·출고를 모두 읽어 몇 초 걸립니다)</div>
        ) : error ? (
          <div className="empty" style={{ border: 0 }}><b>{error}</b></div>
        ) : (
          <table>
            <thead>
              <tr className="h1">
                <th className="r" rowSpan={wipOpen ? 2 : 1}>순위</th>
                <th rowSpan={wipOpen ? 2 : 1}>SO번호</th>
                <th rowSpan={wipOpen ? 2 : 1}>MO번호</th>
                <th rowSpan={wipOpen ? 2 : 1}>고객사</th>
                <th rowSpan={wipOpen ? 2 : 1}>브랜드</th>
                <th rowSpan={wipOpen ? 2 : 1}>납기일</th>
                <th rowSpan={wipOpen ? 2 : 1}>포장</th>
                <th className="r" rowSpan={wipOpen ? 2 : 1}>주문량</th>
                <th className="r" rowSpan={wipOpen ? 2 : 1}>착색재고</th>
                {wipOpen ? (
                  <th className="grp" colSpan={STAGES.length} onClick={() => setWipOpen(false)} title="누르면 공정재공 합계 1칸으로 접습니다">
                    공정재공 (조립 ~ 출하포장) ▾
                  </th>
                ) : (
                  <th className="r grp" onClick={() => setWipOpen(true)} title="누르면 조립 ~ 출하포장 공정별로 펼칩니다">
                    공정재공 ▸
                  </th>
                )}
                <th className="r" rowSpan={wipOpen ? 2 : 1}>출고</th>
                <th className="r" rowSpan={wipOpen ? 2 : 1}>조립투입 필요</th>
                <th className="r" rowSpan={wipOpen ? 2 : 1}>출하부족</th>
                <th rowSpan={wipOpen ? 2 : 1}>진행률</th>
                <th rowSpan={wipOpen ? 2 : 1}>상세</th>
              </tr>
              {wipOpen && (
                <tr className="h2">
                  {STAGES.map((st) => (
                    <th key={st} className="r">{st}</th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = progress(r);
                return (
                  <tr
                    key={r.so_no}
                    className={`row${selected === r.so_no ? " sel" : ""}`}
                    tabIndex={0}
                    onClick={() => setSelected(r.so_no)}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(r.so_no)}
                  >
                    <td className="r num">{r.rank}</td>
                    <td className="so">{r.so_no}</td>
                    <td className="num" style={{ fontSize: 12.5 }}>{r.mo_no ?? ""}</td>
                    <td>{r.customer ?? ""}</td>
                    <td>{r.brand ?? ""}</td>
                    <td><span className="num">{(r.due_date ?? "").slice(0, 10)}</span> <DueBadge row={r} base={base} /></td>
                    <td>{r.pack_method ?? ""}</td>
                    <td className="r num">{fmt(r.order_qty)}</td>
                    <td className="r num"><Z n={r.color_stock} /></td>
                    {wipOpen ? (
                      r.wip.map((v, i) => (<td key={i} className="r num"><Z n={v} /></td>))
                    ) : (
                      <td className="r num"><Z n={sum(r.wip)} /></td>
                    )}
                    <td className="r num"><Z n={r.shipped} /></td>
                    <td className={`r num ${r.assy_in > 0 ? "need" : ""}`}><Z n={r.assy_in} /></td>
                    <td className="r num"><Z n={r.ship_short} /></td>
                    <td>
                      <span className="bar"><i style={{ width: `${(p * 100).toFixed(0)}%` }} /></span>{" "}
                      <span className="num" style={{ fontSize: 12 }}>{(p * 100).toFixed(0)}%</span>
                    </td>
                    <td><span className="pill p-grn">열기</span></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={wipOpen ? 14 + STAGES.length : 15} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>조건에 맞는 수주가 없습니다. 필터를 해제해 보세요.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="note">
        엑셀 수주별 시트 계산식과 같습니다: 공정 부족분 = 누적주문 − 기초재고(제품창고A+조립창고) − 누적출고 − 다음 공정~출하포장 재공,
        조립투입 = 검사부족분 ÷ 직진율 − 조립 − 분리3 − 습윤 − 외관검사×108%(60 단위 올림). 공정재공은 품목코드 기준이라 같은 품목을 가진 수주에 똑같이 보입니다.
        순위는 납기일 → 생산순위지정(PLAN-01) 작업순서 순입니다.
      </p>

      {selected && <DetailPanel key={selected} soNo={selected} onClose={() => setSelected(null)} base={base} />}
    </div>
  );
}
