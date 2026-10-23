"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { MaterialCell, MaterialKind, MaterialRow, MaterialSupplyResult } from "@/lib/material-supply";

// 구매관리 "자재수급(PUR-03)" — 자재수급일정 엑셀(출하검토 시트)을 MES 데이터로 자동 계산해 보여주는 화면.
// 수주×모델 한 줄마다 실링지·단상자·라벨·설명서의 소요량·현재고·과부족·입고예정(발주 충당)을 보여준다.
// 계산식과 데이터 출처는 lib/material-supply.ts 머리 주석 참고. 디자인은 납기별수주현황(PLAN-04)과 같은 톤.

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap");
.ms{--navy:#002060;--accent:#2457d6;--bg:#f3f5f9;--surface:#fff;--surface-2:#f7f9fc;--line:#dfe4ee;--line-2:#eef1f6;--fg:#16203a;--fg-2:#4a5672;--fg-3:#7c88a3;--red:#c62f2f;--red-bg:#fdecec;--amber:#a86400;--amber-bg:#fff4e0;--green:#1d7a46;--green-bg:#e6f5ec;--blue-bg:#e9efff;
 --sans:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
 font-family:var(--sans);font-size:14px;line-height:1.45;color:var(--fg);background:var(--bg);display:flex;flex-direction:column;gap:14px;padding:20px 16px 40px;min-height:100%}
.ms *{box-sizing:border-box}
.ms .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.ms .head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px}
.ms h1{margin:0;font-size:22px;font-weight:700;color:var(--fg)}
.ms .crumb{font-size:12px;color:var(--fg-3);margin-bottom:2px}
.ms .meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--fg-2);align-items:center}
.ms .meta b{color:var(--fg);font-weight:600}
.ms .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.ms .kpi{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.ms .kpi .l{font-size:12px;color:var(--fg-3)}.ms .kpi .v{font-size:20px;font-weight:600}.ms .kpi .s{font-size:11.5px;color:var(--fg-3)}
.ms .tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ms .tools input,.ms .tools select{font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--fg);min-width:0}
.ms .tools input[type="search"]{width:240px;max-width:100%}
.ms .chip{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--surface);color:var(--fg-2);border-radius:999px;padding:5px 11px;cursor:pointer;white-space:nowrap}
.ms .chip[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:#fff}
.ms .cnt{font-size:12px;color:var(--fg-3);margin-left:auto}
.ms .tbl-wrap{background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow:auto}
.ms table{border-collapse:collapse;width:100%;font-size:13px}
.ms th{position:sticky;top:0;background:var(--surface-2);color:var(--fg-2);font-weight:600;font-size:12px;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap;z-index:1}
.ms td{padding:6px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap;color:var(--fg);vertical-align:top}
.ms th.r,.ms td.r{text-align:right}
.ms th.grp{text-align:center;border-bottom:3px solid var(--gc);color:var(--gc)}
.ms thead tr.h1 th{height:35px}
.ms thead tr.h2 th{top:35px}
.ms .tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line)}
.ms .tab{font:inherit;font-size:13.5px;font-weight:600;color:var(--fg-2);background:transparent;border:0;border-bottom:3px solid transparent;padding:8px 16px;cursor:pointer;display:inline-flex;gap:6px;align-items:center;margin-bottom:-1px}
.ms .tab[aria-selected="true"]{color:var(--gc,var(--navy));border-bottom-color:var(--gc,var(--navy))}
.ms .tab:hover{background:var(--blue-bg)}
.ms tbody tr.sf td{box-shadow:inset 0 1.5px 0 var(--navy)}
.ms tbody tr.sf:first-child td{box-shadow:none}
.ms .so{font-family:var(--mono);font-size:12.5px;color:var(--accent);font-weight:500}
.ms .code{font-family:var(--mono);font-size:12px;color:var(--fg-2)}
.ms .pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:3px;font-family:var(--mono)}
.ms .p-red{background:var(--red-bg);color:var(--red)}.ms .p-amb{background:var(--amber-bg);color:var(--amber)}.ms .p-grn{background:var(--green-bg);color:var(--green)}.ms .p-gry{background:var(--line-2);color:var(--fg-3)}
.ms .zero{color:var(--fg-3)}.ms .neg{color:var(--red);font-weight:600}
.ms .picker{position:relative}
.ms .pop{position:absolute;top:calc(100% + 4px);left:0;z-index:30;background:var(--surface);border:1px solid var(--line);border-radius:6px;box-shadow:0 8px 24px rgba(0,20,60,.16);padding:10px 12px;min-width:260px;display:flex;flex-direction:column;gap:8px}
.ms .pop label{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px}
.ms .pop input{width:84px;text-align:right}
.ms .pop .hint{font-size:11.5px;color:var(--fg-3);line-height:1.4;max-width:280px;white-space:normal}
.ms .pop .err{font-size:12px;color:var(--red)}
.ms .pop-scrim{position:fixed;inset:0;z-index:29}
.ms .empty{background:var(--surface);border:1px dashed var(--line);border-radius:6px;padding:22px;text-align:center;color:var(--fg-2)}
.ms .note{font-size:12px;color:var(--fg-3);line-height:1.6}
`;

const KINDS: { key: MaterialKind; label: string; color: string }[] = [
  { key: "seal", label: "실링지", color: "#2f6df0" },
  { key: "box", label: "단상자", color: "#e8590c" },
  { key: "label", label: "라벨", color: "#7c4dff" },
  { key: "manual", label: "설명서", color: "#2b9348" },
];

const STATUS_LABEL: Record<MaterialRow["status"], string> = { order: "발주 필요", late: "납기 이후 입고", po: "입고 예정", ok: "충족" };

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dday(due: string | null, base: string): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
  return Math.round((new Date(due.slice(0, 10) + "T00:00:00").getTime() - new Date(base + "T00:00:00").getTime()) / 864e5);
}
function DueBadge({ due, base }: { due: string | null; base: string }) {
  const n = dday(due, base);
  if (n == null) return <span className="pill p-gry">미정</span>;
  const cls = n < 0 ? "p-red" : n <= 14 ? "p-amb" : "p-gry";
  return <span className={`pill ${cls}`}>{n < 0 ? `D+${-n}` : n === 0 ? "D-day" : `D-${n}`}</span>;
}
function shortDate(iso: string | null): string {
  if (!iso) return "납기미정";
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

type CellStatus = "ok" | "po" | "late" | "order";
const cellStatus = (c: MaterialCell): CellStatus => (c.state === "order" ? "order" : c.late ? "late" : c.state === "po" ? "po" : "ok");
const RANK: Record<CellStatus, number> = { ok: 0, po: 1, late: 2, order: 3 };

// 요약 탭 — 자재 한 종류(품번이 여럿이면 가장 나쁜 것 기준)를 한 알약으로
function SumPill({ cells }: { cells: MaterialCell[] }) {
  const c = cells.reduce((w, x) => (RANK[cellStatus(x)] > RANK[cellStatus(w)] ? x : w), cells[0]);
  return <Pill c={c} />;
}

function Pill({ c }: { c: MaterialCell }) {
  if (c.state === "ok") return <span className="pill p-grn">충족</span>;
  if (c.state === "po")
    return (
      <span className={`pill ${c.late ? "p-red" : "p-amb"}`} title={`${c.po_no ?? ""} 납기 ${c.eta ?? "미정"}${c.late ? " — 수주 납기일보다 늦습니다" : ""}`}>
        {shortDate(c.eta)} 입고{c.late ? " (납기후)" : ""}
      </span>
    );
  return <span className="pill p-red" title="미입고 발주로도 모자랍니다">발주필요 {fmt(c.order_qty)}</span>;
}

// 모든 탭 공통 앞 열 — NO. · SO번호 · MO번호 · 고객사 · 브랜드 · 대표품목 · 수주량 · 납기일자(SALES-02) · 비고
const LEAD_COLS = 9;
function LeadHead() {
  return (
    <>
      <th className="r">NO.</th>
      <th>SO번호</th>
      <th>MO번호</th>
      <th>고객사</th>
      <th>브랜드</th>
      <th>대표품목</th>
      <th className="r">수주량</th>
      <th>납기일자</th>
      <th>비고</th>
    </>
  );
}
function LeadCells({ no, r, base }: { no: number; r: MaterialRow; base: string }) {
  return (
    <>
      <td className="r num zero">{no}</td>
      <td className="so">{r.so_no}</td>
      <td className="num" style={{ fontSize: 12.5 }}>{r.mo_no ?? ""}</td>
      <td>{r.customer ?? ""}</td>
      <td>{r.brand ?? ""}</td>
      <td title={r.item_name ?? ""}><span className="code">{r.model}</span></td>
      <td className="r num">{fmt(r.order_qty)}</td>
      <td><span className="num">{(r.due_date ?? "").slice(0, 10)}</span> <DueBadge due={r.due_date} base={base} /></td>
      <td>{r.memo ?? ""}</td>
    </>
  );
}

export default function MaterialSupplyPage() {
  const [data, setData] = useState<MaterialSupplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useTabState<"all" | MaterialKind>("msTab", "all");
  const [dueSoon, setDueSoon] = useState(false);
  const [hideDone, setHideDone] = useState(true);
  const [lossOpen, setLossOpen] = useState(false);
  const [lossDraft, setLossDraft] = useState<Record<string, string>>({});
  const [lossErr, setLossErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/material-supply", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: MaterialSupplyResult) => {
        setData(d);
        setError(null);
      })
      .catch(() => setError("자재수급 데이터를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openLoss = () => {
    setLossDraft(Object.fromEntries(KINDS.map((k) => [k.key, String(data?.loss[k.key] ?? "")])));
    setLossErr(null);
    setLossOpen(true);
  };
  const saveLoss = () => {
    const loss = Object.fromEntries(KINDS.map((k) => [k.key, Number(lossDraft[k.key])]));
    fetch("/api/material-supply", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loss }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "저장하지 못했습니다.");
        setLossOpen(false);
        load();
      })
      .catch((e: Error) => setLossErr(e.message));
  };

  const base = today();
  const customers = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.customer ?? ""))].filter(Boolean).sort(), [data]);
  const rows = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (hideDone && r.remain <= 0) return false;
      if (dueSoon && (dday(r.due_date, base) ?? 999) > 14) return false;
      if (customer && r.customer !== customer) return false;
      if (!kw) return true;
      const codes = KINDS.flatMap((k) => r.cells[k.key].map((c) => c.code));
      return [r.so_no, r.mo_no, r.customer, r.brand, r.model, r.item_name, r.memo, ...codes].some((v) => (v ?? "").toLowerCase().includes(kw));
    });
  }, [data, search, customer, dueSoon, hideDone, base]);
  const summaryRows = useMemo(() => rows.filter((r) => !status || r.status === status), [rows, status]);
  const kindRows = useMemo(() => {
    if (tab === "all") return [];
    return rows.flatMap((r) => r.cells[tab].map((c) => ({ r, c }))).filter((x) => !status || cellStatus(x.c) === status);
  }, [rows, tab, status]);
  const tabs = [
    { key: "all" as "all" | MaterialKind, label: "요약", color: "#002060", warn: rows.filter((r) => r.status === "order" || r.status === "late").length },
    ...KINDS.map((k) => ({
      key: k.key as "all" | MaterialKind,
      label: k.label,
      color: k.color,
      warn: rows.reduce((n, r) => n + r.cells[k.key].filter((c) => cellStatus(c) === "order" || cellStatus(c) === "late").length, 0),
    })),
  ];

  const count = (s: MaterialRow["status"]) => rows.filter((r) => r.status === s).length;
  const orderCodes = new Set(rows.flatMap((r) => KINDS.flatMap((k) => r.cells[k.key].filter((c) => c.state === "order").map((c) => c.code))));
  const kpis: [string, string, string][] = [
    ["대상 줄", `${rows.length}건`, "수주 × 모델"],
    ["발주 필요", `${count("order")}건`, `자재 ${orderCodes.size}종`],
    ["납기 이후 입고", `${count("late")}건`, "발주해도 납기를 넘김"],
    ["입고 예정", `${count("po")}건`, "미입고 발주로 충당"],
    ["자재 없음(BOM)", `${rows.filter((r) => !r.has_bom).length}건`, "BOM에 4종 자재 없음"],
  ];

  return (
    <div className="ms">
      <style>{CSS}</style>
      <div className="head">
        <div>
          <div className="crumb">구매관리 › 자재수급</div>
          <h1>자재수급</h1>
        </div>
        <div className="meta">
          <span>PUR-03</span>
          {data && <span>자재 재고 <b>{data.as_of.inventory ?? "-"}</b></span>}
          {data && <span>발주 <b>{data.as_of.purchase ?? "-"}</b></span>}
          <button className="chip" onClick={load}>다시 계산</button>
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
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SO번호·MO·고객·브랜드·모델·자재코드 검색" aria-label="검색" />
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="고객 선택">
          <option value="">전체 고객</option>
          {customers.map((c) => (<option key={c}>{c}</option>))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태 선택">
          <option value="">전체 상태</option>
          {(Object.keys(STATUS_LABEL) as MaterialRow["status"][]).map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
        </select>
        <button className="chip" aria-pressed={dueSoon} onClick={() => setDueSoon(!dueSoon)}>납기 14일 이내</button>
        <button className="chip" aria-pressed={hideDone} onClick={() => setHideDone(!hideDone)}>출하 완료 숨기기</button>
        <div className="picker">
          <button className="chip" aria-pressed={lossOpen} onClick={() => (lossOpen ? setLossOpen(false) : openLoss())}>Loss % 설정 ▾</button>
          {lossOpen && (
            <>
              <div className="pop-scrim" onClick={() => setLossOpen(false)} />
              <div className="pop">
                {KINDS.map((k) => (
                  <label key={k.key}>
                    <span>{k.label}</span>
                    <input type="number" min={100} max={500} step={1} value={lossDraft[k.key] ?? ""} onChange={(e) => setLossDraft({ ...lossDraft, [k.key]: e.target.value })} />
                  </label>
                ))}
                {lossErr && <div className="err">{lossErr}</div>}
                <div className="hint">소요량 = 필요 수량 × 개당 사용량 × Loss%. 자재 종류별로 모든 사용자에게 공통 적용됩니다(엑셀의 130%·115% 같은 값).</div>
                <div><button className="chip" onClick={saveLoss}>저장</button></div>
              </div>
            </>
          )}
        </div>
        <span className="cnt">{(tab === "all" ? summaryRows : kindRows).length.toLocaleString("ko-KR")}건 표시</span>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className="tab" style={{ ["--gc" as string]: t.color }} onClick={() => { setTab(t.key); setStatus(""); }}>
            {t.label}
            {t.warn > 0 && <span className="pill p-red">{t.warn}</span>}
          </button>
        ))}
      </div>

      <div className="tbl-wrap" style={{ maxHeight: "calc(100vh - 380px)" }}>
        {loading ? (
          <div className="empty" style={{ border: 0 }}>계산 중… (수주·BOM·재고·발주를 모두 읽어 몇 초 걸립니다)</div>
        ) : error ? (
          <div className="empty" style={{ border: 0 }}><b>{error}</b></div>
        ) : tab === "all" ? (
          <table>
            <thead>
              <tr>
                <LeadHead />
                <th className="r">미출하</th>
                {KINDS.map((k) => (<th key={k.key} className="grp" style={{ ["--gc" as string]: k.color }}>{k.label}</th>))}
                <th>종합</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((r, i) => (
                <tr key={`${r.so_no}|${r.model}`} className={i > 0 && summaryRows[i - 1].so_no !== r.so_no ? "sf" : undefined}>
                  <LeadCells no={i + 1} r={r} base={base} />
                  <td className="r num">{r.remain > 0 ? fmt(r.remain) : <span className="zero">0</span>}</td>
                  {KINDS.map((k) => (
                    <td key={k.key} className="c">
                      {r.cells[k.key].length === 0 ? <span className="zero">{r.has_bom ? "-" : "BOM 없음"}</span> : <SumPill cells={r.cells[k.key]} />}
                    </td>
                  ))}
                  <td><span className={`pill ${r.status === "ok" ? "p-grn" : r.status === "po" ? "p-amb" : "p-red"}`}>{STATUS_LABEL[r.status]}</span></td>
                </tr>
              ))}
              {summaryRows.length === 0 && (
                <tr><td colSpan={LEAD_COLS + 6} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>조건에 맞는 줄이 없습니다. 필터를 해제해 보세요.</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <LeadHead />
                <th>품번</th>
                <th className="r">소요량</th>
                <th className="r">현재고</th>
                <th className="r">과부족</th>
                <th>판정</th>
                <th>발주일자</th>
                <th>발주납기</th>
                <th>입고일자</th>
              </tr>
            </thead>
            <tbody>
              {kindRows.map((x, i) => (
                <tr key={`${x.r.so_no}|${x.r.model}|${x.c.code}`} className={i > 0 && kindRows[i - 1].r.so_no !== x.r.so_no ? "sf" : undefined}>
                  <LeadCells no={i + 1} r={x.r} base={base} />
                  <td className="code" title={x.c.name ?? ""}>{x.c.code}</td>
                  <td className="r num">{fmt(x.c.need)}</td>
                  <td className="r num">{fmt(x.c.stock)}</td>
                  <td className={`r num ${x.c.balance < 0 ? "neg" : ""}`}>{fmt(x.c.balance)}</td>
                  <td><Pill c={x.c} /></td>
                  <td className="num">{x.c.ref?.order_date ?? <span className="zero">-</span>}{x.c.ref?.status && <> <span className={`pill ${x.c.ref.status === "완료" ? "p-grn" : "p-amb"}`} title={`발주번호 ${x.c.ref.po_no}`}>{x.c.ref.status}</span></>}</td>
                  <td className="num">{x.c.ref?.due ?? <span className="zero">-</span>}</td>
                  <td className="num">{x.c.ref?.receipt_date ?? <span className="zero">-</span>}</td>
                </tr>
              ))}
              {kindRows.length === 0 && (
                <tr><td colSpan={LEAD_COLS + 8} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>조건에 맞는 줄이 없습니다. 필터를 해제해 보세요.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="note">
        자재수급일정 엑셀(출하검토)과 같은 방식입니다: 소요량 = 필요 수량 × BOM 개당 사용량 × Loss%(올림), 현재고는 같은 자재의 앞 줄 과부족을 이어받고(과부족 = 현재고 − 소요량),
        모자라는 만큼은 납기 빠른 미입고 발주(구매발주등록 상태 &lsquo;발주&rsquo;)부터 채워 입고일을 보여줍니다. 입고일이 수주 납기일보다 늦으면 &lsquo;납기후&rsquo;로 빨갛게 표시합니다.
        발주일자·발주현황·발주납기는 구매발주등록(PUR-01), 입고일자는 구매입고등록(PUR-02) 기준이며, 모자라는 만큼을 채우는 발주(없으면 그 자재의 가장 최근 발주)를 보여주고
        입고일자는 그 발주일자 이후 가장 최근 입고일입니다(입고 전표에 발주번호가 없어 자재코드·날짜로 잇습니다).
        필요 수량: 실링지는 실링 부족분, 단상자·라벨·설명서는 출하부족(조립투입계획 PLAN-04 기준, 앞 수주가 재고를 먼저 씁니다).
        현재고는 {data?.warehouses.join("·") ?? "원.부자재창고·포장창고·조립창고"} 재고 합입니다. 순서는 납기일 → 생산순위지정(PLAN-01) 작업순서 순입니다.
      </p>
    </div>
  );
}
