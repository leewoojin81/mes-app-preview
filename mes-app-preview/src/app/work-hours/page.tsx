"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import HourMinuteInput from "@/components/HourMinuteInput";
import { useTabState } from "@/lib/use-tab-state";
import { LEAVE_TYPE_OPTIONS, computeAttendanceHours } from "@/lib/work-hours-leave";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import { formatHoursClock } from "@/lib/format-hours";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { Process, WorkHoursResponse, WorkHoursRow } from "@/lib/types";

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}

// 목록에 실제로 나타나는 값만 옵션으로 뽑는다(빈 값 제외, 가나다순) — 작업자등록(BASE-09)의
// 같은 헬퍼와 동일한 패턴.
function distinctOptions(rows: WorkHoursRow[], key: "work_group" | "contractor" | "team"): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v != null && v.trim() !== "") set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

// "정상"/"잔업"은 휴가구분이 "출근"인 날은 지각+조퇴+외출 합계를 잔업(신청값)에서 먼저
// 차감하고, 잔업으로 다 못 덮는 초과분만 정상근무 8시간에서 마저 빼는 계산값이다
// (work-hours-leave.ts의 computeAttendanceHours). 수정 팝업에서 값을 바꾸는 동안 저장 전
// 미리보기로 쓴다 — 그리드 자체는 항상 서버가 계산해 내려준 값(r.normal_hours/total_hours)을
// 그대로 표시한다(2026-09-13 사용자 요청으로 그리드 직접 수정을 없애면서, 조회 시 재계산
// 때문에 PSN-06과 값이 어긋나 보이던 문제도 같이 없앴다).
function computeAttendance(r: {
  leave_type: string | null;
  overtime_hours: number;
  late_hours: number;
  early_leave_hours: number;
  outing_hours: number;
  support_hours: number;
}): { normalHours: number; overtimeHours: number } {
  return computeAttendanceHours(r.leave_type, {
    overtimeInput: r.overtime_hours,
    lateHours: r.late_hours,
    earlyLeaveHours: r.early_leave_hours,
    outingHours: r.outing_hours,
    supportHours: r.support_hours,
  });
}

function computeTotal(r: {
  leave_type: string | null;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  outing_hours: number;
  support_hours: number;
}): number {
  const { normalHours, overtimeHours } = computeAttendance(r);
  return normalHours + overtimeHours + r.early_start_hours + r.lunch_shift_hours + r.support_hours;
}

// 근무시간 표시용 기준값 — 12.01로 잡아서 "정확히 12"는 정상(경계값), 12를 조금이라도
// 넘긴 경우만 빨간색으로 표시한다. 저장을 막는 상한은 아니다(2026-09-20 사용자 요청으로
// 저장 제한 제거, 표시만 유지).
const OVER_HOURS_THRESHOLD = 12.01;

// 근무조(workers.team) — 1조/2조/3조 소속 표시(작업자등록 BASE-09 TEAM_OPTIONS와 동일).
const TEAM_OPTIONS = ["1조", "2조", "3조"] as const;

type HourField =
  | "overtime_hours"
  | "early_start_hours"
  | "lunch_shift_hours"
  | "late_hours"
  | "early_leave_hours"
  | "outing_hours";

// "잔업" 필드는 그리드 표시(계산된 실제 인정 잔업, r.overtime_hours)와 편집 대상(잔업
// 신청값 원본, r.overtime_input_hours)이 서로 다르다 — 수정 팝업/미리보기/저장 요청은
// 전부 이 헬퍼로 편집용 원본값을 읽어야 한다(overtime_hours를 다시 신청값으로 쓰면 저장할
// 때마다 지각/조퇴/외출 차감이 중복 적용된다, 2026-09-15 발견·수정).
function editableHourValue(r: WorkHoursRow, key: HourField): number {
  return key === "overtime_hours" ? r.overtime_input_hours : r[key];
}

const HOUR_FIELDS: { key: HourField; label: string }[] = [
  { key: "overtime_hours", label: "잔업" },
  { key: "early_start_hours", label: "조출" },
  { key: "lunch_shift_hours", label: "중교" },
  { key: "late_hours", label: "지각" },
  { key: "early_leave_hours", label: "조퇴" },
  { key: "outing_hours", label: "외출" },
];

// 잔업/조출/중교/지각/조퇴/외출은 10분 단위로만 입력할 수 있다 — 분 단위(정수)로 직접
// 비교해 부동소수점 오차를 피한다(0.17 같은 반올림된 소수 표와 비교하던 예전 방식은
// 1/6시간=10분을 정확히 입력해도 0.1666...≠0.17로 어긋나 저장이 거부되는 버그가 있었다,
// 2026-09-24 발견·수정). 2:15(135분)는 잔업에서만 실제로 수기 입력하는 값이라 예외로
// 허용한다.
const EXTRA_VALID_MINUTES_BY_FIELD: Partial<Record<HourField, Set<number>>> = {
  overtime_hours: new Set([135]),
};
function isValidTenMinuteHours(hours: number, fieldKey: HourField): boolean {
  const totalMinutes = Math.round(hours * 60);
  if (EXTRA_VALID_MINUTES_BY_FIELD[fieldKey]?.has(totalMinutes)) return true;
  return totalMinutes % 10 === 0;
}

export default function WorkHoursPage() {
  const [date, setDate] = useTabState("workHoursDate", today);
  const [rows, setRows] = useState<WorkHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [workGroupFilter, setWorkGroupFilter] = useTabState("workHoursWorkGroupFilter", "");
  const [contractorFilter, setContractorFilter] = useTabState("workHoursContractorFilter", "");
  const [teamFilter, setTeamFilter] = useTabState("workHoursTeamFilter", "");
  // 저장상태 필터(2026-09-08 사용자 요청) — ""=전체, "saved"=저장됨, "unsaved"=미저장.
  const [statusFilter, setStatusFilter] = useTabState("workHoursStatusFilter", "");
  const [searchText, setSearchText] = useTabState("workHoursSearchText", "");
  const [showUpload, setShowUpload] = useState(false);
  const [processes, setProcesses] = useState<Process[]>([]);

  // 그리드에서 직접 고치는 대신(2026-09-13 사용자 요청 — 저장 버튼이 화면에 보이는 사람만이
  // 아니라 그 날짜 전체 인원을 통째로 다시 저장해서, 근무조 하나 고치려다 다른 사람 값까지
  // 같이 덮어써지는 사고가 반복됐다) 행마다 "관리 · 수정" 버튼으로 그 사람만 편집하는
  // 팝업을 열거나, 체크박스로 여러 명을 골라 "선택 항목 일괄수정" 팝업을 연다 — 출퇴근카드
  // 등록(PSN-02)과 동일한 패턴. 두 경우 다 팝업 안에서 바로 저장되고, 그 순간 실제로
  // 수정 대상인 사번만 API 호출 대상에 포함된다.
  const [editingRows, setEditingRows] = useState<WorkHoursRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // 지원공정 선택지 — BASE-04(공정등록)에 등록된 사용여부='Y' 공정 전체를, 소속(work_group)
  // 필터 없이 그대로 보여준다. processes.process_group 기준으로 <optgroup>을 나눠서
  // 목록이 길어도 찾기 쉽게 한다 — seq 순서를 그대로 따른다.
  useEffect(() => {
    fetch("/api/processes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Process[]) =>
        setProcesses(data.filter((p) => p.use_yn === "Y").sort((a, b) => a.seq - b.seq))
      );
  }, []);
  const processGroups = (() => {
    const groups = new Map<string, Process[]>();
    for (const p of processes) {
      const key = p.process_group ?? "기타";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries());
  })();

  const load = () => {
    setLoading(true);
    setMessage(null);
    setSelected(new Set());
    fetch(`/api/work-hours?date=${date}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: WorkHoursResponse) => {
        setRows(data.rows ?? []);
        setLastSavedAt(data.lastSavedAt ?? null);
        setLoading(false);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [date]);

  function toggleSelected(employeeNo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(employeeNo)) next.delete(employeeNo);
      else next.add(employeeNo);
      return next;
    });
  }

  // 관리상 삭제(2026-09-08 사용자 요청) — 확인 즉시 DB에서 지운다(그 날짜 기록 자체를
  // 없애 "미저장" 상태로 되돌리는 것). 삭제 뒤 화면을 다시 불러온다.
  async function deleteSelected() {
    if (selected.size === 0) return;
    const names = rows
      .filter((r) => selected.has(r.employee_no))
      .map((r) => r.worker_name)
      .slice(0, 5)
      .join(", ");
    const more = selected.size > 5 ? ` 외 ${selected.size - 5}명` : "";
    if (
      !window.confirm(
        `${date} 날짜의 ${names}${more} 저장 기록을 삭제할까요?\n삭제하면 되돌릴 수 없고, 해당 인원은 "미저장" 상태로 돌아갑니다.`
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await fetch("/api/work-hours", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, employeeNos: Array.from(selected) }),
    });
    const data = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      window.alert(data.error ?? "삭제에 실패했습니다.");
      return;
    }
    setMessage(`${new Date().toLocaleTimeString("ko-KR")} 기준 ${data.count}건 삭제되었습니다.`);
    load();
  }

  const workGroupOptions = distinctOptions(rows, "work_group").sort(
    (a, b) => WORK_GROUP_OPTIONS.indexOf(a) - WORK_GROUP_OPTIONS.indexOf(b)
  );
  const contractorOptions = distinctOptions(rows, "contractor");
  const teamOptions = distinctOptions(rows, "team");

  const search = searchText.trim().toLowerCase();
  const visibleRows = rows.filter((r) => {
    if (workGroupFilter && r.work_group !== workGroupFilter) return false;
    if (contractorFilter && r.contractor !== contractorFilter) return false;
    if (teamFilter && r.team !== teamFilter) return false;
    if (statusFilter === "saved" && !r.has_record) return false;
    if (statusFilter === "unsaved" && r.has_record) return false;
    if (
      search &&
      !r.employee_no.toLowerCase().includes(search) &&
      !(r.erp_code ?? "").toLowerCase().includes(search) &&
      !r.worker_name.toLowerCase().includes(search)
    )
      return false;
    return true;
  });

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.employee_no));
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of visibleRows) next.delete(r.employee_no);
      } else {
        for (const r of visibleRows) next.add(r.employee_no);
      }
      return next;
    });
  }

  const thCls =
    "text-center px-2 py-2 font-semibold sticky top-0 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]";
  const wCls = "w-20";

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">일일근태입력</h1>
          <p className="text-sm text-slate-500 mt-1">
            PSN-01 · 근무조·휴가구분과 자공정(정상/잔업/조출/중교/지각/조퇴/외출)·지원공정
            (소속/시간)을 조회하는 화면입니다. 그리드는 조회 전용이고, 값을 고치려면 각 행의
            &quot;관리 · 수정&quot;을 누르거나 왼쪽 체크박스로 여러 명을 선택해 &quot;선택
            항목 일괄수정&quot;을 누르세요 — 팝업 안에서 저장하면 그 대상자만 반영되고
            다른 사람 값은 건드리지 않습니다. &quot;선택 삭제&quot;는 그 날짜 저장 기록
            자체를 지웁니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              window.location.href = `/api/work-hours/export?date=${date}`;
            }}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            엑셀 다운로드
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            엑셀 업로드
          </button>
          <button
            onClick={() => setEditingRows(rows.filter((r) => selected.has(r.employee_no)))}
            disabled={selected.size === 0}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300 transition-colors"
          >
            선택 항목 일괄수정{selected.size > 0 ? ` (${selected.size}명)` : ""}
          </button>
          <button
            onClick={deleteSelected}
            disabled={selected.size === 0 || deleting}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
          >
            {deleting ? "삭제 중..." : `선택 삭제${selected.size > 0 ? ` (${selected.size}명)` : ""}`}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-medium text-slate-500 shrink-0">날짜</label>
        <DateSegmentInput value={date} onChange={setDate} />
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <select
          value={workGroupFilter}
          onChange={(e) => setWorkGroupFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">공정 전체</option>
          {workGroupOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={contractorFilter}
          onChange={(e) => setContractorFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">도급사 전체</option>
          {contractorOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">근무조 전체</option>
          {teamOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">저장상태 전체</option>
          <option value="saved">저장됨</option>
          <option value="unsaved">미저장</option>
        </select>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="이름 · 사번 · ERP코드 검색"
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-52"
        />
        {(workGroupFilter || contractorFilter || teamFilter || statusFilter || searchText) && (
          <button
            onClick={() => {
              setWorkGroupFilter("");
              setContractorFilter("");
              setTeamFilter("");
              setStatusFilter("");
              setSearchText("");
            }}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            필터 초기화
          </button>
        )}
        {!message && !loading && (
          <span className="text-xs text-slate-400 ml-2">
            {lastSavedAt ? `이 날짜 최근 저장: ${lastSavedAt}` : "이 날짜는 아직 저장된 적이 없습니다(기본값 표시 중)"}
          </span>
        )}
        {message && <span className="text-xs text-slate-500 ml-2">{message}</span>}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-14rem)]">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500">
              <tr>
                <th rowSpan={2} className={thCls}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="전체 선택"
                  />
                </th>
                <th rowSpan={2} className={thCls}>
                  No
                </th>
                <th rowSpan={2} className={thCls}>
                  관리
                </th>
                <th rowSpan={2} className={thCls}>
                  사번
                </th>
                <th rowSpan={2} className={thCls}>
                  소속공정
                </th>
                <th rowSpan={2} className={thCls}>
                  직무
                </th>
                <th rowSpan={2} className={thCls}>
                  성명
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  근무조
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  교대조
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  근무시간
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  저장상태
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  휴가
                </th>
                <th colSpan={1 + HOUR_FIELDS.length} className={thCls}>
                  자공정
                </th>
                <th colSpan={2} className={thCls}>
                  지원공정
                </th>
              </tr>
              <tr>
                <th className={`${thCls} ${wCls}`}>정상</th>
                {HOUR_FIELDS.map((f) => (
                  <th key={f.key} className={`${thCls} ${wCls}`}>
                    {f.label}
                  </th>
                ))}
                <th className={`${thCls} ${wCls}`}>지원공정</th>
                <th className={`${thCls} ${wCls}`}>지원시간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={13 + HOUR_FIELDS.length + 2} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={13 + HOUR_FIELDS.length + 2} className="text-center py-10 text-slate-400">
                    표시할 조원이 없습니다. (필터를 확인하거나 작업자등록에서 먼저 등록하세요)
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr
                    key={r.employee_no}
                    className={selected.has(r.employee_no) ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50"}
                  >
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(r.employee_no)}
                        onChange={() => toggleSelected(r.employee_no)}
                        aria-label={`${r.worker_name} 선택`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => setEditingRows([r])}
                        className="text-xs font-medium text-navy hover:underline"
                      >
                        수정
                      </button>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-500">{r.employee_no}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.work_group ?? "-"}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.duty ?? "-"}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-700">{r.worker_name}</td>
                    <td className={`px-2 py-1.5 text-slate-600 ${wCls}`}>{r.team ?? "미지정"}</td>
                    <td className={`px-2 py-1.5 text-slate-500 ${wCls}`}>{r.shift_group ?? "-"}</td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono font-semibold ${wCls} ${
                        r.total_hours > OVER_HOURS_THRESHOLD ? "bg-rose-50 text-rose-700" : "text-navy"
                      }`}
                    >
                      {formatHoursClock(r.total_hours)}
                    </td>
                    <td className={`px-2 py-1.5 text-center ${wCls}`}>
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
                    <td className={`px-2 py-1.5 text-slate-600 ${wCls}`}>{r.leave_type ?? "출근"}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-semibold text-navy ${wCls}`}>
                      {formatHoursClock(r.normal_hours)}
                    </td>
                    {HOUR_FIELDS.map((f) => (
                      <td key={f.key} className={`px-2 py-1.5 text-right font-mono text-slate-600 ${wCls}`}>
                        {formatHoursClock(r[f.key])}
                      </td>
                    ))}
                    <td className={`px-2 py-1.5 text-slate-600 ${wCls}`}>{r.support_work_group ?? "-"}</td>
                    <td className={`px-2 py-1.5 text-right font-mono text-slate-600 ${wCls}`}>
                      {formatHoursClock(r.support_hours)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showUpload && (
        <WorkHoursUploadModal date={date} onClose={() => setShowUpload(false)} onImported={load} />
      )}

      {editingRows && (
        <WorkHoursEditModal
          date={date}
          rows={editingRows}
          processGroups={processGroups}
          onClose={() => setEditingRows(null)}
          onSaved={() => {
            setEditingRows(null);
            load();
          }}
        />
      )}
    </div>
  );
}

type ModalField =
  | { key: "team"; label: string; kind: "team" }
  | { key: "leave_type"; label: string; kind: "leave" }
  | { key: HourField; label: string; kind: "hour" }
  | { key: "support_work_group"; label: string; kind: "support_group" }
  | { key: "support_hours"; label: string; kind: "support_hours" };

const MODAL_FIELDS: ModalField[] = [
  { key: "team", label: "근무조", kind: "team" },
  { key: "leave_type", label: "휴가", kind: "leave" },
  ...HOUR_FIELDS.map((f) => ({ ...f, kind: "hour" as const })),
  { key: "support_work_group", label: "지원공정", kind: "support_group" },
  { key: "support_hours", label: "지원시간", kind: "support_hours" },
];

// 행 수정 겸 선택 일괄수정 팝업 — 출퇴근카드등록(PSN-02)과 동일한 패턴이다. rows가 1개면
// "행 수정"(전체 항목 항상 편집 가능), 2개 이상이면 "선택 일괄수정"(체크한 항목만 선택된
// 모든 행에 같은 값으로 적용, 체크 안 한 항목은 그대로 둠). 저장을 누르면 이 팝업에 담긴
// rows(=실제로 편집 대상인 사번들)에게만 API를 호출한다 — 화면에 떠 있는 다른 사람 행은
// 건드리지 않는다(2026-09-13 사용자 요청, 예전엔 "저장"이 그 날짜 전체를 통째로 다시
// 써서 근무조 하나 고치려다 다른 사람 값까지 덮어써지는 사고가 있었음).
function WorkHoursEditModal({
  date,
  rows,
  processGroups,
  onClose,
  onSaved,
}: {
  date: string;
  rows: WorkHoursRow[];
  processGroups: [string, Process[]][];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isBulk = rows.length > 1;
  const single = !isBulk ? rows[0] : null;

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODAL_FIELDS.map((f) => [f.key, !isBulk]))
  );
  const [team, setTeam] = useState<string>(single?.team ?? "");
  const [leaveType, setLeaveType] = useState<string>(single?.leave_type ?? "");
  const [hourValues, setHourValues] = useState<Record<HourField, number>>(() =>
    Object.fromEntries(
      HOUR_FIELDS.map((f) => [f.key, single ? editableHourValue(single, f.key) : 0])
    ) as Record<HourField, number>
  );
  const [supportGroup, setSupportGroup] = useState<string>(single?.support_work_group ?? "");
  const [supportHours, setSupportHours] = useState<number>(single ? single.support_hours : 0);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useDraggableModal();

  function toggleField(key: string) {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function setHourValue(key: HourField, hours: number) {
    setHourValues((prev) => ({ ...prev, [key]: hours }));
  }

  // 단일행 수정일 때만 정상/근무시간 미리보기를 보여준다(2026-09-13) — 여러 명을 한 번에
  // 고칠 땐 사람마다 기존 값이 달라 한 화면에서 미리 계산해 보여줄 수 없다.
  const preview = (() => {
    if (!single) return null;
    const patched = {
      leave_type: leaveType || null,
      overtime_hours: hourValues.overtime_hours || 0,
      early_start_hours: hourValues.early_start_hours || 0,
      lunch_shift_hours: hourValues.lunch_shift_hours || 0,
      late_hours: hourValues.late_hours || 0,
      early_leave_hours: hourValues.early_leave_hours || 0,
      outing_hours: hourValues.outing_hours || 0,
      support_hours: supportGroup ? supportHours || 0 : 0,
    };
    const { normalHours } = computeAttendance(patched);
    return { normal: normalHours, total: computeTotal(patched) };
  })();

  const activeKeys = MODAL_FIELDS.map((f) => f.key).filter((k) => enabled[k]);

  function validate(): string | null {
    if (isBulk && activeKeys.length === 0) return "변경할 항목을 하나 이상 선택하세요.";

    for (const f of HOUR_FIELDS) {
      if (!enabled[f.key]) continue;
      const v = hourValues[f.key];
      if (!Number.isFinite(v)) return `${f.label} 값이 올바르지 않습니다.`;
      if (v < 0) return `${f.label}은(는) 음수를 입력할 수 없습니다.`;
      if (!isValidTenMinuteHours(v, f.key)) return `${f.label}은(는) 10분 단위로만 입력할 수 있습니다.`;
    }
    if (enabled.support_hours) {
      if (!Number.isFinite(supportHours) || supportHours < 0) return "지원시간은 음수를 입력할 수 없습니다.";
    }

    return null;
  }

  async function submit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);

    if (enabled.team) {
      const groups = new Map<string, string[]>();
      for (const r of rows) {
        if (r.team === (team || null)) continue;
        const list = groups.get(team) ?? [];
        list.push(r.employee_no);
        groups.set(team, list);
      }
      for (const [teamValue, employeeNos] of groups) {
        if (employeeNos.length === 0) continue;
        const res = await fetch("/api/workers/team", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeNos, team: teamValue || null, date }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSaving(false);
          setError(data.error ?? "근무조 변경에 실패했습니다.");
          return;
        }
      }
    }

    // 근무조를 뺀 나머지 활성 항목만 이 팝업의 대상(rows)에게 적용해 /api/work-hours로
    // 보낸다 — PUT은 받은 rows 배열에 있는 사번만 upsert하므로, 다른 사람은 그대로다.
    const otherActive = activeKeys.filter((k) => k !== "team");
    if (otherActive.length > 0 || !isBulk) {
      const patchedRows = rows.map((r) => ({
        employee_no: r.employee_no,
        leave_type: enabled.leave_type ? leaveType || null : r.leave_type,
        // /api/work-hours PUT은 잔업 신청값을 overtime_input_hours로 받는다(2026-09-15
        // 수정) — r.overtime_hours(계산된 실제 인정 잔업)를 다시 보내면 저장할 때마다
        // 지각/조퇴/외출 차감이 중복 적용된다.
        overtime_input_hours: enabled.overtime_hours
          ? hourValues.overtime_hours || 0
          : r.overtime_input_hours,
        early_start_hours: enabled.early_start_hours
          ? hourValues.early_start_hours || 0
          : r.early_start_hours,
        lunch_shift_hours: enabled.lunch_shift_hours
          ? hourValues.lunch_shift_hours || 0
          : r.lunch_shift_hours,
        late_hours: enabled.late_hours ? hourValues.late_hours || 0 : r.late_hours,
        early_leave_hours: enabled.early_leave_hours
          ? hourValues.early_leave_hours || 0
          : r.early_leave_hours,
        outing_hours: enabled.outing_hours ? hourValues.outing_hours || 0 : r.outing_hours,
        support_work_group: enabled.support_work_group ? supportGroup || null : r.support_work_group,
        support_hours: enabled.support_work_group
          ? supportGroup
            ? supportHours || 0
            : 0
          : enabled.support_hours
            ? supportHours || 0
            : r.support_hours,
      }));
      const res = await fetch("/api/work-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, rows: patchedRows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaving(false);
        setError(data.error ?? "저장에 실패했습니다.");
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  const inputCls =
    "border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white w-full disabled:bg-slate-50 disabled:text-slate-300 text-right";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">
            {isBulk ? (
              <>
                선택 항목 일괄수정 <span className="text-slate-400 font-normal">({rows.length}명)</span>
              </>
            ) : (
              <>
                근태 수정{" "}
                <span className="text-slate-400 font-normal">
                  {single!.worker_name}({single!.employee_no})
                </span>
              </>
            )}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {isBulk && (
            <p className="text-xs text-slate-500 mb-1">
              체크한 항목만 선택된 {rows.length}명 전부에게 같은 값으로 적용됩니다. 체크하지
              않은 항목은 그대로 둡니다.
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {MODAL_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                {isBulk && (
                  <input
                    type="checkbox"
                    checked={enabled[f.key]}
                    onChange={() => toggleField(f.key)}
                    aria-label={`${f.label} 변경`}
                  />
                )}
                <label className="text-xs text-slate-500 w-16 shrink-0">{f.label}</label>
                {f.kind === "team" ? (
                  <select
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    disabled={isBulk && !enabled.team}
                    className={inputCls.replace("text-right", "")}
                  >
                    <option value="">미지정</option>
                    {TEAM_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : f.kind === "leave" ? (
                  <select
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value)}
                    disabled={isBulk && !enabled.leave_type}
                    className={inputCls.replace("text-right", "")}
                  >
                    <option value="">출근</option>
                    {LEAVE_TYPE_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ) : f.kind === "hour" ? (
                  <HourMinuteInput
                    value={hourValues[f.key]}
                    onChange={(v) => setHourValue(f.key, v)}
                    disabled={isBulk && !enabled[f.key]}
                  />
                ) : f.kind === "support_group" ? (
                  <select
                    value={supportGroup}
                    onChange={(e) => setSupportGroup(e.target.value)}
                    disabled={isBulk && !enabled.support_work_group}
                    className={inputCls.replace("text-right", "")}
                  >
                    <option value="">-</option>
                    {processGroups.map(([group, procs]) => (
                      <optgroup key={group} label={`— ${group} —`}>
                        {procs.map((p) => (
                          <option key={p.process_code} value={p.process_name}>
                            {p.process_name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <HourMinuteInput
                    value={supportHours}
                    onChange={setSupportHours}
                    disabled={(isBulk && !enabled.support_hours) || (!isBulk && !supportGroup)}
                  />
                )}
              </div>
            ))}
          </div>
          {preview && (
            <p className="text-xs text-slate-500 pt-1 border-t border-slate-100">
              미리보기 — 정상{" "}
              <span className="font-mono font-semibold text-navy">{formatHoursClock(preview.normal)}</span>
              , 근무시간{" "}
              <span
                className={`font-mono font-semibold ${preview.total > OVER_HOURS_THRESHOLD ? "text-rose-600" : "text-navy"}`}
              >
                {formatHoursClock(preview.total)}
              </span>
            </p>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600">
            취소
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkHoursUploadModal({
  date,
  onClose,
  onImported,
}: {
  date: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; skippedNoKey: number } | null>(null);
  const drag = useDraggableModal();

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("date", date);
    const res = await fetch("/api/work-hours/import", { method: "POST", body: fd });
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">엑셀 업로드</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          {result ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                {date} 날짜로 업로드 완료 — {result.updated.toLocaleString()}건 반영
                {result.skippedNoKey > 0 && `, 건너뜀(사번 없음/미등록) ${result.skippedNoKey.toLocaleString()}건`}
              </p>
              <div className="flex justify-end">
                <button onClick={onClose} className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white">
                  닫기
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                &quot;엑셀 다운로드&quot;로 받은 것과 같은 컬럼 구성의 .xlsx 첫 시트를
                읽어 현재 선택된 날짜(<span className="font-mono">{date}</span>)로
                저장합니다. &quot;사번&quot; 컬럼은 필수이며, 이미 등록된 작업자만
                반영됩니다.
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
                <button onClick={onClose} className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600">
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
