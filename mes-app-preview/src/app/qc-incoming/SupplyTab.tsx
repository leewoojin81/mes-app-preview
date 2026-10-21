"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupplyLot } from "@/lib/qc-incoming-shared";
import {
  CERT_STATUS,
  DESIGN_OPTIONS,
  PHYS_STATUS,
  RECV_TYPE_OPTIONS,
  RESULT_OPTIONS,
  SUPPLY_DEFECT_NAMES,
  SUPPLY_PARTS,
} from "@/lib/qc-incoming-shared";
import LotPhotoDialog from "./LotPhotoDialog";
import RequestLotPanel from "./RequestLotPanel";
import { downloadXlsx, n, pct, shrinkImage, todayStr } from "./qc-utils";

// 부자재 탭 — 입고검사 대시보드의 "부자재 관리대장"과 같은 기능:
// 요약 카드, 검색·필터, 로트 표(100건씩), 실물검사/성적서 즉시 변경, 일괄 변경, 로트 추가·수정·삭제, 로트 사진, 엑셀 내려받기.
const PAGE_SIZE = 100;
const PART_COLOR: Record<string, string> = {
  실링지: "bg-sky-100 text-sky-800",
  단상자: "bg-amber-100 text-amber-800",
  라벨: "bg-emerald-100 text-emerald-800",
  설명서: "bg-violet-100 text-violet-800",
  기타: "bg-slate-100 text-slate-700",
};

type BulkAction = { label: string; body: { phys_status?: string; cert_status?: string; result?: string } };

export default function SupplyTab() {
  const [lots, setLots] = useState<SupplyLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [q, setQ] = useState("");
  const [fm, setFm] = useState("");
  const [fp, setFp] = useState("");
  const [fs, setFs] = useState("");
  const [fx, setFx] = useState("");
  const [fc, setFc] = useState("");
  const [fb, setFb] = useState(false);
  const [fe, setFe] = useState(false);
  const [page, setPage] = useState(0);

  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);

  const [editNo, setEditNo] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoNo, setPhotoNo] = useState<number | null>(null);
  const [delArmed, setDelArmed] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/qc-incoming/supply", { cache: "no-store" });
    const d = await res.json();
    setLots(d.lots ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const replaceLot = (l: SupplyLot) => setLots((prev) => prev.map((x) => (x.no === l.no ? l : x)));

  const partOptions = useMemo(() => Array.from(new Set(lots.map((l) => l.part))).sort(), [lots]);
  const supplierOptions = useMemo(() => Array.from(new Set(lots.map((l) => l.supplier))).filter(Boolean).sort(), [lots]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return lots.filter(
      (r) =>
        (!fm || String(r.month) === fm) &&
        (!fp || r.part === fp) &&
        (!fs || r.supplier === fs) &&
        (!fb || r.bad_qty > 0) &&
        (!fx || r.phys_status === fx) &&
        (!fc || r.cert_status === fc) &&
        (!fe || !r.insp_date) &&
        (!k ||
          [r.no, r.lot_no, r.mat_code, r.item_code, r.name, r.customer, r.design, r.recv_type, r.supplier, r.remark].join(" ").toLowerCase().includes(k))
    );
  }, [lots, q, fm, fp, fs, fx, fc, fb, fe]);

  useEffect(() => setPage(0), [q, fm, fp, fs, fx, fc, fb, fe]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const stats = useMemo(
    () => ({
      total: lots.length,
      badLots: lots.filter((r) => r.bad_qty > 0).length,
      rejected: lots.filter((r) => r.result === "부적합").length,
      noInsp: lots.filter((r) => !r.insp_date).length,
    }),
    [lots]
  );

  async function patchLot(no: number, body: Record<string, unknown>, okMsg: string) {
    const res = await fetch(`/api/qc-incoming/supply/${no}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(d.error ?? "저장하지 못했습니다.");
      return false;
    }
    replaceLot(d.lot);
    setMsg(okMsg);
    return true;
  }

  async function changeStatus(r: SupplyLot, key: "phys_status" | "cert_status", value: string) {
    const label = key === "phys_status" ? "실물검사" : "성적서";
    const willSetDate = key === "cert_status" && value === "작성완료" && r.cert_status !== "작성완료";
    await patchLot(r.no, { [key]: value }, `No.${r.no} ${label} → ${value}${willSetDate ? " · 검사일자를 오늘 날짜로 변경했습니다." : ""}`);
  }

  async function runBulk(a: BulkAction) {
    const nos = Array.from(sel);
    if (nos.length === 0) return;
    setBusy(true);
    setPending(null);
    setMsg(`처리 중… (${nos.length}건)`);
    const res = await fetch("/api/qc-incoming/supply/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nos, ...a.body }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg((d.error ?? "저장하지 못했습니다.") + " 선택이 남아 있으니 다시 시도하세요.");
      return;
    }
    setMsg(`${d.changed}건을 ${a.label}(으)로 변경했습니다.`);
    setSel(new Set());
    await load();
  }

  async function removeAdded(no: number) {
    if (delArmed !== no) {
      setDelArmed(no);
      setTimeout(() => setDelArmed((v) => (v === no ? null : v)), 3000);
      return;
    }
    setDelArmed(null);
    const res = await fetch(`/api/qc-incoming/supply/${no}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(d.error ?? "삭제하지 못했습니다.");
      return;
    }
    setLots((prev) => prev.filter((x) => x.no !== no));
    setSel((s) => {
      const nx = new Set(s);
      nx.delete(no);
      return nx;
    });
    setMsg(`No.${no} 로트를 삭제했습니다.`);
  }

  function exportXlsx() {
    const head = [
      "번호", "월", "자재", "입고일자", "검사일자", "Lot No.", "자재코드", "품명", "고객사", "디자인 구분", "입고 구분", "납품업체",
      "Lot 수량", "검사수량", "부적합수량", "실물검사", "성적서", "결과", "비고", ...SUPPLY_DEFECT_NAMES, "품목코드",
    ];
    const rows = lots.map((r) => [
      r.no, r.month, r.part, r.recv_date, r.insp_date, r.lot_no, r.mat_code, r.name, r.customer, r.design, r.recv_type, r.supplier,
      r.lot_qty, r.insp_qty, r.bad_qty, r.phys_status, r.cert_status, r.result, r.remark,
      ...SUPPLY_DEFECT_NAMES.map((_, j) => r.defs?.[j] || ""), r.item_code,
    ]);
    downloadXlsx("부자재_관리대장", [["부자재 관리대장", [head, ...rows]]]);
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => sel.has(r.no));
  const someSelected = filtered.some((r) => sel.has(r.no));
  const toggleAll = (on: boolean) =>
    setSel((s) => {
      const nx = new Set(s);
      filtered.forEach((r) => (on ? nx.add(r.no) : nx.delete(r.no)));
      return nx;
    });
  const outsideFilter = Array.from(sel).filter((no) => !filtered.some((r) => r.no === no)).length;

  const onCountChange = useCallback((no: number, count: number) => {
    setLots((prev) => prev.map((x) => (x.no === no && x.photo_count !== count ? { ...x, photo_count: count } : x)));
  }, []);

  const editLot = editNo != null ? lots.find((l) => l.no === editNo) ?? null : null;
  const photoLot = photoNo != null ? lots.find((l) => l.no === photoNo) ?? null : null;

  const card = (key: string, color: string, label: string, value: number, on: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border px-4 py-3 bg-white transition-colors ${on ? "border-navy ring-1 ring-navy/30" : "border-slate-200 hover:border-slate-400"}`}
    >
      <div className="text-2xl font-bold" style={{ color }}>
        {n(value)}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </button>
  );

  return (
    <div className="w-full px-4 sm:px-6 py-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">부자재 관리대장</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            로트를 누르면 사진이 열리고, 줄을 더블클릭하면 내용을 수정할 수 있습니다. 검사일자가 비어 있으면 바로 입력할 수 있습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportXlsx}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            엑셀 내려받기
          </button>
          <button
            onClick={() => setUploading(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            사진 업로드
          </button>
          <button onClick={() => setAdding(true)} className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90">
            + 로트 추가
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card("all", "#2433a8", "전체 로트", stats.total, !fb && !fe, () => {
          setFb(false);
          setFe(false);
          setQ("");
          setFm("");
          setFp("");
          setFs("");
          setFx("");
          setFc("");
        })}
        {card("bad", "#ee6a3a", "부적합 발생 로트", stats.badLots, fb, () => setFb((v) => !v))}
        {card("rj", "#e5533d", "부적합 판정", stats.rejected, false, () => {
          setQ("");
          setFb(true);
          setFe(false);
        })}
        {card("emp", "#f0a020", "검사일 미입력", stats.noInsp, fe, () => setFe((v) => !v))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Lot, 코드, 품명, 납품업체 검색"
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64"
        />
        <select value={fm} onChange={(e) => setFm(e.target.value)} className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
          <option value="">월 전체</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}월
            </option>
          ))}
        </select>
        <select value={fp} onChange={(e) => setFp(e.target.value)} className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
          <option value="">자재 전체</option>
          {partOptions.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={fs} onChange={(e) => setFs(e.target.value)} className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
          <option value="">납품업체 전체</option>
          {supplierOptions.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={fx} onChange={(e) => setFx(e.target.value)} aria-label="실물검사 상태" className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
          <option value="">실물검사 전체</option>
          {PHYS_STATUS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={fc} onChange={(e) => setFc(e.target.value)} aria-label="성적서 상태" className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600">
          <option value="">성적서 전체</option>
          {CERT_STATUS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none cursor-pointer">
          <input type="checkbox" checked={fb} onChange={(e) => setFb(e.target.checked)} className="accent-navy" />
          부적합 수량 있는 로트만
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none cursor-pointer">
          <input type="checkbox" checked={fe} onChange={(e) => setFe(e.target.checked)} className="accent-navy" />
          검사일자 미입력만
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected && !allFilteredSelected;
            }}
            onChange={(e) => toggleAll(e.target.checked)}
            className="accent-navy"
          />
          필터된 로트 전체 선택
        </label>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>

      {sel.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-navy/30 bg-navy/5 px-3 py-2 text-sm">
          <b className="text-navy">
            {sel.size}건 선택{outsideFilter > 0 ? ` (현재 필터 밖 ${outsideFilter}건 포함)` : ""}
          </b>
          <span className="text-slate-500">실물검사</span>
          <BulkBtn onClick={() => setPending({ label: "실물검사 '검사완료'", body: { phys_status: "검사완료" } })} tone="ok" disabled={busy}>검사완료로</BulkBtn>
          <BulkBtn onClick={() => setPending({ label: "실물검사 '미검사'", body: { phys_status: "미검사" } })} disabled={busy}>미검사로</BulkBtn>
          <span className="text-slate-500">성적서</span>
          <BulkBtn onClick={() => setPending({ label: "성적서 '작성완료'", body: { cert_status: "작성완료" } })} tone="ok" disabled={busy}>작성완료로</BulkBtn>
          <BulkBtn onClick={() => setPending({ label: "성적서 '미작성'", body: { cert_status: "미작성" } })} disabled={busy}>미작성으로</BulkBtn>
          <span className="text-slate-500">결과</span>
          <BulkBtn onClick={() => setPending({ label: "결과 '적합'", body: { result: "적합" } })} tone="ok" disabled={busy}>적합으로</BulkBtn>
          <BulkBtn onClick={() => setPending({ label: "결과 '부적합'", body: { result: "부적합" } })} disabled={busy}>부적합으로</BulkBtn>
          <BulkBtn onClick={() => setPending({ label: "결과 비움", body: { result: "" } })} disabled={busy}>비움</BulkBtn>
          <BulkBtn onClick={() => setPending({ label: "실물검사 '검사완료', 성적서 '작성완료'", body: { phys_status: "검사완료", cert_status: "작성완료" } })} tone="ok" disabled={busy}>
            둘 다 완료로
          </BulkBtn>
          <button type="button" onClick={() => { setSel(new Set()); setPending(null); }} className="px-2.5 py-1 rounded border border-rose-200 text-rose-600 text-xs hover:bg-rose-50">
            선택 해제
          </button>
          {pending && (
            <span className="flex items-center gap-2">
              <b>{sel.size}건을 {pending.label}(으)로 변경할까요?</b>
              <BulkBtn onClick={() => runBulk(pending)} tone="ok">확인</BulkBtn>
              <button type="button" onClick={() => setPending(null)} className="px-2.5 py-1 rounded border border-rose-200 text-rose-600 text-xs hover:bg-rose-50">
                취소
              </button>
            </span>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-24rem)]">
          <table className="text-sm whitespace-nowrap w-full">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["번호", "자재", "입고일자", "검사일자", "Lot No.", "자재코드", "품목코드", "품명", "고객사", "디자인 구분", "입고 구분", "납품업체", "Lot 수량", "검사수량", "부적합", "부적합률", "실물검사", "성적서", "결과", "비고", "사진", ""].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] text-center">
                    {i === 0 ? (
                      <label className="flex items-center gap-1 justify-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected && !allFilteredSelected;
                          }}
                          onChange={(e) => toggleAll(e.target.checked)}
                          className="accent-navy"
                          aria-label="필터된 전체 선택"
                        />
                        {h}
                      </label>
                    ) : (
                      h
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={22} className="text-center py-10 text-slate-400">불러오는 중...</td>
                </tr>
              )}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={22} className="text-center py-10 text-slate-400">조건에 맞는 로트가 없습니다.</td>
                </tr>
              )}
              {pageRows.map((r) => (
                <tr
                  key={r.no}
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest("input,button,select,a")) return;
                    setEditNo(r.no);
                  }}
                  className={`${r.result === "부적합" ? "bg-rose-50" : r.bad_qty > 0 ? "bg-rose-50/50" : !r.insp_date ? "bg-amber-50/60" : ""} ${sel.has(r.no) ? "outline outline-1 outline-navy/40" : ""} hover:bg-slate-50`}
                >
                  <td className="px-3 py-2 text-center">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sel.has(r.no)}
                        onChange={(e) =>
                          setSel((s) => {
                            const nx = new Set(s);
                            if (e.target.checked) nx.add(r.no);
                            else nx.delete(r.no);
                            return nx;
                          })
                        }
                        className="accent-navy"
                        aria-label={`No.${r.no} 선택`}
                      />
                      <span className="font-mono">{r.no}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PART_COLOR[r.part] ?? PART_COLOR["기타"]}`}>{r.part}</span>
                  </td>
                  <td className="px-3 py-2">{r.recv_date}</td>
                  <td className="px-3 py-2">
                    {r.insp_date ? (
                      r.insp_date
                    ) : (
                      <input
                        type="date"
                        defaultValue=""
                        aria-label={`No.${r.no} 검사일자 입력`}
                        onChange={(e) => e.target.value && patchLot(r.no, { insp_date: e.target.value }, `No.${r.no} 검사일자를 저장했습니다.`)}
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-xs"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setPhotoNo(r.no)} className="text-navy font-mono text-xs underline underline-offset-2 hover:opacity-80">
                      {r.lot_no || "-"}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.mat_code}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.item_code || "-"}</td>
                  <td className="px-3 py-2 max-w-72 truncate" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2">{r.customer}</td>
                  <td className="px-3 py-2">{r.design}</td>
                  <td className="px-3 py-2">{r.recv_type}</td>
                  <td className="px-3 py-2">{r.supplier}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{n(r.lot_qty)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{n(r.insp_qty)}</td>
                  <td className={`px-3 py-2 text-right font-mono text-xs ${r.bad_qty > 0 ? "text-rose-600 font-semibold" : ""}`}>{n(r.bad_qty)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{pct(r.bad_qty, r.insp_qty)}</td>
                  <td className="px-3 py-2">
                    <StatusSelect value={r.phys_status} options={PHYS_STATUS} label={`No.${r.no} 실물검사 상태`} onChange={(v) => changeStatus(r, "phys_status", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusSelect value={r.cert_status} options={CERT_STATUS} label={`No.${r.no} 성적서 상태`} onChange={(v) => changeStatus(r, "cert_status", v)} />
                  </td>
                  <td className="px-3 py-2">
                    {r.result ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.result === "부적합" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{r.result}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-60 truncate" title={r.remark}>{r.remark}</td>
                  <td className="px-3 py-2 text-center">
                    {r.photo_count > 0 ? (
                      <button type="button" onClick={() => setPhotoNo(r.no)} className="text-xs px-2 py-0.5 rounded border border-slate-300 hover:border-navy">
                        {r.photo_count}장
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2 text-center space-x-1">
                    <button type="button" onClick={() => setEditNo(r.no)} className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-600 hover:border-navy hover:text-navy">
                      수정
                    </button>
                    {r.is_added === 1 && (
                      <button type="button" onClick={() => removeAdded(r.no)} className="text-xs px-2 py-0.5 rounded border border-rose-200 text-rose-600 hover:bg-rose-50">
                        {delArmed === r.no ? "정말 삭제" : "삭제"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-sm">
          <span className="text-slate-500">
            {filtered.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {n(filtered.length)}건 · {page + 1}/{totalPages} 페이지
          </span>
          <span className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-40">이전</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded border border-slate-300 bg-white disabled:opacity-40">다음</button>
          </span>
        </div>
      </div>

      {adding && (
        <LotFormDialog
          mode="add"
          lots={lots}
          onClose={() => setAdding(false)}
          onSaved={(l) => {
            setLots((prev) => [l, ...prev].sort((a, b) => b.no - a.no));
            setAdding(false);
            setMsg(`No.${l.no} 로트를 추가했습니다.`);
          }}
        />
      )}
      {editLot && (
        <LotFormDialog
          mode="edit"
          lot={editLot}
          lots={lots}
          onClose={() => setEditNo(null)}
          onSaved={(l) => {
            replaceLot(l);
            setEditNo(null);
            setMsg(`No.${l.no} 로트를 수정했습니다.`);
          }}
        />
      )}
      {uploading && (
        <PhotoUploadDialog
          lots={lots}
          onClose={() => setUploading(false)}
          onDone={async (msgText) => {
            setMsg(msgText);
            await load();
          }}
        />
      )}
      {photoLot && <LotPhotoDialog lot={photoLot} onClose={() => setPhotoNo(null)} onCountChange={onCountChange} />}
    </div>
  );
}

function BulkBtn({ children, onClick, tone, disabled }: { children: React.ReactNode; onClick: () => void; tone?: "ok"; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-2.5 py-1 rounded border text-xs disabled:opacity-40 ${tone === "ok" ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "border-slate-300 text-slate-600 hover:border-navy hover:text-navy"}`}
    >
      {children}
    </button>
  );
}

function StatusSelect({ value, options, label, onChange }: { value: string; options: readonly string[]; label: string; onChange: (v: string) => void }) {
  const done = value === options[1];
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={`border rounded-md px-1.5 py-0.5 text-xs ${done ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600"}`}
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

interface OcrItem {
  code: string;
  name: string;
  spec: string;
  qty: number;
  design: string;
  customer: string;
}
interface OcrHead {
  supplier: string;
  date: string;
  rtype: string;
}

const INP = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700";
// 렌더 안에서 정의하면 입력할 때마다 다시 만들어져 포커스를 잃으므로 바깥에 둔다
function L({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`text-xs text-slate-500 ${wide ? "col-span-2 sm:col-span-3" : ""}`}>
      {label}
      {children}
    </label>
  );
}

// ── 로트 추가 / 수정 창 ───────────────────────────────────────────────────────────────────
interface FormState {
  part: string; recv_date: string; insp_date: string; lot_no: string; mat_code: string; name: string; supplier: string;
  lot_qty: string; insp_qty: string; bad_qty: string; inspector: string; result: string; remark: string;
  item_code: string; customer: string; design: string; recv_type: string; defs: string[];
}

function formFrom(l?: SupplyLot): FormState {
  return {
    part: l?.part ?? "실링지",
    recv_date: l?.recv_date ?? todayStr(),
    insp_date: l?.insp_date ?? "",
    lot_no: l?.lot_no ?? "",
    mat_code: l?.mat_code ?? "",
    name: l?.name ?? "",
    supplier: l?.supplier ?? "",
    lot_qty: String(l?.lot_qty ?? 0),
    insp_qty: String(l?.insp_qty ?? 0),
    bad_qty: String(l?.bad_qty ?? 0),
    inspector: l?.inspector ?? "",
    result: l?.result ?? "",
    remark: l?.remark ?? "",
    item_code: l?.item_code ?? "",
    customer: l?.customer ?? "",
    design: l?.design ?? "",
    recv_type: l?.recv_type ?? "",
    defs: Array.from({ length: 13 }, (_, j) => String(l?.defs?.[j] ?? 0)),
  };
}

function LotFormDialog({
  mode,
  lot,
  lots,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  lot?: SupplyLot;
  lots: SupplyLot[];
  onClose: () => void;
  onSaved: (l: SupplyLot) => void;
}) {
  const [f, setF] = useState<FormState>(() => formFrom(lot));
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [itemChoices, setItemChoices] = useState<string[]>([]);
  // 로트 추가 시 함께 올릴 사진(저장하면 로트가 만들어진 뒤 이 로트 사진으로 올라간다)
  const [files, setFiles] = useState<File[]>([]);
  // 사진을 처음 고르면 의뢰서 사진으로 보고 AI가 읽어 필수 칸(입고일자·Lot No.·품명 등)을 채운다
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMsg, setOcrMsg] = useState("");
  const [ocrItems, setOcrItems] = useState<OcrItem[]>([]);
  const ocrHead = useRef<OcrHead>({ supplier: "", date: "", rtype: "" });
  const previews = useMemo(() => files.map((f0) => URL.createObjectURL(f0)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  // 자동 입력으로 채운 값 / 사용자가 직접 고친 칸 (대시보드의 data-auto 동작)
  const auto = useRef({ name: "", supplier: "" });
  const touched = useRef({ lot: mode === "edit", lq: mode === "edit", iq: mode === "edit" });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const suppliers = useMemo(() => Array.from(new Set(lots.map((l) => l.supplier))).filter(Boolean).sort(), [lots]);

  // 입고일자가 바뀌면(직접 안 고친 경우) Lot 번호를 제안한다
  useEffect(() => {
    if (mode !== "add" || touched.current.lot || !f.recv_date) return;
    let live = true;
    fetch(`/api/qc-incoming/supply/lookup?recv=${f.recv_date}`)
      .then((r) => r.json())
      .then((d) => live && !touched.current.lot && d.lot && setF((p) => ({ ...p, lot_no: d.lot })));
    return () => {
      live = false;
    };
  }, [mode, f.recv_date]);

  // 자재코드를 입력하면 같은 코드의 직전 로트(없으면 BOM)에서 자재·품명·납품업체·품목코드·수량을 채운다
  useEffect(() => {
    if (mode !== "add") return;
    const code = f.mat_code.trim().toUpperCase();
    if (!code) {
      setHint("");
      setItemChoices([]);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const d = await fetch(`/api/qc-incoming/supply/lookup?code=${encodeURIComponent(code)}`).then((r) => r.json()).catch(() => null);
      if (!live || !d) return;
      setItemChoices(d.items ?? []);
      setF((p) => {
        const next = { ...p };
        if (d.found) {
          if (d.part) next.part = d.part;
          if (!p.name || p.name === auto.current.name) {
            next.name = d.name ?? "";
            auto.current.name = d.name ?? "";
          }
          if (!p.supplier || p.supplier === auto.current.supplier) {
            next.supplier = d.supplier ?? "";
            auto.current.supplier = d.supplier ?? "";
          }
          if (d.item) next.item_code = d.item;
        } else if (d.part) {
          next.part = d.part;
        }
        if (!touched.current.lq && d.found) next.lot_qty = String(d.lot_qty ?? 0);
        if (!touched.current.iq && d.insp_qty != null) next.insp_qty = String(d.insp_qty);
        return next;
      });
      setHint(
        d.found
          ? d.source === "lot"
            ? `자동 입력됨: ${d.part} · ${d.name} · ${d.supplier} · Lot 수량·검사수량은 직전 로트(No.${d.last_no}) 기준 — 다르면 수정하세요`
            : `BOM에서 찾았습니다: 품목코드 ${d.item}. 품명을 확인하고 납품업체는 직접 입력해 주세요.`
          : "목록에 없는 코드입니다. 아래 내용을 직접 입력해 주세요."
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mode, f.mat_code]);

  function applyOcrItem(it: OcrItem) {
    const h = ocrHead.current;
    const nm = [it.name, it.spec].filter(Boolean).join(" ").trim();
    auto.current = { name: nm, supplier: h.supplier };
    if (it.qty > 0) touched.current.lq = true;
    setF((p) => ({
      ...p,
      mat_code: it.code.replace(/\s+/g, "").toUpperCase(),
      name: nm || p.name,
      supplier: h.supplier || p.supplier,
      recv_date: h.date || p.recv_date,
      recv_type: h.rtype || p.recv_type,
      design: it.design || p.design,
      customer: it.customer || p.customer,
      lot_qty: it.qty > 0 ? String(it.qty) : p.lot_qty,
    }));
  }

  async function readPhoto(file: File) {
    setOcrBusy(true);
    setOcrItems([]);
    setOcrMsg("사진을 읽는 중… (10~60초 걸릴 수 있습니다)");
    try {
      const sh = await shrinkImage(file, 2400, 0.9);
      const res = await fetch("/api/qc-incoming/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: sh.dataUrl }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOcrMsg(d.error ?? "사진을 읽지 못했습니다. 아래에서 직접 입력해 주세요.");
        return;
      }
      const data = (d.data ?? {}) as Record<string, unknown>;
      const ymd = (v: unknown) => {
        const m = String(v ?? "").match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
        return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
      };
      const rt = String(data.receiptType ?? "");
      const rtype = (RECV_TYPE_OPTIONS as readonly string[]).includes(rt) ? rt : "";
      ocrHead.current = { supplier: String(data.supplier ?? "").trim(), date: ymd(data.receiptDate) || ymd(data.requestDate), rtype };
      const items: OcrItem[] = (Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [])
        .map((x) => ({
          code: String(x.code ?? "").trim(),
          name: String(x.name ?? "").trim(),
          spec: String(x.spec ?? "").trim(),
          qty: Math.round(Number(String(x.qty ?? "").replace(/[^\d.]/g, ""))) || 0,
          design: (DESIGN_OPTIONS as readonly string[]).includes(String(x.design ?? "").trim()) ? String(x.design).trim() : "",
          customer: String(x.customer ?? "").trim(),
        }))
        .filter((x) => x.code);
      if (items.length === 0) {
        setOcrMsg("사진에서 자재코드가 있는 줄을 찾지 못했습니다. 의뢰서 전체가 밝고 선명하게 나오도록 다시 찍어 주세요.");
        return;
      }
      setOcrItems(items);
      applyOcrItem(items[0]);
      setOcrMsg(
        items.length > 1
          ? `${items.length}건을 읽었습니다. 첫 번째 줄을 채웠습니다 — 아래에서 다른 줄을 고를 수 있습니다. 사진과 비교해 확인하세요.`
          : "1건을 읽어 채웠습니다. 사진과 비교해 확인하세요."
      );
    } catch {
      setOcrMsg("사진을 읽지 못했습니다. 아래에서 직접 입력해 주세요.");
    } finally {
      setOcrBusy(false);
    }
  }

  async function save() {
    setErr("");
    if (!f.lot_no.trim()) return setErr("Lot No.를 입력해 주세요.");
    if (!f.recv_date) return setErr("입고일자를 입력해 주세요.");
    if (!f.name.trim()) return setErr("품명을 입력해 주세요.");
    setSaving(true);
    const body = {
      full: mode === "edit",
      part: f.part, recv_date: f.recv_date, insp_date: f.insp_date, lot_no: f.lot_no, mat_code: f.mat_code, name: f.name, supplier: f.supplier,
      lot_qty: Number(f.lot_qty), insp_qty: Number(f.insp_qty), bad_qty: Number(f.bad_qty), inspector: f.inspector, result: f.result, remark: f.remark,
      item_code: f.item_code, customer: f.customer, design: f.design, recv_type: f.recv_type, defs: f.defs.map((x) => Number(x) || 0),
    };
    const res = await fetch(mode === "add" ? "/api/qc-incoming/supply" : `/api/qc-incoming/supply/${lot!.no}`, {
      method: mode === "add" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      return setErr(d.error ?? "저장하지 못했습니다.");
    }
    let lotSaved: SupplyLot = d.lot;
    if (mode === "add" && files.length > 0) {
      let ok = 0;
      for (let i = 0; i < files.length; i++) {
        setErr(`로트를 저장했습니다. 사진 올리는 중 (${i + 1}/${files.length})…`);
        try {
          const sh = await shrinkImage(files[i]);
          const pr = await fetch("/api/qc-incoming/photos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ no: lotSaved.no, note: "", image: sh.dataUrl, w: sh.w, h: sh.h }),
          });
          if (pr.ok) ok++;
        } catch {
          /* 한 장 실패해도 다음 장 계속 */
        }
      }
      lotSaved = { ...lotSaved, photo_count: ok };
      if (ok < files.length) alert(`로트는 저장됐지만 사진 ${files.length - ok}장은 올리지 못했습니다. 로트의 사진 창에서 다시 올려 주세요.`);
    }
    setSaving(false);
    onSaved(lotSaved);
  }

  async function resetToOrig() {
    if (!lot || !confirm("이 로트를 엑셀 원본 값으로 되돌릴까요?")) return;
    const res = await fetch(`/api/qc-incoming/supply/${lot.no}/reset`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error ?? "되돌리지 못했습니다.");
    onSaved(d.lot);
  }

  const inp = INP;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <b className="text-navy">{mode === "add" ? "로트 추가" : `로트 수정 · No.${lot!.no}`}</b>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">닫기</button>
        </div>
        <div className="p-5 space-y-4">
          {hint && <p className="text-xs text-indigo-600">{hint}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mode === "add" && (
              <L label="자재코드">
                <input value={f.mat_code} onChange={(e) => set("mat_code", e.target.value.toUpperCase())} maxLength={40} placeholder="예: BFS0931A" className={inp} />
              </L>
            )}
            <L label="자재">
              <select value={f.part} onChange={(e) => set("part", e.target.value)} className={inp}>
                {SUPPLY_PARTS.map((p) => (<option key={p}>{p}</option>))}
              </select>
            </L>
            <L label="입고일자 *"><input type="date" value={f.recv_date} onChange={(e) => set("recv_date", e.target.value)} className={inp} /></L>
            <L label="검사일자"><input type="date" value={f.insp_date} onChange={(e) => set("insp_date", e.target.value)} className={inp} /></L>
            <L label="Lot No. *">
              <input value={f.lot_no} onChange={(e) => { touched.current.lot = true; set("lot_no", e.target.value); }} maxLength={40} className={inp} />
            </L>
            {mode === "edit" && (
              <L label="자재코드"><input value={f.mat_code} onChange={(e) => set("mat_code", e.target.value.toUpperCase())} maxLength={40} className={inp} /></L>
            )}
            <L label="품목코드">
              <input value={f.item_code} onChange={(e) => set("item_code", e.target.value)} maxLength={40} list="qc_item_choices" className={inp} />
              <datalist id="qc_item_choices">{itemChoices.map((x) => (<option key={x} value={x} />))}</datalist>
            </L>
            <L label="품명 *" wide><input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className={inp} /></L>
            <L label="고객사"><input value={f.customer} onChange={(e) => set("customer", e.target.value)} maxLength={40} className={inp} /></L>
            <L label="디자인 구분">
              <select value={f.design} onChange={(e) => set("design", e.target.value)} className={inp}>
                <option value=""></option>
                {DESIGN_OPTIONS.map((p) => (<option key={p}>{p}</option>))}
              </select>
            </L>
            <L label="입고 구분">
              <select value={f.recv_type} onChange={(e) => set("recv_type", e.target.value)} className={inp}>
                <option value=""></option>
                {RECV_TYPE_OPTIONS.map((p) => (<option key={p}>{p}</option>))}
              </select>
            </L>
            <L label="납품업체">
              <input value={f.supplier} onChange={(e) => set("supplier", e.target.value)} maxLength={40} list="qc_supplier_choices" className={inp} />
              <datalist id="qc_supplier_choices">{suppliers.map((x) => (<option key={x} value={x} />))}</datalist>
            </L>
            <L label="Lot 수량"><input type="number" min={0} value={f.lot_qty} onChange={(e) => { touched.current.lq = true; set("lot_qty", e.target.value); }} className={inp} /></L>
            <L label="검사수량"><input type="number" min={0} value={f.insp_qty} onChange={(e) => { touched.current.iq = true; set("insp_qty", e.target.value); }} className={inp} /></L>
            <L label="부적합수량"><input type="number" min={0} value={f.bad_qty} onChange={(e) => set("bad_qty", e.target.value)} className={inp} /></L>
            <L label="검사자"><input value={f.inspector} onChange={(e) => set("inspector", e.target.value)} maxLength={20} className={inp} /></L>
            <L label="결과">
              <select value={f.result} onChange={(e) => set("result", e.target.value)} className={inp}>
                <option value=""></option>
                {RESULT_OPTIONS.map((p) => (<option key={p}>{p}</option>))}
              </select>
            </L>
            <L label="비고" wide><input value={f.remark} onChange={(e) => set("remark", e.target.value)} maxLength={200} className={inp} /></L>
          </div>
          {mode === "add" && (
            <div>
              <div className="text-xs text-slate-500 mb-1.5">사진 (선택 · 여러 장 가능)</div>
              <label className="inline-block px-3 py-1.5 rounded-md text-sm border border-slate-300 text-slate-700 cursor-pointer hover:border-navy">
                사진 촬영·선택
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    if (picked.length) {
                      if (files.length === 0 && !ocrBusy) readPhoto(picked[0]);
                      setFiles((prev) => [...prev, ...picked]);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              {ocrMsg && <p className={`text-xs mt-2 ${ocrBusy ? "text-indigo-600" : "text-slate-500"}`}>{ocrMsg}</p>}
              {ocrItems.length > 1 && (
                <div className="flex gap-1.5 flex-wrap mt-1.5">
                  {ocrItems.map((it, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => applyOcrItem(it)}
                      className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-navy hover:text-navy"
                    >
                      {i + 1}. {it.code}
                    </button>
                  ))}
                </div>
              )}
              {files.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {files.map((f0, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previews[i]} alt={f0.name} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        aria-label="사진 빼기"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-5"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {mode === "edit" && (
            <div>
              <div className="text-xs text-slate-500 mb-1.5">불량유형별 수량</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SUPPLY_DEFECT_NAMES.map((nm, j) => (
                  <label key={nm} className="text-xs text-slate-500">
                    {nm}
                    <input type="number" min={0} value={f.defs[j]} onChange={(e) => setF((p) => ({ ...p, defs: p.defs.map((x, i) => (i === j ? e.target.value : x)) }))} className={inp} />
                  </label>
                ))}
              </div>
            </div>
          )}
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            {mode === "edit" && lot?.has_orig && (
              <button type="button" onClick={resetToOrig} className="px-3 py-2 rounded-md text-sm border border-rose-200 text-rose-600 hover:bg-rose-50">
                원래대로
              </button>
            )}
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-md text-sm border border-slate-300 text-slate-600">취소</button>
            <button type="button" disabled={saving} onClick={save} className="px-4 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-50">
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 사진 업로드 창(로트를 골라 사진을 올린다 — 대시보드 "불량사진" 올리기와 같은 방식) ─────────────────
function PhotoUploadDialog({ lots, onClose, onDone }: { lots: SupplyLot[]; onClose: () => void; onDone: (msg: string) => Promise<void> }) {
  const [mode, setMode] = useState<"lot" | "request">("lot");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<SupplyLot | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const previews = useMemo(() => files.map((f0) => URL.createObjectURL(f0)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    const list = k
      ? lots.filter((r) => String(r.no) === k || [r.lot_no, r.mat_code, r.name, r.supplier].join(" ").toLowerCase().includes(k))
      : lots;
    return list.slice(0, 8);
  }, [lots, q]);

  async function upload() {
    if (!sel) return setMsg("사진을 올릴 로트를 먼저 골라 주세요.");
    if (files.length === 0) return setMsg("올릴 사진을 골라 주세요.");
    setBusy(true);
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      setMsg(`사진 올리는 중 (${i + 1}/${files.length})…`);
      try {
        const sh = await shrinkImage(files[i]);
        const res = await fetch("/api/qc-incoming/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ no: sel.no, note: note.trim(), image: sh.dataUrl, w: sh.w, h: sh.h }),
        });
        if (res.ok) ok++;
      } catch {
        /* 한 장 실패해도 다음 장 계속 */
      }
    }
    setBusy(false);
    const text = `No.${sel.no} 로트에 사진 ${ok}장을 올렸습니다.${ok < files.length ? ` (${files.length - ok}장 실패)` : ""}`;
    await onDone(text);
    if (ok === files.length) onClose();
    else setMsg(text);
  }

  const inp = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700";
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <b className="text-navy">사진 업로드</b>
          <button onClick={onClose} disabled={busy} className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-40">닫기</button>
        </div>
        <div className="px-5 pt-3 flex gap-1 border-b border-slate-200">
          {[{ v: "lot" as const, label: "로트에 사진 올리기" }, { v: "request" as const, label: "의뢰서 사진으로 로트 추가" }].map((t) => (
            <button
              key={t.v}
              type="button"
              disabled={busy}
              onClick={() => setMode(t.v)}
              className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${mode === t.v ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {mode === "request" ? (
          <div className="p-5">
            <RequestLotPanel lots={lots} onClose={onClose} onAdded={onDone} />
          </div>
        ) : (
        <div className="p-5 space-y-4">
          <div>
            <div className="text-xs text-slate-500 mb-1">1. 사진을 올릴 로트 선택</div>
            {sel ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-navy/30 bg-navy/5 px-3 py-2 text-sm">
                <span>
                  <b>No.{sel.no}</b> · {sel.name}
                  <span className="block text-xs text-slate-500">{sel.lot_no} · {sel.supplier}</span>
                </span>
                <button type="button" onClick={() => setSel(null)} className="text-xs px-2 py-1 rounded border border-slate-300 hover:border-navy">해제</button>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="번호, Lot, 자재코드, 품명, 납품업체 검색"
                  className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
                />
                <div className="mt-2 grid gap-1.5">
                  {results.length === 0 && <span className="text-xs text-slate-400">찾는 로트가 없습니다.</span>}
                  {results.map((r) => (
                    <button
                      key={r.no}
                      type="button"
                      onClick={() => setSel(r)}
                      className="text-left rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:border-navy"
                    >
                      No.{r.no} · {r.name}
                      <span className="block text-xs text-slate-500">{r.lot_no} · {r.supplier}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">2. 사진 선택 (여러 장 가능)</div>
            <label className="inline-block px-3 py-1.5 rounded-md text-sm border border-slate-300 text-slate-700 cursor-pointer hover:border-navy">
              사진 촬영·선택
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  if (picked.length) setFiles((prev) => [...prev, ...picked]);
                  e.target.value = "";
                }}
              />
            </label>
            {files.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {files.map((f0, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previews[i]} alt={f0.name} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      aria-label="사진 빼기"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-5"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label className="block text-xs text-slate-500">
            메모 (선택)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="예: 측면터짐 3개 확인" className={inp} />
          </label>
          {msg && <p className="text-xs text-slate-500">{msg}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-md text-sm border border-slate-300 text-slate-600 disabled:opacity-40">취소</button>
            <button type="button" onClick={upload} disabled={busy} className="px-4 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-50">
              {busy ? "올리는 중…" : "업로드"}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
