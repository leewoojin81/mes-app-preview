"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BlisterLot, NcrRecord, SupplyLot } from "@/lib/qc-incoming-shared";
import { NCR_DISPOSITIONS, NCR_MANUAL_KINDS, NCR_STATUS } from "@/lib/qc-incoming-shared";
import { buildNcrItems, inSeg, prt, REP_HEADERS, repData, repRows, repTot, type NcrItem, type Seg } from "./ncr-logic";
import { downloadXlsx, n } from "./qc-utils";

// 부적합 탭 — 입고검사 대시보드의 "부적합 관리대장"과 같은 기능:
// 부적합률 10% 이상 로트(부자재·블리스터)가 자동으로 모이고, 줄을 누르면 처리구분·상태·조치일·담당자·원인·조치내용을 기록한다.
// 구분(전체/부자재/블리스터) · 요약 카드 · 검색/필터 · 일괄 상태 변경 · 로트 직접 추가 · 보고 보기(월별·자재별·불량추이, 인쇄) · 엑셀 내려받기.
const SHOW_STEP = 100;
const ST_BADGE: Record<string, string> = {
  미처리: "bg-rose-100 text-rose-700",
  진행중: "bg-amber-100 text-amber-700",
  완료: "bg-emerald-100 text-emerald-700",
};
const SERIES_COLORS = ["#4f7cc4", "#e0913a", "#4daa7c", "#8e6bbf", "#d9534f"];

export default function NcrTab() {
  const [lots, setLots] = useState<SupplyLot[]>([]);
  const [blister, setBlister] = useState<BlisterLot[]>([]);
  const [records, setRecords] = useState<NcrRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [view, setView] = useState<"" | "R">("");
  const [seg, setSeg] = useState<Seg>("");
  const [q, setQ] = useState("");
  const [fm, setFm] = useState("");
  const [fk, setFk] = useState("");
  const [fs, setFs] = useState("");
  const [show, setShow] = useState(SHOW_STEP);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState<NcrItem | null>(null);
  const [adding, setAdding] = useState(false);

  const [bDisp, setBDisp] = useState("");
  const [bDate, setBDate] = useState("");
  const [pendingSt, setPendingSt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/qc-incoming/ncr", { cache: "no-store" });
    const d = await res.json();
    setLots(d.lots ?? []);
    setBlister(d.blister ?? []);
    setRecords(d.records ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const recMap = useMemo(() => new Map(records.map((r) => [r.k, r])), [records]);
  const stOf = useCallback((k: string) => recMap.get(k)?.st || "미처리", [recMap]);
  const items = useMemo(() => buildNcrItems(lots, blister, records), [lots, blister, records]);

  // 목록에서 사라진 항목은 선택에서 뺀다
  useEffect(() => {
    setSel((s) => {
      const keys = new Set(items.map((i) => i.k));
      const nx = new Set([...s].filter((k) => keys.has(k)));
      return nx.size === s.size ? s : nx;
    });
  }, [items]);

  const segItems = useMemo(() => items.filter((it) => inSeg(it, seg)), [items, seg]);
  const monthOptions = useMemo(
    () => Array.from(new Set(segItems.map((it) => Number(it.date.slice(5, 7))).filter(Boolean))).sort((a, b) => a - b),
    [segItems]
  );
  const kindOptions = useMemo(() => Array.from(new Set(segItems.map((it) => it.kind))).sort(), [segItems]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return segItems.filter((it) => {
      const r = recMap.get(it.k);
      if (fm && String(Number(it.date.slice(5, 7))) !== fm) return false;
      if (fk && it.kind !== fk) return false;
      if (fs && stOf(it.k) !== fs) return false;
      if (k && `${it.lot} ${it.code} ${it.name} ${it.sup} ${it.defs} ${r?.cause ?? ""} ${r?.act ?? ""}`.toLowerCase().indexOf(k) < 0) return false;
      return true;
    });
  }, [segItems, q, fm, fk, fs, recMap, stOf]);

  useEffect(() => setShow(SHOW_STEP), [q, fm, fk, fs, seg]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { 미처리: 0, 진행중: 0, 완료: 0 };
    segItems.forEach((it) => c[stOf(it.k)]++);
    return c;
  }, [segItems, stOf]);
  const nBlister = items.filter((it) => it.kind === "블리스터").length;

  const visible = filtered.slice(0, show);
  const inFilterSel = filtered.filter((it) => sel.has(it.k)).length;
  const allSel = filtered.length > 0 && inFilterSel === filtered.length;

  function toggleAll(on: boolean) {
    setSel((s) => {
      const nx = new Set(s);
      filtered.forEach((it) => (on ? nx.add(it.k) : nx.delete(it.k)));
      return nx;
    });
  }

  async function runBulk(st: string) {
    const keys = Array.from(sel);
    if (keys.length === 0) return;
    setBusy(true);
    setPendingSt(null);
    setMsg(`처리 중… (${keys.length}건)`);
    const res = await fetch("/api/qc-incoming/ncr/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys, st, disp: bDisp, adate: bDate }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg((d.error ?? "저장하지 못했습니다.") + " 선택이 남아 있으니 다시 시도하세요.");
      return;
    }
    setMsg(`${d.count}건을 '${st}'(으)로 변경했습니다.`);
    setSel(new Set());
    await load();
  }

  function exportLedger() {
    const head = ["번호", "일자", "구분", "Lot No.", "자재코드", "품목코드", "품명", "공급사", "검사수량", "부적합수량", "부적합률(%)", "불량내용", "처리구분", "상태", "조치일", "담당자", "원인", "조치내용"];
    const rows = filtered.map((it) => {
      const r = recMap.get(it.k);
      return [it.no, it.date, it.kind, it.lot, it.code, it.item || "", it.name, it.sup, it.insp, it.bad, Math.round(it.rate * 10000) / 100, it.defs, r?.disp ?? "", stOf(it.k), r?.adate ?? "", r?.who ?? "", r?.cause ?? "", r?.act ?? ""];
    });
    downloadXlsx("부적합관리대장", [["부적합관리대장(10%이상)", [head, ...rows]]]);
  }

  const R = useMemo(() => (view === "R" ? repData(seg, lots, blister, items, stOf) : null), [view, seg, lots, blister, items, stOf]);
  const segLabel = seg === "B" ? "블리스터" : seg === "M" ? "부자재(블리스터 제외)" : "전체(부자재+블리스터)";

  function exportReport() {
    if (!R) return;
    const hd = (f: string) => [f, ...REP_HEADERS];
    downloadXlsx(`부적합현황보고_${seg === "B" ? "블리스터" : seg === "M" ? "부자재" : "전체"}`, [
      ["월별현황", [hd("월"), ...repRows(R.M, R.ms, (m) => `${m}월`), repTot(R.T)]],
      ["자재별현황", [hd("자재"), ...repRows(R.P, R.ps, (p) => p), repTot(R.T)]],
      [
        "불량유형별(월)",
        [["불량유형", ...R.ms.map((m) => `${m}월`), "합계"], ...R.ts.map((t) => [t, ...R.ms.map((m) => R.D[t].m[m] || 0), R.D[t].t])],
      ],
    ]);
  }

  const card = (label: string, value: number, filter: string, color: string) => (
    <button
      key={label}
      type="button"
      onClick={() => setFs(filter)}
      className={`text-left rounded-lg border px-4 py-3 bg-white transition-colors ${fs === filter ? "border-navy ring-1 ring-navy/30" : "border-slate-200 hover:border-slate-400"}`}
    >
      <div className="text-2xl font-bold" style={{ color }}>
        {n(value)}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </button>
  );
  const segBtn = (v: Seg, label: string, count: number) => (
    <button
      key={v}
      type="button"
      onClick={() => {
        setSeg(v);
        setFk("");
      }}
      className={`px-3 py-1 rounded-full text-sm border transition-colors ${seg === v ? "bg-navy text-white border-navy" : "bg-white text-slate-600 border-slate-300 hover:border-navy"}`}
    >
      {label} {count}
    </button>
  );

  return (
    <div className="w-full px-4 sm:px-6 py-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">부적합 관리대장</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            부적합률 10% 이상인 로트(부자재·블리스터)만 자동으로 모입니다. 줄을 누르면 처리구분·원인·조치내용을 기록할 수 있습니다.
          </p>
        </div>
        <button
          onClick={view === "R" ? exportReport : exportLedger}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
        >
          엑셀 내려받기
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {[{ v: "" as const, label: "부적합 대장" }, { v: "R" as const, label: "보고 (월별·자재별·불량추이)" }].map((b) => (
          <button
            key={b.v}
            type="button"
            onClick={() => setView(b.v)}
            className={`px-3.5 py-1.5 rounded-full text-sm border transition-colors ${view === b.v ? "bg-navy text-white border-navy" : "bg-white text-slate-600 border-slate-300 hover:border-navy"}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {segBtn("", "전체", items.length)}
        {segBtn("M", "부자재(블리스터 제외)", items.length - nBlister)}
        {segBtn("B", "블리스터", nBlister)}
      </div>

      {view === "" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {card("부적합률 10%↑ 로트", segItems.length, "", "#2433a8")}
            {card("미처리", counts["미처리"], "미처리", "#b4412c")}
            {card("진행중", counts["진행중"], "진행중", "#d49a00")}
            {card("완료", counts["완료"], "완료", "#0f766e")}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Lot, 품명, 공급사, 원인 검색"
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72"
            />
            <select value={fm} onChange={(e) => setFm(e.target.value)} className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
              <option value="">월 전체</option>
              {monthOptions.map((m) => (<option key={m} value={m}>{m}월</option>))}
            </select>
            <select value={fk} onChange={(e) => setFk(e.target.value)} className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
              <option value="">구분 전체</option>
              {kindOptions.map((k) => (<option key={k}>{k}</option>))}
            </select>
            <select value={fs} onChange={(e) => setFs(e.target.value)} className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
              <option value="">상태 전체</option>
              {NCR_STATUS.map((s) => (<option key={s}>{s}</option>))}
            </select>
            <button onClick={() => setAdding(true)} className="ml-auto px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90">
              + 로트 추가
            </button>
            {msg && <span className="text-xs text-slate-500 w-full">{msg}</span>}
          </div>

          {sel.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-navy/30 bg-navy/5 px-3 py-2 text-sm">
              <b className="text-navy">
                {sel.size}건 선택{filtered.length && inFilterSel < sel.size ? ` (현재 필터 밖 ${sel.size - inFilterSel}건 포함)` : ""}
              </b>
              {NCR_STATUS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingSt(s)}
                  className={`px-2.5 py-1 rounded border text-xs disabled:opacity-40 ${s === "완료" ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : s === "미처리" ? "border-rose-300 text-rose-700 hover:bg-rose-50" : "border-amber-300 text-amber-700 hover:bg-amber-50"}`}
                >
                  {s}으로
                </button>
              ))}
              <select value={bDisp} onChange={(e) => setBDisp(e.target.value)} aria-label="처리구분 함께 변경" className="border border-slate-300 rounded px-2 py-1 text-xs bg-white">
                <option value="">처리구분 그대로</option>
                {NCR_DISPOSITIONS.map((d) => (<option key={d}>{d}</option>))}
              </select>
              <input type="date" value={bDate} onChange={(e) => setBDate(e.target.value)} aria-label="조치일 함께 입력" title="조치일 함께 입력(비우면 그대로)" className="border border-slate-300 rounded px-2 py-1 text-xs" />
              <button type="button" onClick={() => { setSel(new Set()); setPendingSt(null); setMsg(""); }} className="px-2.5 py-1 rounded border border-rose-200 text-rose-600 text-xs hover:bg-rose-50">
                선택 해제
              </button>
              {pendingSt && (
                <span className="flex items-center gap-2">
                  <b>{sel.size}건을 &apos;{pendingSt}&apos;(으)로 변경할까요?{bDisp ? ` 처리구분 ${bDisp}` : ""}{bDate ? ` 조치일 ${bDate}` : ""}</b>
                  <button type="button" onClick={() => runBulk(pendingSt)} className="px-2.5 py-1 rounded border border-emerald-300 text-emerald-700 text-xs hover:bg-emerald-50">확인</button>
                  <button type="button" onClick={() => setPendingSt(null)} className="px-2.5 py-1 rounded border border-rose-200 text-rose-600 text-xs hover:bg-rose-50">취소</button>
                </span>
              )}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-auto max-h-[calc(100vh-26rem)]">
              <table className="text-sm whitespace-nowrap w-full">
                <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
                  <tr>
                    <th className="px-3 py-2.5 sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                      <input
                        type="checkbox"
                        checked={allSel}
                        ref={(el) => {
                          if (el) el.indeterminate = inFilterSel > 0 && !allSel;
                        }}
                        onChange={(e) => toggleAll(e.target.checked)}
                        aria-label="필터된 항목 전체 선택"
                        title="필터된 항목 전체 선택"
                        className="accent-navy"
                      />
                    </th>
                    {["번호", "일자", "구분", "Lot No.", "자재코드", "품목코드", "품명", "공급사", "검사수량", "부적합", "부적합률", "불량내용", "처리구분", "상태", "조치일", "원인"].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] text-center">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && (<tr><td colSpan={17} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>)}
                  {!loading && visible.length === 0 && (<tr><td colSpan={17} className="text-center py-10 text-slate-400">조건에 맞는 부적합 로트가 없습니다.</td></tr>)}
                  {visible.map((it) => {
                    const r = recMap.get(it.k);
                    const s = stOf(it.k);
                    return (
                      <tr
                        key={it.k}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("input")) return;
                          setCur(it);
                        }}
                        className={`cursor-pointer hover:bg-slate-50 ${sel.has(it.k) ? "bg-navy/5" : ""}`}
                      >
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={sel.has(it.k)}
                            onChange={(e) =>
                              setSel((x) => {
                                const nx = new Set(x);
                                if (e.target.checked) nx.add(it.k);
                                else nx.delete(it.k);
                                return nx;
                              })
                            }
                            aria-label="선택"
                            className="accent-navy"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{it.no}</td>
                        <td className="px-3 py-2">{it.date}</td>
                        <td className="px-3 py-2">{it.kind}</td>
                        <td className="px-3 py-2 font-mono text-xs">{it.lot}</td>
                        <td className="px-3 py-2 font-mono text-xs">{it.code}</td>
                        <td className="px-3 py-2 font-mono text-xs">{it.item}</td>
                        <td className="px-3 py-2 max-w-72 truncate" title={it.name}>{it.name}</td>
                        <td className="px-3 py-2">{it.sup}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{n(it.insp)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-rose-600 font-semibold">{n(it.bad)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{(it.rate * 100).toFixed(2)}%</td>
                        <td className="px-3 py-2 max-w-60 truncate" title={it.defs}>{it.defs}</td>
                        <td className="px-3 py-2">{r?.disp ?? ""}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ST_BADGE[s]}`}>{s}</span>
                        </td>
                        <td className="px-3 py-2">{r?.adate ?? ""}</td>
                        <td className="px-3 py-2 max-w-60 truncate" title={r?.cause ?? ""}>{r?.cause ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-sm">
              <span className="text-slate-500">{filtered.length}건 중 {visible.length}건 표시</span>
              {filtered.length > visible.length && (
                <button onClick={() => setShow((v) => v + SHOW_STEP)} className="px-3 py-1 rounded border border-slate-300 bg-white">더 보기</button>
              )}
            </div>
          </div>
        </>
      )}

      {view === "R" && R && (
        <>
          <style>{`@media print { body * { visibility: hidden !important; } #ncr-report, #ncr-report * { visibility: visible !important; } #ncr-report { position: absolute; left: 0; top: 0; width: 100%; } #ncr-report .no-print { display: none !important; } }`}</style>
          <div id="ncr-report" className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-base font-bold text-navy">부적합 현황 보고</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date().getFullYear()}년 {R.ms[0] ?? 0}~{R.ms[R.ms.length - 1] ?? 0}월 · 기준: {segLabel} · 부적합률은 검사 샘플 기준, 관리대상은 로트별 부적합률 10% 이상
                </p>
              </div>
              <button type="button" onClick={() => window.print()} className="no-print px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white">인쇄</button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                { v: n(R.T.q), l: "검사수량", bad: false },
                { v: n(R.T.b), l: "부적합수량", bad: true },
                { v: `${prt(R.T.b, R.T.q)}%`, l: "부적합률", bad: true },
                { v: `${R.T.n}건`, l: "관리대상 로트", bad: false },
                { v: `${R.T.s[0]} / ${R.T.s[1]} / ${R.T.s[2]}`, l: "미처리 / 진행중 / 완료", bad: false },
              ].map((c) => (
                <div key={c.l} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className={`text-xl font-bold ${c.bad ? "text-rose-600" : "text-slate-800"}`}>{c.v}</div>
                  <div className="text-xs text-slate-500">{c.l}</div>
                </div>
              ))}
            </div>
            <h4 className="font-semibold text-slate-700">1. 월별 현황</h4>
            <RepTable first="월" rows={repRows(R.M, R.ms, (m) => `${m}월`)} tot={repTot(R.T)} />
            <h4 className="font-semibold text-slate-700">2. 자재 종류별 현황</h4>
            <RepTable first="자재" rows={repRows(R.P, R.ps, (p) => p)} tot={repTot(R.T)} />
            <h4 className="font-semibold text-slate-700">
              3. 불량 추이 <small className="font-normal text-slate-400">· 월별 부적합수량(개), 막대 위는 월 합계</small>
            </h4>
            <TrendChart R={R} />
          </div>
        </>
      )}

      {cur && (
        <NcrDialog
          item={cur}
          rec={recMap.get(cur.k)}
          onClose={() => setCur(null)}
          onSaved={async () => {
            setCur(null);
            await load();
          }}
        />
      )}
      {adding && (
        <ManualDialog
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            setMsg("부적합 로트를 추가했습니다.");
            await load();
          }}
        />
      )}
    </div>
  );
}

function RepTable({ first, rows, tot }: { first: string; rows: (string | number)[][]; tot: (string | number)[] }) {
  let mx = 0;
  rows.forEach((r) => {
    if ((r[3] as number) > mx) mx = r[3] as number;
  });
  return (
    <div className="overflow-auto">
      <table className="text-sm whitespace-nowrap w-full border border-slate-200">
        <thead className="bg-slate-100 text-slate-600 text-xs">
          <tr>
            {[first, ...REP_HEADERS].map((h) => (<th key={h} className="px-3 py-2 text-center font-semibold border-b border-slate-200">{h}</th>))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={String(r[0])}>
              <td className="px-3 py-1.5">{r[0]}</td>
              <td className="px-3 py-1.5 text-right">{n(r[1] as number)}</td>
              <td className="px-3 py-1.5 text-right">{n(r[2] as number)}</td>
              <td className={`px-3 py-1.5 text-right ${r[3] === mx && mx > 0 ? "text-rose-600 font-semibold" : ""}`}>{(r[3] as number).toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right">{r[4]}</td>
              <td className="px-3 py-1.5 text-right text-rose-600">{r[5]}</td>
              <td className="px-3 py-1.5 text-right text-amber-600">{r[6]}</td>
              <td className="px-3 py-1.5 text-right text-emerald-600">{r[7]}</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold">
            <td className="px-3 py-1.5">{tot[0]}</td>
            <td className="px-3 py-1.5 text-right">{n(tot[1] as number)}</td>
            <td className="px-3 py-1.5 text-right">{n(tot[2] as number)}</td>
            <td className="px-3 py-1.5 text-right">{(tot[3] as number).toFixed(2)}</td>
            <td className="px-3 py-1.5 text-right">{tot[4]}</td>
            <td className="px-3 py-1.5 text-right">{tot[5]}</td>
            <td className="px-3 py-1.5 text-right">{tot[6]}</td>
            <td className="px-3 py-1.5 text-right">{tot[7]}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TrendChart({ R }: { R: ReturnType<typeof repData> }) {
  const top = R.ts.slice(0, 5);
  const ser = top.concat(R.ts.length > 5 ? ["그 외"] : []);
  const val = (m: number, s: string) =>
    s === "그 외" ? R.ts.slice(5).reduce((a, t) => a + (R.D[t].m[m] || 0), 0) : R.D[s].m[m] || 0;
  const tm = R.ms.map((m) => ser.reduce((a, s) => a + val(m, s), 0));
  const pk = Math.max(...tm, 1);
  const W = 700, H = 250, pl = 44, pt = 26, pb = 28;
  const bw = (W - pl - 10) / Math.max(1, R.ms.length);
  const col = (s: string, j: number) => (s === "그 외" ? "#94a3b8" : SERIES_COLORS[j]);
  if (R.ms.length === 0) return <p className="text-sm text-slate-400">표시할 데이터가 없습니다.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 불량유형별 부적합수량" style={{ width: "100%", minWidth: 560, height: "auto", display: "block" }}>
          <line x1={pl} x2={W - 6} y1={H - pb} y2={H - pb} stroke="#d9dfe5" />
          {R.ms.map((m, i) => {
            let acc = 0;
            const x = pl + i * bw + bw * 0.18;
            const w = bw * 0.64;
            return (
              <g key={m}>
                {ser.map((s, j) => {
                  const v = val(m, s);
                  if (!(v > 0)) return null;
                  const hh = (v / pk) * (H - pt - pb);
                  const y = H - pb - acc - hh;
                  acc += hh;
                  return (
                    <rect key={s} x={x} y={y} width={w} height={hh} fill={col(s, j)}>
                      <title>{`${m}월 ${s} ${n(v)}개`}</title>
                    </rect>
                  );
                })}
                <text x={x + w / 2} y={H - pb - acc - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill="#1b2733">{n(tm[i])}</text>
                <text x={x + w / 2} y={H - 9} textAnchor="middle" fontSize={12} fill="#5d6b79">{m}월</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex gap-3 flex-wrap text-xs text-slate-600">
        {ser.map((s, j) => (
          <span key={s} className="flex items-center gap-1">
            <i className="inline-block w-3 h-3 rounded-sm" style={{ background: col(s, j) }} />
            {s}
          </span>
        ))}
      </div>
      <div className="overflow-auto">
        <table className="text-sm whitespace-nowrap w-full border border-slate-200">
          <thead className="bg-slate-100 text-slate-600 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-semibold border-b border-slate-200">불량유형</th>
              {R.ms.map((m) => (<th key={m} className="px-3 py-2 text-center font-semibold border-b border-slate-200">{m}월</th>))}
              <th className="px-3 py-2 text-center font-semibold border-b border-slate-200">합계</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {R.ts.map((t) => (
              <tr key={t}>
                <td className="px-3 py-1.5">{t}</td>
                {R.ms.map((m) => {
                  const v = R.D[t].m[m] || 0;
                  return (<td key={m} className="px-3 py-1.5 text-right">{v ? n(v) : <span className="text-slate-300">-</span>}</td>);
                })}
                <td className="px-3 py-1.5 text-right font-semibold">{n(R.D[t].t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">※ &quot;유형 미기재&quot;는 부적합수량은 있으나 불량유형이 입력되지 않은 수량입니다. 관리대상·처리현황은 부적합관리대장의 상태 기록과 같습니다.</p>
    </>
  );
}

// ── 부적합 처리 창 ────────────────────────────────────────────────────────────────────────
function NcrDialog({ item, rec, onClose, onSaved }: { item: NcrItem; rec?: NcrRecord; onClose: () => void; onSaved: () => void }) {
  const [disp, setDisp] = useState(rec?.disp ?? "");
  const [st, setSt] = useState(rec?.st ?? "미처리");
  const [adate, setAdate] = useState(rec?.adate ?? "");
  const [who, setWho] = useState(rec?.who ?? "");
  const [cause, setCause] = useState(rec?.cause ?? "");
  const [act, setAct] = useState(rec?.act ?? "");
  const [msg, setMsg] = useState("");
  const [clrArmed, setClrArmed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setMsg("저장 중…");
    const res = await fetch(`/api/qc-incoming/ncr/${encodeURIComponent(item.k)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disp, st, adate, who, cause, act }),
    });
    setSaving(false);
    if (!res.ok) return setMsg("저장하지 못했습니다.");
    onSaved();
  }
  async function clear() {
    if (!clrArmed) {
      setClrArmed(true);
      setTimeout(() => setClrArmed(false), 4000);
      return;
    }
    const res = await fetch(`/api/qc-incoming/ncr/${encodeURIComponent(item.k)}`, { method: "DELETE" });
    if (!res.ok) return setMsg("지우지 못했습니다.");
    onSaved();
  }

  const inp = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <b className="text-navy">부적합 처리 · {item.no}</b>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">닫기</button>
        </div>
        <div className="p-5 space-y-4">
          <table className="w-full text-sm border border-slate-200">
            <tbody>
              <tr><th className="bg-slate-50 px-3 py-1.5 text-left w-24">일자</th><td className="px-3 py-1.5">{item.date}</td><th className="bg-slate-50 px-3 py-1.5 text-left w-24">구분</th><td className="px-3 py-1.5">{item.kind}</td></tr>
              <tr><th className="bg-slate-50 px-3 py-1.5 text-left">Lot No.</th><td className="px-3 py-1.5">{item.lot}</td><th className="bg-slate-50 px-3 py-1.5 text-left">코드</th><td className="px-3 py-1.5">{item.code}</td></tr>
              <tr><th className="bg-slate-50 px-3 py-1.5 text-left">품명</th><td colSpan={3} className="px-3 py-1.5">{item.name}</td></tr>
              <tr><th className="bg-slate-50 px-3 py-1.5 text-left">공급사</th><td className="px-3 py-1.5">{item.sup}</td><th className="bg-slate-50 px-3 py-1.5 text-left">부적합/검사</th><td className="px-3 py-1.5">{n(item.bad)} / {n(item.insp)} ({(item.rate * 100).toFixed(2)}%)</td></tr>
              <tr><th className="bg-slate-50 px-3 py-1.5 text-left">불량내용</th><td colSpan={3} className="px-3 py-1.5">{item.defs || "-"}</td></tr>
              {item.note && (<tr><th className="bg-slate-50 px-3 py-1.5 text-left">비고</th><td colSpan={3} className="px-3 py-1.5">{item.note}</td></tr>)}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500">처리구분
              <select value={disp} onChange={(e) => setDisp(e.target.value)} className={inp}>
                <option value="">선택</option>
                {NCR_DISPOSITIONS.map((d) => (<option key={d}>{d}</option>))}
              </select>
            </label>
            <label className="text-xs text-slate-500">상태
              <select value={st} onChange={(e) => setSt(e.target.value)} className={inp}>
                {NCR_STATUS.map((d) => (<option key={d}>{d}</option>))}
              </select>
            </label>
            <label className="text-xs text-slate-500">조치일<input type="date" value={adate} onChange={(e) => setAdate(e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500">담당자<input value={who} maxLength={30} onChange={(e) => setWho(e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500 col-span-2">원인<input value={cause} maxLength={200} onChange={(e) => setCause(e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500 col-span-2">조치내용<input value={act} maxLength={300} onChange={(e) => setAct(e.target.value)} className={inp} /></label>
          </div>
          <div className="flex items-center justify-end gap-2">
            {msg && <span className="text-xs text-slate-500 mr-auto">{msg}</span>}
            <button type="button" onClick={clear} className="px-3 py-2 rounded-md text-sm border border-rose-200 text-rose-600 hover:bg-rose-50">
              {clrArmed ? "한 번 더 누르면 지웁니다" : "기록 지우기"}
            </button>
            <button type="button" disabled={saving} onClick={save} className="px-4 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-50">저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 부적합 로트 직접 추가 창 ─────────────────────────────────────────────────────────────
function ManualDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: "", kind: "단상자", lot: "", code: "", item: "", name: "", sup: "", insp: "", bad: "", defs: "" });
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // 자재코드를 입력하면 품명·공급사·품목코드·구분을 채운다(비어 있을 때만)
  useEffect(() => {
    const code = f.code.trim().toUpperCase();
    if (code.length < 6) return;
    let live = true;
    const t = setTimeout(async () => {
      const d = await fetch(`/api/qc-incoming/supply/lookup?code=${encodeURIComponent(code)}`).then((r) => r.json()).catch(() => null);
      if (!live || !d?.found) return;
      setF((p) => ({
        ...p,
        name: p.name || d.name || "",
        sup: p.sup || d.supplier || "",
        item: p.item || d.item || "",
        kind: (NCR_MANUAL_KINDS as readonly string[]).includes(d.part) ? d.part : p.kind,
      }));
      setMsg(`자동 입력: ${d.part} · ${d.name}${d.supplier ? " · " + d.supplier : " · 공급사는 직접 입력"}${d.item ? " · 품목코드 " + d.item : ""}`);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [f.code]);

  async function save() {
    if (!f.lot.trim()) return setMsg("Lot No.를 입력해 주세요.");
    if (!f.date) return setMsg("일자를 입력해 주세요.");
    if (f.bad === "" || Number(f.bad) < 0) return setMsg("부적합수량을 입력해 주세요.");
    setSaving(true);
    setMsg("저장 중…");
    const res = await fetch("/api/qc-incoming/ncr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, code: f.code.trim().toUpperCase(), insp: Number(f.insp) || 0, bad: Number(f.bad) }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setMsg(d.error ?? "저장하지 못했습니다.");
    onSaved();
  }

  const inp = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <b className="text-navy">부적합 로트 직접 추가</b>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">닫기</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500">일자 *<input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500">구분
              <select value={f.kind} onChange={(e) => set("kind", e.target.value)} className={inp}>
                {NCR_MANUAL_KINDS.map((k) => (<option key={k}>{k}</option>))}
              </select>
            </label>
            <label className="text-xs text-slate-500">Lot No. *<input value={f.lot} maxLength={100} onChange={(e) => set("lot", e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500">자재코드<input value={f.code} maxLength={100} onChange={(e) => set("code", e.target.value.toUpperCase())} className={inp} /></label>
            <label className="text-xs text-slate-500">품목코드<input value={f.item} maxLength={100} onChange={(e) => set("item", e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500">공급사<input value={f.sup} maxLength={100} onChange={(e) => set("sup", e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500 col-span-2">품명<input value={f.name} maxLength={100} onChange={(e) => set("name", e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500">검사수량<input type="number" min={0} value={f.insp} onChange={(e) => set("insp", e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500">부적합수량 *<input type="number" min={0} value={f.bad} onChange={(e) => set("bad", e.target.value)} className={inp} /></label>
            <label className="text-xs text-slate-500 col-span-2">불량내용<input value={f.defs} maxLength={100} onChange={(e) => set("defs", e.target.value)} className={inp} /></label>
          </div>
          <div className="flex items-center justify-end gap-2">
            {msg && <span className="text-xs text-slate-500 mr-auto">{msg}</span>}
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-md text-sm border border-slate-300 text-slate-600">취소</button>
            <button type="button" disabled={saving} onClick={save} className="px-4 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-50">저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}
