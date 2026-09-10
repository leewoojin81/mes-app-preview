"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { ProcessWipListResponse, ProcessWipRow } from "@/lib/types";
import {
  PROCESS_WIP_COLS as DETAIL_COLS,
  PROCESS_WIP_SUM_KEYS as SUM_KEYS,
} from "@/lib/process-wip-columns";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

export default function ProcessWipPage() {
  const [rows, setRows] = useState<ProcessWipRow[]>([]);
  const [total, setTotal] = useState(0);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [showUpload, setShowUpload] = useState(false);
  // 탭을 전환했다 돌아와도 조회 조건은 유지되도록 세션 단위로 저장한다.
  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", 200);
  const [searchInput, setSearchInput] = useTabState("searchInput", "");
  const [search, setSearch] = useTabState("search", "");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch, setPage]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set("search", search);
    fetch(`/api/process-wip?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ProcessWipListResponse) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setUploadedAt(data.uploadedAt);
        setTotals(data.totals ?? {});
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, search, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">공정재공현황</h1>
          <p className="text-sm text-slate-500 mt-1">
            INV-03 · ERP &quot;공정재공현황&quot; 엑셀 업로드 스냅샷 · 공정 단계별 재공수량
            {uploadedAt && ` · 기준 시점 ${uploadedAt}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (search) params.set("search", search);
              window.location.href = `/api/process-wip/export?${params.toString()}`;
            }}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            엑셀 다운로드
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light transition-colors"
          >
            엑셀 업로드
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="품목코드, 품목정보, 작업지시번호, LOT No, 수주번호 검색"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-80"
        />
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
        <div className="overflow-auto max-h-[calc(100vh-17rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-3 py-3 font-semibold sticky left-0 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-16">
                  No.
                </th>
                {DETAIL_COLS.map((col) => (
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
                  <td colSpan={DETAIL_COLS.length + 1} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={DETAIL_COLS.length + 1} className="text-center py-10 text-slate-400">
                    업로드된 재공 데이터가 없습니다. 엑셀 업로드로 시작하세요.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50 group">
                    <td className="px-3 py-2.5 text-center text-slate-400 sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 w-16">
                      {(page - 1) * pageSize + idx + 1}
                    </td>
                    {DETAIL_COLS.map((col) => {
                      const v = row.detail?.[col.key];
                      return (
                        <td
                          key={col.key}
                          title={v == null ? undefined : String(v)}
                          className={`px-3 py-2.5 max-w-64 truncate ${
                            typeof v === "number"
                              ? "text-right text-slate-500 font-mono text-xs"
                              : "text-slate-500"
                          }`}
                        >
                          {v == null || v === "" ? "-" : typeof v === "number" ? v.toLocaleString() : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-semibold sticky bottom-0 z-20">
                  <td
                    className="px-3 py-2.5 text-center sticky left-0 z-10 bg-slate-100 border-r border-slate-200 w-16"
                    title="검색 결과 전체 기준 합계(현재 페이지만이 아님)"
                  >
                    합계
                  </td>
                  {DETAIL_COLS.map((col) => {
                    const isSum = (SUM_KEYS as readonly string[]).includes(col.key);
                    const isRowsLabel = col.key === "품목코드";
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 whitespace-nowrap ${
                          isSum
                            ? "text-right text-navy font-mono text-xs"
                            : isRowsLabel
                              ? "text-slate-700"
                              : "text-slate-300"
                        }`}
                      >
                        {isRowsLabel
                          ? `(${total.toLocaleString()} Rows)`
                          : isSum
                            ? (totals[col.key] ?? 0).toLocaleString()
                            : "-"}
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

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onImported={() => {
            setPage(1);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function UploadModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/process-wip/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "업로드에 실패했습니다.");
      return;
    }
    setResult(data);
    onImported();
  };

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">엑셀 업로드</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          {result ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                업로드 완료 — {result.inserted.toLocaleString()}건 적재
                {result.skipped > 0 && `, 건너뜀(품목코드 없음) ${result.skipped.toLocaleString()}건`}
              </p>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white"
                >
                  닫기
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                &quot;공정재공현황&quot; 양식(.xlsx) 첫 시트를 읽습니다. 1행은 컬럼 제목이어야
                하며 &quot;품목코드&quot; 컬럼은 필수입니다. 업로드하면 기존 재공 데이터는 전부
                지워지고 새 파일 내용으로 교체됩니다.
              </p>
              <label className="block text-sm">
                <span className="text-slate-600">엑셀 파일</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-sm"
                />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
                >
                  취소
                </button>
                <button
                  onClick={submit}
                  disabled={!file || busy}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
                >
                  {busy ? "업로드 중..." : "업로드"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
