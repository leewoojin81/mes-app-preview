"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { PackingBox, PackingForm, PackingList, PackingModel } from "@/lib/packing-list";
import ShipLotTab from "./ShipLotTab";

// 영업관리 Packing List(SALES-04) — 수주를 고르면 라벨일정(차수·제조일)과 품목정보(포장단위·Box 수량)로 소박스·카톤을
// 자동으로 나누고, 고친 뒤 확정·엑셀(표준 DPL / 중국 라벨형)·인쇄(PDF)한다. 규칙은 lib/packing-list.ts.

type OrderRow = {
  sono: string; mo: string | null; customer: string | null; brand: string | null; due: string | null; qty: number; sts: string;
  pl_no: string | null; pl_status: string | null; revision: number | null;
};

const FORMS: { key: PackingForm; label: string }[] = [
  { key: "std", label: "표준 DPL" },
  { key: "cn", label: "중국 라벨형" },
];
const fmt = (n: number | null | undefined, d = 0) => (n == null ? "" : n.toLocaleString("ko-KR", { maximumFractionDigits: d }));
const powerText = (p: number | null) => (p == null ? "-" : p === 0 ? "0.00" : p.toFixed(2));

function expiryOf(mfg: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mfg);
  if (!m || !years) return "";
  const d = new Date(Number(m[1]) + years, Number(m[2]) - 1, Number(m[3]));
  if (d.getDate() !== Number(m[3])) d.setDate(0);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `요청 실패 (${r.status})`);
  return d as T;
}

const inp = "border border-slate-300 rounded px-1.5 py-0.5 text-[13px] bg-white disabled:bg-slate-50 disabled:text-slate-500";
const btn = "px-3 py-1.5 text-[13px] rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50";
const btnMain = "px-3 py-1.5 text-[13px] rounded bg-navy text-white hover:opacity-90 disabled:opacity-50";

type Tab = "pl" | "lot";
const TABS: { v: Tab; label: string }[] = [
  { v: "pl", label: "Packing List" },
  { v: "lot", label: "출하LOT" },
];

export default function PackingListPage() {
  const [tab, setTab] = useTabState<Tab>("plTab", "pl");
  const [q, setQ] = useTabState("plSearch", "");
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [selSo, setSelSo] = useTabState<string | null>("plSelSo", null);
  const [pl, setPl] = useState<PackingList | null>(null);
  const [draft, setDraft] = useState<PackingList | null>(null);
  const [newForm, setNewForm] = useState<PackingForm>("std");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [askRebuild, setAskRebuild] = useState(false);

  const loadOrders = useCallback(() => {
    call<{ orders: OrderRow[] }>(`/api/packing-list?q=${encodeURIComponent(q)}`)
      .then((d) => setOrders(d.orders))
      .catch((e) => setMsg({ ok: false, text: e.message }));
  }, [q]);
  useEffect(() => {
    const t = window.setTimeout(loadOrders, 250);
    return () => window.clearTimeout(t);
  }, [loadOrders]);

  const sel = orders?.find((o) => o.sono === selSo) ?? null;
  const plNo = sel?.pl_no ?? null;
  useEffect(() => {
    if (!plNo) return;
    let alive = true;
    call<PackingList>(`/api/packing-list?pl=${encodeURIComponent(plNo)}`)
      .then((d) => {
        if (!alive) return;
        setPl(d);
        setDraft(structuredClone(d));
      })
      .catch((e) => alive && setMsg({ ok: false, text: e.message }));
    return () => {
      alive = false;
    };
  }, [plNo]);
  const pick = (so: string) => {
    setSelSo(so);
    setPl(null);
    setDraft(null);
    setAskRebuild(false);
    setMsg(null);
  };

  const run = async (f: () => Promise<PackingList | void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const d = await f();
      if (d) {
        setPl(d);
        setDraft(structuredClone(d));
      }
      setMsg({ ok: true, text: ok });
      loadOrders();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setAskRebuild(false);
    }
  };

  const create = () =>
    run(async () => {
      const r = await call<{ pl_no: string }>("/api/packing-list", { method: "POST", body: JSON.stringify({ so_no: selSo, form: newForm }) });
      return call<PackingList>(`/api/packing-list?pl=${r.pl_no}`);
    }, "Packing List를 만들었습니다. 박스 구성을 확인해 주세요.");
  const payload = (d: PackingList, rebuild = false) => ({
    pl_no: d.pl_no,
    form: d.form,
    lot_prefix: d.lot_prefix,
    mfg_date: d.mfg_date,
    customer_po: d.customer_po,
    remark: d.remark,
    include_sample: d.include_sample,
    models: d.models,
    boxes: rebuild ? undefined : d.boxes,
    cartons: d.cartons,
    jan: d.jan,
    rebuild,
  });
  const save = (rebuild = false) =>
    draft && run(() => call<PackingList>("/api/packing-list", { method: "PUT", body: JSON.stringify(payload(draft, rebuild)) }), rebuild ? "모델 설정으로 박스를 다시 나눴습니다." : "저장했습니다.");
  const act = (action: "confirm" | "reopen" | "cancel", ok: string) =>
    pl && run(() => call<PackingList>("/api/packing-list", { method: "PATCH", body: JSON.stringify({ pl_no: pl.pl_no, action }) }), ok);

  const dirty = useMemo(() => !!pl && !!draft && JSON.stringify(payload(pl)) !== JSON.stringify(payload(draft)), [pl, draft]);
  const locked = !draft || draft.status !== "작성중" || busy;

  const setD = (f: (d: PackingList) => void) =>
    setDraft((cur) => {
      if (!cur) return cur;
      const n = structuredClone(cur);
      f(n);
      return n;
    });

  return (
    <div className="pl-page">
      <style>{`
        .pl-print{display:none}
        @media print{
          body *{visibility:hidden}
          .pl-print,.pl-print *{visibility:visible}
          .pl-print{display:block;position:absolute;left:0;top:0;width:100%;font-size:10px}
          .pl-print table{border-collapse:collapse;width:100%;margin-bottom:8px}
          .pl-print th,.pl-print td{border:1px solid #444;padding:1px 4px;text-align:center}
          .pl-print .sheet{break-after:page}
          @page{size:A4;margin:10mm}
        }
      `}</style>
      <div className="w-full px-4 sm:px-6 pt-6">
        <h1 className="text-xl font-bold text-navy">Packing List</h1>
        <p className="text-sm text-slate-500 mt-1">SALES-04 · 수주별 소박스 · 카톤 구성(DPL)과 확정 · 엑셀 · 인쇄 · 출하LOT 발행</p>
        <div className="flex gap-1 mt-4 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setTab(t.v)}
              className={`px-5 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === t.v ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "lot" && <ShipLotTab />}
      <div className={`px-4 sm:px-6 py-4 flex gap-4 items-start ${tab === "pl" ? "" : "hidden"}`}>
        {/* 수주 목록 */}
        <div className="w-[360px] shrink-0 border border-slate-200 rounded bg-white">
          <div className="p-2 border-b border-slate-200">
            <input className={`${inp} w-full`} placeholder="수주번호 · MO · 거래처 · 브랜드" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto text-[13px]">
            {!orders && <div className="p-4 text-slate-400">불러오는 중…</div>}
            {orders?.length === 0 && <div className="p-4 text-slate-400">수주가 없습니다.</div>}
            {orders?.map((o) => (
              <button
                key={o.sono}
                onClick={() => pick(o.sono)}
                className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${selSo === o.sono ? "bg-blue-50" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-mono">{o.sono}</span>
                  {o.pl_status ? (
                    <span className={`text-[11px] px-1.5 rounded ${o.pl_status === "확정" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {o.pl_status}{o.revision ? ` Rev.${o.revision}` : ""}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">{o.sts}</span>
                  )}
                </div>
                <div className="text-slate-600 truncate">{o.customer} · {o.brand}</div>
                <div className="text-slate-400 text-[12px]">{o.mo ?? "-"} · 납기 {o.due?.slice(0, 10) ?? "-"} · {fmt(o.qty)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 상세 */}
        <div className="flex-1 min-w-0">
          {msg && <div className={`mb-3 text-[13px] px-3 py-2 rounded ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
          {!sel && <div className="text-slate-400 text-sm p-8 border border-dashed border-slate-300 rounded">왼쪽에서 수주를 고르세요.</div>}
          {sel && !sel.pl_no && (
            <div className="border border-slate-200 rounded bg-white p-4 text-[13px] space-y-3">
              <div>
                <b className="font-mono">{sel.sono}</b> · {sel.customer} · {sel.brand} · {sel.mo} · {fmt(sel.qty)}
              </div>
              <div className="text-slate-500">
                아직 Packing List가 없습니다. 만들면 라벨일정(PROC-06)의 출하차수 · 생산일자와 품목정보의 포장단위 · Box 수량으로 소박스 · 카톤을
                자동으로 나눕니다(무상 · 유상 샘플 줄 제외).
              </div>
              <div className="flex items-center gap-2">
                양식
                <select className={inp} value={newForm} onChange={(e) => setNewForm(e.target.value as PackingForm)}>
                  {FORMS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <button className={btnMain} onClick={create} disabled={busy}>Packing List 만들기</button>
              </div>
            </div>
          )}
          {sel?.pl_no && draft && pl && (
            <Editor
              pl={pl}
              d={draft}
              setD={setD}
              locked={locked}
              busy={busy}
              dirty={dirty}
              askRebuild={askRebuild}
              setAskRebuild={setAskRebuild}
              onSave={() => save(false)}
              onRebuild={() => save(true)}
              onAct={act}
            />
          )}
        </div>
      </div>
      {pl && <PrintView pl={pl} />}
    </div>
  );
}

function Editor({
  pl, d, setD, locked, busy, dirty, askRebuild, setAskRebuild, onSave, onRebuild, onAct,
}: {
  pl: PackingList;
  d: PackingList;
  setD: (f: (d: PackingList) => void) => void;
  locked: boolean;
  busy: boolean;
  dirty: boolean;
  askRebuild: boolean;
  setAskRebuild: (v: boolean) => void;
  onSave: () => void;
  onRebuild: () => void;
  onAct: (a: "confirm" | "reopen" | "cancel", ok: string) => void;
}) {
  const totalPacks = d.boxes.reduce((s, b) => s + b.qty, 0);
  const ctnCount = new Set(d.boxes.map((b) => b.ctn_no)).size;
  const bad = pl.check.filter((c) => c.order_packs !== c.boxed);
  const itemCodes = [...new Set(pl.check.map((c) => c.item_code))];
  const setModel = (m: string, k: keyof PackingModel, v: string) =>
    setD((x) => {
      const t = x.models.find((y) => y.model === m);
      if (t) (t as unknown as Record<string, unknown>)[k] = k === "title" || k === "label_name" ? v : Number(v);
    });
  const setBox = (i: number, k: keyof PackingBox, v: string) =>
    setD((x) => {
      const b = x.boxes[i] as unknown as Record<string, unknown>;
      b[k] = k === "lot_no" || k === "item_code" ? v : Number(v);
      if (k === "item_code") {
        const m = /-(\d{4})$/.exec(v);
        b.model = v.slice(0, 9);
        b.power = m ? -Number(m[1]) / 100 || 0 : null;
      }
    });

  return (
    <div className="space-y-4 text-[13px]">
      {/* 머리글 */}
      <div className="border border-slate-200 rounded bg-white p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <b className="font-mono">{d.pl_no}</b>
          <span className={`px-2 rounded text-[12px] ${d.status === "확정" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            {d.status}{d.revision ? ` · Rev.${d.revision}` : ""}
          </span>
          <span className="font-mono">{d.so_no}</span>
          <span>{d.customer} · {d.brand}</span>
          <span>MO {d.mo_no ?? "-"}</span>
          <span>납기 {d.due_date?.slice(0, 10) ?? "-"}</span>
          <span className="text-slate-500">카톤 <b>{ctnCount}</b> · 소박스 <b>{d.boxes.length}</b> · <b>{fmt(totalPacks)}</b>팩</span>
          {d.confirmed_at && <span className="text-slate-400">확정 {d.confirmed_by} {d.confirmed_at.slice(0, 16)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <label className="flex items-center gap-1">양식
            <select className={inp} value={d.form} disabled={locked} onChange={(e) => setD((x) => void (x.form = e.target.value as PackingForm))}>
              {FORMS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">출하차수
            <input className={`${inp} w-16 font-mono`} value={d.lot_prefix} disabled={locked} onChange={(e) => setD((x) => void (x.lot_prefix = e.target.value))} />
          </label>
          <label className="flex items-center gap-1">제조일
            <input type="date" className={inp} value={d.mfg_date} disabled={locked} onChange={(e) => setD((x) => void (x.mfg_date = e.target.value))} />
          </label>
          <label className="flex items-center gap-1">고객 PO
            <input className={`${inp} w-32`} value={d.customer_po} disabled={locked} onChange={(e) => setD((x) => void (x.customer_po = e.target.value))} />
          </label>
          <label className="flex items-center gap-1">비고
            <input className={`${inp} w-48`} value={d.remark} disabled={locked} onChange={(e) => setD((x) => void (x.remark = e.target.value))} />
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={d.include_sample} disabled={locked} onChange={(e) => setD((x) => void (x.include_sample = e.target.checked))} />
            샘플 줄 포함
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {d.status === "작성중" && (
            <>
              <button className={btnMain} disabled={busy || !dirty} onClick={onSave}>저장</button>
              <button className={btn} disabled={busy || dirty || bad.length > 0} onClick={() => onAct("confirm", "확정했습니다. 수주 상태가 MES에서 Packing으로 보입니다.")} title={bad.length ? "수주 수량과 박스 수량이 다른 품목이 있습니다" : dirty ? "먼저 저장하세요" : ""}>
                확정
              </button>
              <button className={btn} disabled={busy} onClick={() => onAct("cancel", "Packing List를 취소했습니다.")}>취소(삭제)</button>
            </>
          )}
          {d.status === "확정" && <button className={btn} disabled={busy} onClick={() => onAct("reopen", "확정을 풀었습니다(개정번호 +1).")}>확정 풀기(수정)</button>}
          <span className="mx-2 h-5 border-l border-slate-300" />
          <a className={`${btn} ${dirty ? "pointer-events-none opacity-50" : ""}`} href={`/api/packing-list/export?pl=${encodeURIComponent(d.pl_no)}`}>엑셀 ({FORMS.find((f) => f.key === pl.form)?.label})</a>
          <button className={btn} disabled={dirty} onClick={() => window.print()}>인쇄 / PDF</button>
          {dirty && <span className="text-amber-600">저장하지 않은 변경이 있습니다.</span>}
        </div>
      </div>

      {/* 수량 확인 */}
      {bad.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded p-3 text-red-700">
          수주 팩 수와 박스 팩 수가 다른 품목 {bad.length}개 (확정 불가):{" "}
          {bad.slice(0, 12).map((c) => `${c.model.slice(0, 5)} ${powerText(c.power)} 수주 ${fmt(c.order_packs)} / 박스 ${fmt(c.boxed)}`).join(" · ")}
          {bad.length > 12 ? " …" : ""}
        </div>
      )}

      {/* 모델 설정 */}
      <div className="border border-slate-200 rounded bg-white">
        <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-3">
          <b>모델별 포장 설정</b>
          <span className="text-slate-500">팩 수 = 수주 수량 ÷ 팩당 렌즈 · 소박스 1개 = 한 도수 · 모델이 바뀌면 새 카톤</span>
          {d.status === "작성중" && (askRebuild ? (
            <span className="ml-auto flex items-center gap-2 text-amber-700">
              직접 고친 박스 줄이 모두 사라집니다.
              <button className={btnMain} disabled={busy} onClick={onRebuild}>다시 나누기</button>
              <button className={btn} onClick={() => setAskRebuild(false)}>그만두기</button>
            </span>
          ) : (
            <button className={`${btn} ml-auto`} disabled={busy} onClick={() => setAskRebuild(true)}>이 설정으로 박스 다시 나누기</button>
          ))}
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-1 text-left">모델</th><th className="px-2 py-1 text-left">제목(품명)</th><th className="px-2 py-1 text-left">Label #</th>
              <th className="px-2 py-1">팩당 렌즈</th><th className="px-2 py-1">소박스 팩수</th><th className="px-2 py-1">카톤당 소박스</th><th className="px-2 py-1">유효기간(년)</th>
              <th className="px-2 py-1 text-right">수주 수량</th><th className="px-2 py-1 text-right">팩 수</th><th className="px-2 py-1">유효기간</th>
            </tr>
          </thead>
          <tbody>
            {d.models.map((m) => (
              <tr key={m.model} className="border-t border-slate-100">
                <td className="px-2 py-1 font-mono">{m.model}</td>
                <td className="px-2 py-1"><input className={`${inp} w-56`} value={m.title} disabled={locked} onChange={(e) => setModel(m.model, "title", e.target.value)} /></td>
                <td className="px-2 py-1"><input className={`${inp} w-28`} value={m.label_name} disabled={locked} onChange={(e) => setModel(m.model, "label_name", e.target.value)} placeholder="예: 黑色" /></td>
                {(["pack_unit", "per_small", "small_per_ctn", "shelf_years"] as const).map((k) => (
                  <td key={k} className="px-2 py-1 text-center">
                    <input type="number" min={1} className={`${inp} w-16 text-right`} value={m[k]} disabled={locked} onChange={(e) => setModel(m.model, k, e.target.value)} />
                  </td>
                ))}
                <td className="px-2 py-1 text-right">{fmt(m.order_qty)}</td>
                <td className="px-2 py-1 text-right">{fmt(m.order_packs)}</td>
                <td className="px-2 py-1 text-center font-mono">{expiryOf(d.mfg_date, m.shelf_years) || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 items-start">
        {/* 박스 */}
        <div className="flex-1 min-w-0 border border-slate-200 rounded bg-white">
          <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-3">
            <b>소박스 · 카톤</b>
            <span className="text-slate-500">한 줄 = 소박스 1개. 수량은 팩 단위</span>
            {!locked && (
              <button
                className={`${btn} ml-auto`}
                onClick={() =>
                  setD((x) => {
                    const last = x.boxes[x.boxes.length - 1];
                    x.boxes.push({ ctn_no: last?.ctn_no ?? 1, small_no: (last?.small_no ?? 0) + 1, model: last?.model ?? "", item_code: last?.item_code ?? "", power: last?.power ?? null, lot_no: last?.lot_no ?? "", qty: 0 });
                  })
                }
              >
                줄 추가
              </button>
            )}
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr>
                  <th className="px-2 py-1">Ctn</th><th className="px-2 py-1">Small</th><th className="px-2 py-1 text-left">품목코드</th><th className="px-2 py-1">Power</th>
                  <th className="px-2 py-1 text-left">LOT</th><th className="px-2 py-1">JAN</th><th className="px-2 py-1 text-right">팩</th><th />
                </tr>
              </thead>
              <tbody>
                {d.boxes.map((b, i) => {
                  const first = i === 0 || d.boxes[i - 1].ctn_no !== b.ctn_no;
                  return (
                    <tr key={i} className={first ? "border-t-2 border-slate-300" : "border-t border-slate-100"}>
                      <td className="px-2 py-0.5 text-center"><input type="number" className={`${inp} w-14 text-right`} value={b.ctn_no} disabled={locked} onChange={(e) => setBox(i, "ctn_no", e.target.value)} /></td>
                      <td className="px-2 py-0.5 text-center"><input type="number" className={`${inp} w-12 text-right`} value={b.small_no} disabled={locked} onChange={(e) => setBox(i, "small_no", e.target.value)} /></td>
                      <td className="px-2 py-0.5">
                        <select className={`${inp} font-mono`} value={b.item_code} disabled={locked} onChange={(e) => setBox(i, "item_code", e.target.value)}>
                          {!itemCodes.includes(b.item_code) && <option value={b.item_code}>{b.item_code || "선택"}</option>}
                          {itemCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-0.5 text-center font-mono">{powerText(b.power)}</td>
                      <td className="px-2 py-0.5"><input className={`${inp} w-28 font-mono`} value={b.lot_no} disabled={locked} onChange={(e) => setBox(i, "lot_no", e.target.value)} /></td>
                      <td className="px-2 py-0.5 text-center font-mono text-slate-500">{d.jan[b.item_code] ?? ""}</td>
                      <td className="px-2 py-0.5 text-right"><input type="number" className={`${inp} w-16 text-right`} value={b.qty} disabled={locked} onChange={(e) => setBox(i, "qty", e.target.value)} /></td>
                      <td className="px-1">{!locked && <button className="text-slate-400 hover:text-red-600" onClick={() => setD((x) => void x.boxes.splice(i, 1))} title="줄 삭제">×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="w-[330px] shrink-0 space-y-4">
          {/* 카톤 중량 */}
          <div className="border border-slate-200 rounded bg-white">
            <div className="px-3 py-2 border-b border-slate-200"><b>카톤 중량(kg)</b> <span className="text-slate-500">실측 입력</span></div>
            <div className="max-h-[260px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr><th className="px-2 py-1">Ctn</th><th className="px-2 py-1">N.W</th><th className="px-2 py-1">G.W</th></tr></thead>
                <tbody>
                  {d.cartons.map((c, i) => (
                    <tr key={c.ctn_no} className="border-t border-slate-100">
                      <td className="px-2 py-0.5 text-center">{c.ctn_no}</td>
                      {(["net_kg", "gross_kg"] as const).map((k) => (
                        <td key={k} className="px-2 py-0.5 text-center">
                          <input
                            type="number"
                            step="0.01"
                            className={`${inp} w-20 text-right`}
                            value={c[k] ?? ""}
                            disabled={locked}
                            onChange={(e) => setD((x) => void (x.cartons[i][k] = e.target.value === "" ? null : Number(e.target.value)))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {/* JAN */}
          <div className="border border-slate-200 rounded bg-white">
            <div className="px-3 py-2 border-b border-slate-200"><b>JAN 코드</b> <span className="text-slate-500">품목코드별 · 중국 라벨형에 사용</span></div>
            <div className="max-h-[300px] overflow-y-auto">
              <table className="w-full">
                <tbody>
                  {itemCodes.map((c) => (
                    <tr key={c} className="border-t border-slate-100">
                      <td className="px-2 py-0.5 font-mono text-[12px]">{c}</td>
                      <td className="px-2 py-0.5">
                        <input className={`${inp} w-36 font-mono`} value={d.jan[c] ?? ""} disabled={locked} onChange={(e) => setD((x) => void (x.jan[c] = e.target.value))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 인쇄용(브라우저 인쇄 → PDF로 저장) — 표준 DPL 모양, 모델마다 한 장 */
function PrintView({ pl }: { pl: PackingList }) {
  return (
    <div className="pl-print">
      {pl.models.map((m) => {
        const boxes = pl.boxes.filter((b) => b.model === m.model);
        if (!boxes.length) return null;
        const exp = expiryOf(pl.mfg_date, m.shelf_years);
        const ctns = [...new Set(boxes.map((b) => b.ctn_no))];
        return (
          <div key={m.model} className="sheet">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <b style={{ fontSize: 15 }}>Detailed Packing List</b>
              <span>{pl.pl_no}{pl.revision ? ` Rev.${pl.revision}` : ""} · {pl.status}</span>
            </div>
            <div style={{ marginBottom: 6 }}>
              Customer: {pl.customer} · MO: {pl.mo_no} · MES: {pl.so_no} · PO: {pl.customer_po || "-"} · Model: {m.title} {m.label_name && `(${m.label_name})`}
            </div>
            <table>
              <thead>
                <tr><th>Carton</th><th>Small Box</th><th>Model</th><th>Power</th><th>Q&apos;ty(pack)</th><th>MFG</th><th>EXP</th><th>Lot Number</th><th>N.W(kg)</th><th>G.W(kg)</th></tr>
              </thead>
              <tbody>
                {boxes.map((b, i) => {
                  const first = i === 0 || boxes[i - 1].ctn_no !== b.ctn_no;
                  const w = pl.cartons.find((c) => c.ctn_no === b.ctn_no);
                  return (
                    <tr key={i}>
                      <td>{first ? b.ctn_no : ""}</td><td>{b.small_no}</td><td>{m.model.slice(0, 5)}</td><td>{powerText(b.power)}</td><td>{b.qty}</td>
                      <td>{pl.mfg_date}</td><td>{exp}</td><td>{b.lot_no}</td><td>{first ? (w?.net_kg ?? "") : ""}</td><td>{first ? (w?.gross_kg ?? "") : ""}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td><b>Total</b></td><td>{ctns.length} ctn</td><td /><td /><td><b>{boxes.reduce((s, b) => s + b.qty, 0)}</b></td><td /><td /><td />
                  <td>{fmt(pl.cartons.filter((c) => ctns.includes(c.ctn_no)).reduce((s, c) => s + (c.net_kg ?? 0), 0), 2) || ""}</td>
                  <td>{fmt(pl.cartons.filter((c) => ctns.includes(c.ctn_no)).reduce((s, c) => s + (c.gross_kg ?? 0), 0), 2) || ""}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
