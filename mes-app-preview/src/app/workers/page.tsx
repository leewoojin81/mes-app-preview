"use client";

import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { useTabState } from "@/lib/use-tab-state";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import { convertBizEmployeeNo, formatBizName, hireDateFromEmployeeNo, parseBizName } from "@/lib/biz-import";
import type { Process, Worker } from "@/lib/types";

const USE_TABS = [
  { label: "전체", value: "" },
  { label: "사용", value: "Y" },
  { label: "중단", value: "N" },
] as const;

// "주간고정"은 2026-09-10 사용자 요청으로 목록에서 제거(1조/2조/3조만 남김) — 기존에
// 이미 주간고정으로 배정된 작업자(35명, 2026-09-10 기준)의 DB 값은 그대로 남아있지만,
// 이 목록에 없어 편집 화면에서 근무조가 미선택으로 보인다(사용자 확인, 재배정은 별도).
const TEAM_OPTIONS = ["1조", "2조", "3조"] as const;
// 교대조(2026-09-09 사용자 요청) — team("근무조", 급여형태 구분)과 별개인 A조/B조/고정
// 소속 표시일 뿐, 자동 순환계산 로직은 없다.
const SHIFT_GROUP_OPTIONS = ["A조", "B조", "고정"] as const;

const CONTRACTOR_OPTIONS = ["다온", "더휴먼", "메디오스", "제이시스템", "태경", "휴먼"] as const;
const BUS_ROUTE_OPTIONS = ["동부", "서부", "버스", "자가", "자차", "자전거"] as const;
const UNIFORM_SIZE_OPTIONS = ["없음", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"] as const;
const STATUS_OPTIONS = ["정상", "퇴사", "육휴", "출휴", "병가"] as const;

type FormState = {
  employee_no: string;
  erp_code: string;
  worker_name: string;
  contractor: string;
  work_group: string;
  process_code: string;
  duty: string;
  team: string;
  shift_group: string;
  phone: string;
  hire_date: string;
  bus_route: string;
  bus_stop: string;
  uniform_size: string;
  shoe_size: string;
  vest_size: string;
  safety_shoe_size: string;
  status: string;
  resign_date: string;
  resign_reason: string;
  remark: string;
  use_yn: "Y" | "N";
};

const EMPTY_FORM: FormState = {
  employee_no: "",
  erp_code: "",
  worker_name: "",
  contractor: "",
  work_group: "",
  process_code: "",
  duty: "",
  team: "",
  shift_group: "",
  phone: "",
  hire_date: "",
  bus_route: "",
  bus_stop: "",
  uniform_size: "",
  shoe_size: "",
  vest_size: "",
  safety_shoe_size: "",
  status: "",
  resign_date: "",
  resign_reason: "",
  remark: "",
  use_yn: "Y",
};

const COLUMNS: { key: keyof Worker; label: string }[] = [
  { key: "erp_code", label: "ERP코드" },
  { key: "employee_no", label: "사번" },
  { key: "employee_qr", label: "사번QR" },
  { key: "work_group", label: "공정" },
  { key: "process_code", label: "공정코드" },
  { key: "duty", label: "직무" },
  { key: "worker_name", label: "성명" },
  { key: "contractor", label: "도급사" },
  { key: "team", label: "근무조" },
  { key: "shift_group", label: "교대조" },
  { key: "bus_route", label: "버스" },
  { key: "bus_stop", label: "정류장" },
  { key: "uniform_size", label: "방진복" },
  { key: "shoe_size", label: "방진화" },
  { key: "vest_size", label: "조끼" },
  { key: "safety_shoe_size", label: "안전화" },
  { key: "phone", label: "연락처" },
  { key: "hire_date", label: "입사일" },
  { key: "resign_date", label: "퇴사일" },
  { key: "resign_reason", label: "퇴사사유" },
  { key: "remark", label: "특이사항" },
  { key: "status", label: "상태" },
];

// 상태(자유텍스트) 배지 색상 — 사용여부와 같은 톤 체계를 쓰되, 알려지지 않은 값(오타 등)도
// 화면이 깨지지 않도록 중립 회색으로 fallback한다.
const STATUS_BADGE_CLASS: Record<string, string> = {
  정상: "bg-emerald-50 text-emerald-700 border-emerald-200",
  퇴사: "bg-rose-50 text-rose-700 border-rose-200",
  육휴: "bg-blue-50 text-blue-700 border-blue-200",
  출휴: "bg-violet-50 text-violet-700 border-violet-200",
  병가: "bg-amber-50 text-amber-700 border-amber-200",
};
function statusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASS[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

// 목록에 실제로 나타나는 값만 옵션으로 뽑는다(빈 값 제외, 가나다순).
function distinctOptions(rows: Worker[], key: keyof Worker): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v != null && String(v).trim() !== "") set.add(String(v));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

export default function WorkerMasterPage() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  // 탭을 전환했다 돌아와도 보고 있던 필터는 유지되도록 세션 단위로 저장한다.
  const [useFilter, setUseFilter] = useTabState<"" | "Y" | "N">("useFilter", "");
  const [contractorFilter, setContractorFilter] = useTabState("contractorFilter", "");
  const [workGroupFilter, setWorkGroupFilter] = useTabState("workGroupFilter", "");
  const [teamFilter, setTeamFilter] = useTabState("teamFilter", "");
  const [shiftGroupFilter, setShiftGroupFilter] = useTabState("shiftGroupFilter", "");
  const [busRouteFilter, setBusRouteFilter] = useTabState("busRouteFilter", "");
  const [searchText, setSearchText] = useTabState("searchText", "");
  // 비즈사번/비즈부서/비즈이름 열은 대부분의 인원(비즈 연동 없이 등록됨)에겐 "-"뿐이라
  // 기본은 숨기고, 상단 체크박스를 켤 때만 보여준다(2026-09-08 사용자 요청).
  const [showBizColumns, setShowBizColumns] = useTabState("showBizColumns", false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Worker | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/workers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Worker[]) => {
        setRows(data);
        setLoading(false);
      });
  };

  useEffect(load, []);

  const contractorOptions = distinctOptions(rows, "contractor");
  const workGroupOptions = distinctOptions(rows, "work_group");
  const teamOptions = distinctOptions(rows, "team");
  const busRouteOptions = distinctOptions(rows, "bus_route");

  const search = searchText.trim().toLowerCase();
  const visibleRows = rows.filter((r) => {
    if (useFilter && r.use_yn !== useFilter) return false;
    if (contractorFilter && r.contractor !== contractorFilter) return false;
    if (workGroupFilter && r.work_group !== workGroupFilter) return false;
    if (teamFilter && r.team !== teamFilter) return false;
    if (busRouteFilter && r.bus_route !== busRouteFilter) return false;
    // 교대조는 지금 전원 미지정으로 시작하므로(2026-09-09 신설), distinctOptions로 뽑으면
    // 선택지가 아예 안 나온다 — 고정 목록(SHIFT_GROUP_OPTIONS) + "미지정"을 그대로 쓴다.
    if (shiftGroupFilter === "미지정" && r.shift_group) return false;
    if (shiftGroupFilter && shiftGroupFilter !== "미지정" && r.shift_group !== shiftGroupFilter) return false;
    if (
      search &&
      !r.employee_no.toLowerCase().includes(search) &&
      !(r.erp_code ?? "").toLowerCase().includes(search) &&
      !r.worker_name.toLowerCase().includes(search)
    )
      return false;
    return true;
  });

  // 필터로 화면에서 사라진 행은 선택도 같이 풀어준다(안 보이는데 선택된 채로 남는 걸 방지).
  const visibleSelected = visibleRows.filter((r) => selected.has(r.employee_no));
  const allVisibleSelected = visibleRows.length > 0 && visibleSelected.length === visibleRows.length;

  function toggleOne(employeeNo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(employeeNo)) next.delete(employeeNo);
      else next.add(employeeNo);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const r of visibleRows) next.delete(r.employee_no);
        return next;
      }
      const next = new Set(prev);
      for (const r of visibleRows) next.add(r.employee_no);
      return next;
    });
  }

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">작업자정보</h1>
          <p className="text-sm text-slate-500 mt-1">
            BASE-09 · 생산현장 작업자(현장직 약 120명) 기준정보 관리 — 급여·인사평가 등은
            다루지 않는 순수 운영 기록입니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulkEdit(true)}
            disabled={selected.size === 0}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300 transition-colors"
          >
            선택 일괄변경{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (useFilter) params.set("use", useFilter);
              const qs = params.toString();
              window.location.href = `/api/workers/export${qs ? `?${qs}` : ""}`;
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
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
          >
            작업자 추가
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {USE_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setUseFilter(tab.value)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              useFilter === tab.value
                ? tab.value === "N"
                  ? "bg-rose-700 text-white border-rose-700"
                  : "bg-navy text-white border-navy"
                : "bg-white text-slate-600 border-slate-300 hover:border-navy"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
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
          value={shiftGroupFilter}
          onChange={(e) => setShiftGroupFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">교대조 전체</option>
          <option value="미지정">미지정</option>
          {SHIFT_GROUP_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={busRouteFilter}
          onChange={(e) => setBusRouteFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">버스 전체</option>
          {busRouteOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="사번 · ERP코드 · 이름 검색"
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-56"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showBizColumns}
            onChange={(e) => setShowBizColumns(e.target.checked)}
          />
          비즈 정보 표시
        </label>
        {(contractorFilter || workGroupFilter || teamFilter || shiftGroupFilter || busRouteFilter || searchText) && (
          <button
            onClick={() => {
              setContractorFilter("");
              setWorkGroupFilter("");
              setTeamFilter("");
              setShiftGroupFilter("");
              setBusRouteFilter("");
              setSearchText("");
            }}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            필터 초기화
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-13.5rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="전체 선택"
                  />
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  순번
                </th>
                {showBizColumns && (
                  <>
                    <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                      비즈사번
                    </th>
                    <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                      비즈부서
                    </th>
                    <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                      비즈이름
                    </th>
                  </>
                )}
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={`text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0] ${
                      c.key === "uniform_size" ? "border-l-2 border-slate-300" : ""
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  사용여부
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={COLUMNS.length + 4 + (showBizColumns ? 3 : 0)} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 4 + (showBizColumns ? 3 : 0)} className="text-center py-10 text-slate-400">
                    등록된 작업자가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr
                    key={r.employee_no}
                    className={`hover:bg-slate-50 ${selected.has(r.employee_no) ? "bg-navy/[0.03]" : ""}`}
                  >
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(r.employee_no)}
                        onChange={() => toggleOne(r.employee_no)}
                        aria-label={`${r.worker_name} 선택`}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    {showBizColumns && (
                      <>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {r.biz_employee_no ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{r.biz_dept ?? "-"}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {r.biz_employee_no ? formatBizName(r.worker_name, r.contractor) : "-"}
                        </td>
                      </>
                    )}
                    {COLUMNS.map((c) => {
                      const v = r[c.key];
                      const empty = v == null || v === "";
                      if (c.key === "status") {
                        return (
                          <td key={c.key} className="px-4 py-3">
                            {empty ? (
                              <span className="text-slate-500">-</span>
                            ) : (
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadgeClass(
                                  String(v)
                                )}`}
                              >
                                {String(v)}
                              </span>
                            )}
                          </td>
                        );
                      }
                      return (
                        <td
                          key={c.key}
                          className={`px-4 py-3 ${
                            c.key === "uniform_size" ? "border-l-2 border-slate-200" : ""
                          } ${
                            c.key === "employee_no" || c.key === "erp_code" || c.key === "employee_qr"
                              ? "font-mono text-xs text-slate-500"
                              : c.key === "worker_name"
                                ? "font-medium"
                                : c.key === "uniform_size" ||
                                    c.key === "shoe_size" ||
                                    c.key === "vest_size" ||
                                    c.key === "safety_shoe_size"
                                  ? "text-center text-slate-500"
                                  : "text-slate-500"
                          }`}
                        >
                          {empty ? "-" : String(v)}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          r.use_yn === "Y"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}
                      >
                        {r.use_yn === "Y" ? "사용" : "중단"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditing(r);
                            setShowForm(true);
                          }}
                          className="text-xs font-medium text-navy hover:underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(r);
                          }}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
          전체 {rows.length.toLocaleString()}건 중 {visibleRows.length.toLocaleString()}건 표시
        </div>
      </div>

      {showForm && (
        <WorkerFormModal
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {showUpload && (
        <WorkerUploadModal onClose={() => setShowUpload(false)} onImported={load} />
      )}

      {showBulkEdit && (
        <WorkerBulkEditModal
          workers={rows.filter((r) => selected.has(r.employee_no))}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            setSelected(new Set());
            load();
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-navy">작업자 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">
                  {deleteTarget.employee_no}
                </span>
                <span className="font-medium">{deleteTarget.worker_name}</span>
                을(를) 정말 삭제하시겠습니까?
              </p>
              <p className="text-xs text-slate-400">이 작업은 되돌릴 수 없습니다.</p>
              {deleteError && <p className="text-sm text-rose-600">{deleteError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (!deleteTarget) return;
                  setDeleting(true);
                  const res = await fetch(
                    `/api/workers/${encodeURIComponent(deleteTarget.employee_no)}`,
                    { method: "DELETE" }
                  );
                  const data = await res.json().catch(() => ({}));
                  setDeleting(false);
                  if (!res.ok) {
                    setDeleteError(data.error ?? "삭제에 실패했습니다.");
                    return;
                  }
                  setDeleteTarget(null);
                  load();
                }}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm font-medium bg-rose-600 text-white disabled:opacity-40"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkerFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Worker | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [processes, setProcesses] = useState<Process[]>([]);
  useEffect(() => {
    fetch("/api/processes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Process[]) => setProcesses(data.filter((p) => p.use_yn === "Y")));
  }, []);

  const [form, setForm] = useState<FormState>(
    editing
      ? {
          employee_no: editing.employee_no,
          erp_code: editing.erp_code ?? "",
          worker_name: editing.worker_name,
          contractor: editing.contractor ?? "",
          work_group: editing.work_group ?? "",
          process_code: editing.process_code ?? "",
          duty: editing.duty ?? "",
          team: editing.team ?? "",
          shift_group: editing.shift_group ?? "",
          phone: editing.phone ?? "",
          hire_date: editing.hire_date ?? "",
          bus_route: editing.bus_route ?? "",
          bus_stop: editing.bus_stop ?? "",
          uniform_size: editing.uniform_size ?? "",
          shoe_size: editing.shoe_size ?? "",
          vest_size: editing.vest_size ?? "",
          safety_shoe_size: editing.safety_shoe_size ?? "",
          status: editing.status ?? "",
          resign_date: editing.resign_date ?? "",
          resign_reason: editing.resign_reason ?? "",
          remark: editing.remark ?? "",
          use_yn: editing.use_yn,
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // 비즈 연동 자동입력(2026-09-08 사용자 요청) — 신규 등록(수정 아님)일 때만 보여주는
  // 보조 입력칸 3개. 여기 입력은 FormState에 직접 들어가지 않고, 매번 변환해서 사번/
  // 입사일자/상태/성명/도급사 칸에 대신 채워준다 — 채워진 뒤에는 그 칸들을 평소처럼
  // 직접 고쳐도 된다(이 보조칸으로 다시 덮어쓰지 않음, 보조칸 자체를 다시 고칠 때만
  // 재변환). 비즈부서는
  // 우리 공정(work_group) 값과 이름이 안 맞는 경우가 많아(2026-09-08 사용자 확인 —
  // "실링 초과신청.xlsx" 원본 "멸균(실링)"/"트레이세정"처럼 우리 9개 소속과 다르게
  // 세분화돼 있음) 공정 칸을 자동으로 채우지 않는 순수 참고용 개별 입력이다 — 공정은
  // 아래 드롭다운에서 직접 고른다.
  const [bizEmployeeNo, setBizEmployeeNo] = useState("");
  const [bizDept, setBizDept] = useState("");
  const [bizName, setBizName] = useState("");

  function applyBizEmployeeNo(raw: string) {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 13);
    setBizEmployeeNo(digits);
    const converted = convertBizEmployeeNo(digits);
    if (!converted) return;
    set("employee_no", converted);
    // 사번 변환이 성공하면 입사일자·상태도 같이 채운다(2026-09-08 사용자 요청) — 둘 다
    // 그대로 직접 고칠 수 있다.
    const hireDate = hireDateFromEmployeeNo(converted);
    if (hireDate) set("hire_date", hireDate);
    set("status", "정상");
  }

  function applyBizName(raw: string) {
    setBizName(raw);
    const { name, contractor } = parseBizName(raw);
    set("worker_name", name);
    set("contractor", contractor);
  }

  const submit = async () => {
    setSaving(true);
    setError(null);
    const body = {
      ...form,
      employee_no: form.employee_no.trim(),
      erp_code: form.erp_code.trim(),
      // 사번QR은 더 이상 수동 입력을 받지 않고, QR코드가 인코딩하는 값(사번)을 그대로
      // 저장한다 — 별도 입력창을 없앤 것과 짝을 이루는 결정(2026-09-07, 기존 107명 전원
      // 이 필드가 비어 있어 실제 사용 이력이 없는 걸 확인하고 결정).
      employee_qr: form.employee_no.trim(),
      worker_name: form.worker_name.trim(),
      contractor: form.contractor.trim(),
      work_group: form.work_group.trim(),
      duty: form.duty.trim(),
      phone: form.phone.trim(),
      hire_date: form.hire_date.trim(),
      bus_route: form.bus_route.trim(),
      bus_stop: form.bus_stop.trim(),
      uniform_size: form.uniform_size.trim(),
      shoe_size: form.shoe_size.trim(),
      vest_size: form.vest_size.trim(),
      safety_shoe_size: form.safety_shoe_size.trim(),
      status: form.status.trim(),
      resign_date: form.resign_date.trim(),
      resign_reason: form.resign_reason.trim(),
      remark: form.remark.trim(),
      // 비즈 연동 자동입력칸(2026-09-08 사용자 요청) — 신규 등록일 때만 값이 있고,
      // 수정 화면에는 이 입력칸 자체가 없어(!editing에서만 렌더) 항상 빈 문자열이라
      // PATCH에는 사실상 영향이 없다(그 라우트는 이 필드를 아예 안 씀).
      biz_employee_no: bizEmployeeNo.trim() || null,
      biz_dept: bizDept.trim() || null,
    };
    const url = editing
      ? `/api/workers/${encodeURIComponent(editing.employee_no)}`
      : "/api/workers";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    onSaved();
  };

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            {editing ? "작업자 수정" : "작업자 추가"}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {!editing && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
              <p className="text-xs font-medium text-slate-500">
                비즈 연동 자동입력(선택) — 채우면 아래 사번·입사일자·상태·성명·도급사가
                자동으로 채워집니다(채워진 값은 그대로 직접 고칠 수 있음). 비즈부서는
                우리 공정 분류와 이름이 달라 자동 연결하지 않는 참고용 개별 입력입니다 —
                공정은 아래에서 직접 선택하세요.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-600">비즈사번(13자리)</span>
                  <input
                    value={bizEmployeeNo}
                    onChange={(e) => applyBizEmployeeNo(e.target.value)}
                    placeholder="예: 2312180000002"
                    className={`${inputCls} font-mono`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">비즈부서(참고용)</span>
                  <input
                    value={bizDept}
                    onChange={(e) => setBizDept(e.target.value)}
                    placeholder="예: 멸균(실링)"
                    className={inputCls}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">비즈이름</span>
                  <input
                    value={bizName}
                    onChange={(e) => applyBizName(e.target.value)}
                    placeholder="예: SJ-홍길동"
                    className={inputCls}
                  />
                </label>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                사번 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.employee_no}
                onChange={(e) => set("employee_no", e.target.value)}
                disabled={!!editing}
                className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                placeholder="예: 20260001"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">ERP코드</span>
              <input
                value={form.erp_code}
                onChange={(e) => set("erp_code", e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </label>
          </div>
          <EmployeeQrPreview employeeNo={form.employee_no.trim()} workerName={form.worker_name.trim()} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                성명 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.worker_name}
                onChange={(e) => set("worker_name", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">도급사</span>
              <select
                value={form.contractor}
                onChange={(e) => set("contractor", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {CONTRACTOR_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">공정</span>
              <select
                value={form.work_group}
                onChange={(e) => set("work_group", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {WORK_GROUP_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">공정코드</span>
              <select
                value={form.process_code}
                onChange={(e) => set("process_code", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">미지정</option>
                {processes.map((p) => (
                  <option key={p.process_code} value={p.process_code}>
                    {p.process_code} · {p.process_name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-0.5">
                일일근태입력(PSN-01) 등에서 본공정 기준으로 씁니다 — 위 &quot;공정&quot;(소속)과는 별개입니다.
              </p>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">직무</span>
              <input
                value={form.duty}
                onChange={(e) => set("duty", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">근무조</span>
              <select
                value={form.team}
                onChange={(e) => set("team", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {TEAM_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">교대조</span>
              <select
                value={form.shift_group}
                onChange={(e) => set("shift_group", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">미지정</option>
                {SHIFT_GROUP_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">상태</span>
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {STATUS_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">연락처</span>
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className={inputCls}
                placeholder="010-0000-0000"
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">입사일</span>
              <input
                value={form.hire_date}
                onChange={(e) => set("hire_date", e.target.value)}
                className={inputCls}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">버스</span>
              <select
                value={form.bus_route}
                onChange={(e) => set("bus_route", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {BUS_ROUTE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">정류장</span>
              <input
                value={form.bus_stop}
                onChange={(e) => set("bus_stop", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">방진복 사이즈</span>
              <select
                value={form.uniform_size}
                onChange={(e) => set("uniform_size", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {UNIFORM_SIZE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">방진화 사이즈</span>
              <input
                value={form.shoe_size}
                onChange={(e) => set("shoe_size", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">조끼 사이즈</span>
              <select
                value={form.vest_size}
                onChange={(e) => set("vest_size", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {UNIFORM_SIZE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">안전화 사이즈</span>
              <input
                value={form.safety_shoe_size}
                onChange={(e) => set("safety_shoe_size", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">퇴사일자</span>
              <input
                value={form.resign_date}
                onChange={(e) => {
                  const resignDate = e.target.value;
                  // 퇴사일자를 채우면 사용여부를 "중단", 상태를 "퇴사"로 자동으로 바꾼다
                  // (2026-09-07 사용자 요청) — 반대로 퇴사일자를 지워도 둘 다 자동으로
                  // 되돌리지 않는다(사용 재개·상태 복귀는 사람이 직접 판단해야 하는
                  // 결정이라 한쪽으로만 자동화).
                  setForm((prev) => ({
                    ...prev,
                    resign_date: resignDate,
                    use_yn: resignDate.trim() ? "N" : prev.use_yn,
                    status: resignDate.trim() ? "퇴사" : prev.status,
                  }));
                }}
                className={inputCls}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">퇴사사유</span>
              <input
                value={form.resign_reason}
                onChange={(e) => set("resign_reason", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">특이사항</span>
            <input
              value={form.remark}
              onChange={(e) => set("remark", e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">사용여부</span>
            <select
              value={form.use_yn}
              onChange={(e) => set("use_yn", e.target.value)}
              className={`${inputCls} bg-white`}
            >
              <option value="Y">Y (사용)</option>
              <option value="N">N (중단)</option>
            </select>
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || !form.employee_no.trim() || !form.worker_name.trim()}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 사번QR — 사번 값을 그대로 QR코드로 인코딩해 클라이언트에서 직접 생성한다(외부 서비스
// 호출 없음, `qrcode` npm 패키지). 다운로드/인쇄는 명찰·출입증 인쇄 용도.
function EmployeeQrPreview({ employeeNo, workerName }: { employeeNo: string; workerName: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeNo) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(employeeNo, { width: 200, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeNo]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `사번QR_${employeeNo}.png`;
    a.click();
  }

  // document.write 대신 DOM API로 새 창을 구성한다 — 이름/사번에 특수문자가 섞여도
  // HTML 인젝션 걱정 없이 안전하게 넣을 수 있다(textContent 사용).
  function printQr() {
    if (!dataUrl) return;
    const win = window.open("", "_blank", "width=400,height=500");
    if (!win) return;
    const doc = win.document;
    doc.title = `사번QR ${employeeNo}`;
    const style = doc.createElement("style");
    style.textContent =
      "body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;}";
    doc.head.appendChild(style);
    const img = doc.createElement("img");
    img.src = dataUrl;
    img.style.width = "220px";
    img.style.height = "220px";
    img.onload = () => {
      win.focus();
      win.print();
    };
    doc.body.appendChild(img);
    const p = doc.createElement("p");
    p.textContent = [workerName, employeeNo].filter(Boolean).join(" ");
    p.style.marginTop = "12px";
    p.style.fontSize = "16px";
    p.style.fontWeight = "600";
    doc.body.appendChild(p);
  }

  return (
    <div className="border border-slate-200 rounded-md p-3 flex items-center gap-4">
      <div className="w-24 h-24 flex items-center justify-center bg-slate-50 border border-slate-100 rounded shrink-0">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="사번QR" className="w-full h-full object-contain" />
        ) : (
          <span className="text-[10px] text-slate-400 text-center px-1 leading-tight">
            사번을 입력하면
            <br />
            QR코드가 생성됩니다
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-slate-500">사번QR — 명찰·출입증 인쇄용</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={download}
            disabled={!dataUrl}
            className="px-2.5 py-1 rounded border border-slate-300 text-xs text-slate-600 disabled:opacity-40 hover:border-navy"
          >
            다운로드
          </button>
          <button
            type="button"
            onClick={printQr}
            disabled={!dataUrl}
            className="px-2.5 py-1 rounded border border-slate-300 text-xs text-slate-600 disabled:opacity-40 hover:border-navy"
          >
            인쇄
          </button>
        </div>
      </div>
    </div>
  );
}

type BulkField =
  | "contractor"
  | "work_group"
  | "process_code"
  | "duty"
  | "team"
  | "shift_group"
  | "bus_route"
  | "bus_stop"
  | "status"
  | "use_yn";

const BULK_FIELD_LABELS: Record<BulkField, string> = {
  contractor: "도급사",
  work_group: "공정",
  process_code: "공정코드",
  duty: "직무",
  team: "근무조",
  shift_group: "교대조",
  bus_route: "버스",
  bus_stop: "정류장",
  status: "상태",
  use_yn: "사용여부",
};

// 체크한 항목의 필드만 선택된 작업자 전원에게 같은 값으로 덮어쓴다(체크 안 한 항목은
// 기존 값 그대로 유지) — 수주등록의 SalesOrderBulkEditModal과 달리 행마다 다른 값을 주는
// 그리드 편집이 아니라, "여러 명을 한 값으로 맞추는" 단순한 형태라 이 방식이 더 맞는다.
// PATCH가 부분수정이 아니라 전체 덮어쓰기라, 각 작업자의 현재 행(workers 목록에서 이미
// 갖고 있음)에 체크된 필드만 얹어 보낸다.
function WorkerBulkEditModal({
  workers,
  onClose,
  onSaved,
}: {
  workers: Worker[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [processes, setProcesses] = useState<Process[]>([]);
  useEffect(() => {
    fetch("/api/processes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Process[]) => setProcesses(data.filter((p) => p.use_yn === "Y")));
  }, []);

  const [enabled, setEnabled] = useState<Record<BulkField, boolean>>({
    contractor: false,
    work_group: false,
    process_code: false,
    duty: false,
    team: false,
    shift_group: false,
    bus_route: false,
    bus_stop: false,
    status: false,
    use_yn: false,
  });
  const [values, setValues] = useState<Record<BulkField, string>>({
    contractor: "",
    work_group: "",
    process_code: "",
    duty: "",
    team: "",
    shift_group: "",
    bus_route: "",
    bus_stop: "",
    status: "정상",
    use_yn: "Y",
  });
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function toggleField(field: BulkField) {
    setEnabled((prev) => ({ ...prev, [field]: !prev[field] }));
  }
  function setValue(field: BulkField, v: string) {
    setValues((prev) => ({ ...prev, [field]: v }));
  }

  const activeFields = (Object.keys(enabled) as BulkField[]).filter((f) => enabled[f]);

  async function submit() {
    if (activeFields.length === 0) {
      setError("변경할 항목을 하나 이상 선택하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    setProgress(0);
    let ok = 0;
    let fail = 0;
    for (const w of workers) {
      const body: Record<string, unknown> = {
        erp_code: w.erp_code,
        employee_qr: w.employee_qr,
        worker_name: w.worker_name,
        contractor: w.contractor,
        process_code: w.process_code,
        work_group: w.work_group,
        duty: w.duty,
        team: w.team,
        shift_group: w.shift_group,
        phone: w.phone,
        hire_date: w.hire_date,
        bus_route: w.bus_route,
        bus_stop: w.bus_stop,
        uniform_size: w.uniform_size,
        shoe_size: w.shoe_size,
        vest_size: w.vest_size,
        safety_shoe_size: w.safety_shoe_size,
        status: w.status,
        resign_date: w.resign_date,
        resign_reason: w.resign_reason,
        remark: w.remark,
        use_yn: w.use_yn,
      };
      for (const f of activeFields) body[f] = values[f];
      const res = await fetch(`/api/workers/${encodeURIComponent(w.employee_no)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) ok++;
      else fail++;
      setProgress(ok + fail);
    }
    setSaving(false);
    if (fail > 0) {
      setError(`${ok}건 성공, ${fail}건 실패했습니다.`);
      return;
    }
    onSaved();
  }

  const selectCls = "border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white w-full disabled:bg-slate-50 disabled:text-slate-300";

  function FieldRow({ field, children }: { field: BulkField; children: ReactNode }) {
    return (
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm w-24 shrink-0">
          <input type="checkbox" checked={enabled[field]} onChange={() => toggleField(field)} />
          {BULK_FIELD_LABELS[field]}
        </label>
        <div className="flex-1">{children}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            선택 일괄변경 <span className="text-slate-400 font-normal">({workers.length}명)</span>
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-500">
            체크한 항목만 선택된 {workers.length}명 전원에게 같은 값으로 적용됩니다. 체크하지
            않은 항목은 그대로 둡니다.
          </p>
          <FieldRow field="contractor">
            <select
              value={values.contractor}
              onChange={(e) => setValue("contractor", e.target.value)}
              disabled={!enabled.contractor}
              className={selectCls}
            >
              <option value="">선택 안 함</option>
              {CONTRACTOR_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow field="work_group">
            <select
              value={values.work_group}
              onChange={(e) => setValue("work_group", e.target.value)}
              disabled={!enabled.work_group}
              className={selectCls}
            >
              <option value="">선택 안 함</option>
              {WORK_GROUP_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow field="process_code">
            <select
              value={values.process_code}
              onChange={(e) => setValue("process_code", e.target.value)}
              disabled={!enabled.process_code}
              className={selectCls}
            >
              <option value="">미지정</option>
              {processes.map((p) => (
                <option key={p.process_code} value={p.process_code}>
                  {p.process_code} · {p.process_name}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow field="duty">
            <input
              value={values.duty}
              onChange={(e) => setValue("duty", e.target.value)}
              disabled={!enabled.duty}
              className={selectCls}
            />
          </FieldRow>
          <FieldRow field="team">
            <select
              value={values.team}
              onChange={(e) => setValue("team", e.target.value)}
              disabled={!enabled.team}
              className={selectCls}
            >
              <option value="">선택 안 함</option>
              {TEAM_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow field="shift_group">
            <select
              value={values.shift_group}
              onChange={(e) => setValue("shift_group", e.target.value)}
              disabled={!enabled.shift_group}
              className={selectCls}
            >
              <option value="">미지정</option>
              {SHIFT_GROUP_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow field="bus_route">
            <select
              value={values.bus_route}
              onChange={(e) => setValue("bus_route", e.target.value)}
              disabled={!enabled.bus_route}
              className={selectCls}
            >
              <option value="">선택 안 함</option>
              {BUS_ROUTE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow field="bus_stop">
            <input
              value={values.bus_stop}
              onChange={(e) => setValue("bus_stop", e.target.value)}
              disabled={!enabled.bus_stop}
              className={selectCls}
            />
          </FieldRow>
          <FieldRow field="status">
            <select
              value={values.status}
              onChange={(e) => setValue("status", e.target.value)}
              disabled={!enabled.status}
              className={selectCls}
            >
              {STATUS_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow field="use_yn">
            <select
              value={values.use_yn}
              onChange={(e) => setValue("use_yn", e.target.value)}
              disabled={!enabled.use_yn}
              className={selectCls}
            >
              <option value="Y">Y (사용)</option>
              <option value="N">N (중단)</option>
            </select>
          </FieldRow>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {saving && (
            <p className="text-xs text-slate-400">
              저장 중... ({progress}/{workers.length})
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || activeFields.length === 0}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "적용 중..." : "적용"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerUploadModal({
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
    inserted: number;
    updated: number;
    skippedNoKey: number;
  } | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/workers/import", { method: "POST", body: fd });
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
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
                업로드 완료 — 신규 {result.inserted.toLocaleString()}건, 갱신{" "}
                {result.updated.toLocaleString()}건
                {result.skippedNoKey > 0 &&
                  `, 건너뜀(사번/성명 없음) ${result.skippedNoKey.toLocaleString()}건`}
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
                &quot;엑셀 다운로드&quot;로 받은 것과 같은 컬럼 구성의 .xlsx 첫 시트를
                읽습니다. &quot;사번&quot;·&quot;성명&quot; 컬럼은 필수입니다(제목행이 몇
                행 아래에 있어도 자동으로 찾습니다). 이미 있는 사번은 해당 행 값으로 전체
                덮어씁니다.
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
