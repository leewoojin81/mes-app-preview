"use client";

import { Fragment, useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import type {
  AttendanceAuditItem,
  AttendanceAuditResult,
  AttendanceAuditRow,
  AttendanceAuditRowStatus,
} from "@/lib/attendance-audit";

// No.·사번·성명·공정·근무조·일자·저장상태(7) + 대사항목6×3(18) + 참고항목3×1(3) + 종합상태(1)
const TABLE_COL_COUNT = 29;

interface Me {
  role: string;
  processCodes: string[];
}

// PSN-01과 동일한 9개 항목·순서. kind="compare"는 PSN-01/PSN-02/차이 3열로 일치·불일치를
// 판정하고, kind="reference"는 세콤 근거 자체가 없어 PSN-01 값만 1열로 보여주고
// "참고"로만 표시한다(2026-09-10 사용자 요청 — 일치/불일치 판정 안 함).
const ITEM_DEFS: { key: keyof AttendanceAuditRow["items"]; label: string; kind: "compare" | "reference" }[] = [
  { key: "total", label: "근로시간", kind: "compare" },
  { key: "normal", label: "정상", kind: "compare" },
  { key: "overtime", label: "잔업", kind: "compare" },
  { key: "early_start", label: "조출", kind: "compare" },
  { key: "lunch_shift", label: "중교", kind: "reference" },
  { key: "late", label: "지각", kind: "compare" },
  { key: "early_leave", label: "조퇴", kind: "compare" },
  { key: "outing", label: "외출", kind: "reference" },
  { key: "support", label: "지원시간", kind: "reference" },
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

function fmtHours(v: number | null): string {
  if (v == null) return "-";
  if (v === 0) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtDiff(v: number | null): string {
  if (v == null) return "-";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  const s = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return (v > 0 ? "+" : "-") + s;
}

function rowClass(status: AttendanceAuditRowStatus): string {
  if (status === "매칭오류") return "bg-orange-50 hover:bg-orange-100/70";
  if (status === "불일치") return "bg-rose-50 hover:bg-rose-100/70";
  if (status === "카드없음") return "bg-slate-50/60 text-slate-400 hover:bg-slate-100/60";
  return "hover:bg-slate-50";
}

function StatusBadge({ status }: { status: AttendanceAuditRowStatus }) {
  const cls =
    status === "매칭오류"
      ? "bg-orange-100 text-orange-700"
      : status === "불일치"
        ? "bg-rose-100 text-rose-700"
        : status === "카드없음"
          ? "bg-slate-100 text-slate-400"
          : "bg-emerald-50 text-emerald-700";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>;
}

function ItemCells({ item, mismatch }: { item: AttendanceAuditItem; mismatch: boolean }) {
  return (
    <>
      <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtHours(item.psn01)}</td>
      <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtHours(item.psn02)}</td>
      <td
        className={`px-2 py-2 text-right font-mono border-r border-slate-100 ${
          mismatch ? "text-rose-600 font-semibold" : "text-slate-400"
        }`}
      >
        {fmtDiff(item.diff)}
      </td>
    </>
  );
}

// 참고 표시 전용 항목(중교/외출/지원시간) — 세콤 근거가 없어 PSN-01 값만 보여주고
// 일치/불일치 판정 없이 "참고"로만 표시한다.
function ReferenceCell({ psn01 }: { psn01: number }) {
  return (
    <td className="px-2 py-2 text-right border-r border-slate-100">
      <span className="font-mono text-slate-600">{fmtHours(psn01)}</span>
      <span className="ml-1.5 inline-block px-1 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400 align-middle">
        참고
      </span>
    </td>
  );
}

export default function AttendanceAuditPage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Me) => setMe(data));
  }, []);

  const [dateFrom, setDateFrom] = useTabState("aaDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("aaDateTo", today);
  const [workGroup, setWorkGroup] = useTabState("aaWorkGroup", "");
  const [mismatchOnly, setMismatchOnly] = useTabState("aaMismatchOnly", false);
  const [nameErrorOnly, setNameErrorOnly] = useTabState("aaNameErrorOnly", false);
  const [searchText, setSearchText] = useTabState("aaSearchText", "");

  // 조장 세션이면(그리고 아직 공정을 안 골랐으면) 본인 소속공정을 기본값으로 채운다
  // (PSN-05 근무시간조회와 동일한 관례).
  useEffect(() => {
    if (!me || me.role !== "leader") return;
    if (workGroup) return;
    if (me.processCodes.length === 1) setWorkGroup(me.processCodes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const [result, setResult] = useState<AttendanceAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const qs = new URLSearchParams({ dateFrom, dateTo });
    if (workGroup) qs.set("workGroup", workGroup);
    fetch(`/api/attendance-audit?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "조회에 실패했습니다.");
          setResult(null);
          return;
        }
        setResult(data as AttendanceAuditResult);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canQuery, dateFrom, dateTo, workGroup]);

  const allRows = result?.rows ?? [];
  const search = searchText.trim().toLowerCase();
  const visibleRows = allRows.filter((r) => {
    if (mismatchOnly && r.status !== "불일치") return false;
    if (nameErrorOnly && r.status !== "매칭오류") return false;
    if (
      search &&
      !r.employee_no.toLowerCase().includes(search) &&
      !r.worker_name.toLowerCase().includes(search)
    )
      return false;
    return true;
  });

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">근태대사</h1>
        <p className="text-sm text-slate-500 mt-1">
          PSN-06 · 일일근태입력(PSN-01)에 저장된 근태기록과 출퇴근카드등록(PSN-02, 세콤
          카드 원본)을 사번 변환 + 이름 교차검증으로 대조해 보여주는 조회 전용
          화면입니다(별도 업로드 없음). 공정은 세콤 근무조를 참고용으로 나란히 보여줄 뿐
          자동으로 맞춰보지 않습니다.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">오늘 불일치 인원 수</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">
            {result ? result.summary.todayMismatchWorkers.toLocaleString() : "-"}
            <span className="text-sm font-normal text-slate-400 ml-1">명</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">매칭오류 건수</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">
            {result ? result.summary.nameMismatchCount.toLocaleString() : "-"}
            <span className="text-sm font-normal text-slate-400 ml-1">건</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">조회기간</label>
          <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput value={dateTo} onChange={setDateTo} />
        </div>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <select
          value={workGroup}
          onChange={(e) => setWorkGroup(e.target.value)}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            workGroup ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">전체 공정</option>
          {WORK_GROUP_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="사번 · 성명 검색"
          className="border border-slate-300 rounded-md px-2.5 py-2 text-sm w-44"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
          <input
            type="checkbox"
            checked={mismatchOnly}
            onChange={(e) => setMismatchOnly(e.target.checked)}
            className="accent-rose-600"
          />
          불일치만 보기
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
          <input
            type="checkbox"
            checked={nameErrorOnly}
            onChange={(e) => setNameErrorOnly(e.target.checked)}
            className="accent-orange-600"
          />
          매칭오류만 보기
        </label>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-22rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["No.", "사번", "성명", "공정", "근무조", "일자", "저장상태"].map((label) => (
                  <th
                    key={label}
                    rowSpan={2}
                    className="text-center px-3 py-2 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] align-middle"
                  >
                    {label}
                  </th>
                ))}
                {ITEM_DEFS.map((it) => (
                  <th
                    key={it.key}
                    colSpan={it.kind === "compare" ? 3 : 1}
                    className="text-center px-2 py-1.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l border-slate-300/60"
                  >
                    {it.label}
                  </th>
                ))}
                <th
                  rowSpan={2}
                  className="text-center px-3 py-2 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] align-middle border-l border-slate-300/60"
                >
                  종합상태
                </th>
              </tr>
              <tr>
                {ITEM_DEFS.map((it) =>
                  it.kind === "compare" ? (
                    <Fragment key={it.key}>
                      <th className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l border-slate-300/60">
                        PSN-01
                      </th>
                      <th className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                        PSN-02
                      </th>
                      <th className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                        차이
                      </th>
                    </Fragment>
                  ) : (
                    <th
                      key={it.key}
                      className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l border-slate-300/60"
                    >
                      비교불가
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!canQuery && (
                <tr>
                  <td colSpan={TABLE_COL_COUNT} className="text-center py-10 text-slate-400">
                    사용자 정보를 불러오는 중...
                  </td>
                </tr>
              )}
              {canQuery && loading && (
                <tr>
                  <td colSpan={TABLE_COL_COUNT} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {canQuery && !loading && result && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={TABLE_COL_COUNT} className="text-center py-10 text-slate-400">
                    조건에 맞는 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {canQuery &&
                !loading &&
                result &&
                visibleRows.map((r, idx) => (
                  <tr key={`${r.employee_no}-${r.work_date}`} className={rowClass(r.status)}>
                    <td className="px-3 py-2 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{r.employee_no}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{r.worker_name}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.work_group ?? "-"}
                      {r.card_team && r.card_team !== r.work_group && (
                        <span className="text-slate-400 text-xs ml-1">(세콤: {r.card_team})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.team ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-600">{r.work_date}</td>
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
                    {ITEM_DEFS.map((it) =>
                      it.kind === "compare" ? (
                        <ItemCells key={it.key} item={r.items[it.key]} mismatch={r.items[it.key].mismatch} />
                      ) : (
                        <ReferenceCell key={it.key} psn01={r.items[it.key].psn01} />
                      )
                    )}
                    <td className="px-3 py-2 text-center border-l border-slate-100">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
