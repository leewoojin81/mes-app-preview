"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import {
  PRIORITY_DETAIL_COLS,
  PRIORITY_SUM_KEYS,
  priorityCell,
  type PriorityRow,
} from "@/lib/production-priority-columns";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 자정 근처에 날짜가 밀릴 수 있음)
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function currentYearStart(): string {
  const now = new Date();
  return toLocalDateStr(new Date(now.getFullYear(), 0, 1));
}
function today(): string {
  return toLocalDateStr(new Date());
}

export default function ProductionPriorityPage() {
  const [rows, setRows] = useState<PriorityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const uploadDrag = useDraggableModal();
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [savingSoNo, setSavingSoNo] = useState<string | null>(null);
  const [bulkExcluding, setBulkExcluding] = useState(false);

  // 탭을 전환했다 돌아와도 조회 조건은 유지되도록 세션 단위로 저장한다.
  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", 200);
  // 필터 없이 열면 전체 수주 라인(수만 건)이 대상이 되므로 기본은 당해년도 1월 1일부터로 좁힌다.
  const [dateFrom, setDateFrom] = useTabState("dateFrom", currentYearStart);
  const [dateTo, setDateTo] = useTabState("dateTo", today);
  const [soNoInput, setSoNoInput] = useTabState("soNoInput", "");
  const [soNo, setSoNo] = useTabState("soNo", "");

  async function loadRows() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (soNo) params.set("soNo", soNo);
    const res = await fetch(`/api/production-priority?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();
    setRows(data.rows);
    setTotal(data.total);
    setTotals(data.totals ?? {});
    setLoading(false);
  }

  // 수주번호 검색어는 300ms 디바운스 후 실제 조회에 반영
  useEffect(() => {
    const t = setTimeout(() => {
      setSoNo(soNoInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [soNoInput, setSoNo, setPage]);

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, dateFrom, dateTo, soNo]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  async function savePlan(so: PriorityRow, priority: number | null, exclude: boolean) {
    setSavingSoNo(so.so_no);
    try {
      const res = await fetch(`/api/sales-orders/${encodeURIComponent(so.so_no)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plan", priority, exclude }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      await loadRows();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSavingSoNo(null);
    }
  }

  // 현재 조회(검색) 결과에 뜬 행 전체의 계획제외를 한 번에 체크/해제한다.
  async function setAllExcluded(exclude: boolean) {
    if (rows.length === 0) return;
    setBulkExcluding(true);
    try {
      const res = await fetch("/api/production-priority/exclude-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ so_nos: rows.map((r) => r.so_no), exclude }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "일괄 반영에 실패했습니다.");
      setToast(`계획제외 일괄 ${exclude ? "체크" : "해제"} — ${data.updated.toLocaleString()}건`);
      await loadRows();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "일괄 반영에 실패했습니다.");
    } finally {
      setBulkExcluding(false);
    }
  }

  // 작업순서는 직접 입력하지 않고 ▲▼로 순서만 바꾼다 — 서버가 현재 조회 조건 전체 기준으로
  // 1..N을 다시 채번해 저장하므로 값이 비어있거나 뒤섞여 있어도 항상 안전하게 정리된다.
  async function moveRow(so: PriorityRow, direction: "up" | "down") {
    setSavingSoNo(so.so_no);
    try {
      const res = await fetch("/api/production-priority/move", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ so_no: so.so_no, direction, dateFrom, dateTo, soNo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "순서 변경에 실패했습니다.");
      await loadRows();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "순서 변경에 실패했습니다.");
    } finally {
      setSavingSoNo(null);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/production-priority/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(data.error ?? "업로드에 실패했습니다.");
        return;
      }
      setToast(
        `업로드 완료 — 반영 ${data.updated.toLocaleString()}건` +
          (data.skippedNotFound > 0
            ? `, 건너뜀(수주번호 없음) ${data.skippedNotFound.toLocaleString()}건`
            : "") +
          (data.skippedInvalid > 0 ? `, 건너뜀(값 오류) ${data.skippedInvalid.toLocaleString()}건` : "")
      );
      setShowUpload(false);
      setUploadFile(null);
      loadRows();
    } finally {
      setUploading(false);
    }
  }

  const colCount = PRIORITY_DETAIL_COLS.length + 3; // No. + 작업순서 + 계획제외
  const allExcluded = rows.length > 0 && rows.every((r) => r.detail?.["계획제외"] === "Y");
  const someExcluded = rows.some((r) => r.detail?.["계획제외"] === "Y");

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">생산순위지정</h1>
          <p className="text-sm text-slate-500 mt-1">
            PLAN-01 · ▲▼로 작업순서를 조정하고 계획제외 여부를 관리 · 엑셀로 일괄 다운로드/업로드
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (dateFrom) params.set("dateFrom", dateFrom);
              if (dateTo) params.set("dateTo", dateTo);
              if (soNo) params.set("soNo", soNo);
              window.location.href = `/api/production-priority/export?${params.toString()}`;
            }}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            엑셀 다운로드
          </button>
          <button
            onClick={() => {
              setUploadFile(null);
              setShowUpload(true);
            }}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            엑셀 업로드
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4 flex-wrap shadow-sm">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">수주일자</label>
          <DateSegmentInput
            value={dateFrom}
            onChange={(iso) => {
              setDateFrom(iso);
              setPage(1);
            }}
          />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput
            value={dateTo}
            onChange={(iso) => {
              setDateTo(iso);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">수주번호</label>
          <input
            value={soNoInput}
            onChange={(e) => setSoNoInput(e.target.value)}
            placeholder="수주번호 검색"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-40"
          />
        </div>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white text-slate-600"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}건씩
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-19rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-3 py-3 font-semibold sticky left-0 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-12">
                  No.
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky left-12 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-20">
                  작업순서
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky left-32 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-16">
                  <div className="flex flex-col items-center gap-1">
                    <span>계획제외</span>
                    <input
                      type="checkbox"
                      title="현재 검색 결과 전체 체크/해제"
                      checked={allExcluded}
                      ref={(el) => {
                        if (el) el.indeterminate = !allExcluded && someExcluded;
                      }}
                      disabled={bulkExcluding || loading || rows.length === 0}
                      onChange={(e) => setAllExcluded(e.target.checked)}
                    />
                  </div>
                </th>
                {PRIORITY_DETAIL_COLS.map((col) => (
                  <th
                    key={col.key}
                    className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]"
                  >
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={colCount} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="text-center py-10 text-slate-400">
                    조건에 맞는 수주가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, idx) => {
                  const priority = (r.detail?.["작업순서"] as number | null | undefined) ?? null;
                  const excluded = r.detail?.["계획제외"] === "Y";
                  const saving = savingSoNo === r.so_no;
                  return (
                    <tr key={r.so_no} className="hover:bg-slate-50 group">
                      <td className="px-3 py-2.5 text-center text-slate-400 sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200">
                        {(page - 1) * pageSize + idx + 1}
                      </td>
                      <td className="px-2 py-2 sticky left-12 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="w-6 text-center text-sm font-mono text-slate-600">
                            {priority ?? "-"}
                          </span>
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => moveRow(r, "up")}
                              disabled={saving}
                              aria-label="위로"
                              className="leading-none text-slate-400 hover:text-navy disabled:opacity-30"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              onClick={() => moveRow(r, "down")}
                              disabled={saving}
                              aria-label="아래로"
                              className="leading-none text-slate-400 hover:text-navy disabled:opacity-30"
                            >
                              ▼
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center sticky left-32 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200">
                        <input
                          type="checkbox"
                          checked={excluded}
                          disabled={saving}
                          onChange={(e) => savePlan(r, priority, e.target.checked)}
                        />
                      </td>
                      {PRIORITY_DETAIL_COLS.map((col) => {
                        const v = priorityCell(r, col.key);
                        const isSum = (PRIORITY_SUM_KEYS as readonly string[]).includes(col.key);
                        return (
                          <td
                            key={col.key}
                            title={v == null ? undefined : String(v)}
                            className={`px-3 py-2.5 max-w-64 truncate ${
                              isSum
                                ? "text-right text-slate-500 font-mono text-xs"
                                : col.key === "수주번호"
                                  ? "font-mono text-xs text-navy"
                                  : "text-slate-500"
                            }`}
                          >
                            {v == null || v === "" ? "-" : typeof v === "number" ? v.toLocaleString() : String(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-semibold sticky bottom-0 z-20">
                  <td className="px-3 py-2.5 text-center sticky left-0 z-10 bg-slate-100 border-r border-slate-200">
                    합계
                  </td>
                  <td className="px-3 py-2.5 sticky left-12 z-10 bg-slate-100 border-r border-slate-200" />
                  <td
                    className="px-3 py-2.5 text-slate-700 sticky left-32 z-10 bg-slate-100 border-r border-slate-200 whitespace-nowrap"
                    title="검색 결과 전체 기준"
                  >
                    ({total.toLocaleString()} Rows)
                  </td>
                  {PRIORITY_DETAIL_COLS.map((col) => {
                    const isSum = (PRIORITY_SUM_KEYS as readonly string[]).includes(col.key);
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 whitespace-nowrap ${
                          isSum ? "text-right text-navy font-mono text-xs" : "text-slate-300"
                        }`}
                      >
                        {isSum ? (totals[col.key] ?? 0).toLocaleString() : "-"}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500">
            전체 {total.toLocaleString()}건 중 {rangeStart.toLocaleString()}-
            {rangeEnd.toLocaleString()}건 표시
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300"
            >
              이전
            </button>
            <span className="text-sm text-slate-600">
              {page.toLocaleString()} / {totalPages.toLocaleString()}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300"
            >
              다음
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}

      {showUpload && (
        <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col" style={uploadDrag.style}>
            <div
              className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
              onMouseDown={uploadDrag.onMouseDown}
            >
              <h2 className="text-base font-bold text-navy">엑셀 업로드</h2>
              <button
                onClick={() => {
                  setShowUpload(false);
                  setUploadFile(null);
                }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-slate-500">
                &quot;엑셀 다운로드&quot;로 받은 양식을 그대로 사용하세요. &quot;수주번호&quot;(과
                &quot;순번&quot;)로 수주를 찾아 &quot;작업순서&quot;·&quot;계획제외&quot; 값만 반영합니다.
              </p>
              <label className="block text-sm">
                <span className="text-slate-600">엑셀 파일</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setUploadFile(file);
                  }}
                  className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-sm"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowUpload(false);
                    setUploadFile(null);
                  }}
                  className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
                >
                  닫기
                </button>
                <button
                  onClick={() => uploadFile && handleUpload(uploadFile)}
                  disabled={!uploadFile || uploading}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {uploading ? "업로드 중..." : "업로드"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
