"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import SpecialWorkDayModal from "@/components/SpecialWorkDayModal";
import { useTabState } from "@/lib/use-tab-state";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import type { WorkHoursLookupPage, WorkHoursLookupTotals } from "@/lib/work-hours-lookup";

interface WorkerOption {
  employee_no: string;
  worker_name: string;
  work_group: string | null;
}

interface Me {
  role: string;
  processCodes: string[];
}

const COLS: { key: keyof WorkHoursLookupTotals; label: string }[] = [
  { key: "total_hours", label: "근무시간" },
  { key: "normal_hours", label: "정상" },
  { key: "overtime_hours", label: "잔업" },
  { key: "early_start_hours", label: "조출" },
  { key: "lunch_shift_hours", label: "중교" },
  { key: "late_hours", label: "지각" },
  { key: "early_leave_hours", label: "조퇴" },
  { key: "outing_hours", label: "외출" },
  { key: "support_hours", label: "지원" },
];

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

// 값이 0(또는 없음)이면 빈칸으로 보여준다 — "근무시간조회.xlsx" 원본도 값이 없는 칸은
// 비어 있다(PSN-01 그리드의 "값이 0이면 빈칸" 표시 관례와 동일).
function fmt(v: number): string {
  return v === 0 ? "" : v.toLocaleString();
}

// 근무시간(total_hours)은 지원시간 등이 더해져 소수점이 흔히 나오므로 항상 소수점
// 2자리까지 보여준다(다른 항목은 정수라 fmt()의 toLocaleString 그대로 사용).
function fmtHours(v: number): string {
  return v === 0 ? "" : v.toFixed(2);
}

function fmtTotal(key: keyof WorkHoursLookupTotals, v: number): string {
  return key === "total_hours" ? v.toFixed(2) : v.toLocaleString();
}

// 생산캘린더(BASE-08) 기준 일자 글씨색 — 토요일은 파랑, 일요일과 휴일은 빨강, 그 외는
// 기본색. 생산캘린더는 토/일요일도 day_type='휴일'(비고 "주말")로 등록해두므로 day_type만
// 보면 토요일도 전부 빨강이 돼버린다 — 요일 판정을 먼저 적용해 토요일은 파랑으로 고정하고,
// 평일에 등록된 휴일(공휴일 등)만 day_type='휴일'로 빨강 처리한다. 요일 판정은 문자열
// 그대로 UTC로 파싱해도 달력 날짜가 어긋나지 않는다(dateRange와 동일한 방식).
function dateTextColor(dateStr: string, dayType: string | undefined): string {
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  if (weekday === 0) return "text-rose-600";
  if (weekday === 6) return "text-blue-600";
  if (dayType === "휴일") return "text-rose-600";
  return "text-slate-500";
}

// 저장상태 필터(2026-09-08 사용자 요청) — 서버 재조회 없이 이미 받아온 일자별 행을
// has_record 기준으로 화면에서만 걸러 보여준다. 소계/전체합계는 필터와 무관하게 항상
// 조회기간 전체 기준 값을 그대로 보여준다(필터링된 부분합이 아님).
function filterRowsByStatus<T extends { has_record: boolean }>(rows: T[], statusFilter: string): T[] {
  if (statusFilter === "saved") return rows.filter((r) => r.has_record);
  if (statusFilter === "unsaved") return rows.filter((r) => !r.has_record);
  return rows;
}

export default function WorkHoursLookupPage() {
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  useEffect(() => {
    fetch("/api/work-hours-lookup/workers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: WorkerOption[]) => setWorkers(data));
  }, []);

  // role/소속공정 조회 — 조장이면 화면 진입 시 자동으로 본인 소속공정으로 필터링된
  // 상태로 시작하고, 관리자는 공정 필터를 비워둔 채(="전체") 시작할 수 있게 한다
  // (2026-09-08 사용자 요청, 더 이상 공정/작업자 선택을 강제하지 않는다).
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Me) => setMe(data));
  }, []);

  const [employeeNo, setEmployeeNo] = useTabState("whlEmployeeNo", "");
  const [searchText, setSearchText] = useTabState("whlSearchText", "");
  const [showDropdown, setShowDropdown] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const [dateFrom, setDateFrom] = useTabState("whlDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("whlDateTo", today);
  const [processFilter, setProcessFilter] = useTabState("whlProcess", "");
  const [page, setPage] = useTabState("whlPage", 1);
  // 저장상태 필터(2026-09-08 사용자 요청) — 서버 조회 조건이 아니라 이미 받아온 일자별
  // 행(has_record)을 화면에서만 걸러 보여준다. ""=전체, "saved"=저장됨, "unsaved"=미저장.
  const [statusFilter, setStatusFilter] = useTabState("whlStatusFilter", "");

  // 조장 세션이 확인되면, 아직 아무 필터도 고르지 않은 상태(=탭을 새로 연 직후)일 때만
  // 본인 소속공정을 기본값으로 채운다 — 이미 다른 값을 골라뒀다면(같은 탭에서 이전에
  // 선택해 세션에 남아있는 값) 덮어쓰지 않는다. 소속공정이 여럿인 조장은 특정 하나로
  // 단정할 수 없어 비워두고(=자기 소속공정 전체, 서버가 세션으로 알아서 좁혀준다).
  useEffect(() => {
    if (!me || me.role !== "leader") return;
    if (processFilter || employeeNo) return;
    if (me.processCodes.length === 1) setProcessFilter(me.processCodes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const [showSpecialModal, setShowSpecialModal] = useState(false);

  const [result, setResult] = useState<WorkHoursLookupPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const matches = useMemo(() => {
    const q = searchText.trim();
    if (!q) return [];
    return workers
      .filter((w) => !processFilter || w.work_group === processFilter)
      .filter((w) => w.employee_no.includes(q) || w.worker_name.includes(q))
      .slice(0, 20);
  }, [workers, searchText, processFilter]);

  function selectWorker(w: WorkerOption) {
    setEmployeeNo(w.employee_no);
    setSearchText(`${w.worker_name} (${w.employee_no})`);
    setShowDropdown(false);
    setPage(1);
  }

  // 검색창을 비우면(사번/성명 지우기) 다시 공정 소속 전원 보기로 돌아간다.
  function changeSearchText(v: string) {
    setSearchText(v);
    if (!v.trim()) {
      setEmployeeNo("");
      setPage(1);
    }
    setShowDropdown(true);
  }

  // 공정 필터가 바뀌면 이미 골라둔 작업자가 새 필터 밖일 수 있으니 검색 선택을 비운다
  // (필터와 안 맞는 작업자가 표에 계속 남아 있으면 헷갈린다) — 공정 필터 자체는 그대로 조회 조건이 된다.
  function changeProcessFilter(v: string) {
    setProcessFilter(v);
    setEmployeeNo("");
    setSearchText("");
    setPage(1);
  }

  // 더 이상 공정/작업자 선택을 강제하지 않는다 — 필터를 비워두면 관리자는 "전체",
  // 조장은 세션에 담긴 본인 소속공정 전체로 서버가 알아서 좁혀준다(resolveEmployeeNos).
  // role을 아직 모르는 동안(me===null)에는 어느 쪽으로 조회할지 알 수 없으니 대기한다.
  const canQuery = me != null;

  useEffect(() => {
    if (!canQuery || !dateFrom || !dateTo) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ dateFrom, dateTo, page: String(page) });
    if (employeeNo) params.set("employeeNo", employeeNo);
    else if (processFilter) params.set("workGroup", processFilter);
    fetch(`/api/work-hours-lookup?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "조회에 실패했습니다.");
          setResult(null);
          return;
        }
        const pageData = data as WorkHoursLookupPage;
        setResult(pageData);
        // 필터/조회기간이 바뀌어 페이지 수가 줄어들면 서버가 요청한 page를 마지막
        // 페이지로 잘라서 내려준다 — 화면 상태도 그 값에 맞춰 스스로 보정한다(요청한
        // page와 같으면 재요청 없이 그대로 끝남).
        setPage((prev) => (prev === pageData.page ? prev : pageData.page));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeNo, processFilter, dateFrom, dateTo, page, canQuery]);

  function buildDownloadParams(): URLSearchParams {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (employeeNo) params.set("employeeNo", employeeNo);
    else if (processFilter) params.set("workGroup", processFilter);
    return params;
  }

  function downloadExcel() {
    if (!canQuery) return;
    window.location.href = `/api/work-hours-lookup/export?${buildDownloadParams().toString()}`;
  }

  // "초과신청" 다운로드(2026-09-08 사용자 요청) — 실제 제출용 서식("실링 초과신청.xlsx"
  // 참고, 사번/부서/성명/일자/조출/중교/잔업/비고)으로 같은 조회 조건을 내려받는다.
  function downloadOvertimeExcel() {
    if (!canQuery) return;
    window.location.href = `/api/work-hours-lookup/export-overtime?${buildDownloadParams().toString()}`;
  }

  // 다운로드는 페이지 구분 없이 조건에 맞는 전체를 내려주므로(export/route.ts) 현재
  // 페이지가 아니라 totalWorkers로 활성화 여부를 판단한다.
  const hasAnyRows = (result?.totalWorkers ?? 0) > 0;

  // 저장상태 필터를 적용해 일자가 하나도 안 남는 작업자는 블록째로 숨긴다 — "No."는
  // 화면에 실제로 보이는 순서대로 다시 매긴다(건너뛴 번호가 안 생기게).
  const visibleWorkerBlocks = (result?.workers ?? [])
    .map((w) => ({ w, rows: filterRowsByStatus(w.rows, statusFilter) }))
    .filter((b) => b.rows.length > 0);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">근무시간조회</h1>
          <p className="text-sm text-slate-500 mt-1">
            PSN-05 · 일일근태입력(PSN-01)에 저장된 근태기록을 일자별로 보여주는 조회 전용
            화면입니다(여기서 입력·수정하지 않습니다). 조장은 본인 소속공정으로 자동
            필터링되어 시작하고, 관리자는 공정을 전체로 둘 수 있습니다(대상이 많으면 인원
            단위로 페이지가 나뉩니다). 사번/성명 검색은 그 안에서 한 명만 추려낼 때 씁니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={downloadExcel}
            disabled={!canQuery || !hasAnyRows}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 transition-colors"
          >
            엑셀 다운로드
          </button>
          <button
            onClick={downloadOvertimeExcel}
            disabled={!canQuery || !hasAnyRows}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy disabled:opacity-40 transition-colors"
          >
            초과신청
          </button>
          <button
            onClick={() => setShowSpecialModal(true)}
            disabled={!canQuery || !hasAnyRows}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy disabled:opacity-40 transition-colors"
          >
            특근일
          </button>
        </div>
      </div>

      {showSpecialModal && (
        <SpecialWorkDayModal
          workGroup={employeeNo ? "" : processFilter}
          employeeNo={employeeNo}
          onClose={() => setShowSpecialModal(false)}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">조회기간</label>
          <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput value={dateTo} onChange={setDateTo} />
        </div>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <select
          value={processFilter}
          onChange={(e) => changeProcessFilter(e.target.value)}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            processFilter ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">전체 공정</option>
          {WORK_GROUP_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-md px-2.5 py-2 text-sm bg-white border-slate-300 text-slate-600"
        >
          <option value="">저장상태 전체</option>
          <option value="saved">저장됨</option>
          <option value="unsaved">미저장</option>
        </select>
        <div ref={boxRef} className="relative">
          <input
            value={searchText}
            onChange={(e) => changeSearchText(e.target.value)}
            onFocus={() => setShowDropdown(true)}
            placeholder="사번 또는 성명 검색(선택)"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-64"
          />
          {showDropdown && matches.length > 0 && (
            <div className="absolute z-30 mt-1 w-72 max-h-64 overflow-auto bg-white border border-slate-200 rounded-md shadow-lg">
              {matches.map((w) => (
                <button
                  key={w.employee_no}
                  onClick={() => selectWorker(w)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2"
                >
                  <span className="font-medium text-slate-700">{w.worker_name}</span>
                  <span className="text-xs text-slate-400 font-mono">
                    {w.employee_no} · {w.work_group ?? "-"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {showDropdown && searchText.trim() && matches.length === 0 && (
            <div className="absolute z-30 mt-1 w-72 bg-white border border-slate-200 rounded-md shadow-lg px-3 py-2 text-sm text-slate-400">
              일치하는 작업자가 없습니다.
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-19rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["No.", "사번", "공정", "공정코드", "성명", "일자", "저장상태", "근무시간", "정상", "잔업", "조출", "중교", "지각", "조퇴", "외출", "지원"].map(
                  (label) => (
                    <th
                      key={label}
                      className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]"
                    >
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!canQuery && (
                <tr>
                  <td colSpan={16} className="text-center py-10 text-slate-400">
                    사용자 정보를 불러오는 중...
                  </td>
                </tr>
              )}
              {canQuery && loading && (
                <tr>
                  <td colSpan={16} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {canQuery && !loading && result && result.workers.length === 0 && (
                <tr>
                  <td colSpan={16} className="text-center py-10 text-slate-400">
                    조건에 맞는 작업자가 없습니다.
                  </td>
                </tr>
              )}
              {canQuery && !loading && result && result.workers.length > 0 && visibleWorkerBlocks.length === 0 && (
                <tr>
                  <td colSpan={16} className="text-center py-10 text-slate-400">
                    선택한 저장상태에 맞는 일자가 없습니다.
                  </td>
                </tr>
              )}
              {canQuery &&
                !loading &&
                result &&
                visibleWorkerBlocks.map(({ w, rows: workerRows }, wIdx) => (
                  <Fragment key={w.employee_no}>
                    {workerRows.map((r, idx) => (
                      <tr key={`${w.employee_no}-${r.work_date}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-center text-slate-500">{idx === 0 ? wIdx + 1 : ""}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{idx === 0 ? w.employee_no : ""}</td>
                        <td className="px-3 py-2 text-slate-500">{idx === 0 ? w.work_group ?? "-" : ""}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">
                          {idx === 0 ? (w.process_code ? `${w.process_code} · ${w.process_name ?? ""}` : "-") : ""}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-700">{idx === 0 ? w.worker_name : ""}</td>
                        <td className={`px-3 py-2 ${dateTextColor(r.work_date, result.calendar[r.work_date])}`}>
                          {r.work_date}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.has_record ? (
                            <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                              저장됨
                            </span>
                          ) : (
                            <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-400">
                              미저장
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-navy font-semibold">
                          {fmtHours(r.total_hours)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.normal_hours)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.overtime_hours)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.early_start_hours)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.lunch_shift_hours)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.late_hours)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.early_leave_hours)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.outing_hours)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.support_hours)}</td>
                      </tr>
                    ))}
                    <tr key={`${w.employee_no}-subtotal`} className="bg-slate-50/70 font-medium">
                      <td className="px-3 py-2 text-center text-slate-400" colSpan={5}>
                        {w.worker_name} 소계
                      </td>
                      <td className="px-3 py-2 text-slate-400" colSpan={2}></td>
                      {COLS.map((c) => (
                        <td key={c.key} className="px-3 py-2 text-right font-mono text-slate-600">
                          {fmtTotal(c.key, w.totals[c.key])}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
            </tbody>
            {canQuery && !loading && result && result.totalWorkers > 1 && (
              <tfoot>
                <tr className="bg-slate-100 font-semibold border-t-2 border-slate-200">
                  <td className="px-3 py-2.5 text-center text-slate-500" colSpan={5}>
                    전체합계 <span className="text-slate-400 font-normal">({result.totalWorkers}명)</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500" colSpan={2}>
                    {dateFrom} ~ {dateTo}
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-right font-mono text-navy">
                      {fmtTotal(c.key, result.grandTotals[c.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* 조회 대상(작업자 수 × 조회일수)이 PAGE_ROW_LIMIT을 넘으면 서버가 인원 단위로
            페이지를 나눠 내려준다 — 안 넘으면 totalPages가 1이라 이 영역 자체가 안 보인다. */}
        {canQuery && !loading && result && result.totalPages > 1 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-amber-50">
            <p className="text-xs text-amber-700">
              조회 대상이 총 {result.totalWorkers.toLocaleString()}명이라 한 번에 표시하기엔 많습니다.
              조회 범위를 좁혀주세요 — 지금은 인원 {result.pageSize.toLocaleString()}명씩 나눠 보여드립니다.
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
                {result.page.toLocaleString()} / {result.totalPages.toLocaleString()}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}
                disabled={page >= result.totalPages}
                className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
