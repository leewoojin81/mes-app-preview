"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelName, ModelNameLot } from "@/lib/model-names";

// 공통정보(BASE-10) 형명 탭 — F706-3 형명식별기호 관리대장과 같은 칸. 줄을 누르면 고치는 창이 열린다.
// 유효기간은 여기가 원본(라벨일정 유통기한·Packing List 유효기간이 이 값을 쓴다).

type Draft = Omit<ModelName, "updated_at" | "updated_by" | "item_count"> & { isNew: boolean };

const EMPTY: Draft = {
  isNew: true,
  model_name: "",
  list_no: null,
  permit_item: "",
  shelf_years: null,
  uv_yn: "N",
  ph: "",
  material_type: "",
  material_code: "",
  note: "",
  use_yn: "Y",
  lots: [{ raw_lot: "", symbol: "" }],
};

const inp = "border border-slate-300 rounded px-2 py-1 text-[13px] bg-white disabled:bg-slate-50";
const btn = "px-3 py-1.5 text-[13px] rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50";
const btnMain = "px-3 py-1.5 text-[13px] rounded bg-navy text-white hover:opacity-90 disabled:opacity-50";

export default function ModelNameTab() {
  const [rows, setRows] = useState<ModelName[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/common-info/model-names", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { rows: ModelName[] }) => alive && setRows(d.rows))
      .catch(() => alive && setError("형명 목록을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (showAll || r.use_yn === "Y") &&
        (!kw ||
          [r.model_name, r.permit_item, r.material_code, r.note, ...r.lots.flatMap((l) => [l.raw_lot, l.symbol])].some((v) => (v ?? "").toLowerCase().includes(kw)))
    );
  }, [rows, q, showAll]);

  return (
    <div className="px-4 sm:px-6 py-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className={`${inp} w-72`} placeholder="형명 · 허가품목 · 원료로트 · 형명식별" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-slate-600">
          <input type="checkbox" checked={!showAll} onChange={(e) => setShowAll(!e.target.checked)} />
          사용 중만
        </label>
        <span className="text-slate-500">{shown.length}개</span>
        <span className="text-slate-400">출처: F706-3 형명식별기호 관리대장(2025-12-12) · 유효기간은 라벨일정(PROC-06) · Packing List(SALES-04)가 같이 씀</span>
        <button className={`${btnMain} ml-auto`} onClick={() => setDraft(structuredClone(EMPTY))}>형명 추가</button>
      </div>
      {error && <div className="mb-3 px-3 py-2 rounded bg-red-50 text-red-700">{error}</div>}
      <div className="border border-slate-200 rounded bg-white overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium [&>th]:border-b [&>th]:border-slate-200">
              <th>연번</th><th className="text-left">허가품목</th><th className="text-left">형명</th><th>유효기간<br />(years)</th>
              <th className="text-left">원료로트 식별 → 형명식별</th><th>UV</th><th>pH</th><th>원료 구분</th><th>원료 기호</th>
              <th className="text-right">사용 품목</th><th>사용</th><th className="text-left">비고</th>
            </tr>
          </thead>
          <tbody>
            {!rows && !error && <tr><td colSpan={12} className="p-6 text-center text-slate-400">불러오는 중…</td></tr>}
            {shown.map((r, i) => {
              const sameItem = i > 0 && shown[i - 1].list_no != null && shown[i - 1].list_no === r.list_no;
              return (
                <tr
                  key={r.model_name}
                  onClick={() => setDraft({ ...structuredClone(r), isNew: false, lots: r.lots.length ? structuredClone(r.lots) : [{ raw_lot: "", symbol: "" }] })}
                  className={`cursor-pointer hover:bg-blue-50 ${sameItem ? "" : "border-t border-slate-200"} ${r.use_yn === "N" ? "text-slate-400" : ""}`}
                >
                  <td className="px-2 py-1 text-center">{sameItem ? "" : r.list_no ?? ""}</td>
                  <td className="px-2 py-1">{sameItem ? "" : r.permit_item}</td>
                  <td className="px-2 py-1 font-mono font-semibold">{r.model_name}</td>
                  <td className="px-2 py-1 text-center">{r.shelf_years ?? <span className="text-red-500">-</span>}</td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      {r.lots.map((l, k) => (
                        <span key={k} className="font-mono text-[12px] px-1.5 rounded bg-slate-100">
                          {l.raw_lot || "-"} → <b>{l.symbol || "-"}</b>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-center">{r.uv_yn === "Y" ? "○" : "-"}</td>
                  <td className="px-2 py-1 text-center">{r.ph || "-"}</td>
                  <td className="px-2 py-1 text-center">{r.material_type}</td>
                  <td className="px-2 py-1 text-center font-mono">{r.material_code}</td>
                  <td className="px-2 py-1 text-right">{r.item_count ? r.item_count.toLocaleString("ko-KR") : <span className="text-slate-400">0</span>}</td>
                  <td className="px-2 py-1 text-center">{r.use_yn}</td>
                  <td className="px-2 py-1">{r.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {draft && <EditModal draft={draft} setDraft={setDraft} onSaved={(d) => { setRows(d); setDraft(null); }} />}
    </div>
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

  const field = (label: string, el: React.ReactNode) => (
    <label className="flex flex-col gap-1">
      <span className="text-slate-500 text-[12px]">{label}</span>
      {el}
    </label>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDraft(null)} />
      <div className="fixed z-50 top-[8vh] left-1/2 -translate-x-1/2 w-[min(720px,calc(100%-32px))] bg-white rounded shadow-xl text-[13px]">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center">
          <b className="text-navy">{draft.isNew ? "형명 추가" : `형명 ${draft.model_name}`}</b>
          <button className="ml-auto text-slate-400 hover:text-slate-700 text-lg" onClick={() => setDraft(null)} aria-label="닫기">×</button>
        </div>
        <div className="p-4 grid grid-cols-4 gap-3">
          {field("형명", <input className={`${inp} font-mono`} value={draft.model_name} disabled={!draft.isNew} onChange={(e) => set("model_name", e.target.value)} placeholder="예: 38-HR" />)}
          {field("연번", <input type="number" className={inp} value={draft.list_no ?? ""} onChange={(e) => set("list_no", e.target.value === "" ? null : Number(e.target.value))} />)}
          <div className="col-span-2">{field("허가품목", <input className={`${inp} w-full`} value={draft.permit_item} onChange={(e) => set("permit_item", e.target.value)} />)}</div>
          {field("유효기간(년)", <input type="number" className={inp} value={draft.shelf_years ?? ""} onChange={(e) => set("shelf_years", e.target.value === "" ? null : Number(e.target.value))} />)}
          {field("UV", (
            <select className={inp} value={draft.uv_yn} onChange={(e) => set("uv_yn", e.target.value as "Y" | "N")}>
              <option value="Y">○ (있음)</option>
              <option value="N">- (없음)</option>
            </select>
          ))}
          {field("pH", <input className={inp} value={draft.ph} onChange={(e) => set("ph", e.target.value)} placeholder="예: 4.5 ~ 7.5" />)}
          {field("사용여부", (
            <select className={inp} value={draft.use_yn} onChange={(e) => set("use_yn", e.target.value as "Y" | "N")}>
              <option value="Y">Y</option>
              <option value="N">N</option>
            </select>
          ))}
          {field("원료 구분", <input className={inp} value={draft.material_type} onChange={(e) => set("material_type", e.target.value)} placeholder="HD / PC" />)}
          {field("원료 기호", <input className={`${inp} font-mono`} value={draft.material_code} onChange={(e) => set("material_code", e.target.value)} />)}
          <div className="col-span-2">{field("비고", <input className={`${inp} w-full`} value={draft.note} onChange={(e) => set("note", e.target.value)} />)}</div>
          <div className="col-span-4">
            <div className="text-slate-500 text-[12px] mb-1">원료로트 식별 → 형명식별 기호</div>
            <div className="space-y-1">
              {draft.lots.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${inp} w-32 font-mono`} value={l.raw_lot} onChange={(e) => setLot(i, "raw_lot", e.target.value)} placeholder="원료로트 (예: 38C)" />
                  <span className="text-slate-400">→</span>
                  <input className={`${inp} w-24 font-mono`} value={l.symbol} onChange={(e) => setLot(i, "symbol", e.target.value)} placeholder="기호 (예: E1)" />
                  <button className="text-slate-400 hover:text-red-600" onClick={() => set("lots", draft.lots.filter((_, j) => j !== i))} title="줄 삭제">×</button>
                </div>
              ))}
              <button className={btn} onClick={() => set("lots", [...draft.lots, { raw_lot: "", symbol: "" }])}>짝 추가</button>
            </div>
          </div>
        </div>
        {err && <div className="mx-4 mb-3 px-3 py-2 rounded bg-red-50 text-red-700">{err}</div>}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-2">
          {!draft.isNew &&
            (askDelete ? (
              <span className="flex items-center gap-2 text-red-700">
                정말 삭제할까요?
                <button className={btn} disabled={busy} onClick={() => send("DELETE")}>삭제</button>
                <button className={btn} onClick={() => setAskDelete(false)}>그만두기</button>
              </span>
            ) : (
              <button className={btn} disabled={busy} onClick={() => setAskDelete(true)}>삭제</button>
            ))}
          <span className="ml-auto text-slate-400">변경 내용은 기준정보변경이력(BASE-20)에 남습니다.</span>
          <button className={btn} onClick={() => setDraft(null)}>닫기</button>
          <button className={btnMain} disabled={busy || !draft.model_name.trim()} onClick={() => send(draft.isNew ? "POST" : "PUT")}>저장</button>
        </div>
      </div>
    </>
  );
}
