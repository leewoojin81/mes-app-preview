"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type { BizDayRow, BizLookupPage, BizTotals } from "@/lib/biz-attendance";

// 인원관리(PSN-05) "비즈" 탭 — 비즈 근태 시스템 "기간별 근무관리" 리포트(비즈.xlsx)를 그대로 올려
// 두고 조회한다(2026-10-01 사용자 요청: 조회 탭과 같은 맥락). 열 구성·사람별 블록·"( 소 계 )" 행까지
// 원본 모양 그대로이고, 조회 탭처럼 기간·부서·사번/성명으로 좁히고 엑셀로 내려받는다. 업로드는 관리자만.

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function firstDayOfMonth(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}
function today(): string {
  return toLocalDateStr(new Date());
}

// 시간 칸은 원본 엑셀의 [hh]:mm 서식과 같이 "08:00"(24시간을 넘으면 "151:20"). 0/빈칸은 빈칸.
function fmtDur(min: number | null): string {
  if (!min) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
// 소계 행은 0이어도 "00:00"으로 보여준다(원본 소계 행과 같게).
function fmtTotal(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// 일자 글씨색 — 토요일 파랑, 일요일 빨강(비즈 데이터에는 휴일 캘린더가 없어 요일만 본다)
function dateColor(dateStr: string): string {
  const wd = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  if (wd === 0) return "text-rose-600";
  if (wd === 6) return "text-blue-600";
  return "text-slate-600";
}

const DURATION_COLS: { key: keyof BizDayRow & keyof BizTotals; label: string }[] = [
  { key: "early_start", label: "조출" },
  { key: "lunch_shift", label: "중교" },
  { key: "overtime", label: "잔업" },
  { key: "normal", label: "정근" },
  { key: "extension", label: "연장" },
  { key: "night", label: "야간" },
  { key: "special", label: "특근" },
  { key: "special_holiday", label: "휴일" },
  { key: "special_sat", label: "토요" },
];

const COL_COUNT = 5 + 4 + 2 + DURATION_COLS.length + 1; // 사번~타임 5 + 일자/시간 4 + 지각/조퇴 2 + 시간 9 + 비고

const thCls =
  "text-center px-2 py-2 font-semibold sticky z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]";

export default function BizAttendanceTab({ role }: { role: string | null }) {
  const [dateFrom, setDateFrom] = useTabState("bizDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("bizDateTo", today);
  const [dept, setDept] = useTabState("bizDept", "");
  const [searchText, setSearchText] = useTabState("bizSearchText", "");
  const [query, setQuery] = useState(searchText);
  const [page, setPage] = useTabState("bizPage", 1);

  const [result, setResult] = useState<BizLookupPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 사번/성명 검색은 입력이 멈춘 뒤 조회한다
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(searchText.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  useEffect(() => {
    if (!dateFrom || !dateTo) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ dateFrom, dateTo, page: String(page) });
    if (query) params.set("q", query);
    if (dept) params.set("dept", dept);
    fetch(`/api/work-hours-lookup/biz?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "조회에 실패했습니다.");
          setResult(null);
          return;
        }
        const pageData = data as BizLookupPage;
        setResult(pageData);
        setPage((prev) => (prev === pageData.page ? prev : pageData.page));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, dept, query, page, reloadKey]);

  function downloadExcel() {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (query) params.set("q", query);
    if (dept) params.set("dept", dept);
    window.location.href = `/api/work-hours-lookup/biz/export?${params.toString()}`;
  }

  // ── 업로드(관리자) ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setUploadMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/work-hours-lookup/biz/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) {
      setUploadMsg({ ok: false, text: data.error ?? "업로드에 실패했습니다." });
      return;
    }
    setUploadMsg({
      ok: true,
      text: `업로드 완료 — ${data.dateFrom} ~ ${data.dateTo} (기존 ${Number(data.deleted).toLocaleString()}건 교체, ${Number(
        data.inserted
      ).toLocaleString()}건 저장${data.skipped ? `, ${data.skipped}건 건너뜀` : ""})`,
    });
    setDateFrom(data.dateFrom);
    setDateTo(data.dateTo);
    setPage(1);
    setReloadKey((k) => k + 1);
  }

  const hasData = (result?.totalPersons ?? 0) > 0;
  const noUploadedData = result != null && result.dataFrom == null;
  const outsideRange = result != null && result.dataFrom != null && result.totalPersons === 0 && !query && !dept;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500">
          비즈 "기간별 근무관리" 리포트를 업로드해 둔 값을 원본 모양 그대로 조회합니다(여기서 수정하지 않습니다).
          {result?.uploadedAt ? ` 최근 업로드 ${result.uploadedAt}` : ""}
        </p>
        <div className="flex items-center gap-2">
          {role === "admin" && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {uploading ? "업로드 중..." : "비즈 엑셀 업로드"}
              </button>
            </>
          )}
          <button
            onClick={downloadExcel}
            disabled={!hasData}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 transition-colors"
          >
            엑셀 다운로드
          </button>
        </div>
      </div>
      {uploadMsg && (
        <p className={`text-sm ${uploadMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>{uploadMsg.text}</p>
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
          value={dept}
          onChange={(e) => {
            setDept(e.target.value);
            setPage(1);
          }}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            dept ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">전체 부서</option>
          {(result?.depts ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="사번 또는 성명 검색(선택)"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-64"
        />
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 text-sm">
          <span className="font-bold text-navy">기간별 근무관리</span>
          <span className="text-slate-500 ml-3">
            근무기간 : {dateFrom.replace(/-/g, "/")}-{dateTo.replace(/-/g, "/")}
            {dept ? ` · 부서 : ${dept}` : ""}
          </span>
        </div>
        <div className="overflow-auto max-h-[calc(100vh-22rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["사번", "부서", "성명", "직위", "타임", "출근일자", "출근시간", "퇴근일자", "퇴근시간", "지각", "조퇴"].map((l) => (
                  <th key={l} rowSpan={2} className={`${thCls} top-0`}>
                    {l}
                  </th>
                ))}
                {DURATION_COLS.slice(0, 6).map((c) => (
                  <th key={c.key} rowSpan={2} className={`${thCls} top-0`}>
                    {c.label}
                  </th>
                ))}
                <th rowSpan={2} className={`${thCls} top-0`}>
                  특근
                </th>
                <th colSpan={2} className={`${thCls} top-0`}>
                  특연
                </th>
                <th rowSpan={2} className={`${thCls} top-0`}>
                  비 고
                </th>
              </tr>
              <tr>
                <th className={`${thCls} top-[2.1rem]`}>휴일</th>
                <th className={`${thCls} top-[2.1rem]`}>토요</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={COL_COUNT} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && result && result.totalPersons === 0 && (
                <tr>
                  <td colSpan={COL_COUNT} className="text-center py-10 text-slate-400">
                    {noUploadedData
                      ? "업로드된 비즈 데이터가 없습니다. 관리자가 비즈 엑셀을 업로드해 주세요."
                      : outsideRange
                        ? `이 기간에는 데이터가 없습니다. 업로드된 기간: ${result?.dataFrom} ~ ${result?.dataTo}`
                        : "조건에 맞는 인원이 없습니다."}
                  </td>
                </tr>
              )}
              {!loading &&
                result?.persons.map((p) => (
                  <Fragment key={p.employee_no}>
                    {p.rows.map((r, i) => (
                      <tr key={`${p.employee_no}-${r.work_date}-${i}`} className="hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono text-slate-500">{i === 0 ? p.employee_no : ""}</td>
                        <td className="px-2 py-1.5 text-slate-500">{i === 0 ? p.dept ?? "" : ""}</td>
                        <td className="px-2 py-1.5 font-medium text-slate-700">{i === 0 ? p.worker_name ?? "" : ""}</td>
                        <td className="px-2 py-1.5 text-slate-500">{i === 0 ? p.position ?? "" : ""}</td>
                        <td className="px-2 py-1.5 text-center text-slate-600">{r.shift ?? ""}</td>
                        <td className={`px-2 py-1.5 ${dateColor(r.work_date)}`}>{r.work_date}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-600">{r.in_time ?? ""}</td>
                        <td className="px-2 py-1.5 text-slate-600">{r.out_date ?? ""}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-600">{r.out_time ?? ""}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-600">{fmtDur(r.late)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-600">{fmtDur(r.early_leave)}</td>
                        {DURATION_COLS.map((c) => (
                          <td key={c.key} className="px-2 py-1.5 text-right font-mono text-slate-600">
                            {fmtDur(r[c.key])}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-slate-600">{r.note ?? ""}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/70 font-medium">
                      <td className="px-2 py-1.5 text-slate-500" colSpan={4}>
                        ( 소 계 )
                      </td>
                      <td className="px-2 py-1.5 text-center text-slate-600">{p.totals.days}</td>
                      <td className="px-2 py-1.5"></td>
                      <td className="px-2 py-1.5 text-center text-slate-600">{p.totals.in_count}</td>
                      <td className="px-2 py-1.5"></td>
                      <td className="px-2 py-1.5 text-center text-slate-600">{p.totals.out_count}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-600">{fmtTotal(p.totals.late)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-600">{fmtTotal(p.totals.early_leave)}</td>
                      {DURATION_COLS.map((c) => (
                        <td key={c.key} className="px-2 py-1.5 text-right font-mono text-slate-600">
                          {fmtTotal(p.totals[c.key])}
                        </td>
                      ))}
                      <td className="px-2 py-1.5"></td>
                    </tr>
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>

        {!loading && result && result.totalPages > 1 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-amber-50">
            <p className="text-xs text-amber-700">
              조회 대상이 총 {result.totalPersons.toLocaleString()}명이라 한 번에 표시하기엔 많습니다. 조회 범위를
              좁혀주세요 — 지금은 인원 {result.pageSize.toLocaleString()}명씩 나눠 보여드립니다.
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
