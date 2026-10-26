"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import {
  anwExpiry,
  buildBlock,
  buildBoxes,
  DEFAULT_LABEL_USE,
  modelBoxSettings,
  powerText,
  yymmdd,
  yyyymm,
  type Box,
  type BoxKind,
  type OrderFormBlock,
  type OrderFormData,
  type OrderFormInput,
  type OrderFormModel,
  type OrderFormMo,
} from "@/lib/label-order-form-shared";

// 마킹출하공정(PROC-06) 오더양식 — 엑셀 "1 오더양식(ANW) 형명추가ver.xlsx"의 ANW 본표와 소/중 박스 라벨 시트(2026-10-26, ANW 전용).
// MO를 고르면 수주현황·품목정보·BOM·라벨일정에서 채우고, 흰 칸(일련번호·라벨 사용량·불량·박스 라벨 설정)만 입력해 [저장]한다.

const fmt = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? "" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function NumInput({ value, onChange, width = "w-14", placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; width?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value == null ? "" : String(value));
  }
  return (
    <input
      inputMode="numeric"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.replace(/,/g, "").trim();
        const n = t === "" ? undefined : Number(t);
        if (n !== undefined && (!Number.isFinite(n) || n < 0)) return setDraft(value == null ? "" : String(value));
        onChange(n);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${width} border border-slate-300 rounded px-1.5 py-0.5 text-right text-xs font-mono bg-white focus:outline-none focus:border-navy`}
    />
  );
}

function TextInput({ value, onChange, width = "w-40", placeholder }: { value: string; onChange: (v: string) => void; width?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${width} border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:border-navy`}
    />
  );
}

/** 박스 라벨 시트 한 장 — 모델 블록마다 카톤 번호를 이어서 매긴다 */
function boxesOf(blocks: OrderFormBlock[], input: OrderFormInput): { block: OrderFormBlock; boxes: Box[]; brand: string; color: string }[] {
  let carton = 1;
  return blocks.map((b) => {
    const s = modelBoxSettings(b.model, input);
    const boxes = buildBoxes(b, s, carton);
    if (boxes.length) carton = boxes[boxes.length - 1].carton + 1; // 다음 모델은 새 카톤부터
    const mi = input.models?.[b.model.rep_item];
    return { block: b, boxes, brand: mi?.brand || b.model.brand_default, color: mi?.color || b.model.color_default };
  });
}

function openPrint(title: string, body: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:"Malgun Gothic",sans-serif;margin:12mm;color:#111}
    h2{font-size:15px;margin:0 0 6px} h3{font-size:13px;margin:14px 0 4px}
    table{border-collapse:collapse;font-size:10.5px;width:100%} th,td{border:1px solid #888;padding:2px 4px;white-space:nowrap}
    th{background:#eee} td.r{text-align:right} .hd td{border:none;padding:1px 8px 1px 0;font-size:12px}
    .labels{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
    .lb{border:1px solid #333;padding:3mm;min-height:30mm;break-inside:avoid;font-size:12px}
    .lb .no{font-size:18px;font-weight:700;text-align:center;margin-bottom:2mm}
    .lb .br{font-weight:700;text-align:center} .lb .cl{text-align:center;margin-bottom:2mm}
    .lb .ln{display:flex;justify-content:space-between;font-size:14px;font-weight:700}
    @page{size:A4;margin:8mm}
  </style></head><body>${body}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function sheetHtml(form: OrderFormData, blocks: OrderFormBlock[], input: OrderFormInput): string {
  const f = blocks[0]?.model;
  const head = `<h2>오더양식 — ${esc(form.customer)} ${esc(form.mo_no)}</h2><table class="hd"><tr>
    <td>업체: <b>${esc(form.customer)}</b></td><td>관리번호: <b>${esc(form.mo_no)}</b></td><td>MES 관리번호: <b>${esc(form.so_nos.join(", "))}</b></td>
    <td>LOT: <b>${esc(f?.ship_lot ?? "")}</b></td><td>형명: <b>${esc(f?.model_name ?? "")}</b></td>
    <td>제조: <b>${esc(yymmdd(f?.prod_date ?? ""))}</b></td><td>유효: <b>${esc(yymmdd(blocks[0]?.expiry ?? ""))}</b></td>
    <td>일련번호: <b>${esc(input.serial ?? "")}</b></td><td>출력: <b>${esc(f?.worker ?? "")}</b></td></tr></table>`;
  const body = blocks
    .map((b) => {
      const m = b.model;
      const rows = b.rows
        .map(
          (r) => `<tr><td>${esc(m.ship_lot)}</td><td class="r">${powerText(r.power)}</td><td class="r">${fmt(r.sample)}</td><td class="r">${fmt(r.order)}</td>
          <td class="r">${fmt(r.issue)}</td><td class="r">${fmt(r.set)}</td><td>${yyyymm(m.prod_date)}</td><td>${yyyymm(b.expiry)}</td><td>${esc(r.jan)}</td>
          <td>${esc(r.qr)}</td><td>${esc(r.lot_code)}</td><td class="r">${fmt(r.use)}</td><td class="r">${fmt(r.spare)}</td><td class="r">${fmt(r.consume)}</td>
          <td class="r">${r.defect || ""}</td><td class="r">${r.defect_add || ""}</td></tr>`
        )
        .join("");
      const t = b.total;
      return `<h3>모델 ${esc(m.model)} · ${esc(input.models?.[m.rep_item]?.color || m.color_default)} · B.C ${fmt(m.bc)} · DIA ${fmt(m.dia)} · ${fmt(m.pack_unit)}개입 · 라벨 ${esc(m.labels.map((l) => `${l.code} ${l.spec}`).join(", "))}</h3>
      <table><tr><th>LOT</th><th>도수</th><th>샘플</th><th>오더</th><th>불출</th><th>SET</th><th>제조</th><th>유효기한</th><th>JAN</th><th>QR</th><th>LOT</th><th>라벨사용량</th><th>여유</th><th>소진</th><th>불량</th><th>추가불량</th></tr>
      ${rows}<tr><th colspan="2">총 계</th><th>${fmt(t.sample)}</th><th>${fmt(t.order)}</th><th>${fmt(t.issue)}</th><th>${fmt(t.set)}</th><th colspan="5"></th><th>${fmt(t.use)}</th><th>${fmt(t.spare)}</th><th>${fmt(t.consume)}</th><th colspan="2">${fmt(t.defect)}</th></tr></table>`;
    })
    .join("");
  return head + body + (input.memo ? `<p style="font-size:12px">특이사항: ${esc(input.memo)}</p>` : "");
}

function labelsHtml(form: OrderFormData, sheets: ReturnType<typeof boxesOf>): string {
  const cells = sheets
    .flatMap((s) =>
      s.boxes.map(
        (bx) => `<div class="lb"><div class="no">${bx.carton} - ${bx.box}</div><div class="br">${esc(s.brand)}</div>
        <div class="cl">${esc(s.block.model.cycle)} / ${esc(s.color)}</div>
        ${bx.lines.map((l) => `<div class="ln"><span>${esc(l.label)}</span><span>${fmt(l.qty)} SET</span></div>`).join("")}</div>`
      )
    )
    .join("");
  return `<h2>박스 라벨 — ${esc(form.customer)} ${esc(form.mo_no)}</h2><div class="labels">${cells}</div>`;
}

export default function OrderFormTab() {
  const [q, setQ] = useState("");
  const [mos, setMos] = useState<OrderFormMo[] | null>(null);
  const [mo, setMo] = useTabState<string>("procMsOrderMo", "");
  const [view, setView] = useTabState<"sheet" | "box">("procMsOrderView", "sheet");
  const [formRaw, setForm] = useState<OrderFormData | null>(null);
  const [input, setInput] = useState<OrderFormInput>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      fetch(`/api/proc/label-schedule/order-form?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { mos: OrderFormMo[] }) => setMos(d.mos))
        .catch(() => setMsg("MO 목록을 불러오지 못했습니다."));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!mo) return;
    let alive = true;
    fetch(`/api/proc/label-schedule/order-form?mo=${encodeURIComponent(mo)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error ?? String(r.status))))))
      .then((d: OrderFormData) => {
        if (!alive) return;
        setForm(d);
        setInput(d.input ?? {});
        setDirty(false);
        setMsg(null);
      })
      .catch((e: Error) => alive && setMsg(e.message || "오더양식을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [mo]);
  const form = formRaw && formRaw.mo_no === mo ? formRaw : null; // 다른 MO를 고르면 불러올 때까지 비워 둔다

  const pick = (m: string) => {
    if (dirty && !window.confirm("저장하지 않은 입력이 있습니다. 다른 MO로 바꿀까요?")) return;
    setMo(m);
  };

  const edit = (f: (i: OrderFormInput) => OrderFormInput) => {
    setInput((i) => f(i));
    setDirty(true);
  };
  const editModel = (rep: string, patch: NonNullable<OrderFormInput["models"]>[string]) =>
    edit((i) => ({ ...i, models: { ...i.models, [rep]: { ...i.models?.[rep], ...patch } } }));
  const editDefect = (code: string, k: "s" | "t", v: number | undefined) =>
    edit((i) => ({ ...i, defects: { ...i.defects, [code]: { ...i.defects?.[code], [k]: v } } }));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    const r = await fetch("/api/proc/label-schedule/order-form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mo_no: form.mo_no, input }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setMsg("저장하지 못했습니다.");
    setDirty(false);
    setMsg("저장했습니다.");
    window.setTimeout(() => setMsg((m) => (m === "저장했습니다." ? null : m)), 2000);
  };

  const blocks = useMemo(() => (form ? form.models.map((m) => buildBlock(m, input)) : []), [form, input]);
  const sheets = useMemo(() => boxesOf(blocks, input), [blocks, input]);
  const curMo = mos?.find((m) => m.mo_no === mo);

  return (
    <div className="w-full px-4 sm:px-6 py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="MO · 수주번호 · 브랜드 · 대표품목 · LOT 검색"
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72"
        />
        <select value={mo} onChange={(e) => pick(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm max-w-[34rem]">
          <option value="">— ANW MO 선택 ({mos?.length ?? 0}건) —</option>
          {mo && !curMo && <option value={mo}>{mo}</option>}
          {(mos ?? []).map((m) => (
            <option key={m.mo_no} value={m.mo_no}>
              {m.mo_no} · {m.brand.replace(/_JPN$/, "")} · {m.qty.toLocaleString()}개{m.ship_lot ? ` · ${m.ship_lot}` : " · LOT 없음"}
              {m.saved ? " · 저장됨" : ""}
            </option>
          ))}
        </select>
        {form && (
          <>
            <div className="flex rounded-md border border-slate-300 overflow-hidden text-sm ml-2">
              {(
                [
                  ["sheet", "본표"],
                  ["box", "박스 라벨"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? "bg-navy text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {l}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || busy}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${dirty ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-100 text-slate-400"}`}
              title="일련번호 · 라벨 사용량 · 불량 · 박스 라벨 설정을 저장합니다"
            >
              {busy ? "저장 중…" : dirty ? "저장 (바뀐 값 있음)" : "저장됨"}
            </button>
            <button
              type="button"
              onClick={() =>
                view === "sheet"
                  ? openPrint(`오더양식 ${form.mo_no}`, sheetHtml(form, blocks, input))
                  : openPrint(`박스 라벨 ${form.mo_no}`, labelsHtml(form, sheets))
              }
              className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:bg-slate-50"
            >
              인쇄
            </button>
            {form.updated_at && <span className="text-xs text-slate-400">마지막 저장 {form.updated_at} {form.updated_by}</span>}
          </>
        )}
        {msg && <span className="text-xs text-rose-600">{msg}</span>}
      </div>

      {!form && !msg && <div className="text-sm text-slate-400 py-10 text-center">MO를 고르면 오더양식이 열립니다. (ANW 수주만)</div>}
      {form && view === "sheet" && <Sheet form={form} blocks={blocks} input={input} edit={edit} editModel={editModel} editDefect={editDefect} />}
      {form && view === "box" && <BoxSheets sheets={sheets} input={input} editModel={editModel} />}
    </div>
  );
}

function Fact({ k, v, warn }: { k: string; v: React.ReactNode; warn?: string }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-xs text-slate-500 w-24 shrink-0">{k}</span>
      <span className={`text-sm font-medium ${warn ? "text-rose-600" : "text-slate-800"}`} title={warn}>
        {v || (warn ? "없음" : "-")}
      </span>
    </div>
  );
}

function Sheet({
  form,
  blocks,
  input,
  edit,
  editModel,
  editDefect,
}: {
  form: OrderFormData;
  blocks: OrderFormBlock[];
  input: OrderFormInput;
  edit: (f: (i: OrderFormInput) => OrderFormInput) => void;
  editModel: (rep: string, patch: NonNullable<OrderFormInput["models"]>[string]) => void;
  editDefect: (code: string, k: "s" | "t", v: number | undefined) => void;
}) {
  const f = blocks[0]?.model;
  const lots = [...new Set(blocks.map((b) => b.model.ship_lot))];
  const prods = [...new Set(blocks.map((b) => b.model.prod_date))];
  const all = blocks.reduce(
    (s, b) => ({ n: s.n + b.rows.filter((r) => r.order > 0).length, sample: s.sample + b.total.sample, order: s.order + b.total.order, issue: s.issue + b.total.issue, set: s.set + b.total.set }),
    { n: 0, sample: 0, order: 0, issue: 0, set: 0 }
  );
  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 grid gap-6 lg:grid-cols-[1fr_1fr_auto]">
        <div>
          <Fact k="업체" v={form.customer} />
          <Fact k="관리번호" v={form.mo_no} />
          <Fact k="MES 관리번호" v={form.so_nos.join(", ")} />
          <Fact k="차수" v={f?.ship_lot.slice(2)} />
          <Fact k="LOT" v={lots.join(" / ")} warn={!f?.ship_lot ? "출하LOT이 없습니다 — SALES-04 출하LOT 발행 또는 라벨일정에서 입력" : lots.length > 1 ? "모델마다 출하LOT이 다릅니다" : undefined} />
          <Fact k="형명" v={[...new Set(blocks.map((b) => b.model.model_name))].join(" / ")} />
        </div>
        <div>
          <Fact k="제조" v={prods.map(yymmdd).join(" / ")} warn={!f?.prod_date ? "생산일자가 없습니다 — 라벨일정에서 입력" : undefined} />
          <Fact
            k="유효"
            v={blocks.map((b) => yymmdd(b.expiry)).filter((v, i, a) => a.indexOf(v) === i).join(" / ")}
            warn={f?.prod_date && !f?.shelf_years ? "형명 유효기간이 없습니다 — BASE-10 형명에서 입력" : undefined}
          />
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-slate-500 w-24 shrink-0">일련번호</span>
            <TextInput value={input.serial ?? ""} onChange={(v) => edit((i) => ({ ...i, serial: v }))} width="w-32" placeholder="00000001" />
          </div>
          <Fact k="출력(작업자)" v={[...new Set(blocks.map((b) => b.model.worker).filter(Boolean))].join(", ")} />
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-slate-500 w-24 shrink-0">라벨 사용량</span>
            <NumInput value={input.label_use} onChange={(v) => edit((i) => ({ ...i, label_use: v }))} placeholder={String(DEFAULT_LABEL_USE)} />
            <span className="text-xs text-slate-400">도수마다 더하는 라벨 수(기본 {DEFAULT_LABEL_USE})</span>
          </div>
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-slate-500 w-24 shrink-0">특이사항</span>
            <TextInput value={input.memo ?? ""} onChange={(v) => edit((i) => ({ ...i, memo: v }))} width="w-64" placeholder="300EA 이상 불량 발생 시 보고" />
          </div>
        </div>
        <div className="overflow-auto">
          <table className="text-xs border border-slate-200">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left">모델</th>
                <th className="px-2 py-1 text-left">라벨코드</th>
                <th className="px-2 py-1 text-right" title="단상자 라벨 필요 수량 = 소진 합계">단상자라벨</th>
                <th className="px-2 py-1 text-right">불량</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.model.rep_item} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-mono">{b.model.model}</td>
                  <td className="px-2 py-1 font-mono" title={b.model.labels.map((l) => `${l.code} ${l.name} ${l.spec}`).join("\n")}>
                    {b.model.labels[0]?.code ?? <span className="text-rose-500">BOM 라벨 없음</span>}
                    {b.model.labels[0]?.spec && <span className="text-slate-400 ml-1">{b.model.labels[0].spec}</span>}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(b.total.consume)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(b.total.defect)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                <td className="px-2 py-1" colSpan={2}>
                  출력 도수 {all.n}개 · 샘플 {fmt(all.sample)} · 오더 {fmt(all.order)}
                </td>
                <td className="px-2 py-1 text-right font-mono" colSpan={2}>
                  불출 {fmt(all.issue)} · SET {fmt(all.set)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {blocks.map((b) => (
        <ModelBlock key={b.model.rep_item} b={b} input={input} editModel={editModel} editDefect={editDefect} />
      ))}
    </div>
  );
}

function ModelBlock({
  b,
  input,
  editModel,
  editDefect,
}: {
  b: OrderFormBlock;
  input: OrderFormInput;
  editModel: (rep: string, patch: NonNullable<OrderFormInput["models"]>[string]) => void;
  editDefect: (code: string, k: "s" | "t", v: number | undefined) => void;
}) {
  const m = b.model;
  const mi = input.models?.[m.rep_item] ?? {};
  const th = "px-2 py-1.5 font-medium";
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm">
        <span>
          모델 <b className="font-mono">{m.model}</b> <span className="text-xs text-slate-400 font-mono">{m.rep_item}</span>
        </span>
        <span className="flex items-center gap-1">
          Color <TextInput value={mi.color ?? ""} onChange={(v) => editModel(m.rep_item, { color: v })} placeholder={m.color_default} width="w-36" />
        </span>
        <span>
          B.C <b className="font-mono">{fmt(m.bc)}</b>
        </span>
        <span>
          DIA <b className="font-mono">{fmt(m.dia)}</b>
        </span>
        <span>
          입수 <b className="font-mono">{fmt(m.pack_unit)}</b>개입
        </span>
        <span>
          형명 <b>{m.model_name || "-"}</b>
        </span>
        <span>
          LOT <b className="font-mono">{m.ship_lot || "-"}</b> · 제조 <b className="font-mono">{yyyymm(m.prod_date) || "-"}</b> · 유효기한{" "}
          <b className="font-mono">{yyyymm(anwExpiry(m.prod_date, m.shelf_years)) || "-"}</b>
          {m.shelf_years ? <span className="text-xs text-slate-400"> ({m.shelf_years}년)</span> : null}
        </span>
        <span className="text-xs text-slate-500">{m.item_name}</span>
      </div>
      <div className="overflow-auto">
        <table className="text-xs whitespace-nowrap w-full">
          <thead className="text-slate-500 bg-white border-b border-slate-200">
            <tr>
              <th className={`${th} text-left`}>LOT</th>
              <th className={`${th} text-right`}>도수</th>
              <th className={`${th} text-right`} title="수주현황 샘플구분 Sample 수량(렌즈)">샘플</th>
              <th className={`${th} text-right`} title="수주현황 일반 수량(렌즈)">오더</th>
              <th className={`${th} text-right`} title="불출 = SET + 여유">불출</th>
              <th className={`${th} text-right`} title="SET = (샘플 + 오더) ÷ 입수">SET</th>
              <th className={`${th} text-left`}>제조</th>
              <th className={`${th} text-left`}>유효기한</th>
              <th className={`${th} text-left`} title="품목정보(BASE-01) JAN 코드">JAN</th>
              <th className={`${th} text-left`} title="JAN + 00 + 유효 YYMM + LOT + 모델 + 도수 + BC + DIA + 도수코드">QR</th>
              <th className={`${th} text-left`} title="출하LOT + 모델 + 도수 2자리">LOT</th>
              <th className={`${th} text-right`} title="수량이 있는 도수마다 라벨 사용량">라벨사용량</th>
              <th className={`${th} text-right`} title="SET 0초과 10 · 1000초과 15 · 3000초과 20 · 5000초과 25 · 8000초과 30 · 10000초과 35">여유</th>
              <th className={`${th} text-right`} title="소진 = 불출 + 라벨 사용량">소진</th>
              <th className={`${th} text-right`}>불량</th>
              <th className={`${th} text-right`} title="RESET 등 기존 불량을 지워야 할 때 쓰는 추가 불량칸">추가불량</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {b.rows.map((r) => (
              <tr key={r.item_code} className="hover:bg-slate-50">
                <td className="px-2 py-1">{m.ship_lot}</td>
                <td className="px-2 py-1 text-right font-semibold">{powerText(r.power)}</td>
                <td className="px-2 py-1 text-right">{fmt(r.sample) || <span className="text-slate-300">0</span>}</td>
                <td className="px-2 py-1 text-right">{fmt(r.order)}</td>
                <td className="px-2 py-1 text-right font-semibold">{fmt(r.issue)}</td>
                <td className="px-2 py-1 text-right">{fmt(r.set)}</td>
                <td className="px-2 py-1">{yyyymm(m.prod_date)}</td>
                <td className="px-2 py-1">{yyyymm(b.expiry)}</td>
                <td className="px-2 py-1">{r.jan || <span className="text-rose-500 font-sans">없음</span>}</td>
                <td className="px-2 py-1 text-[11px] text-slate-600">{r.qr}</td>
                <td className="px-2 py-1">{r.lot_code}</td>
                <td className="px-2 py-1 text-right">{fmt(r.use)}</td>
                <td className="px-2 py-1 text-right">{fmt(r.spare)}</td>
                <td className="px-2 py-1 text-right font-semibold">{fmt(r.consume)}</td>
                <td className="px-1 py-0.5 text-right">
                  <NumInput value={input.defects?.[r.item_code]?.s} onChange={(v) => editDefect(r.item_code, "s", v)} width="w-12" />
                </td>
                <td className="px-1 py-0.5 text-right">
                  <NumInput value={input.defects?.[r.item_code]?.t} onChange={(v) => editDefect(r.item_code, "t", v)} width="w-12" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-mono font-semibold border-t border-slate-200">
            <tr>
              <td className="px-2 py-1.5 font-sans" colSpan={2}>
                총 계
              </td>
              <td className="px-2 py-1.5 text-right">{fmt(b.total.sample)}</td>
              <td className="px-2 py-1.5 text-right">{fmt(b.total.order)}</td>
              <td className="px-2 py-1.5 text-right">{fmt(b.total.issue)}</td>
              <td className="px-2 py-1.5 text-right">{fmt(b.total.set)}</td>
              <td colSpan={5} />
              <td className="px-2 py-1.5 text-right">{fmt(b.total.use)}</td>
              <td className="px-2 py-1.5 text-right">{fmt(b.total.spare)}</td>
              <td className="px-2 py-1.5 text-right">{fmt(b.total.consume)}</td>
              <td className="px-2 py-1.5 text-right" colSpan={2}>
                {fmt(b.total.defect)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BoxSheets({
  sheets,
  input,
  editModel,
}: {
  sheets: ReturnType<typeof boxesOf>;
  input: OrderFormInput;
  editModel: (rep: string, patch: NonNullable<OrderFormInput["models"]>[string]) => void;
}) {
  return (
    <div className="space-y-3">
      {sheets.map(({ block, boxes, brand, color }) => {
        const m: OrderFormModel = block.model;
        const s = modelBoxSettings(m, input);
        const mi = input.models?.[m.rep_item] ?? {};
        const last = boxes[boxes.length - 1];
        return (
          <div key={m.rep_item} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm">
              <span>
                모델 <b className="font-mono">{m.model}</b>
              </span>
              <span className="flex items-center gap-1">
                브랜드 <TextInput value={mi.brand ?? ""} onChange={(v) => editModel(m.rep_item, { brand: v })} placeholder={m.brand_default} width="w-32" />
              </span>
              <span className="flex items-center gap-1">
                Color <TextInput value={mi.color ?? ""} onChange={(v) => editModel(m.rep_item, { color: v })} placeholder={m.color_default} width="w-36" />
              </span>
              <span className="flex items-center gap-1">
                박스
                {(["소", "중"] as BoxKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => editModel(m.rep_item, { box_kind: k, per_box: undefined })}
                    className={`px-2 py-0.5 rounded border text-xs ${s.box_kind === k ? "bg-navy text-white border-navy" : "bg-white border-slate-300 text-slate-600"}`}
                    title={k === "소" ? "소박스 — 카톤당 6개, 박스당 SET 기본 = 품목정보 1 Box 수량" : "중박스 — 카톤당 2개, 박스당 SET 기본 = 품목정보 2 Box 수량"}
                  >
                    {k}
                  </button>
                ))}
              </span>
              <span className="flex items-center gap-1">
                행
                {([1, 2] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => editModel(m.rep_item, { box_rows: k })}
                    className={`px-2 py-0.5 rounded border text-xs ${s.box_rows === k ? "bg-navy text-white border-navy" : "bg-white border-slate-300 text-slate-600"}`}
                    title={k === 1 ? "한 박스에 도수 1개 — 도수가 바뀌면 새 박스" : "한 박스에 도수 2개까지 — 앞 도수가 남으면 다음 도수로 채움"}
                  >
                    {k}행
                  </button>
                ))}
              </span>
              <span className="flex items-center gap-1">
                박스당 SET
                <NumInput value={mi.per_box} onChange={(v) => editModel(m.rep_item, { per_box: v })} placeholder={String((s.box_kind === "중" ? m.box2 : m.box1) ?? "")} />
              </span>
              <span className="text-xs text-slate-500">
                박스 {boxes.length}개{last ? ` · 카톤 ${boxes[0].carton}~${last.carton}` : ""}
              </span>
            </div>
            {!(s.per_box > 0) ? (
              <div className="text-sm text-rose-600 px-4 py-6">박스당 SET을 입력해 주세요(품목정보에 박스 수량이 없습니다).</div>
            ) : (
              <div className="p-3 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {boxes.map((bx) => (
                  <div key={`${bx.carton}-${bx.box}`} className="border border-slate-300 rounded p-2 text-xs">
                    <div className="text-center text-base font-bold font-mono">
                      {bx.carton} - {bx.box}
                    </div>
                    <div className="text-center font-semibold">{brand}</div>
                    <div className="text-center text-slate-500 mb-1">
                      {m.cycle} / {color}
                    </div>
                    {bx.lines.map((l, i) => (
                      <div key={i} className={`flex justify-between font-mono font-semibold ${l.label === "SAMPLE" ? "text-amber-700" : ""}`}>
                        <span>{l.label}</span>
                        <span>{fmt(l.qty)} SET</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-400 px-1">
        오더 SET(오더 ÷ 입수)을 도수 순서대로 박스당 SET만큼 채웁니다. SAMPLE = 샘플 SET의 절반(도수별 2팩 중 1팩은 마지막 박스, 1팩은 영업팀). 모델이 바뀌면 새 카톤부터 이어서 매깁니다.
      </p>
    </div>
  );
}
