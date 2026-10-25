"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelName, ModelNameLot } from "@/lib/model-names";

// 공통정보(BASE-10) 형명 탭 — "형명식별기호 관리" 화면(2026-10-26 사용자 시안 MES_형명식별기호_관리대장.html대로 다시 디자인).
// 데이터는 F706-3 형명식별기호 관리대장(개정본) 그대로. 원료로트(품목구분·원료 LOT·형명식별) 하나가 목록의 한 줄이다.
// 위에 요약 카드 4개, 검색·필터, 페이지 없이 전체 목록 스크롤(열 제목까지 고정), 줄을 누르면 상세 카드 창 → "수정"으로 그 형명을 고치는 창.
// 유효기간은 여기가 원본(라벨일정 유통기한·Packing List 유효기간이 이 값을 쓴다).

type Draft = Omit<ModelName, "updated_at" | "updated_by" | "item_count"> & { isNew: boolean };

/** 목록 한 줄 = 형명 × 원료로트 */
type Row = { m: ModelName; lot: ModelNameLot; first: boolean };

const EMPTY_LOT: ModelNameLot = { item_class: "", raw_lot: "", symbol: "" };

const EMPTY: Draft = {
  isNew: true,
  model_name: "",
  list_no: null,
  permit_item: "",
  shelf_years: null,
  pack_vial: "",
  pack_blister: "",
  use_period: "",
  use_period_cn: "",
  reg_countries: "",
  export_countries: "",
  uv_yn: "N",
  ph: "",
  material_type: "",
  material_code: "",
  note: "",
  use_yn: "Y",
  lots: [{ ...EMPTY_LOT }],
};

const USE_PERIODS = ["Daily", "Monthly", "Half yearly", "Yearly", "Extended"];

// 시안 색 — 남색 #14263d, 파랑 #356df3, 글자 #172438, 흐린 글자 #718096, 선 #e6ebf2
const ctl = "border border-[#dfe6ef] rounded-[9px] bg-white text-[13px] text-[#35445a] outline-none focus:border-[#7196ff] focus:ring-[3px] focus:ring-[#356df318]";
const btn = "border border-[#e6ebf2] bg-white text-[#35445a] px-[13px] py-[9px] rounded-[9px] font-bold text-[13px] hover:bg-[#f7f9ff] disabled:opacity-50";
const btnPrimary = "border border-[#356df3] bg-[#356df3] text-white px-[13px] py-[9px] rounded-[9px] font-bold text-[13px] hover:opacity-90 disabled:opacity-50";
const inp = `${ctl} px-2.5 py-1.5 disabled:bg-slate-50`;

const dash = (v: string | number | null | undefined) => (v == null || String(v).trim() === "" ? "—" : String(v));

function Pill({ children, kind = "blue" }: { children: React.ReactNode; kind?: "blue" | "gray" | "warn" | "good" }) {
  const cls = {
    blue: "bg-[#edf3ff] text-[#315fcb]",
    gray: "bg-[#f0f2f5] text-[#667386]",
    warn: "bg-[#fff4df] text-[#9a650b]",
    good: "bg-[#e7f7f1] text-[#16866b]",
  }[kind];
  return <span className={`inline-block px-[7px] py-1 rounded-md text-[11px] font-bold ${cls}`}>{children}</span>;
}

function Stat({ label, icon, value, hint, warn }: { label: string; icon: string; value: number | string; hint: string; warn?: boolean }) {
  return (
    <div className="bg-white border border-[#e6ebf2] rounded-[12px] px-3.5 py-2.5 shadow-[0_2px_8px_#1b2c4405] flex items-center gap-3">
      <span className={`shrink-0 w-[26px] h-[26px] rounded-[8px] grid place-items-center text-[13px] ${warn ? "bg-[#fff4df] text-[#b7791f]" : "bg-[#eef3ff] text-[#356df3]"}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] text-[#718096] leading-tight">{label}</div>
        <div className="text-[11px] text-[#8b98a9] leading-tight mt-0.5 truncate">{hint}</div>
      </div>
      <div className="ml-auto text-[22px] font-extrabold tracking-[-0.5px] text-[#172438] leading-none">{value}</div>
    </div>
  );
}

export default function ModelNameTab() {
  const [models, setModels] = useState<ModelName[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [period, setPeriod] = useState("");
  const [years, setYears] = useState("");
  const [uv, setUv] = useState("");
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/common-info/model-names", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { rows: ModelName[] }) => alive && setModels(d.rows))
      .catch(() => alive && setError("형명 목록을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo<Row[]>(
    () => (models ?? []).flatMap((m) => (m.lots.length ? m.lots : [EMPTY_LOT]).map((lot, k) => ({ m, lot, first: k === 0 }))),
    [models]
  );
  const uniq = (vals: string[]) => [...new Set(vals.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const cats = useMemo(() => uniq(all.map((r) => r.lot.item_class)), [all]);
  const yearList = useMemo(() => [...new Set((models ?? []).map((m) => m.shelf_years))].sort((a, b) => (a ?? 999) - (b ?? 999)), [models]);
  const periods = useMemo(() => uniq((models ?? []).map((m) => m.use_period)), [models]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return all.filter(({ m, lot }) => {
      const hay = [m.list_no, m.permit_item, m.model_name, lot.item_class, lot.raw_lot, lot.symbol, m.material_code, m.reg_countries, m.export_countries, m.note]
        .join(" ")
        .toLowerCase();
      return (
        (!kw || hay.includes(kw)) &&
        (!cat || lot.item_class === cat) &&
        (!period || m.use_period === period) &&
        (!years || String(m.shelf_years ?? "none") === years) &&
        (!uv || m.uv_yn === uv) &&
        (!status || (status === "note" ? !!m.note : status === "normal" ? !m.note && m.use_yn === "Y" : m.use_yn === "N"))
      );
    });
  }, [all, q, cat, period, years, uv, status]);


  const permitCount = new Set((models ?? []).map((m) => (m.list_no != null ? `#${m.list_no}` : m.permit_item))).size;

  const openEdit = (m: ModelName | null) => {
    setDetail(null);
    setDraft(m ? { ...structuredClone(m), isNew: false, lots: m.lots.length ? structuredClone(m.lots) : [{ ...EMPTY_LOT }] } : structuredClone(EMPTY));
  };

  const exportCsv = () => {
    const labels = ["관리번호", "허가품목", "형명", "품목구분", "원료LOT", "형명식별", "원료구분", "원료기호", "유효기간", "Vial", "Blister", "사용기간", "중국 사용기간", "등록국가", "수출국가", "UV", "pH", "비고", "사용여부"];
    const body = filtered.map(({ m, lot }) => [
      m.list_no ?? "", m.permit_item, m.model_name, lot.item_class, lot.raw_lot, lot.symbol, m.material_type, m.material_code, m.shelf_years ?? "",
      m.pack_vial, m.pack_blister, m.use_period, m.use_period_cn, m.reg_countries, m.export_countries, m.uv_yn === "Y" ? "○" : "-", m.ph, m.note, m.use_yn,
    ]);
    const csv = "﻿" + [labels, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = "형명식별기호_관리목록.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="px-4 sm:px-6 py-5 text-[14px] text-[#172438]">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="관리 레코드" icon="▤" value={models ? all.length.toLocaleString("ko-KR") : "—"} hint="형명 / 품목구분 기준" />
        <Stat label="허가 품목 수" icon="◈" value={models ? permitCount : "—"} hint="원본 대장 기준" />
        <Stat label="UV 적용" icon="☼" value={models ? all.filter((r) => r.m.uv_yn === "Y").length : "—"} hint="UV 표시가 ○ 인 레코드" />
        <Stat label="확인 필요" icon="!" warn value={models ? all.filter((r) => r.m.note).length : "—"} hint="비고에 별도 상태가 기재된 항목" />
      </section>

      <section className="bg-white border border-[#e6ebf2] rounded-[14px] overflow-hidden shadow-[0_2px_8px_#1b2c4405]">
        <div className="px-[22px] py-4 flex flex-wrap items-center gap-2">
          <select className={`${ctl} py-[10px] pl-[11px] pr-8`} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">전체 품목구분</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={`${ctl} py-[10px] pl-[11px] pr-8`} value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="">전체 사용기간</option>
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className={`${ctl} py-[10px] pl-[11px] pr-8`} value={years} onChange={(e) => setYears(e.target.value)}>
            <option value="">전체 유효기간</option>
            {yearList.map((y) => <option key={y ?? "none"} value={y ?? "none"}>{y != null ? `${y}년` : "유효기간 없음"}</option>)}
          </select>
          <select className={`${ctl} py-[10px] pl-[11px] pr-8`} value={uv} onChange={(e) => setUv(e.target.value)}>
            <option value="">UV 전체</option>
            <option value="Y">UV 적용</option>
            <option value="N">UV 미적용</option>
          </select>
          <select className={`${ctl} py-[10px] pl-[11px] pr-8`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">전체 상태</option>
            <option value="note">비고 있음</option>
            <option value="normal">일반</option>
            <option value="off">사용 안 함</option>
          </select>
          <div className="relative w-[300px] max-w-full">
            <span className="absolute left-3 top-2.5 text-[#8290a4]">⌕</span>
            <input className={`${ctl} w-full py-[10px] pl-9 pr-3`} placeholder="품목명, 형명, 원료 LOT, 식별기호 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Pill kind="gray">{models ? `${filtered.length}건` : "전체"}</Pill>
            <button className={`${btn} !py-[10px]`} onClick={exportCsv} disabled={!models}>↓ 엑셀용 CSV</button>
            <button className={`${btnPrimary} !py-[10px]`} onClick={() => openEdit(null)}>＋ 신규 등록</button>
          </div>
        </div>
        {error && <div className="mx-[22px] mb-4 px-3 py-2 rounded-[9px] bg-red-50 text-red-700 text-[13px]">{error}</div>}
        <div className="overflow-auto border-t border-[#e6ebf2] max-h-[calc(100vh-355px)] min-h-[240px]">
          <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-[12px]">
            <thead>
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-[#f8fafd] [&>th]:text-[#637187] [&>th]:font-bold [&>th]:text-left [&>th]:px-3.5 [&>th]:py-[13px] [&>th]:border-b [&>th]:border-[#e6ebf2]">
                <th>NO.</th><th>허가품목</th><th>형명</th><th>품목구분</th><th>원료 LOT</th><th>형명식별</th><th>유효기간</th><th>포장</th><th>사용기간</th><th>UV</th><th>비고</th>
              </tr>
            </thead>
            <tbody>
              {!models && !error && (
                <tr><td colSpan={11} className="text-center p-11 text-[#718096]">데이터를 불러오는 중</td></tr>
              )}
              {models && filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center p-11 text-[#718096]">검색 결과가 없습니다.</td></tr>
              )}
              {filtered.map((r) => {
                const { m, lot, first } = r;
                const off = m.use_yn === "N";
                return (
                  <tr
                    key={`${m.model_name}|${lot.raw_lot}|${lot.symbol}`}
                    onClick={() => setDetail(r)}
                    className={`cursor-pointer hover:bg-[#dce7ff] [&>td]:px-3.5 [&>td]:py-[13px] [&>td]:border-b [&>td]:border-[#edf1f6] ${off ? "[&>td]:text-[#a0aec0]" : "[&>td]:text-[#344258]"}`}
                  >
                    <td>{dash(m.list_no)}</td>
                    <td className="font-bold !text-[#26364c] whitespace-pre-line">{m.permit_item}</td>
                    <td className={`font-extrabold ${first ? "!text-[#244fbd]" : "!text-[#9fb3e3]"}`}>{m.model_name}</td>
                    <td><Pill>{dash(lot.item_class)}</Pill></td>
                    <td>{dash(lot.raw_lot)}</td>
                    <td><b>{dash(lot.symbol)}</b></td>
                    <td>{m.shelf_years != null ? `${m.shelf_years}년` : "—"}</td>
                    <td>{`Vial ${dash(m.pack_vial)} / Blister ${dash(m.pack_blister)}`}</td>
                    <td>{dash(m.use_period)}</td>
                    <td>{m.uv_yn === "Y" ? <Pill kind="good">UV 적용</Pill> : <Pill kind="gray">-</Pill>}</td>
                    <td>
                      <span className="inline-flex gap-1">
                        {m.note ? <Pill kind="warn">{m.note}</Pill> : !off && "—"}
                        {off && <Pill kind="gray">사용 안 함</Pill>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="text-[11px] text-[#8a97a8] mt-4 leading-relaxed">
        ※ 원본: F706-3 형명식별기호 관리대장(관리용, 제/개정 2025.12.09). 유효기간은 라벨일정(PROC-06) · Packing List(SALES-04)가 같이 씁니다. 변경 내용은 기준정보변경이력(BASE-20)에 남습니다.
      </div>

      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} onEdit={() => openEdit(detail.m)} />}
      {draft && (
        <EditModal
          draft={draft}
          setDraft={setDraft}
          onSaved={(d) => {
            setModels(d);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

function ModalShell({ crumb, title, sub, onClose, children, footer, width = 760 }: {
  crumb: string; title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-[#0d1a2d70] flex items-center justify-center p-5" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-[0_25px_80px_#07162b40] text-[#172438]" style={{ maxWidth: width }}>
        <div className="px-6 py-[22px] border-b border-[#e6ebf2] flex justify-between items-start">
          <div>
            <div className="text-[12px] text-[#718096] mb-2">{crumb}</div>
            <h3 className="text-[21px] font-extrabold m-0 mb-1.5 whitespace-pre-line">{title}</h3>
            {sub && <div className="text-[13px] text-[#718096]">{sub}</div>}
          </div>
          <button className="border-0 bg-[#f0f3f8] rounded-lg px-[11px] py-[7px] text-[13px]" onClick={onClose}>✕ 닫기</button>
        </div>
        <div className="px-6 py-[22px] overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-[#e6ebf2] flex items-center gap-2">{footer}</div>}
      </div>
    </div>
  );
}

function DetailModal({ row, onClose, onEdit }: { row: Row; onClose: () => void; onEdit: () => void }) {
  const { m, lot } = row;
  const fields: [string, string][] = [
    ["형명", m.model_name],
    ["품목구분", lot.item_class],
    ["원료 LOT 식별", lot.raw_lot],
    ["형명 식별기호", lot.symbol],
    ["원료 구분", m.material_type],
    ["원료 기호", m.material_code],
    ["유효기간", m.shelf_years != null ? `${m.shelf_years}년` : ""],
    ["Vial 포장", m.pack_vial],
    ["Blister 포장", m.pack_blister],
    ["사용기간(국내·해외)", m.use_period],
    ["사용기간(중국)", m.use_period_cn],
    ["UV", m.uv_yn === "Y" ? "○" : "-"],
    ["pH", m.ph],
    ["등록국가", m.reg_countries],
    ["수출국가", m.export_countries],
  ];
  return (
    <ModalShell
      crumb="MASTER DATA / 상세 정보"
      title={m.permit_item || m.model_name}
      sub={`형명 ${m.model_name} · 관리번호 ${dash(m.list_no)} · 이 형명의 원료로트 ${m.lots.length}개 · 사용 품목 ${m.item_count.toLocaleString("ko-KR")}개${m.use_yn === "N" ? " · 사용 안 함" : ""}`}
      onClose={onClose}
      footer={
        <>
          <span className="text-[12px] text-[#8a97a8]">{m.updated_at ? `최근 변경 ${m.updated_at.slice(0, 16)} ${m.updated_by ?? ""}` : ""}</span>
          <button className={`${btnPrimary} ml-auto`} onClick={onEdit}>수정</button>
        </>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {fields.map(([k, v]) => (
          <div key={k} className="border border-[#e6ebf2] rounded-[10px] p-3">
            <label className="block text-[11px] text-[#718096] mb-1.5">{k}</label>
            <strong className="text-[13px] whitespace-pre-wrap break-words">{dash(v)}</strong>
          </div>
        ))}
      </div>
      {m.note && <div className="mt-3.5 bg-[#fff8e8] border border-[#f5e6c4] px-[13px] py-[11px] rounded-[9px] text-[#825d16] text-[13px]">비고: {m.note}</div>}
    </ModalShell>
  );
}

function EditModal({ draft, setDraft, onSaved }: { draft: Draft; setDraft: (d: Draft | null) => void; onSaved: (rows: ModelName[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const setLot = (i: number, k: keyof ModelNameLot, v: string) => set("lots", draft.lots.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const send = async (method: "POST" | "PUT" | "DELETE") => {
    setBusy(true);
    setErr(null);
    try {
      const url = method === "DELETE" ? `/api/common-info/model-names?name=${encodeURIComponent(draft.model_name)}` : "/api/common-info/model-names";
      const { isNew: _, ...body } = draft;
      void _;
      const r = await fetch(url, {
        method,
        headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "저장하지 못했습니다.");
      onSaved(d.rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, el: React.ReactNode, cls = "") => (
    <label className={`flex flex-col gap-1.5 ${cls}`}>
      <span className="text-[#718096] text-[11px]">{label}</span>
      {el}
    </label>
  );
  const section = (title: string, children: React.ReactNode) => (
    <div>
      <div className="text-[12px] font-extrabold text-[#14263d] mb-2.5">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{children}</div>
    </div>
  );
  const packSelect = (k: "pack_vial" | "pack_blister") => {
    const v = draft[k];
    return (
      <select className={inp} value={v} onChange={(e) => set(k, e.target.value)}>
        <option value="">(없음)</option>
        <option value="O">O</option>
        {v !== "" && v !== "O" && <option value={v}>{v}</option>}
      </select>
    );
  };
  const periodInput = (k: "use_period" | "use_period_cn") => (
    <input className={inp} list="model-name-use-periods" value={draft[k]} onChange={(e) => set(k, e.target.value)} placeholder="예: Daily" />
  );

  return (
    <ModalShell
      crumb={draft.isNew ? "MASTER DATA / 신규 등록" : "MASTER DATA / 수정"}
      title={draft.isNew ? "형명 신규 등록" : `형명 ${draft.model_name}`}
      sub={draft.isNew ? undefined : draft.permit_item}
      onClose={() => setDraft(null)}
      width={840}
      footer={
        <>
          {!draft.isNew &&
            (askDelete ? (
              <span className="flex items-center gap-2 text-red-700 text-[13px]">
                정말 삭제할까요?
                <button className={btn} disabled={busy} onClick={() => send("DELETE")}>삭제</button>
                <button className={btn} onClick={() => setAskDelete(false)}>그만두기</button>
              </span>
            ) : (
              <button className={btn} disabled={busy} onClick={() => setAskDelete(true)}>삭제</button>
            ))}
          {err && <span className="text-red-700 text-[13px]">{err}</span>}
          <button className={`${btn} ml-auto`} onClick={() => setDraft(null)}>닫기</button>
          <button className={btnPrimary} disabled={busy || !draft.model_name.trim()} onClick={() => send(draft.isNew ? "POST" : "PUT")}>저장</button>
        </>
      }
    >
      <datalist id="model-name-use-periods">
        {USE_PERIODS.map((p) => <option key={p} value={p} />)}
      </datalist>
      <div className="space-y-5 text-[13px]">
        {section(
          "기본",
          <>
            {field("형명", <input className={`${inp} font-mono`} value={draft.model_name} disabled={!draft.isNew} onChange={(e) => set("model_name", e.target.value)} placeholder="예: 38-HR" />)}
            {field("관리번호(연번)", <input type="number" className={inp} value={draft.list_no ?? ""} onChange={(e) => set("list_no", e.target.value === "" ? null : Number(e.target.value))} />)}
            {field("허가품목", <input className={`${inp} w-full`} value={draft.permit_item} onChange={(e) => set("permit_item", e.target.value)} />, "col-span-2")}
            {field("사용여부", (
              <select className={inp} value={draft.use_yn} onChange={(e) => set("use_yn", e.target.value as "Y" | "N")}>
                <option value="Y">Y</option>
                <option value="N">N</option>
              </select>
            ))}
            {field("비고", <input className={`${inp} w-full`} value={draft.note} onChange={(e) => set("note", e.target.value)} placeholder="예: 취하예정" />, "col-span-1 sm:col-span-3")}
          </>
        )}
        {section(
          "국가별 등급",
          <>
            {field("유효기간(년)", <input type="number" className={inp} value={draft.shelf_years ?? ""} onChange={(e) => set("shelf_years", e.target.value === "" ? null : Number(e.target.value))} />)}
            {field("Vial 포장", packSelect("pack_vial"))}
            {field("Blister 포장", packSelect("pack_blister"))}
            <div className="hidden sm:block" />
            {field("사용기간(국내·해외)", periodInput("use_period"))}
            {field("사용기간(중국)", periodInput("use_period_cn"))}
            {field("등록국가", <input className={`${inp} w-full`} value={draft.reg_countries} onChange={(e) => set("reg_countries", e.target.value)} placeholder="예: KGMP, CFDA" />, "col-span-2")}
            {field("수출국가", <input className={`${inp} w-full`} value={draft.export_countries} onChange={(e) => set("export_countries", e.target.value)} placeholder="예: 중국, 국내" />, "col-span-2")}
          </>
        )}
        {section(
          "원료",
          <>
            {field("UV", (
              <select className={inp} value={draft.uv_yn} onChange={(e) => set("uv_yn", e.target.value as "Y" | "N")}>
                <option value="Y">○ (UV 적용)</option>
                <option value="N">- (미적용)</option>
              </select>
            ))}
            {field("pH", <input className={inp} value={draft.ph} onChange={(e) => set("ph", e.target.value)} placeholder="예: 4.5 ~ 7.5" />)}
            {field("원료 구분", <input className={inp} value={draft.material_type} onChange={(e) => set("material_type", e.target.value)} placeholder="HD / PC" />)}
            {field("원료 기호", <input className={`${inp} font-mono`} value={draft.material_code} onChange={(e) => set("material_code", e.target.value)} />)}
          </>
        )}
        <div>
          <div className="text-[12px] font-extrabold text-[#14263d] mb-2.5">품목구분 · 원료 LOT 식별 → 형명 식별기호</div>
          <div className="space-y-1.5">
            {draft.lots.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className={`${inp} w-40`} value={l.item_class} onChange={(e) => setLot(i, "item_class", e.target.value)} placeholder="품목구분 (예: 칼라)" />
                <input className={`${inp} w-32 font-mono`} value={l.raw_lot} onChange={(e) => setLot(i, "raw_lot", e.target.value)} placeholder="원료 LOT (예: 38C)" />
                <span className="text-[#8290a4]">→</span>
                <input className={`${inp} w-24 font-mono`} value={l.symbol} onChange={(e) => setLot(i, "symbol", e.target.value)} placeholder="기호 (예: E1)" />
                <button className="text-[#8290a4] hover:text-red-600 px-1" onClick={() => set("lots", draft.lots.filter((_, j) => j !== i))} title="줄 삭제">✕</button>
              </div>
            ))}
            <button className={btn} onClick={() => set("lots", [...draft.lots, { ...EMPTY_LOT }])}>＋ 줄 추가</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
