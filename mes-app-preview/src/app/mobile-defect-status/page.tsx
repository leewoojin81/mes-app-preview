"use client";
/* eslint-disable @next/next/no-img-element -- 로그인 필요한 사진 API라 next/image를 쓰지 않는다 */

// 모바일 불량입력 PC 조회 — 휴대폰(/m/defect)에서 등록한 불량을 기간·공정·검색어로 보고 사진 확인·CSV(엑셀) 저장.
// 2026-11-20 신설(사용자 요청). 메뉴(nav-groups)에 넣지 않고 주소로 연다: /mobile-defect-status

import { useCallback, useEffect, useState } from "react";

const PROCESSES = ["조립", "분리3", "습윤", "외관검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "마킹", "출하포장"];

type Row = {
  id: number; created_at: string; wo_no: string; lot_no: string | null; item_code: string | null; item_info: string | null;
  process_name: string; defect_type_code: string; defect_type_name: string; qty: number; memo: string | null;
  photo1: string | null; photo2: string | null; photo3: string | null; input_method: string;
  username: string; display_name: string | null; deleted_at: string | null;
};

const today = () => new Date().toLocaleDateString("sv-SE");
const th = "px-2 py-2 text-left font-semibold border-b border-slate-200 whitespace-nowrap";
const td = "px-2 py-1.5 border-b border-slate-100 align-top";

export default function MobileDefectStatusPage() {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [proc, setProc] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [withDeleted, setWithDeleted] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(() => {
    const sp = new URLSearchParams({ from, to, process: proc, q: qApplied, deleted: withDeleted ? "1" : "0" });
    return fetch(`/api/m-defect/list?${sp}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "조회하지 못했습니다.");
        setRows(j.rows ?? []);
        setErr("");
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [from, to, proc, qApplied, withDeleted]);

  useEffect(() => {
    load();
  }, [load]);

  const live = rows.filter((r) => !r.deleted_at);
  const total = live.reduce((a, r) => a + r.qty, 0);
  const typeSum = new Map<string, number>();
  for (const r of live) typeSum.set(r.defect_type_name, (typeSum.get(r.defect_type_name) ?? 0) + r.qty);
  const byType = [...typeSum.entries()].sort((a, b) => b[1] - a[1]);

  function downloadCsv() {
    const head = ["입력일시", "공정", "작업지시", "LOT", "품목코드", "품목정보", "불량유형코드", "불량유형", "수량", "메모", "사진수", "입력방식", "입력자", "취소일시"];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) =>
      [r.created_at, r.process_name, r.wo_no, r.lot_no, r.item_code, r.item_info, r.defect_type_code, r.defect_type_name, r.qty, r.memo,
        [r.photo1, r.photo2, r.photo3].filter(Boolean).length, r.input_method, r.display_name || r.username, r.deleted_at].map(esc).join(",")
    );
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `모바일불량입력_${from}_${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const input = "h-9 border border-slate-300 rounded px-2 text-sm bg-white";

  return (
    <div className="w-full px-4 sm:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-navy">모바일 불량입력 조회</h1>
        <p className="text-sm text-slate-500 mt-1">휴대폰(/m/defect)에서 등록한 불량 · 공정이동표 QR 기준</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-lg p-3"
        onSubmit={(e) => { e.preventDefault(); setLoading(true); if (q !== qApplied) setQApplied(q); else load(); }}
      >
        <label className="flex flex-col gap-1 text-xs text-slate-500">시작일
          <input id="mds-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">종료일
          <input id="mds-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">공정
          <select id="mds-proc" value={proc} onChange={(e) => setProc(e.target.value)} className={input}>
            <option value="">전체</option>
            {PROCESSES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">검색 (작업지시·LOT·품목·입력자·메모)
          <input id="mds-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: PR202611" className={`${input} w-64`} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 h-9">
          <input id="mds-del" type="checkbox" checked={withDeleted} onChange={(e) => setWithDeleted(e.target.checked)} /> 취소 건 포함
        </label>
        <button type="submit" className="h-9 px-4 rounded bg-navy text-white text-sm font-medium">조회</button>
        <button type="button" onClick={downloadCsv} disabled={!rows.length} className="h-9 px-4 rounded border border-navy text-navy text-sm font-medium disabled:opacity-40">엑셀(CSV) 저장</button>
        <div className="flex gap-1 ml-auto">
          {[["오늘", 0], ["7일", 6], ["30일", 29]].map(([l, d]) => (
            <button key={l} type="button" className="h-9 px-3 rounded bg-slate-100 text-sm text-slate-700"
              onClick={() => { const t = new Date(); const f = new Date(t.getTime() - Number(d) * 86400000); setFrom(f.toLocaleDateString("sv-SE")); setTo(t.toLocaleDateString("sv-SE")); }}>{l}</button>
          ))}
        </div>
      </form>

      <div className="flex flex-wrap gap-2 items-center text-sm">
        <span className="px-3 py-1.5 rounded bg-navy text-white">{live.length}건 · 불량 <b>{total.toLocaleString()}</b>개</span>
        {byType.map(([n, v]) => (
          <span key={n} className="px-2.5 py-1.5 rounded bg-white border border-slate-200">{n} <b className="text-red-600">{v}</b></span>
        ))}
        {loading && <span className="text-slate-400">조회 중…</span>}
        {err && <span className="text-red-600">{err}</span>}
      </div>

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className={th}>입력일시</th><th className={th}>공정</th><th className={th}>작업지시</th><th className={th}>LOT</th>
              <th className={th}>품목</th><th className={th}>불량유형</th><th className={`${th} text-right`}>수량</th><th className={th}>메모</th>
              <th className={th}>사진</th><th className={th}>입력자</th><th className={th}>방식</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-400">이 기간에 휴대폰으로 등록한 불량이 없습니다.</td></tr>
            )}
            {rows.map((r) => {
              const ps = [r.photo1, r.photo2, r.photo3].map((p, i) => (p ? i + 1 : 0)).filter(Boolean);
              return (
                <tr key={r.id} className={r.deleted_at ? "text-slate-400 line-through" : "hover:bg-slate-50"}>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{r.created_at.slice(5, 16)}</td>
                  <td className={td}>{r.process_name}</td>
                  <td className={`${td} whitespace-nowrap font-medium`}>{r.wo_no}</td>
                  <td className={`${td} whitespace-nowrap`}>{r.lot_no ?? "-"}</td>
                  <td className={td}><div>{r.item_code ?? "-"}</div><div className="text-xs text-slate-500">{r.item_info}</div></td>
                  <td className={`${td} whitespace-nowrap`}>{r.defect_type_name}</td>
                  <td className={`${td} text-right tabular-nums font-bold`}>{r.qty}</td>
                  <td className={`${td} max-w-[220px] break-all`}>{r.memo}</td>
                  <td className={td}>
                    <div className="flex gap-1">
                      {ps.map((n) => (
                        <button key={n} type="button" onClick={() => setPhoto(`/api/m-defect/photo/${r.id}/${n}`)} className="w-10 h-10 rounded overflow-hidden border border-slate-200">
                          <img src={`/api/m-defect/photo/${r.id}/${n}`} alt={`사진 ${n}`} className="w-full h-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{r.display_name || r.username}</td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{r.deleted_at ? "취소" : r.input_method}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {photo && (
        <button type="button" aria-label="사진 닫기" onClick={() => setPhoto(null)} className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6">
          <img src={photo} alt="불량 사진" className="max-w-full max-h-full rounded-lg" />
        </button>
      )}
    </div>
  );
}
