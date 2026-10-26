"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";

// Packing List(SALES-04) 출하LOT 탭 — PLAN-04 납기별수주현황처럼 수주 줄(순위 순)에 MO별 출하LOT을 붙여 보여주고,
// 줄을 누르면 그 수주에 출하LOT을 발행한다(배포는 엑셀). 2026-10-26부터 기준은 MO가 아니라 수주번호(SO). 규칙은 lib/ship-lot.ts.
// 맨 앞 체크박스로 여러 수주를 골라 같은 발행 창에서 한 번에 발행할 수도 있다(2026-10-26) — 생산일자·출하LOT 하나, 국가·담당자·표기는 MO별.
// 발행하면 라벨일정(PROC-06) 출하LOT·생산일자가 이 값으로 바뀐다.

type DateFmt = "ym" | "ymd";
type SoItem = {
  rep_item: string; mos: string[]; model_name: string; shelf_years: number | null; lot_no: string; prod_date: string;
  date_fmt: DateFmt; rule_fmt: DateFmt; issued_by: string; issued_at: string;
};
type SoDetail = { so_no: string; mo_nos: string[]; customer: string; country: string; sales_manager: string; issued: boolean; items: SoItem[] };
type GridRow = {
  rank: number; done: boolean; so_no: string; mo_no: string; customer: string; brand: string; order_qty: number; due_date: string;
  issued: boolean; lot_no: string; label_lot: string; prod_text: string; expiry_text: string; country: string; sales_manager: string;
  issued_by: string; issued_at: string;
};
type Rule = { country: string; model_name: string; date_fmt: DateFmt };

const FMT_LABEL: Record<DateFmt, string> = { ymd: "제조년월일", ym: "제조년월" };
const MONTH_CODE = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C"];
const prefixOf = (d: string) => (/^\d{4}-\d{2}/.test(d) ? `${Number(d.slice(0, 4)) % 10}${MONTH_CODE[Number(d.slice(5, 7)) - 1]}` : "");
const today = () => new Date().toLocaleDateString("sv-SE");
const fmtN = (n: number) => n.toLocaleString("ko-KR");
function expiryOf(prod: string, years: number | null, fmt: DateFmt): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prod) || !years) return "";
  const [y, m, d] = prod.split("-").map(Number);
  if (fmt === "ym") {
    const idx = y * 12 + m - 1 + years * 12 - 1;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  }
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  const t = new Date(Date.UTC(y + years, m - 1, Math.min(d, last)));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `요청 실패 (${r.status})`);
  return d as T;
}

const API = "/api/packing-list/ship-lot";
const inp = "border border-slate-300 rounded px-1.5 py-0.5 text-[13px] bg-white disabled:bg-slate-50 disabled:text-slate-500";
const btn = "px-3 py-1.5 text-[13px] rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50";
const btnMain = "px-3 py-1.5 text-[13px] rounded bg-navy text-white hover:opacity-90 disabled:opacity-50";
const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-md border text-[13px] transition-colors ${on ? "border-navy bg-navy/5 text-navy font-medium" : "border-slate-300 bg-white text-slate-600 hover:border-navy"}`;
const HEADS: { label: string; r?: boolean }[] = [
  { label: "순위", r: true }, { label: "수주번호" }, { label: "MO번호" }, { label: "고객사" }, { label: "브랜드" }, { label: "주문량", r: true },
  { label: "납기일자" }, { label: "출하LOT" }, { label: "제조일자" }, { label: "사용기한" }, { label: "국가" }, { label: "영업담당자" },
  { label: "배포자" }, { label: "배포일시" },
];

export default function ShipLotTab() {
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [q, setQ] = useTabState("slSearch", "");
  const [unissued, setUnissued] = useTabState("slUnissued", false);
  const [hideDone, setHideDone] = useTabState("slHideDone", true);
  const [selSos, setSelSos] = useState<string[] | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    call<{ rows: GridRow[] }>(API)
      .then((r) => setRows(r.rows))
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!hideDone || !r.done) &&
        (!unissued || !r.issued) &&
        (!kw || [r.so_no, r.mo_no, r.customer, r.brand, r.lot_no, r.label_lot, r.country, r.sales_manager, r.issued_by].some((v) => v.toLowerCase().includes(kw)))
    );
  }, [rows, q, unissued, hideDone]);
  const issuedCount = (rows ?? []).filter((r) => !r.done && r.issued).length;
  const openCount = (rows ?? []).filter((r) => !r.done).length;
  const exportUrl = `${API}/export?q=${encodeURIComponent(q)}${unissued ? "&unissued=1" : ""}${hideDone ? "&hideDone=1" : ""}`;

  // 체크는 수주 단위. 고른 순서 = 화면 순서
  const visibleSos = useMemo(() => visible.map((r) => r.so_no), [visible]);
  const allChecked = visibleSos.length > 0 && visibleSos.every((m) => checked.has(m));
  const toggle = (mo: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(mo)) next.delete(mo);
      else next.add(mo);
      return next;
    });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(visibleSos));
  const bulkSos = (rows ?? []).map((r) => r.so_no).filter((m) => checked.has(m));

  return (
    <div className="px-4 sm:px-6 py-4 space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inp} w-72 py-1.5`} placeholder="수주번호 · MO · 고객사 · 브랜드 · 출하LOT · 국가 · 담당자" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={chip(unissued)} aria-pressed={unissued} onClick={() => setUnissued(!unissued)}>미발행만</button>
        <button className={chip(hideDone)} aria-pressed={hideDone} onClick={() => setHideDone(!hideDone)}>출하 완료 숨기기</button>
        <span className="text-slate-500 ml-2">진행 수주 {fmtN(openCount)}건 · 발행 {fmtN(issuedCount)}건 · 표시 {fmtN(visible.length)}건</span>
        <button className={`${btn} ml-auto`} onClick={() => setRulesOpen(true)}>생산일자 표기 규칙</button>
        <a className={btn} href={exportUrl}>엑셀 (배포용)</a>
      </div>
      {checked.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-navy/30 bg-navy/5">
          <span className="text-navy font-medium">수주 {fmtN(checked.size)}건 선택</span>
          <button className={btnMain} onClick={() => setSelSos(bulkSos)}>선택한 수주 발행</button>
          <button className={btn} onClick={() => setChecked(new Set())}>선택 해제</button>
        </div>
      )}
      {err && <div className="px-3 py-2 rounded bg-red-50 text-red-700">{err}</div>}
      <div className="border border-slate-200 rounded bg-white overflow-auto max-h-[calc(100vh-260px)]">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
            <tr>
              <th className="px-2 py-2 border-b border-slate-200 w-8">
                <input type="checkbox" checked={allChecked} disabled={visibleSos.length === 0} onChange={toggleAll} title="보이는 수주 전체 선택" />
              </th>
              {HEADS.map((h) => (
                <th key={h.label} className={`px-2 py-2 whitespace-nowrap font-semibold border-b border-slate-200 ${h.r ? "text-right" : "text-left"}`}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!rows && !err && <tr><td colSpan={HEADS.length + 1} className="p-6 text-center text-slate-400">불러오는 중…</td></tr>}
            {visible.map((r) => (
              <tr
                key={r.so_no}
                className={`border-t border-slate-100 cursor-pointer hover:bg-[#dce7ff] ${r.done ? "text-slate-400" : ""}`}
                onClick={() => setSelSos([r.so_no])}
                title="누르면 이 수주에 출하LOT을 발행합니다"
              >
                <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked.has(r.so_no)} onChange={() => toggle(r.so_no)} />
                </td>
                <td className="px-2 py-1.5 text-right">{r.done ? <span className="text-[11px] px-1.5 rounded bg-slate-100">완료</span> : r.rank}</td>
                <td className="px-2 py-1.5 font-mono text-[12.5px] text-[#2457d6]">{r.so_no}</td>
                <td className="px-2 py-1.5 font-mono text-[12.5px]">{r.mo_no || "-"}</td>
                <td className="px-2 py-1.5 truncate max-w-[200px]" title={r.customer}>{r.customer}</td>
                <td className="px-2 py-1.5 truncate max-w-[180px]" title={r.brand}>{r.brand}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmtN(r.order_qty)}</td>
                <td className="px-2 py-1.5 font-mono">{r.due_date || "-"}</td>
                <td className="px-2 py-1.5 font-mono font-semibold">
                  {r.issued ? (
                    <span className="px-1.5 rounded bg-green-100 text-green-700">{r.lot_no}</span>
                  ) : r.label_lot ? (
                    <span className="text-slate-400 font-normal" title="미발행 — 라벨일정(PROC-06)에 적혀 있는 값">{r.label_lot}</span>
                  ) : (
                    <span className="text-[11px] font-normal text-amber-600">미발행</span>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono">{r.prod_text}</td>
                <td className="px-2 py-1.5 font-mono">{r.expiry_text}</td>
                <td className="px-2 py-1.5">{r.country}</td>
                <td className="px-2 py-1.5">{r.sales_manager}</td>
                <td className="px-2 py-1.5">{r.issued_by}</td>
                <td className="px-2 py-1.5 font-mono text-slate-500">{r.issued_at}</td>
              </tr>
            ))}
            {rows && visible.length === 0 && <tr><td colSpan={HEADS.length + 1} className="p-6 text-center text-slate-400">표시할 수주가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {selSos && (
        <IssueModal
          soNos={selSos}
          onClose={() => {
            if (selSos.length > 1) setChecked(new Set());
            setSelSos(null);
          }}
          onDone={load}
        />
      )}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

/**
 * 출하LOT 발행 창 — 줄을 누르면 그 수주 하나, 체크한 뒤 "선택한 수주 발행"을 누르면 고른 수주 여러 개를 한 창에서(2026-10-26).
 * 생산일자·출하LOT은 하나(같이 출하), 국가·영업담당자·제조일자 표기는 수주별로 고친다.
 * 기본값: 발행했으면 발행 값, 아니면 라벨일정 출하LOT·생산일자(없으면 오늘)·거래처 국가·수주 등록자
 */
function IssueModal({ soNos, onClose, onDone }: { soNos: string[]; onClose: () => void; onDone: () => void }) {
  const multi = soNos.length > 1;
  const [ds, setDs] = useState<SoDetail[] | null>(null);
  const [prod, setProd] = useState(today());
  const [lot, setLot] = useState("");
  const [lots, setLots] = useState<{ lots: { lot_no: string; sos: string }[]; next: string }>({ lots: [], next: "" });
  // 수주별 국가·영업담당자, 수주|대표품목별 표기
  const [meta, setMeta] = useState<Record<string, { country: string; manager: string }>>({});
  const [fmts, setFmts] = useState<Record<string, DateFmt>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const key = soNos.join(",");

  const applyDetails = (list: SoDetail[]) => {
    setDs(list);
    const first = list.flatMap((m) => m.items).find((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.prod_date));
    setProd(first?.prod_date ?? today());
    setLot(first?.lot_no ?? list[0]?.items[0]?.lot_no ?? ""); // 미발행이어도 라벨일정에 적혀 있던 출하LOT이 그 달 것이면 그대로
    setMeta(Object.fromEntries(list.map((m) => [m.so_no, { country: m.country, manager: m.sales_manager }])));
    setFmts(Object.fromEntries(list.flatMap((m) => m.items.map((i) => [`${m.so_no}|${i.rep_item}`, i.date_fmt]))));
  };
  const fetchAll = (sos: string[]) => Promise.all(sos.map((so) => call<SoDetail>(`${API}?so=${encodeURIComponent(so)}`)));
  useEffect(() => {
    let alive = true;
    fetchAll(key.split(","))
      .then((list) => alive && applyDetails(list))
      .catch((e) => alive && setMsg({ ok: false, text: e.message }));
    return () => {
      alive = false;
    };
  }, [key]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // 생산일자 월이 바뀌거나 MO를 새로 불러오면 그 달 출하LOT 목록과 다음 차수 — 고른 LOT이 그 달 것이 아니면(빈 값 포함) 다음 차수로
  const prefix = prefixOf(prod);
  useEffect(() => {
    if (!prefix) return;
    let alive = true;
    call<{ lots: { lot_no: string; sos: string }[]; next: string }>(`${API}?prefix=${prefix}`).then((r) => {
      if (!alive) return;
      setLots(r);
      setLot((cur) => (cur.startsWith(prefix) ? cur : r.next));
    });
    return () => {
      alive = false;
    };
  }, [prefix, ds]);

  const run = async (f: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      setMsg({ ok: true, text: ok });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const fmtsOf = (m: SoDetail) => Object.fromEntries(m.items.map((i) => [i.rep_item, fmts[`${m.so_no}|${i.rep_item}`] ?? i.date_fmt]));
  const issue = () =>
    ds &&
    run(async () => {
      if (!multi) {
        const m = ds[0];
        const r = await call<SoDetail>(API, {
          method: "POST",
          body: JSON.stringify({ so_no: m.so_no, lot_no: lot, prod_date: prod, country: meta[m.so_no]?.country ?? "", sales_manager: meta[m.so_no]?.manager ?? "", fmts: fmtsOf(m) }),
        });
        applyDetails([r]);
        return;
      }
      const per = Object.fromEntries(ds.map((m) => [m.so_no, { country: meta[m.so_no]?.country ?? "", sales_manager: meta[m.so_no]?.manager ?? "", fmts: fmtsOf(m) }]));
      await call(API, { method: "POST", body: JSON.stringify({ bulk: { so_nos: soNos, prod_date: prod, mode: "same", lot_no: lot, reissue: true, per } }) });
      applyDetails(await fetchAll(soNos));
    }, `${multi ? `수주 ${soNos.length}건에 ` : ""}${lot} 발행했습니다. 라벨일정(PROC-06) 출하LOT·생산일자도 바뀌었습니다.`);
  const cancel = () =>
    ds &&
    !multi &&
    run(async () => {
      await call(`${API}?so=${encodeURIComponent(ds[0].so_no)}`, { method: "DELETE" });
      applyDetails(await fetchAll(soNos));
    }, "발행을 취소했습니다(라벨일정은 발행 전 값으로).");

  const lotChoices = [...new Set([lots.next, ...lots.lots.map((l) => l.lot_no), lot].filter(Boolean))];
  const d = ds?.[0];
  const anyIssued = !!ds?.some((m) => m.issued);
  const setMoMeta = (mo: string, k: "country" | "manager", v: string) => setMeta((cur) => ({ ...cur, [mo]: { ...cur[mo], [k]: v } }));
  const statusPill = (m: SoDetail) =>
    m.issued ? (
      <span className="px-2 rounded text-[12px] bg-green-100 text-green-700">발행됨 · {m.items[0]?.issued_by} {m.items[0]?.issued_at.slice(0, 16)}</span>
    ) : (
      <span className="px-2 rounded text-[12px] bg-amber-100 text-amber-700">미발행</span>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className={`bg-white rounded shadow-xl ${multi ? "w-[1000px]" : "w-[860px]"} max-w-[95vw] max-h-[85vh] flex flex-col text-[13px]`} onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1">
          {multi ? (
            <>
              <b>출하LOT 발행</b>
              <span className="text-slate-600">선택한 수주 {fmtN(soNos.length)}건</span>
              {ds && <span className="text-slate-500">발행됨 {fmtN(ds.filter((m) => m.issued).length)} · 미발행 {fmtN(ds.filter((m) => !m.issued).length)}</span>}
            </>
          ) : (
            <>
              <b className="font-mono">{soNos[0]}</b>
              {d && <span className="font-mono text-slate-600">{d.mo_nos.join(", ") || "MO 없음"}</span>}
              {d && <span>{d.customer}</span>}
              {d && statusPill(d)}
            </>
          )}
          <button className="ml-auto text-slate-400 hover:text-slate-700 text-lg" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {msg && <div className={`px-3 py-2 rounded ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
          {!ds && !msg && <div className="text-slate-400">불러오는 중…</div>}
          {ds && d && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1 whitespace-nowrap">생산일자
                  <input type="date" className={inp} value={prod} onChange={(e) => setProd(e.target.value)} />
                </label>
                <label className="flex items-center gap-1 whitespace-nowrap" title="연도 끝자리 + 월(1~9, A=10월, B=11월, C=12월) + 출하차수 — 같은 달 다른 MO와 같은 LOT을 고르면 같이 출하">
                  출하LOT
                  <select className={`${inp} font-mono w-auto max-w-[220px]`} value={lot} onChange={(e) => setLot(e.target.value)}>
                    {lotChoices.map((l) => {
                      const used = lots.lots.find((x) => x.lot_no === l);
                      return (
                        <option key={l} value={l}>
                          {l}{l === lots.next ? " (새 차수)" : used ? (used.sos ? ` (수주 ${used.sos.split(",").length}건)` : " (라벨일정)") : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {!multi && (
                  <>
                    <label className="flex items-center gap-1 whitespace-nowrap">국가
                      <input className={`${inp} w-28`} value={meta[d.so_no]?.country ?? ""} onChange={(e) => setMoMeta(d.so_no, "country", e.target.value)} />
                    </label>
                    <label className="flex items-center gap-1 whitespace-nowrap">영업담당자
                      <input className={`${inp} w-28`} value={meta[d.so_no]?.manager ?? ""} onChange={(e) => setMoMeta(d.so_no, "manager", e.target.value)} />
                    </label>
                  </>
                )}
              </div>
              <table className="w-full">
                <thead className="bg-slate-50 text-slate-600 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">대표품목</th><th className="px-2 py-1 text-left">형명</th><th className="px-2 py-1">유효기간(년)</th>
                    <th className="px-2 py-1">제조일자 표기</th><th className="px-2 py-1">출하LOT</th><th className="px-2 py-1">제조일자</th><th className="px-2 py-1">사용기한</th>
                  </tr>
                </thead>
                {ds.map((m) => (
                  <tbody key={m.so_no}>
                    {multi && (
                      <tr className="border-t-2 border-slate-300 bg-slate-50/70">
                        <td colSpan={7} className="px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <b className="font-mono">{m.so_no}</b>
                            <span className="font-mono text-slate-600">{m.mo_nos.join(", ") || "MO 없음"}</span>
                            <span className="truncate max-w-[220px]" title={m.customer}>{m.customer}</span>
                            {statusPill(m)}
                            <label className="flex items-center gap-1 whitespace-nowrap ml-auto">국가
                              <input className={`${inp} w-24`} value={meta[m.so_no]?.country ?? ""} onChange={(e) => setMoMeta(m.so_no, "country", e.target.value)} />
                            </label>
                            <label className="flex items-center gap-1 whitespace-nowrap">영업담당자
                              <input className={`${inp} w-24`} value={meta[m.so_no]?.manager ?? ""} onChange={(e) => setMoMeta(m.so_no, "manager", e.target.value)} />
                            </label>
                          </div>
                        </td>
                      </tr>
                    )}
                    {m.items.map((it) => {
                      const fk = `${m.so_no}|${it.rep_item}`;
                      const fmt = fmts[fk] ?? it.date_fmt;
                      return (
                        <tr key={it.rep_item} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-mono">{it.rep_item}</td>
                          <td className="px-2 py-1">{it.model_name || <span className="text-slate-400">형명 없음</span>}</td>
                          <td className="px-2 py-1 text-center">{it.shelf_years ?? <span className="text-red-600">미등록</span>}</td>
                          <td className="px-2 py-1 text-center">
                            <select className={`${inp} w-auto`} value={fmt} onChange={(e) => setFmts((f) => ({ ...f, [fk]: e.target.value as DateFmt }))}>
                              {(["ymd", "ym"] as const).map((k) => (
                                <option key={k} value={k}>{FMT_LABEL[k]}{k === it.rule_fmt ? " (규칙)" : ""}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1 text-center font-mono">{lot}</td>
                          <td className="px-2 py-1 text-center font-mono">{fmt === "ym" ? prod.slice(0, 7) : prod}</td>
                          <td className="px-2 py-1 text-center font-mono">{expiryOf(prod, it.shelf_years, fmt) || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
              <div className="text-slate-500">
                사용기한 = 제조년월일: 제조일자 + 유효기간 − 1일 / 제조년월: 제조 월 + 유효기간 − 1개월. 유효기간은 공통정보(BASE-10) 형명 표.
                발행하면 라벨일정(PROC-06) 출하LOT·생산일자가 이 값으로 바뀝니다.
                {multi && " 여러 MO는 한 번에 처리되어, 하나라도 발행하지 못하면 모두 취소됩니다."}
              </div>
            </>
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-2">
          {!multi && d?.issued && <button className={btn} disabled={busy} onClick={cancel}>발행 취소</button>}
          <button className={`${btn} ml-auto`} onClick={onClose}>닫기</button>
          <button className={btnMain} disabled={busy || !ds || !lot || !prod} onClick={issue}>
            {multi ? `${fmtN(soNos.length)}건 ${anyIssued ? "발행(다시 발행 포함)" : "발행"}` : d?.issued ? "다시 발행" : "발행"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 생산일자 표기 규칙 — 국가별(형명 비움) 또는 국가×형명별로 제조년월 / 제조년월일. 형명 규칙이 국가 규칙보다 먼저, 없으면 제조년월일 */
function RulesModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ rules: Rule[]; countries: string[]; models: string[] } | null>(null);
  const [add, setAdd] = useState<Rule>({ country: "", model_name: "", date_fmt: "ym" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    call<{ rules: Rule[]; countries: string[]; models: string[] }>(`${API}?rules=1`).then(setData).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const save = async (r: Rule) => {
    setErr(null);
    try {
      const res = await call<{ rules: Rule[] }>(API, { method: "PUT", body: JSON.stringify(r) });
      setData((d) => (d ? { ...d, rules: res.rules } : d));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const del = async (r: Rule) => {
    const res = await call<{ rules: Rule[] }>(`${API}?rule_country=${encodeURIComponent(r.country)}&rule_model=${encodeURIComponent(r.model_name)}`, { method: "DELETE" });
    setData((d) => (d ? { ...d, rules: res.rules } : d));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded shadow-xl w-[640px] max-h-[80vh] flex flex-col text-[13px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center">
          <b>생산일자 표기 규칙</b>
          <button className="ml-auto text-slate-400 hover:text-slate-700 text-lg" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="px-4 py-2 text-slate-500">
          국가만 정하면 그 나라 모든 형명, 형명까지 정하면 그 형명만. 형명 규칙이 먼저이고, 규칙이 없으면 제조년월일입니다. 이미 발행한 줄은 바뀌지 않습니다(다시 발행하면 적용).
        </div>
        {err && <div className="mx-4 mb-2 px-3 py-2 rounded bg-red-50 text-red-700">{err}</div>}
        <div className="px-4 pb-2 flex flex-wrap items-center gap-2">
          <select className={inp} value={add.country} onChange={(e) => setAdd({ ...add, country: e.target.value })}>
            <option value="">국가 선택</option>
            {data?.countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={inp} value={add.model_name} onChange={(e) => setAdd({ ...add, model_name: e.target.value })}>
            <option value="">(모든 형명)</option>
            {data?.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className={inp} value={add.date_fmt} onChange={(e) => setAdd({ ...add, date_fmt: e.target.value as DateFmt })}>
            <option value="ym">제조년월</option>
            <option value="ymd">제조년월일</option>
          </select>
          <button className={btnMain} disabled={!add.country} onClick={() => save(add)}>추가 · 변경</button>
        </div>
        <div className="overflow-y-auto px-4 pb-4">
          <table className="w-full">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2 py-1 text-left">국가</th><th className="px-2 py-1 text-left">형명</th><th className="px-2 py-1 text-left">표기</th><th /></tr></thead>
            <tbody>
              {data?.rules.map((r) => (
                <tr key={`${r.country}|${r.model_name}`} className="border-t border-slate-100">
                  <td className="px-2 py-1">{r.country}</td>
                  <td className="px-2 py-1">{r.model_name || <span className="text-slate-400">모든 형명</span>}</td>
                  <td className="px-2 py-1">{FMT_LABEL[r.date_fmt]}</td>
                  <td className="px-2 py-1 text-right"><button className="text-slate-400 hover:text-red-600" onClick={() => del(r)}>삭제</button></td>
                </tr>
              ))}
              {data?.rules.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-slate-400">규칙이 없습니다 — 모두 제조년월일로 표기합니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
