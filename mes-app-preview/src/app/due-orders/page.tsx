"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { AssemblyRecord, ColorStockLot, DueOrderLine, DueOrderRow, DueOrdersResult, ItemChangeCandidate } from "@/lib/due-orders";
import type { MaterialCell, MaterialKind, MaterialRow, OrderMaterialStatus } from "@/lib/material-supply";

// 생산계획 "납기별수주현황(PLAN-04)" — 생산계획 엑셀 「납기별」 시트 + 수주별 시트를 한 화면으로 옮긴 것.
// 목록에서 수주를 누르면 오른쪽 상세 창에서 품목(모델)별 요약 → 모델을 누르면 도수별 공정재공·부족분·조립투입을 본다.
// 계산식과 데이터 출처는 lib/due-orders.ts 머리 주석 참고.
// 화면 디자인은 시안 「메디오스 MES 납기별 수주현황.html」의 CSS를 .po 아래로 옮겨 그대로 맞췄다(착색재고 = 모델별 BOM 착색 반제품의 조립창고 재고, 도수 상세는 0.00 무도수용 / 그 외 무도수용+유도수용).

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
.po .tools input[type="search"]{width:220px;max-width:100%}
.po .pop input[type="checkbox"]{width:auto;padding:0;margin:0}
.po .chip{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--surface);color:var(--fg-2);border-radius:999px;padding:5px 11px;cursor:pointer}
.po .chip[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:#fff}
.po .cnt{font-size:12px;color:var(--fg-3);margin-left:auto}
.po .tbl-wrap{background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow:auto}
.po table{border-collapse:collapse;width:100%;font-size:13px}
.po th{position:sticky;top:0;background:var(--surface-2);color:var(--fg-2);font-weight:600;font-size:12px;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.po td{padding:7px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap;color:var(--fg)}
.po th.r,.po td.r{text-align:right}
.po th.grp{text-align:center;cursor:pointer;user-select:none;border-bottom:1px solid var(--line);color:var(--navy)}
.po th.grp2{text-align:center}
.po th.grp:hover{background:var(--blue-bg)}
.po thead tr.h2 th{top:35px}
.po thead tr.h2.tall th{height:30px}
.po thead tr.h3 th{top:65px}
.po thead tr.h1 th{height:35px}
.po tbody tr.row{cursor:pointer}.po tbody tr.row:hover{background:var(--surface-2)}.po tbody tr.row.sel{background:var(--blue-bg)}
.po tbody tr.row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.po .so{font-family:var(--mono);font-size:12.5px;color:var(--accent);font-weight:500}
.po .pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:3px;font-family:var(--mono)}
.po .p-red{background:var(--red-bg);color:var(--red)}.po .p-amb{background:var(--amber-bg);color:var(--amber)}.po .p-grn{background:var(--green-bg);color:var(--green)}.po .p-gry{background:var(--line-2);color:var(--fg-3)}
.po .bar{width:90px;height:6px;background:var(--line-2);border-radius:3px;overflow:hidden;display:inline-block;vertical-align:middle}
.po .bar i{display:block;height:100%;background:var(--accent)}
.po .pbar{position:relative;height:16px;min-width:85px;border-radius:999px;background:#e9eef6;overflow:hidden}
.po .pbar i{display:flex;align-items:center;justify-content:flex-end;height:100%;min-width:40px;border-radius:999px;background:linear-gradient(90deg,#2f6df0,#22a6ff);padding-right:8px;font-style:normal;font-size:11px;font-weight:700;color:#fff;line-height:1}
.po .pbar i.mid{background:linear-gradient(90deg,#1fa8c9,#2cc7c7)}
.po .pbar span{position:absolute;right:8px;top:0;bottom:0;display:flex;align-items:center;font-size:11px;font-weight:700;color:var(--fg-3)}
.po .pbar.sm{min-width:62px;height:14px}
.po .pbar.sm i{min-width:34px;font-size:10px;padding-right:6px}
.po .pbar.sm span{font-size:10px;right:6px}
.po th[draggable=true]{cursor:grab}
.po th.grp[draggable=true]{cursor:pointer}
.po th.dropt{box-shadow:inset 3px 0 0 var(--accent)}
.po .pop .mv{font:inherit;font-size:12px;line-height:1;border:1px solid var(--line);background:var(--surface);color:var(--fg-2);border-radius:4px;padding:2px 6px;cursor:pointer}
.po .pop .mv:disabled{opacity:.35;cursor:default}
.po .pop .hint{margin-top:6px;padding-top:6px;border-top:1px solid var(--line-2);font-size:11.5px;color:var(--fg-3);max-width:260px;white-space:normal;line-height:1.4}
.po .zero{color:var(--fg-3)}.po .need{color:var(--red);font-weight:600}
.po .scrim{position:fixed;inset:0;background:rgba(10,18,40,.35);z-index:40}
.po .drawer{position:fixed;top:0;right:0;bottom:0;width:min(980px,100%);background:var(--bg);border-left:1px solid var(--line);display:flex;flex-direction:column;box-shadow:-12px 0 30px rgba(0,20,60,.18);z-index:41;animation:po-slide .18s ease-out;transition:width .18s ease-out}
.po .drawer.wide{width:min(1720px,100%)}
.po .pwtbl{table-layout:fixed;min-width:1480px}
.po .pwtbl th,.po .pwtbl td{padding-left:7px;padding-right:7px;overflow:hidden;text-overflow:ellipsis}
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
.po tr.off td{background:#e6e9ef;color:var(--fg-3)}
.po tr.extra td.pw{font-weight:400;color:var(--fg-2)}
.po .legend{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--fg-3);font-weight:400}
.po .legend i{display:inline-block;width:12px;height:12px;border-radius:2px;background:#e6e9ef;border:1px solid var(--line)}
.po .picker{position:relative}
.po .pop{position:absolute;top:calc(100% + 4px);left:0;z-index:30;background:var(--surface);border:1px solid var(--line);border-radius:6px;box-shadow:0 8px 24px rgba(0,20,60,.16);padding:8px 10px;min-width:250px;display:flex;flex-direction:column;gap:2px}
.po .pop label{display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 2px;cursor:pointer;white-space:nowrap}
.po .pop .acts .chip{white-space:nowrap;padding:4px 9px}
.po .pop .acts{display:flex;gap:6px;border-bottom:1px solid var(--line-2);padding-bottom:6px;margin-bottom:4px}
.po .pop-scrim{position:fixed;inset:0;z-index:29}
.po button.pill{border:0;cursor:pointer;font-size:11.5px;font-weight:600}
.po button.p-amb:hover{background:#ffe6bd}
.po .modal-scrim{position:fixed;inset:0;background:rgba(10,18,40,.3);z-index:50}
.po .modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1480px,calc(100% - 32px));max-height:calc(100% - 64px);background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:0 16px 40px rgba(0,20,60,.25);z-index:51;display:flex;flex-direction:column}
.po .modal .mh{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
.po .modal .mh h3{margin:0;font-size:15px;flex:1;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.po .modal .mh small{font-size:12px;color:var(--fg-3);font-weight:400}
.po .modal .mb{overflow:auto}
.po .modal tr.chg td{background:var(--amber-bg)}
.po .modal th.sep,.po .modal td.sep{border-left:1px solid var(--line)}
.po .modal tr.na td{color:var(--fg-3)}
.po button.lnk{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
.po button.lnk:hover{color:var(--accent)}
.po button.cp{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:copy}
.po button.cp:hover{color:var(--accent);text-decoration:underline}
.po button.p-grn:hover{background:#d3eedd}
.po button.hh{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:help;text-decoration:underline dotted;text-underline-offset:3px}
.po button.hh:hover{color:var(--accent)}
.po .help{padding:14px 18px 18px;font-size:13.5px;line-height:1.65;color:var(--fg)}
.po .help h4{margin:14px 0 4px;font-size:13.5px;color:var(--navy)}
.po .help h4:first-child{margin-top:0}
.po .help ul{margin:0;padding-left:18px}
.po .help .ex{background:var(--surface-2);border:1px solid var(--line-2);border-radius:6px;padding:8px 12px;margin-top:4px}
.po .copied{margin-left:6px;font-size:11px;color:var(--green);font-weight:600}
.po button.mat{display:grid;grid-template-columns:auto auto;gap:2px 10px;background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left}
.po button.mat:hover .ml{color:var(--accent)}
.po .mat .mi{display:flex;align-items:center;gap:4px;font-size:11.5px}
.po .mat .ml{color:var(--fg-3);min-width:3.2em}
.po .note{font-size:12px;color:var(--fg-3);line-height:1.6}
`;

// 목록 표에서 골라 볼 수 있는 항목(순서 = 표 열 순서). 공정재공은 접기/펼치기 머리글과 함께 한 항목으로 켜고 끈다.
const GRID_COLS: { key: string; label: string }[] = [
  { key: "rank", label: "순위" },
  { key: "so", label: "SO번호" },
  { key: "mo", label: "MO번호" },
  { key: "customer", label: "고객사" },
  { key: "brand", label: "브랜드" },
  { key: "due", label: "납기일" },
  { key: "status", label: "상태" },
  { key: "pack", label: "포장" },
  { key: "mat", label: "자재일정" },
  { key: "qty", label: "주문량" },
  { key: "color", label: "착색재고" },
  { key: "wip", label: "공정재공" },
  { key: "shipped", label: "출고" },
  { key: "assy", label: "조립투입 필요" },
  { key: "short", label: "출하부족" },
  { key: "stageprog", label: "진행률" },
  { key: "open", label: "상세" },
];

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

function DosuChangeModal({ itemCode, power, onClose }: { itemCode: string; power: number | null; onClose: () => void }) {
  const [data, setData] = useState<{ from: string; to: string; records: AssemblyRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/due-orders?dosu=${encodeURIComponent(itemCode)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setError("조립 기록을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [itemCode]);

  const v = (n: number | null) => (n == null ? <span className="zero">-</span> : n);
  const pw = (n: number | null) => (n == null ? <span className="zero">-</span> : powerText(n));
  const changed = data?.records.filter((r) => r.changed).length ?? 0;
  return (
    <>
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="mh">
          <h3>
            <span className="num">{powerText(power)}</span> 조립 기록
            <span className="num" style={{ fontSize: 12.5, color: "var(--fg-2)", fontWeight: 400 }}>{itemCode}</span>
            {data && (
              <small>
                조립일자 {data.from} ~ {data.to} · 조립 {data.records.length}건 · <span className="pill p-amb">도수변경 {changed}건</span>
              </small>
            )}
          </h3>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="mb">
          {error && <div className="empty"><b>{error}</b></div>}
          {!data && !error && <div className="empty">불러오는 중…</div>}
          {data && (
            <table>
              <thead>
                <tr>
                  <th>작업지시번호</th><th>LOT No</th><th>조립 실적 입력시각</th><th>조립 호기</th><th>조립자</th>
                  <th className="r sep">실제도수</th><th className="r">이전도수</th>
                  <th className="r sep">상몰드1</th><th className="r">상몰드2</th><th className="r">하몰드1</th><th className="r">하몰드2</th>
                  <th className="r sep">도수1</th><th className="r">도수2</th><th className="r">도수3</th>
                  <th className="r sep" title="착색 투입 LOT No 끝 3자리">착색품 RADIUS</th><th className="r" title="하몰드 투입 LOT No 끝 3자리">하몰드 RADIUS</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.wo_no} className={r.changed ? "chg" : ""} title={r.changed ? "도수변경 건" : undefined}>
                    <td className="num">{r.wo_no}</td>
                    <td className="num" style={{ fontSize: 12, color: "var(--fg-2)" }}>{r.lot_no ?? "-"}</td>
                    <td className="num">{r.assembled_at ?? "-"}</td>
                    <td>{r.machine ?? "-"}</td>
                    <td>{r.worker ?? "-"}</td>
                    <td className="r num sep"><b>{pw(r.power)}</b></td>
                    <td className="r num">{r.changed ? <span className="pill p-amb">{powerText(r.prev_power)}</span> : <span className="zero">-</span>}</td>
                    <td className="r num sep">{v(r.upper1)}</td>
                    <td className="r num">{v(r.upper2)}</td>
                    <td className="r num">{v(r.lower1)}</td>
                    <td className="r num">{v(r.lower2)}</td>
                    <td className="r num sep">{v(r.p1)}</td>
                    <td className="r num">{v(r.p2)}</td>
                    <td className="r num">{v(r.p3)}</td>
                    <td className="r num sep">{r.color_radius ?? <span className="zero">-</span>}</td>
                    <td className="r num">{r.mold_radius ?? <span className="zero">-</span>}</td>
                  </tr>
                ))}
                {data.records.length === 0 && (
                  <tr><td colSpan={16} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>최근 1개월 조립 기록이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

/** 클립보드 복사 — http://IP:3001처럼 보안 연결이 아니면 navigator.clipboard가 없어 textarea + execCommand로 대신한다 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 방식으로 다시 시도
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function ColorStockModal({ model, power, onClose }: { model: string; power: number | null; onClose: () => void }) {
  const [data, setData] = useState<{ model: string; lots: ColorStockLot[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyLot = async (lot: string) => {
    if (!(await copyText(lot))) return;
    setCopied(lot);
    window.setTimeout(() => setCopied((c) => (c === lot ? null : c)), 1500);
  };

  useEffect(() => {
    let alive = true;
    fetch(`/api/due-orders?color=${encodeURIComponent(model)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setError("착색 현재고를 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [model]);

  const sum = (u: ColorStockLot["use"]) => data?.lots.filter((l) => l.use === u).reduce((s, l) => s + l.stock_qty, 0) ?? 0;
  const mu = sum("무도수용");
  const yu = sum("유도수용");
  const zero = power === 0;
  return (
    <>
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" style={{ width: "min(1100px, calc(100% - 32px))" }}>
        <div className="mh">
          <h3>
            착색 현재고
            <span className="num" style={{ fontSize: 12.5, color: "var(--fg-2)", fontWeight: 400 }}>{model} · 조립창고</span>
            {data && (
              <small>
                LOT {data.lots.length}개 · <span className="pill p-grn">무도수용 {fmt(mu)}</span> <span className="pill p-gry">유도수용 {fmt(yu)}</span> ·{" "}
                <b className="num">{powerText(power)}</b>에 쓸 수 있는 수량 <b className="num">{fmt(zero ? mu : mu + yu)}</b>
                {zero ? " (유도수용은 0.00에 못 씀)" : " (무도수용 혼용 가능)"}
              </small>
            )}
          </h3>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="mb">
          {error && <div className="empty"><b>{error}</b></div>}
          {!data && !error && <div className="empty">불러오는 중…</div>}
          {data && (
            <table>
              <thead>
                <tr>
                  <th>구분</th><th>품목코드</th><th>품목명</th><th>LOT No</th><th>Location</th><th className="r">현재고</th><th className="sep" title="BASE 인쇄 실적의 호기 — 자동Base 호기면 무도수용">BASE 설비</th><th title="착색 인쇄 실적의 호기 — BASE 실적이 없을 때 자동인쇄 호기면 무도수용">착색 설비</th>
                </tr>
              </thead>
              <tbody>
                {data.lots.map((l) => (
                  <tr key={`${l.item_code}|${l.lot_no}`} className={zero && l.use === "유도수용" ? "na" : ""} title={zero && l.use === "유도수용" ? "유도수용 — 0.00에는 쓸 수 없음" : undefined}>
                    <td><span className={`pill ${l.use === "무도수용" ? "p-grn" : "p-gry"}`}>{l.use}</span></td>
                    <td className="num">{l.item_code}</td>
                    <td>{l.item_name ?? "-"}</td>
                    <td className="num">
                      <button className="cp" onClick={() => copyLot(l.lot_no)} title="누르면 LOT No가 복사됩니다">{l.lot_no}</button>
                      {copied === l.lot_no && <span className="copied">복사됨</span>}
                    </td>
                    <td className="num">{l.location ?? "-"}</td>
                    <td className="r num">{fmt(l.stock_qty)}</td>
                    <td className="sep" style={{ fontSize: 12.5 }}>
                      {l.base_lines.length ? l.base_lines.join(", ") : <span className="zero">실적 없음</span>}
                      {l.pending && <span className="pill p-amb" style={{ marginLeft: 6 }} title="BASE를 자동Base·Back 호기 양쪽에서 인쇄 — 처리 보류, 우선 유도수용">보류</span>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{l.color_lines.length ? l.color_lines.join(", ") : <span className="zero">실적 없음</span>}</td>
                  </tr>
                ))}
                {data.lots.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>조립창고에 착색 재고가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

/** 도수별 상세 열 제목을 누르면 보여줄 계산 기준 창의 틀 */
function HelpModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" style={{ width: "min(640px, calc(100% - 32px))" }}>
        <div className="mh">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="mb help">{children}</div>
      </div>
    </>
  );
}

/** 착색재고 계산 기준 — 계산은 lib/due-orders.ts의 colorMap(COLOR_MU)·colorStockOf, 창은 fetchColorStock */
function ColorStockHelp({ onClose }: { onClose: () => void }) {
  return (
    <HelpModal title="착색재고 계산 기준" onClose={onClose}>
      <h4>무엇을 보여주나</h4>
      <ul>
        <li>모델(BOM 대표코드)의 구성품 중 <b>반제품 · 품목군 "착색"</b> 품목의 <b>조립창고</b> 재고입니다.</li>
      </ul>
      <h4>무도수용 / 유도수용 구분</h4>
      <ul>
        <li>LOT마다 일일작업현황의 BASE 인쇄 · 착색 인쇄 설비로 나눕니다(LOT No는 BASE 인쇄부터 착색 인쇄까지 그대로 이어짐).</li>
        <li><b>무도수용</b> — BASE를 <b>자동Base 호기에서만</b> 인쇄했거나, BASE 인쇄 실적 없이 착색을 <b>자동인쇄 호기</b>에서 인쇄한 LOT</li>
        <li><b>유도수용</b> — 나머지(BASE를 Back 호기에서 인쇄, 인쇄 실적 없음)</li>
      </ul>
      <h4>도수별 표시</h4>
      <ul>
        <li>무도수용은 0.00과 유도수에 모두 쓸 수 있고, 유도수용은 0.00에 쓸 수 없습니다.</li>
        <li><b>0.00 줄</b> = 무도수용, <b>-0.25 ~ -10.00 줄</b> = 무도수용 + 유도수용(같은 모델은 모두 같은 값)</li>
        <li>같은 무도수용 재고를 0.00 줄과 유도수 줄이 함께 세므로, 줄 값을 세로로 더하면 실제 재고보다 커집니다.</li>
      </ul>
      <div className="ex">
        예) 무도수용 600 · 유도수용 900 → 0.00 줄 <b className="num">600</b>, -0.25 ~ -10.00 줄 <b className="num">1,500</b>
      </div>
      <h4>참고</h4>
      <ul>
        <li>BASE를 자동Base · Back 호기 양쪽에서 인쇄한 LOT는 처리 방법이 보류돼 우선 유도수용으로 셉니다(창에 "보류" 표시).</li>
        <li>숫자를 누르면 LOT별 현재고 · BASE 설비 · 착색 설비를 볼 수 있고, LOT No를 누르면 복사됩니다.</li>
      </ul>
    </HelpModal>
  );
}

/** 도수변경 계산 기준 — 계산은 lib/due-orders.ts의 DOSU_CHANGE_COND(ASSY_IN_WINDOW·CHANGED), 창은 fetchAssemblyRecords */
function DosuChangeHelp({ onClose }: { onClose: () => void }) {
  return (
    <HelpModal title="도수변경 계산 기준" onClose={onClose}>
      <h4>무엇을 보여주나</h4>
      <ul>
        <li>최근 1개월 동안 <b>이 도수로 변경되어 조립된 작업지시 건수</b>입니다(도수변경현황 QC-01 기준).</li>
        <li>품목코드는 변경 후, 즉 실제로 조립된 도수입니다.</li>
      </ul>
      <h4>기간</h4>
      <ul>
        <li>오늘부터 1개월 전까지의 <b>조립일자</b>(조립 실적 입력시각의 날짜)입니다. 작업지시 지시일자와는 다를 수 있습니다.</li>
      </ul>
      <h4>판정 조건</h4>
      <ul>
        <li>이전도수가 숫자로 있고 <b>실제도수와 다른</b> 작업지시만 셉니다. 같은 작업지시는 한 번만 셉니다.</li>
        <li>이전도수가 실제도수와 같은 행(이전 품목이 자기 자신)과 이전도수가 깨진 값인 행은 뺍니다.</li>
      </ul>
      <div className="ex">
        예) -2.00으로 조립된 작업지시의 이전도수가 -2.25 → 도수변경 1건<br />
        이전도수가 -2.00(실제도수와 같음) → 제외
      </div>
      <h4>참고</h4>
      <ul>
        <li>숫자를 누르면 그 기간에 이 품목으로 조립된 기록 전부가 열리고, 도수변경 건은 주황색으로 강조됩니다.</li>
        <li>창의 착색품 · 하몰드 RADIUS는 투입 LOT No 끝 3자리입니다(예: 726).</li>
      </ul>
    </HelpModal>
  );
}

/** 품목변경 계산 기준 — 계산은 lib/due-orders.ts의 itemChangeCandidates·fitsPower(허용오차 ITEM_CHANGE_TOLERANCE) */
function ItemChangeHelp({ onClose }: { onClose: () => void }) {
  return (
    <HelpModal title="품목변경 계산 기준" onClose={onClose}>
      <h4>무엇을 보여주나</h4>
      <ul>
        <li>검사부족이 있는 도수에서, 조립 투입 대신 <b>다른 도수 재공을 품목변경해 채울 수 있는 수량</b>입니다.</li>
        <li>검사부족이 없는 도수는 <span className="zero">-</span>로 표시합니다.</li>
      </ul>
      <h4>후보 재공</h4>
      <ul>
        <li>같은 모델의 다른 도수 중 <b>외관검사를 마친 공정재공</b>(이재기 · 실링 · 멸균 · 입고대기 · 중간창고 · 마킹 · 출하포장)을 작업지시 단위로 봅니다.</li>
      </ul>
      <h4>판정 조건</h4>
      <ul>
        <li>그 작업지시의 외관검사 측정값 <b>도수1 · 도수2 · 도수3이 모두</b> 목표 도수 <b>±0.225</b> 안에 들어야 합니다.</li>
      </ul>
      <div className="ex">
        예) -2.00이 50개 부족 → 허용 범위 <b className="num">1.775 ~ 2.225</b><br />
        -2.25 작업지시의 측정값이 2.12 / 2.12 / 2.12 → 세 값 모두 범위 안 → 그 재공 수량이 -2.00 품목변경으로 잡힘<br />
        -1.75 작업지시의 측정값이 1.75 / 1.87 / 2.00 → 1.75가 범위 밖 → 제외
      </div>
      <h4>빠지는 재고</h4>
      <ul>
        <li>제품창고A 재고 — LOT가 포장 LOT라 외관검사 측정값과 연결되지 않습니다.</li>
        <li>2025년 1월 이전 작업지시 — 외관검사 실적 데이터가 없습니다.</li>
      </ul>
      <h4>참고</h4>
      <ul>
        <li>후보 재공이 원래 도수의 수주에 필요한지는 따지지 않은 전체 수량입니다.</li>
        <li>품목변경 수량은 조립투입 계산에 반영하지 않습니다.</li>
        <li>한 재공이 여러 도수의 후보가 될 수 있어 합계 줄은 비워 둡니다.</li>
        <li>숫자를 누르면 후보 작업지시 · LOT · 공정 · 측정값을 볼 수 있습니다.</li>
      </ul>
    </HelpModal>
  );
}

// 자재일정 — 자재수급(PUR-03, lib/material-supply.ts) 계산을 수주별로 묶은 것. 종류 순서·이름은 MATERIAL_KINDS와 같다
const MAT_KINDS: { key: MaterialKind; label: string }[] = [
  { key: "seal", label: "실링지" },
  { key: "box", label: "단상자" },
  { key: "label", label: "라벨" },
  { key: "manual", label: "설명서" },
];
type OrderMaterials = { kinds: Record<MaterialKind, OrderMaterialStatus>; rows: MaterialRow[] };
const mmdd = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "납기미정");

function MatStatus({ s }: { s: OrderMaterialStatus }) {
  if (s.status === "none") return <span className="zero" title="BOM에 이 종류 자재가 없습니다">-</span>;
  if (s.status === "ok") return <span className="pill p-grn">충족</span>;
  if (s.status === "order") return <span className="pill p-red" title={`미입고 발주로도 모자랍니다 — 발주 필요 ${fmt(s.order_qty)}`}>발주필요</span>;
  return (
    <span className={`pill ${s.status === "late" ? "p-red" : "p-amb"}`} title={s.status === "late" ? "입고예정일이 수주 납기일보다 늦습니다" : "미입고 발주로 충당"}>
      {mmdd(s.eta)}{s.status === "late" ? " 납기후" : ""}
    </span>
  );
}

function MatCellPill({ c }: { c: MaterialCell }) {
  if (c.state === "ok") return <span className="pill p-grn">충족</span>;
  if (c.state === "po") return <span className={`pill ${c.late ? "p-red" : "p-amb"}`}>{mmdd(c.eta)} 입고{c.late ? " (납기후)" : ""}</span>;
  return <span className="pill p-red">발주필요 {fmt(c.order_qty)}</span>;
}

function MaterialModal({ row, mats, onClose }: { row: DueOrderRow; mats: OrderMaterials | undefined; onClose: () => void }) {
  const lines = (mats?.rows ?? []).flatMap((r) => MAT_KINDS.flatMap((k) => r.cells[k.key].map((c) => ({ r, k, c }))));
  return (
    <>
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" style={{ width: "min(1280px, calc(100% - 32px))" }}>
        <div className="mh">
          <h3>
            자재일정
            <span className="num" style={{ fontSize: 12.5, color: "var(--fg-2)", fontWeight: 400 }}>{row.so_no}</span>
            <small>
              {row.customer ?? ""} {row.brand ? `· ${row.brand}` : ""} · 납기 <span className="num">{(row.due_date ?? "").slice(0, 10) || "-"}</span>
              {mats && (
                <>
                  {" · "}
                  {MAT_KINDS.map((k) => (
                    <span key={k.key} style={{ marginRight: 8 }}>{k.label} <MatStatus s={mats.kinds[k.key]} /></span>
                  ))}
                </>
              )}
            </small>
          </h3>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="mb">
          {!mats && <div className="empty">이 수주의 자재일정이 없습니다(자재수급 계산 대상 아님).</div>}
          {mats && (
            <table>
              <thead>
                <tr>
                  <th>모델</th><th>품목명</th><th className="sep">자재</th><th>자재코드</th><th>품명</th>
                  <th className="r sep">소요량</th><th className="r">현재고</th><th className="r">과부족</th>
                  <th className="sep">상태</th><th>발주번호</th><th>발주일자</th><th>납기일자</th><th>입고일자</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ r, k, c }) => (
                  <tr key={`${r.model}|${k.key}|${c.code}`}>
                    <td className="num">{r.model}</td>
                    <td>{r.item_name ?? "-"}</td>
                    <td className="sep">{k.label}</td>
                    <td className="num">{c.code}</td>
                    <td>{c.name ?? "-"}</td>
                    <td className="r num sep">{fmt(c.need)}</td>
                    <td className="r num">{fmt(c.stock)}</td>
                    <td className="r num" style={c.balance < 0 ? { color: "var(--red)" } : undefined}>{fmt(c.balance)}</td>
                    <td className="sep"><MatCellPill c={c} /></td>
                    <td className="num">{c.po_no ?? c.ref?.po_no ?? "-"}</td>
                    <td className="num">{c.ref?.order_date ?? "-"}</td>
                    <td className="num">{c.eta ?? c.ref?.due ?? "-"}</td>
                    <td className="num">{c.ref?.receipt_date ?? "-"}</td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr><td colSpan={13} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>BOM에 실링지·단상자·라벨·설명서가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

/** 자재일정 계산 기준 — 계산은 lib/material-supply.ts(자재수급 PUR-03)와 같다 */
function MaterialHelp({ onClose }: { onClose: () => void }) {
  return (
    <HelpModal title="자재일정 계산 기준" onClose={onClose}>
      <h4>무엇을 보여주나</h4>
      <ul>
        <li>수주마다 <b>실링지 · 단상자 · 라벨 · 설명서</b>가 충분한지, 모자라면 언제 들어오는지입니다.</li>
        <li>계산은 <b>자재수급(PUR-03)</b> 화면과 같습니다. 두 화면 숫자는 항상 같습니다.</li>
      </ul>
      <h4>필요 수량</h4>
      <ul>
        <li>실링지는 실링 부족분, 단상자 · 라벨 · 설명서는 출하부족 기준입니다(순위대로 쌓아 앞 수주가 재고를 먼저 씀).</li>
        <li>소요량 = 필요 수량 × BOM 개당 사용량 × Loss(PUR-03에서 설정)를 올림합니다.</li>
      </ul>
      <h4>상태</h4>
      <ul>
        <li><span className="pill p-grn">충족</span> 현재고(원.부자재창고 · 포장창고 · 조립창고)로 충분</li>
        <li><span className="pill p-amb">10/28</span> 미입고 발주로 채움 — 다 들어오는 날(가장 늦은 입고예정일)</li>
        <li><span className="pill p-red">10/30 납기후</span> 발주로 채우지만 입고예정일이 수주 납기일보다 늦음</li>
        <li><span className="pill p-red">발주필요</span> 미입고 발주로도 모자람</li>
        <li><span className="zero">-</span> 이 수주 모델들의 BOM에 그 자재가 없음</li>
      </ul>
      <h4>참고</h4>
      <ul>
        <li>한 수주에 모델 · 자재가 여럿이면 가장 나쁜 상태로 표시합니다.</li>
        <li>칸을 누르면 모델별 · 자재별 소요량 · 현재고 · 과부족 · 발주번호 · 입고예정일을 볼 수 있습니다.</li>
      </ul>
    </HelpModal>
  );
}

function ItemChangeModal({ line, onClose }: { line: DueOrderLine; onClose: () => void }) {
  const [data, setData] = useState<{ item_code: string; power: number | null; tolerance: number; candidates: ItemChangeCandidate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyLot = async (lot: string) => {
    if (!(await copyText(lot))) return;
    setCopied(lot);
    window.setTimeout(() => setCopied((c) => (c === lot ? null : c)), 1500);
  };

  useEffect(() => {
    let alive = true;
    fetch(`/api/due-orders?swap=${encodeURIComponent(line.item_code)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setData(d))
      .catch(() => alive && setError("품목변경 후보를 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [line.item_code]);

  const total = data?.candidates.reduce((s, c) => s + c.qty, 0) ?? 0;
  const target = line.power == null ? null : -line.power;
  return (
    <>
      <div className="modal-scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" style={{ width: "min(1200px, calc(100% - 32px))" }}>
        <div className="mh">
          <h3>
            <span className="num">{powerText(line.power)}</span> 품목변경 후보
            <span className="num" style={{ fontSize: 12.5, color: "var(--fg-2)", fontWeight: 400 }}>{line.item_code}</span>
            {data && target != null && (
              <small>
                외관검사 도수1~3이 모두 <b className="num">{(target - data.tolerance).toFixed(3)} ~ {(target + data.tolerance).toFixed(3)}</b>(±{data.tolerance}) · 후보 {data.candidates.length}건 ·{" "}
                <span className="pill p-grn">합계 {fmt(total)}</span> · 검사부족 <b className="num">{fmt(line.shorts[2] ?? 0)}</b>
              </small>
            )}
          </h3>
          <button className="x" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="mb">
          {error && <div className="empty"><b>{error}</b></div>}
          {!data && !error && <div className="empty">불러오는 중…</div>}
          {data && (
            <table>
              <thead>
                <tr>
                  <th>현재 도수</th><th>품목코드</th><th>작업지시번호</th><th>LOT No</th><th className="sep">공정(재공)</th><th className="r">수량</th>
                  <th className="r sep" title="외관검사 측정값(부호 없음)">도수1~3</th>
                </tr>
              </thead>
              <tbody>
                {data.candidates.map((c) => (
                  <tr key={`${c.item_code}|${c.wo_no}`}>
                    <td className="num"><b>{powerText(c.power)}</b></td>
                    <td className="num" style={{ fontSize: 12, color: "var(--fg-2)" }}>{c.item_code}</td>
                    <td className="num">{c.wo_no}</td>
                    <td className="num">
                      {c.lot_no ? <button className="cp" onClick={() => copyLot(c.lot_no!)} title="누르면 LOT No가 복사됩니다">{c.lot_no}</button> : "-"}
                      {c.lot_no && copied === c.lot_no && <span className="copied">복사됨</span>}
                    </td>
                    <td className="sep" style={{ fontSize: 12.5 }}>{c.stages.map((s) => `${s.stage} ${fmt(s.qty)}`).join(", ")}</td>
                    <td className="r num">{fmt(c.qty)}</td>
                    <td className="r num sep">{c.samples.map((v) => v.toFixed(2)).join(" / ")}</td>
                  </tr>
                ))}
                {data.candidates.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>허용오차 안에 드는 다른 도수 재공이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function DetailPanel({ soNo, onClose, base, wipOpen, setWipOpen }: { soNo: string; onClose: () => void; base: string; wipOpen: boolean; setWipOpen: (v: boolean) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [changeOf, setChangeOf] = useState<DueOrderLine | null>(null);
  const [colorOf, setColorOf] = useState<DueOrderLine | null>(null);
  const [swapOf, setSwapOf] = useState<DueOrderLine | null>(null);
  const [help, setHelp] = useState<"color" | "dosu" | "swap" | null>(null);

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
    // Esc는 작업지시 목록 창이 열려 있으면 그 창만 닫는다
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (help ? setHelp(null) : swapOf ? setSwapOf(null) : colorOf ? setColorOf(null) : changeOf ? setChangeOf(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, changeOf, colorOf, swapOf, help]);

  const models = useMemo(() => {
    const g = new Map<string, { model: string; name: string | null; n: number; qty: number; wip: number[]; color: number; shipped: number; assy: number; short: number }>();
    for (const l of detail?.lines ?? []) {
      if (l.extra) continue; // 수주에 없는 도수(도수변경 재공 확인용)는 모델 요약에 넣지 않는다
      const x = g.get(l.model) ?? { model: l.model, name: l.item_name, n: 0, qty: 0, wip: STAGES.map(() => 0), color: l.model_color_stock, shipped: 0, assy: 0, short: 0 };
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
  // 도수별 상세 = 수주 도수 + 기본 도수표(0.00 ~ -10.00) — 도수 높은 순(0.00이 위)
  const powers = (detail?.lines ?? [])
    .filter((l) => l.model === model)
    .sort((a, b) => (b.power ?? -99) - (a.power ?? -99) || (a.item_code < b.item_code ? -1 : 1));
  const orderedPowers = powers.filter((l) => !l.extra).length;
  const pw = STAGES.map((_, i) => sum(powers.map((l) => l.wip[i])));

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className={`drawer${detail && model ? " wide" : ""}`} role="dialog" aria-modal="true">
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
                <span>상태 <b>{row.status}</b></span>
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
                    <tr className="h1">
                      <th rowSpan={wipOpen ? 2 : 1}>모델</th><th rowSpan={wipOpen ? 2 : 1}>품목명</th><th className="r" rowSpan={wipOpen ? 2 : 1}>도수 수</th><th className="r" rowSpan={wipOpen ? 2 : 1}>주문량</th><th className="r" rowSpan={wipOpen ? 2 : 1}>착색재고</th>
                      {wipOpen ? (
                        <th className="grp" colSpan={STAGES.length} onClick={() => setWipOpen(false)} title="누르면 공정재공 합계 1칸으로 접습니다">
                          공정재공 (조립 ~ 출하포장) ▾
                        </th>
                      ) : (
                        <th className="r grp" onClick={() => setWipOpen(true)} title="누르면 조립 ~ 출하포장 공정별로 펼칩니다">
                          공정재공 ▸
                        </th>
                      )}
                      <th className="r" rowSpan={wipOpen ? 2 : 1}>출고</th><th className="r" rowSpan={wipOpen ? 2 : 1}>조립투입 필요</th><th className="r" rowSpan={wipOpen ? 2 : 1}>출하부족</th>
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
                    {models.map((m) => (
                      <tr key={m.model} className="row" tabIndex={0} onClick={() => setModel(m.model)} onKeyDown={(e) => e.key === "Enter" && setModel(m.model)}>
                        <td className="so">{m.model}</td>
                        <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }} title={m.name ?? ""}>{m.name ?? ""}</td>
                        <td className="r num">{m.n}</td>
                        <td className="r num">{fmt(m.qty)}</td>
                        <td className="r num"><Z n={m.color} /></td>
                        {wipOpen ? (
                          m.wip.map((v, i) => (<td key={i} className="r num"><Z n={v} /></td>))
                        ) : (
                          <td className="r num"><Z n={sum(m.wip)} /></td>
                        )}
                        <td className="r num"><Z n={m.shipped} /></td>
                        <td className={`r num ${m.assy > 0 ? "need" : ""}`}><Z n={m.assy} /></td>
                        <td className="r num"><Z n={m.short} /></td>
                      </tr>
                    ))}
                    {models.length === 0 && (
                      <tr><td colSpan={wipOpen ? 8 + STAGES.length : 9} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>품목 줄이 없습니다.</td></tr>
                    )}
                    {models.length > 0 && (
                      <tr className="tot">
                        <td colSpan={3}>합계</td>
                        <td className="r num">{fmt(sum(models.map((m) => m.qty)))}</td>
                        <td className="r num">{fmt(sum(models.map((m) => m.color)))}</td>
                        {wipOpen ? (
                          STAGES.map((_, i) => (<td key={i} className="r num">{fmt(sum(models.map((m) => m.wip[i])))}</td>))
                        ) : (
                          <td className="r num">{fmt(sum(models.map((m) => sum(m.wip))))}</td>
                        )}
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
                <span className="num">{model}</span> 도수별 상세 <small>수주 {orderedPowers}개 도수 · 전체 {powers.length}개</small>
                <span className="legend"><i />BASE-01 미사용·미등록</span>
              </h3>
              <div className="tbl-wrap">
                <table className="pwtbl">
                  {/* 열 폭 고정: 도수·품목코드는 내용만큼, 주문량~착색재고 / 조립~출고 / 검사부족~출하부족(품목변경·도수변경 포함 5열)은 묶음끼리 같은 폭 */}
                  <colgroup>
                    <col style={{ width: "4.6%" }} />
                    <col style={{ width: "7.7%" }} />
                    {[0, 1, 2].map((i) => (<col key={`o${i}`} style={{ width: "5.3%" }} />))}
                    {[...STAGES, "기초재고", "출고"].map((s) => (<col key={s} style={{ width: "4%" }} />))}
                    {[0, 1, 2, 3, 4].map((i) => (<col key={`s${i}`} style={{ width: "3.92%" }} />))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>도수</th><th>품목코드</th><th className="r">주문량</th><th className="r">누적주문</th><th className="r"><button className="hh" onClick={() => setHelp("color")} title="누르면 착색재고 계산 기준이 열립니다">착색재고</button></th>
                      {STAGES.map((s) => (<th key={s} className="r">{s}</th>))}
                      <th className="r">기초재고</th><th className="r">출고</th><th className="r">검사부족</th>
                      <th className="r"><button className="hh" onClick={() => setHelp("swap")} title="누르면 품목변경 계산 기준이 열립니다">품목변경</button></th>
                      <th className="r"><button className="hh" onClick={() => setHelp("dosu")} title="누르면 도수변경 계산 기준이 열립니다">도수변경</button></th>
                      <th className="r">조립투입</th><th className="r">출하부족</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powers.map((l) => (
                      <tr
                        key={l.item_code}
                        className={`${l.use_yn !== "Y" ? "off" : ""}${l.extra ? " extra" : ""}`}
                        title={l.use_yn == null ? "BASE-01에 없는 품목코드" : l.use_yn !== "Y" ? "BASE-01 사용여부: 미사용" : l.extra ? "수주에 없는 도수 — 재공·재고만 표시" : undefined}
                      >
                        <td className="num pw">{powerText(l.power)}</td>
                        <td className="num" style={{ fontSize: 12, color: "var(--fg-2)" }}>{l.item_code}</td>
                        <td className="r num"><Z n={l.order_qty} /></td>
                        <td className="r num">{l.extra ? <span className="zero">-</span> : <Z n={l.cum_order} />}</td>
                        <td className="r num">{l.color_stock ? <button className="lnk" onClick={() => setColorOf(l)} title="누르면 착색 현재고(LOT별 무도수용/유도수용)가 열립니다"><Z n={l.color_stock} /></button> : <Z n={l.color_stock} />}</td>
                        {l.wip.map((v, i) => (<td key={i} className="r num"><Z n={v} /></td>))}
                        <td className="r num"><Z n={l.base_stock} /></td>
                        <td className="r num"><Z n={l.shipped} /></td>
                        <td className="r">{l.extra ? <span className="zero">-</span> : l.shorts[2] == null ? <span className="pill p-grn">완료</span> : <span className="num">{fmt(l.shorts[2])}</span>}</td>
                        <td className="r">{l.item_change ? <button className="pill p-grn" onClick={() => setSwapOf(l)} title="누르면 품목변경할 수 있는 다른 도수 재공이 열립니다">{fmt(l.item_change)}</button> : <span className="zero">-</span>}</td>
                        <td className="r">{l.dosu_changes ? <button className="pill p-amb" onClick={() => setChangeOf(l)} title="누르면 최근 1개월 조립 기록이 열립니다(도수변경 건 강조)">{fmt(l.dosu_changes)}건</button> : <span className="zero">-</span>}</td>
                        <td className={`r num ${l.assy_in > 0 ? "need" : ""}`}>{l.extra ? <span className="zero">-</span> : <Z n={l.assy_in} />}</td>
                        <td className="r">{l.extra ? <span className="zero">-</span> : l.shorts[9] == null ? <span className="pill p-grn">완료</span> : <span className="pill p-red">{fmt(l.shorts[9])}</span>}</td>
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
                      {/* 품목변경은 한 재공이 여러 도수의 후보로 잡힐 수 있어 더하지 않는다 */}
                      <td />
                      <td className="r num">{fmt(sum(powers.map((l) => l.dosu_changes ?? 0)))}건</td>
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
      {changeOf && <DosuChangeModal itemCode={changeOf.item_code} power={changeOf.power} onClose={() => setChangeOf(null)} />}
      {help === "color" && <ColorStockHelp onClose={() => setHelp(null)} />}
      {help === "dosu" && <DosuChangeHelp onClose={() => setHelp(null)} />}
      {help === "swap" && <ItemChangeHelp onClose={() => setHelp(null)} />}
      {swapOf && <ItemChangeModal line={swapOf} onClose={() => setSwapOf(null)} />}
      {colorOf && <ColorStockModal model={colorOf.model} power={colorOf.power} onClose={() => setColorOf(null)} />}
    </>
  );
}

// 사용자별 화면 구성(열 순서·숨김·공정재공 펼침) — 계정마다 서버(user_ui_prefs)에 저장돼 다음에 열어도 그대로 나온다.
type Layout = { order: string[]; hidden: string[]; wipOpen: boolean; progOpen: boolean };
const PREF_KEY = "due-orders-grid";
const GRID_KEYS = new Set(GRID_COLS.map((c) => c.key));
const LABELS: Record<string, string> = Object.fromEntries(GRID_COLS.map((c) => [c.key, c.label]));
const RIGHT = new Set(["rank", "qty", "color", "shipped", "assy", "short"]);
// 공정별 진행률 열 이름 = lib/due-orders.ts의 SHORT_NAMES(공정 부족분 10개와 같은 순서)
const STAGE_PROG = ["분리3", "습윤", "검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "완검", "출하"];
const DEFAULT_LAYOUT: Layout = { order: GRID_COLS.map((c) => c.key), hidden: [], wipOpen: false, progOpen: false };

function sanitizeLayout(v: unknown): Layout {
  const o = (v ?? {}) as Partial<Layout>;
  const order = [...new Set((Array.isArray(o.order) ? o.order : []).filter((k): k is string => typeof k === "string" && GRID_KEYS.has(k)))];
  const hidden = (Array.isArray(o.hidden) ? o.hidden : []).filter((k): k is string => typeof k === "string" && GRID_KEYS.has(k));
  // 저장 이후 새로 생긴 열은 기본 순서상 바로 앞 열 뒤에 끼우고(없으면 맨 뒤), 처음엔 기본값(숨김 여부)을 따른다
  GRID_COLS.forEach((c, i) => {
    if (order.includes(c.key)) return;
    const prev = i > 0 ? order.indexOf(GRID_COLS[i - 1].key) : -1;
    order.splice(prev >= 0 ? prev + 1 : order.length, 0, c.key);
    if (DEFAULT_LAYOUT.hidden.includes(c.key) && !hidden.includes(c.key)) hidden.push(c.key);
  });
  return { order, hidden, wipOpen: !!o.wipOpen, progOpen: !!o.progOpen };
}

// 공정별 색 — 진행률 펼침 때 막대와 공정명 머리글에 쓴다(흰 글씨가 읽히는 진한 색)
const STAGE_COLORS = ["#2f6df0", "#0e9aa7", "#7c4dff", "#d6409f", "#e8590c", "#2b9348", "#b8860b", "#8a5a44", "#c92a2a", "#364fc7"];

function PBar({ p, small, color }: { p: number; small?: boolean; color?: string }) {
  const pct = Math.round(p * 100);
  return (
    <div className={`pbar num${small ? " sm" : ""}`} title={`${pct}%`}>
      {p > 0 ? <i className={!color && p < 0.7 ? "mid" : ""} style={{ width: `${pct}%`, ...(color ? { background: `linear-gradient(90deg, ${color}, ${color}bb)` } : {}) }}>{pct}%</i> : <span>0%</span>}
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
  const [dueSoon, setDueSoon] = useTabState("dueOrdDueSoon", false);
  const [hideDone, setHideDone] = useTabState("dueOrdHideDone", true);
  const [selected, setSelected] = useState<string | null>(null);
  const [mats, setMats] = useState<Record<string, OrderMaterials> | null>(null);
  const [matsError, setMatsError] = useState(false);
  const [matOf, setMatOf] = useState<DueOrderRow | null>(null);
  const [matHelp, setMatHelp] = useState(false);

  const [layout, setLayoutState] = useState<Layout>(DEFAULT_LAYOUT);
  const [layoutReady, setLayoutReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/user-prefs?key=${PREF_KEY}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { value: unknown } | null) => {
        if (alive && d?.value) setLayoutState(sanitizeLayout(d.value));
      })
      .catch(() => {})
      .finally(() => alive && setLayoutReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // 바꿀 때마다 잠깐(0.4초) 모았다가 내 계정에 저장한다
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    if (!layoutReady) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/user-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: PREF_KEY, value: next }),
      }).catch(() => {});
    }, 400);
  };
  const resetLayout = () => {
    setLayoutState(DEFAULT_LAYOUT);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    fetch(`/api/user-prefs?key=${PREF_KEY}`, { method: "DELETE" }).catch(() => {});
  };

  const on = (k: string) => !layout.hidden.includes(k);
  const wipOpen = layout.wipOpen;
  const cols = layout.order.filter(on);
  const toggleCol = (k: string) => setLayout({ ...layout, hidden: on(k) ? [...layout.hidden, k] : layout.hidden.filter((c) => c !== k) });
  const moveBy = (k: string, d: -1 | 1) => {
    const i = layout.order.indexOf(k);
    const j = i + d;
    if (i < 0 || j < 0 || j >= layout.order.length) return;
    const order = [...layout.order];
    [order[i], order[j]] = [order[j], order[i]];
    setLayout({ ...layout, order });
  };
  const dropOn = (from: string, to: string) => {
    if (from === to) return;
    const order = layout.order.filter((k) => k !== from);
    const toIdx = order.indexOf(to);
    // 오른쪽으로 끌어다 놓으면 대상 열 뒤로, 왼쪽이면 앞으로
    const after = layout.order.indexOf(from) < layout.order.indexOf(to);
    order.splice(after ? toIdx + 1 : toIdx, 0, from);
    setLayout({ ...layout, order });
  };
  const dnd = (k: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragKey(k);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", k);
    },
    onDragOver: (e: DragEvent) => {
      if (dragKey && dragKey !== k) {
        e.preventDefault();
        setOverKey(k);
      }
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragKey) dropOn(dragKey, k);
      setDragKey(null);
      setOverKey(null);
    },
    onDragEnd: () => {
      setDragKey(null);
      setOverKey(null);
    },
  });

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
  // 자재일정은 자재수급(PUR-03) 계산이라 목록보다 무거워 따로 불러온다(목록 먼저 표시)
  const requestMats = () =>
    fetch("/api/due-orders?materials=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { orders: Record<string, OrderMaterials> }) => {
        setMats(d.orders);
        setMatsError(false);
      })
      .catch(() => setMatsError(true));
  const load = (fresh = false) => {
    setLoading(true);
    request(fresh).then(requestMats);
  };
  useEffect(() => {
    request(false).then(requestMats);
  }, []);
  useEffect(() => {
    if (!matOf && !matHelp) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (matHelp ? setMatHelp(false) : setMatOf(null));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matOf, matHelp]);

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

  const progOpen = layout.progOpen;
  const threeRows = progOpen && on("stageprog"); // 진행률을 펼치면 그룹 / 공정명 / 부족분·진행률 3단 머리글
  const twoRows = threeRows || (wipOpen && on("wip"));
  const rs = threeRows ? 3 : twoRows ? 2 : 1;
  const colCount = cols.reduce((n, k) => n + (k === "wip" && wipOpen ? STAGES.length : k === "stageprog" && progOpen ? STAGE_PROG.length * 2 : 1), 0);
  const dt = (k: string) => (overKey === k ? " dropt" : "");

  const headCell = (k: string) => {
    if (k === "wip") {
      return wipOpen ? (
        <th key={k} {...dnd(k)} className={`grp${dt(k)}`} colSpan={STAGES.length} onClick={() => setLayout({ ...layout, wipOpen: false })} title="누르면 공정재공 합계 1칸으로 접습니다">
          공정재공 (조립 ~ 출하포장) ▾
        </th>
      ) : (
        <th key={k} {...dnd(k)} className={`r grp${dt(k)}`} rowSpan={rs} onClick={() => setLayout({ ...layout, wipOpen: true })} title="누르면 조립 ~ 출하포장 공정별로 펼칩니다">
          공정재공 ▸
        </th>
      );
    }
    if (k === "stageprog") {
      return progOpen ? (
        <th key={k} {...dnd(k)} className={`grp${dt(k)}`} colSpan={STAGE_PROG.length * 2} onClick={() => setLayout({ ...layout, progOpen: false })} title="누르면 출하 진행률 1칸으로 접습니다">
          진행률 (공정별, 공정 부족분 기준) ▾
        </th>
      ) : (
        <th key={k} {...dnd(k)} className={`grp${dt(k)}`} rowSpan={rs} onClick={() => setLayout({ ...layout, progOpen: true })} title="누르면 공정별 진행률로 펼칩니다 (접힌 칸 = 출하 진행률 = (주문량 − 출하부족) ÷ 주문량)">
          진행률 ▸
        </th>
      );
    }
    if (k === "mat") {
      return (
        <th key={k} {...dnd(k)} className={dt(k).trim() || undefined} rowSpan={rs}>
          <button className="hh" onClick={() => setMatHelp(true)} title="누르면 자재일정 계산 기준이 열립니다">{LABELS[k]}</button>
        </th>
      );
    }
    return (
      <th key={k} {...dnd(k)} className={`${RIGHT.has(k) ? "r" : ""}${dt(k)}`.trim() || undefined} rowSpan={rs}>
        {LABELS[k]}
      </th>
    );
  };

  const bodyCell = (k: string, r: DueOrderRow, p: number) => {
    const stagePs = STAGE_PROG.map((_, i) => (r.order_qty > 0 ? Math.max(0, Math.min(1, (r.order_qty - ((r.shorts ?? [])[i] ?? 0)) / r.order_qty)) : 0));
    switch (k) {
      case "rank":
        return <td key={k} className="r num">{r.rank}</td>;
      case "so":
        return <td key={k} className="so">{r.so_no}</td>;
      case "mo":
        return <td key={k} className="num" style={{ fontSize: 12.5 }}>{r.mo_no ?? ""}</td>;
      case "customer":
        return <td key={k}>{r.customer ?? ""}</td>;
      case "brand":
        return <td key={k}>{r.brand ?? ""}</td>;
      case "due":
        return <td key={k}><span className="num">{(r.due_date ?? "").slice(0, 10)}</span> <DueBadge row={r} base={base} /></td>;
      case "status":
        return <td key={k}>{r.status}</td>;
      case "pack":
        return <td key={k}>{r.pack_method ?? ""}</td>;
      case "mat": {
        const m = mats?.[r.so_no];
        if (!m) return <td key={k}><span className="zero">{mats ? "-" : matsError ? "불러오기 실패" : "…"}</span></td>;
        return (
          <td key={k}>
            <button
              className="mat"
              onClick={(e) => {
                e.stopPropagation();
                setMatOf(r);
              }}
              title="누르면 모델별·자재별 상세가 열립니다"
            >
              {MAT_KINDS.map((x) => (
                <span key={x.key} className="mi"><span className="ml">{x.label}</span><MatStatus s={m.kinds[x.key]} /></span>
              ))}
            </button>
          </td>
        );
      }
      case "qty":
        return <td key={k} className="r num">{fmt(r.order_qty)}</td>;
      case "color":
        return <td key={k} className="r num"><Z n={r.color_stock} /></td>;
      case "wip":
        return (
          <Fragment key={k}>
            {wipOpen ? r.wip.map((v, i) => <td key={i} className="r num"><Z n={v} /></td>) : <td className="r num"><Z n={sum(r.wip)} /></td>}
          </Fragment>
        );
      case "shipped":
        return <td key={k} className="r num"><Z n={r.shipped} /></td>;
      case "assy":
        return <td key={k} className={`r num ${r.assy_in > 0 ? "need" : ""}`}><Z n={r.assy_in} /></td>;
      case "short":
        return <td key={k} className="r num"><Z n={r.ship_short} /></td>;
      case "stageprog":
        return (
          <Fragment key={k}>
            {progOpen ? stagePs.map((v, i) => (
              <Fragment key={i}>
                <td className="r num"><Z n={(r.shorts ?? [])[i] ?? 0} /></td>
                <td><PBar small p={v} color={STAGE_COLORS[i]} /></td>
              </Fragment>
            )) : <td><PBar p={p} /></td>}
          </Fragment>
        );
      case "open":
        return <td key={k}><span className="pill p-grn">열기</span></td>;
      default:
        return null;
    }
  };

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
        <div className="picker">
          <button className="chip" aria-pressed={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>
            표시 항목 {GRID_COLS.length - layout.hidden.length}/{GRID_COLS.length} ▾
          </button>
          {pickerOpen && (
            <>
              <div className="pop-scrim" onClick={() => setPickerOpen(false)} />
              <div className="pop" role="menu">
                <div className="acts">
                  <button className="chip" onClick={() => setLayout({ ...layout, hidden: [] })}>전체 선택</button>
                  <button className="chip" onClick={() => setLayout({ ...layout, hidden: GRID_COLS.map((c) => c.key).filter((k) => k !== "so") })}>전체 해제</button>
                  <button className="chip" onClick={resetLayout}>기본값</button>
                </div>
                {layout.order.map((k, i) => (
                  <label key={k}>
                    <input type="checkbox" checked={on(k)} onChange={() => toggleCol(k)} />
                    <span style={{ flex: 1 }}>{LABELS[k]}</span>
                    <button type="button" className="mv" disabled={i === 0} onClick={(e) => { e.preventDefault(); moveBy(k, -1); }} aria-label="위로">↑</button>
                    <button type="button" className="mv" disabled={i === layout.order.length - 1} onClick={(e) => { e.preventDefault(); moveBy(k, 1); }} aria-label="아래로">↓</button>
                  </label>
                ))}
                <div className="hint">머리글을 끌어서 순서를 바꿀 수 있고, 바꾼 구성은 내 계정에 자동 저장돼 다음에도 그대로 나옵니다.</div>
              </div>
            </>
          )}
        </div>
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
              <tr className="h1">{cols.map(headCell)}</tr>
              {twoRows && (
                <tr className={`h2${threeRows ? " tall" : ""}`}>
                  {cols.flatMap((k) =>
                    k === "wip" && wipOpen
                      ? STAGES.map((s) => <th key={`w-${s}`} className="r" rowSpan={threeRows ? 2 : 1}>{s}</th>)
                      : k === "stageprog" && progOpen
                        ? STAGE_PROG.map((s, i) => <th key={`p-${s}`} className="grp2" colSpan={2} style={{ color: STAGE_COLORS[i], boxShadow: `inset 0 -3px 0 ${STAGE_COLORS[i]}` }}>{s}</th>)
                        : []
                  )}
                </tr>
              )}
              {threeRows && (
                <tr className="h3">
                  {cols.flatMap((k) =>
                    k === "stageprog"
                      ? STAGE_PROG.flatMap((s) => [<th key={`s-${s}`} className="r">부족분</th>, <th key={`g-${s}`}>진행률</th>])
                      : []
                  )}
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
                    {cols.map((k) => bodyCell(k, r, p))}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={Math.max(colCount, 1)} style={{ textAlign: "center", padding: 24, color: "var(--fg-3)" }}>조건에 맞는 수주가 없습니다. 필터를 해제해 보세요.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="note">
        엑셀 수주별 시트 계산식과 같습니다: 공정 부족분 = 누적주문 − 기초재고(제품창고A+조립창고) − 누적출고 − 다음 공정~출하포장 재공,
        조립투입 = 검사부족분 ÷ 직진율 − 조립 − 분리3 − 습윤 − 외관검사×108%(60 단위 올림). 공정재공은 품목코드 기준이라 같은 품목을 가진 수주에 똑같이 보입니다.
        진행률 = (주문량 − 출하부족) ÷ 주문량, 공정별 진행률 = (주문량 − 그 공정 부족분) ÷ 주문량입니다.
        순위는 납기일 → 생산순위지정(PLAN-01) 작업순서 순입니다.
        도수별 상세의 도수변경 = 최근 1개월(조립일자 기준) 그 도수로 변경되어 조립된 작업지시 건수입니다.
      </p>

      {matHelp && <MaterialHelp onClose={() => setMatHelp(false)} />}
      {matOf && <MaterialModal row={matOf} mats={mats?.[matOf.so_no]} onClose={() => setMatOf(null)} />}
      {selected && (
        <DetailPanel
          key={selected}
          soNo={selected}
          onClose={() => setSelected(null)}
          base={base}
          wipOpen={wipOpen}
          setWipOpen={(v) => setLayout({ ...layout, wipOpen: v })}
        />
      )}
    </div>
  );
}
