"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type { DailyWorkStatusListResponse, DailyWorkStatusRow } from "@/lib/types";
import {
  DAILY_WORK_STATUS_COLS as DETAIL_COLS,
  DAILY_WORK_STATUS_SUM_KEYS as SUM_KEYS,
} from "@/lib/daily-work-status-columns";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

// 드롭다운 필터(faceted) — 라인/설비/공정/품목계정/대분류/중분류/소분류
const DROPDOWN_FILTERS = [
  { param: "line", label: "라인" },
  { param: "equipment", label: "설비" },
  { param: "process", label: "공정" },
  { param: "acct", label: "품목계정" },
  { param: "cat1", label: "대분류" },
  { param: "cat2", label: "중분류" },
  { param: "cat3", label: "소분류" },
] as const;
type DropdownFilterParam = (typeof DROPDOWN_FILTERS)[number]["param"];
type DropdownFilterState = Record<DropdownFilterParam, string>;
const EMPTY_DROPDOWN_FILTERS: DropdownFilterState = {
  line: "",
  equipment: "",
  process: "",
  acct: "",
  cat1: "",
  cat2: "",
  cat3: "",
};
const EMPTY_FILTER_OPTIONS: Record<DropdownFilterParam, string[]> = {
  line: [],
  equipment: [],
  process: [],
  acct: [],
  cat1: [],
  cat2: [],
  cat3: [],
};

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 자정 근처에 날짜가 밀릴 수 있음)
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}
function firstDayOfMonth(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

export default function DailyWorkStatusPage() {
  const [rows, setRows] = useState<DailyWorkStatusRow[]>([]);
  const [total, setTotal] = useState(0);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // "더보기" 안에 접어둔 필터(설비/품목계정/라인/공정/대분류/중분류/소분류/표시건수)를
  // 펼칠지 — 값이 남아있어도 매번 접힌 채로 시작하고, 버튼 옆 배지로만 적용 여부를 알려준다.
  const [showMore, setShowMore] = useState(false);

  // 탭을 전환했다 돌아와도 조회 조건은 유지되도록 세션 단위로 저장한다
  // (조회 결과 자체는 항상 새로 받아오므로 rows/total/loading은 대상에서 제외).
  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", 200);

  // 기본 조회 범위: 이번 달 1일 ~ 당일
  const [dateFrom, setDateFrom] = useTabState("dateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("dateTo", today);

  const [dropdownFilters, setDropdownFilters] = useTabState<DropdownFilterState>(
    "dropdownFilters",
    EMPTY_DROPDOWN_FILTERS
  );
  const [filterOptions, setFilterOptions] =
    useState<Record<DropdownFilterParam, string[]>>(EMPTY_FILTER_OPTIONS);

  const [itemGroupInput, setItemGroupInput] = useTabState("itemGroupInput", "");
  const [itemGroup, setItemGroup] = useTabState("itemGroup", "");
  const [itemCodeInput, setItemCodeInput] = useTabState("itemCodeInput", "");
  const [itemCode, setItemCode] = useTabState("itemCode", "");
  const [woNoInput, setWoNoInput] = useTabState("woNoInput", "");
  const [woNo, setWoNo] = useTabState("woNo", "");
  const [lotNoInput, setLotNoInput] = useTabState("lotNoInput", "");
  const [lotNo, setLotNo] = useTabState("lotNo", "");

  useEffect(() => {
    const t = setTimeout(() => {
      setItemGroup(itemGroupInput.trim());
      setItemCode(itemCodeInput.trim());
      setWoNo(woNoInput.trim());
      setLotNo(lotNoInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [itemGroupInput, itemCodeInput, woNoInput, lotNoInput, setItemGroup, setItemCode, setWoNo, setLotNo, setPage]);

  function buildFilterParams() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    for (const f of DROPDOWN_FILTERS) {
      if (dropdownFilters[f.param]) params.set(f.param, dropdownFilters[f.param]);
    }
    if (itemGroup) params.set("itemGroup", itemGroup);
    if (itemCode) params.set("itemCode", itemCode);
    if (woNo) params.set("woNo", woNo);
    if (lotNo) params.set("lotNo", lotNo);
    return params;
  }

  // 드롭다운 옵션: 현재 조건에서 실제 존재하는 값만 서버에서 조회(faceted)
  useEffect(() => {
    let cancelled = false;
    const params = buildFilterParams();
    fetch(`/api/daily-work-status/filters?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Record<string, string[]>) => {
        if (cancelled) return;
        setFilterOptions({ ...EMPTY_FILTER_OPTIONS, ...data });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, dropdownFilters, itemGroup, itemCode, woNo, lotNo, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = buildFilterParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    fetch(`/api/daily-work-status?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: DailyWorkStatusListResponse) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, dateFrom, dateTo, dropdownFilters, itemGroup, itemCode, woNo, lotNo, refreshKey]);

  function onDropdownFilterChange(param: DropdownFilterParam, value: string) {
    setDropdownFilters((prev) => ({ ...prev, [param]: value }));
    setPage(1);
  }

  // "더보기" 안에 있는 필터(드롭다운 7개) 중 값이 채워진 개수 — 접혀있을 때 버튼 배지로 보여준다.
  const moreFilterCount = DROPDOWN_FILTERS.filter((f) => dropdownFilters[f.param]).length;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">일일작업현황</h1>
          <p className="text-sm text-slate-500 mt-1">
            PROD-10 · ERP &quot;일일작업현황&quot; 실적 로그 엑셀 업로드(기간별 누적) · 공정별
            작업 실적
            {uploadedAt && ` · 최근 업로드 ${uploadedAt}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              window.location.href = `/api/daily-work-status/export?${buildFilterParams().toString()}`;
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

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">작업일자</label>
          <DateSegmentInput
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v);
              setPage(1);
            }}
          />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput
            value={dateTo}
            onChange={(v) => {
              setDateTo(v);
              setPage(1);
            }}
          />
        </div>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <input
          value={itemGroupInput}
          onChange={(e) => setItemGroupInput(e.target.value)}
          placeholder="품목군"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-28"
        />
        <input
          value={woNoInput}
          onChange={(e) => setWoNoInput(e.target.value)}
          placeholder="작업지시번호"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-32"
        />
        <input
          value={itemCodeInput}
          onChange={(e) => setItemCodeInput(e.target.value)}
          placeholder="품목코드"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-32"
        />
        <input
          value={lotNoInput}
          onChange={(e) => setLotNoInput(e.target.value)}
          placeholder="LOT No"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-32"
        />
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
            showMore
              ? "border-navy text-navy bg-navy/5"
              : moreFilterCount > 0
                ? "border-navy/40 text-navy bg-white hover:bg-navy/5"
                : "border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
          }`}
        >
          <span>{showMore ? "접기" : moreFilterCount > 0 ? `더보기 (${moreFilterCount})` : "더보기"}</span>
          <span className="text-[10px]">{showMore ? "▲" : "▼"}</span>
        </button>
      </div>

      {showMore && (
        <div className="flex items-center justify-between flex-wrap gap-3 -mt-3">
          <div className="flex items-center gap-2 flex-wrap">
            {DROPDOWN_FILTERS.map((f) => (
              <select
                key={f.param}
                value={dropdownFilters[f.param]}
                onChange={(e) => onDropdownFilterChange(f.param, e.target.value)}
                className={`border rounded-md px-2.5 py-2 text-sm bg-white max-w-40 truncate ${
                  dropdownFilters[f.param]
                    ? "border-navy text-navy font-medium"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                <option value="">{f.label} 전체</option>
                {filterOptions[f.param].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ))}
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
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-19rem)]">
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
                    조건에 맞는 작업실적이 없습니다.
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
  const [result, setResult] = useState<{
    dateFrom: string;
    dateTo: string;
    deleted: number;
    inserted: number;
    skipped: number;
    finalTotal: number;
  } | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/daily-work-status/import", { method: "POST", body: fd });
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
                업로드 완료 ({result.dateFrom} ~ {result.dateTo} 구간 재동기화) — 기존{" "}
                {result.deleted.toLocaleString()}건 삭제, 신규 {result.inserted.toLocaleString()}
                건 입력, 최종 {result.finalTotal.toLocaleString()}건
                {result.skipped > 0 &&
                  ` (건너뜀(작업일자 없음) ${result.skipped.toLocaleString()}건)`}
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
                &quot;일일작업현황&quot; 양식(.xlsx) 첫 시트를 읽습니다. 1행은 컬럼 제목이어야
                하며 &quot;작업일자&quot; 컬럼은 필수입니다. 업로드 파일의 작업일자
                최소~최대 구간을 구해 그 구간의 기존 데이터를 전부 삭제한 뒤 파일 내용을
                새로 입력합니다(구간 밖 데이터는 유지됩니다).
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
