"use client";

import { useEffect, useMemo, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import TimeSegmentInput from "@/components/TimeSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type { AttendanceCardListResponse, AttendanceCardRow, Worker } from "@/lib/types";
import { ATTENDANCE_CARD_COLS as DETAIL_COLS } from "@/lib/attendance-card-columns";
import { secomStyleName } from "@/lib/biz-import";
import { useDraggableModal } from "@/lib/use-draggable-modal";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

// 사원번호·근무일자는 행의 자연키(record_key)라 선택 일괄변경 대상에서 뺀다 — 여러 행에
// 같은 값을 한꺼번에 넣으면 서로 record_key가 겹쳐 저장이 실패한다. 단일행 수정에서는
// (한 행만 고치는 것이라 충돌 걱정이 없어) 그대로 편집 가능하다.
const BULK_EXCLUDED_KEYS = new Set(["사원번호", "근무일자"]);

// "수동 수정시간"/"수동 수정자"는 세콤 자체 시스템에서 원본 카드값을 고쳤을 때 세콤이
// 남기는 이력 필드라, 우리 쪽에서 새로 만드는 행(신규 등록)에는 애초에 해당 사항이 없다
// (2026-09-24 사용자 요청으로 신규 등록 팝업에서만 제외 — 목록 그리드나 기존 행 수정/
// 일괄변경에는 그대로 남겨둔다, 업로드된 원본 데이터에는 세콤이 채워준 실제 값일 수
// 있으므로).
const CREATE_EXCLUDED_KEYS = new Set(["수동 수정시간", "수동 수정자"]);

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

// 목록에 실제로 나타나는 값만 옵션으로 뽑는다(빈 값 제외, 가나다순).
function distinctOptions(rows: AttendanceCardRow[], key: "org" | "team"): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v != null && v.trim() !== "") set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

export default function AttendanceCardStatusPage() {
  const [rows, setRows] = useState<AttendanceCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [page, setPage] = useTabState("acsPage", 1);
  const [pageSize, setPageSize] = useTabState("acsPageSize", 200);

  // 기본 조회 범위: 이번 달 1일 ~ 당일
  const [dateFrom, setDateFrom] = useTabState("acsDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("acsDateTo", today);
  const [org, setOrg] = useTabState("acsOrg", "");
  const [team, setTeam] = useTabState("acsTeam", "");

  const [searchInput, setSearchInput] = useTabState("acsSearchInput", "");
  const [search, setSearch] = useTabState("acsSearch", "");
  // "수정" 필터(2026-09-24 사용자 요청) — 업로드 이후 사람이 손으로 고친 행(edited_fields
  // 있는 행)만 골라 본다.
  const [editedOnly, setEditedOnly] = useTabState("acsEditedOnly", false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingRow, setEditingRow] = useState<AttendanceCardRow | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AttendanceCardRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDrag = useDraggableModal();

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch, setPage]);

  function buildFilterParams() {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (org) params.set("org", org);
    if (team) params.set("team", team);
    if (search) params.set("search", search);
    if (editedOnly) params.set("edited", "1");
    return params;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = buildFilterParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    fetch(`/api/attendance-card-status?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: AttendanceCardListResponse) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setUploadedAt(data.uploadedAt);
        setLoading(false);
        // 필터/페이지가 바뀌면 이전 선택은 더 이상 화면에 안 보이니 같이 비운다
        // (다른 페이지에 선택된 행이 남아있는 채로 일괄변경 버튼을 누르는 걸 방지).
        setSelected(new Set());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, dateFrom, dateTo, org, team, search, editedOnly, refreshKey]);

  const orgOptions = distinctOptions(rows, "org");
  const teamOptions = distinctOptions(rows, "team");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const r of rows) next.delete(r.id);
        return next;
      }
      const next = new Set(prev);
      for (const r of rows) next.add(r.id);
      return next;
    });
  }

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">출퇴근카드등록</h1>
          <p className="text-sm text-slate-500 mt-1">
            PSN-02 · 카드(출입증) 태깅 근태관리 시스템 원본 리포트 엑셀 업로드(기간별 누적) —
            일일근태입력(PSN-01)과는 별개 데이터로 자동 연동되지 않습니다.
            {uploadedAt && ` · 최근 업로드 ${uploadedAt}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            신규 등록
          </button>
          <button
            onClick={() => setShowBulkEdit(true)}
            disabled={selected.size === 0}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300 transition-colors"
          >
            선택 일괄변경{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
          <button
            onClick={() => {
              window.location.href = `/api/attendance-card-status/export?${buildFilterParams().toString()}`;
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
          <label className="text-xs font-medium text-slate-500 shrink-0">근무일자</label>
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
        <select
          value={org}
          onChange={(e) => {
            setOrg(e.target.value);
            setPage(1);
          }}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            org ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">조직 전체</option>
          {orgOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={team}
          onChange={(e) => {
            setTeam(e.target.value);
            setPage(1);
          }}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            team ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">근무조 전체</option>
          {teamOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="사원번호, 이름 검색"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-64"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600 shrink-0">
          <input
            type="checkbox"
            checked={editedOnly}
            onChange={(e) => {
              setEditedOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-slate-300"
          />
          수정
        </label>
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
                <th className="text-center px-3 py-3 font-semibold sticky left-0 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="전체 선택"
                  />
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky left-10 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-16">
                  No.
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  관리
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
                  <td colSpan={DETAIL_COLS.length + 3} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={DETAIL_COLS.length + 3} className="text-center py-10 text-slate-400">
                    조건에 맞는 출퇴근카드 데이터가 없습니다. 엑셀 업로드로 시작하세요.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row, idx) => (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-50 group ${selected.has(row.id) ? "bg-navy/[0.03]" : ""}`}
                  >
                    <td className="px-3 py-2.5 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 w-10">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        aria-label={`${row.worker_name ?? row.employee_no ?? row.id} 선택`}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-400 sticky left-10 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 w-16">
                      {(page - 1) * pageSize + idx + 1}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setEditingRow(row)}
                          className="text-xs font-medium text-navy hover:underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => setDeleteTarget(row)}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                    {DETAIL_COLS.map((col) => {
                      const v = row.detail?.[col.key];
                      // 업로드 이후 사람이 손으로 고친 컬럼만 빨간색으로 표시한다(2026-09-24
                      // 사용자 요청) — 원본 그대로인 값과 구분해 어디를 고쳤는지 한눈에 보이게.
                      const edited = row.edited_fields?.includes(col.key) ?? false;
                      return (
                        <td
                          key={col.key}
                          title={v == null ? undefined : String(v)}
                          className={`px-3 py-2.5 max-w-64 truncate ${
                            edited
                              ? `font-semibold ${typeof v === "number" ? "text-right font-mono text-xs" : ""} text-rose-600`
                              : typeof v === "number"
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
            refresh();
          }}
        />
      )}

      {editingRow && (
        <AttendanceCardEditModal
          rows={[editingRow]}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            setEditingRow(null);
            refresh();
          }}
        />
      )}

      {showCreate && (
        <AttendanceCardEditModal
          rows={[]}
          isNew
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            setPage(1);
            refresh();
          }}
        />
      )}

      {showBulkEdit && (
        <AttendanceCardEditModal
          rows={rows.filter((r) => selected.has(r.id))}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => {
            setShowBulkEdit(false);
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" style={deleteDrag.style}>
            <div
              className="px-5 py-4 border-b border-slate-200 cursor-move"
              onMouseDown={deleteDrag.onMouseDown}
            >
              <h2 className="text-base font-bold text-navy">출퇴근카드 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">
                  {deleteTarget.employee_no}
                </span>
                <span className="font-medium">{deleteTarget.worker_name}</span>
                {" "}
                {deleteTarget.work_date} 기록을 정말 삭제하시겠습니까?
              </p>
              <p className="text-xs text-slate-400">이 작업은 되돌릴 수 없습니다.</p>
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
                  await fetch(`/api/attendance-card-status/${deleteTarget.id}`, {
                    method: "DELETE",
                  });
                  setDeleting(false);
                  setDeleteTarget(null);
                  refresh();
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

// 출근시간/퇴근시간은 수정 모달에서 일반 텍스트칸 대신 "00:00:00" 형식의 시각 입력칸
// (input type="time", step=1로 초 단위까지)으로 보여준다(2026-09-11 사용자 요청) — 잘못
// 찍힌 시각(예: 06:32)을 고칠 때 텍스트로 직접 타이핑하는 대신 시계 형태로 고르거나
// 각 자리를 화살표로 조절할 수 있다.
const TIME_FIELD_KEYS = new Set(["출근시간", "퇴근시간"]);

// "HH:MM" 또는 "HH:MM:SS"를 분으로 파싱한다. 형식이 안 맞으면 null(자동계산을 건너뛴다).
function parseTimeToMinutes(v: string): number | null {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59) return null;
  return h * 60 + mi;
}
function formatMinutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 행 수정 겸 선택 일괄변경 겸 신규 등록 모달 — rows가 1개면 "행 수정"(전체 컬럼 항상 편집
// 가능, 사원번호·근무일자 포함), 2개 이상이면 "선택 일괄변경"(컬럼별로 체크해야 그 값이
// 선택된 모든 행에 같은 값으로 적용되고, 자연키인 사원번호·근무일자는 목록에서 뺀다) 화면을
// 같이 쓴다. isNew=true면 rows는 빈 배열이고 "행 수정"과 같은 화면(전체 컬럼 편집)을
// 빈 값에서 시작해 새 행을 만든다(2026-09-24 사용자 요청 — 작업자가 카드를 안 찍어 그
// 사원번호·근무일자에 행 자체가 없으면 "수정"을 누를 대상이 없다. 실제 회사 절차상
// 근태신청서 결재 후 담당 직원이 여기서 직접 채워 넣는다).
function AttendanceCardEditModal({
  rows,
  isNew = false,
  onClose,
  onSaved,
}: {
  rows: AttendanceCardRow[];
  isNew?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isBulk = !isNew && rows.length > 1;
  const fields = DETAIL_COLS.filter(
    (c) => (!isBulk || !BULK_EXCLUDED_KEYS.has(c.key)) && (!isNew || !CREATE_EXCLUDED_KEYS.has(c.key))
  );

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, !isBulk]))
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, !isBulk && !isNew ? String(rows[0].detail?.[f.key] ?? "") : ""])
    )
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const drag = useDraggableModal();

  // 신규 등록 팝업의 "이름" 자동완성용 작업자 목록 — 다른 화면(수정/일괄변경)에서는
  // 안 쓰니 isNew일 때만 불러온다.
  const [workers, setWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    if (!isNew) return;
    fetch("/api/workers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Worker[]) => setWorkers(data));
  }, [isNew]);

  function toggleField(key: string) {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  // 출근/퇴근시간을 고치면 총근무시간(원본 태깅 리포트 기준 "퇴근시간 - 출근시간" 순수
  // 경과시간, 자정을 넘기면 +24시간)을 자동으로 다시 계산해 넣는다(2026-09-10 사용자
  // 요청 — 퇴근시간이 잘못 찍힌 걸 고칠 때마다 총근무시간을 손으로 다시 계산해 넣어야
  // 했음). 단일행 수정에서만 적용한다(일괄변경은 행마다 원래 출퇴근시간이 달라 한
  // 화면에서 계산할 수 없다). 두 시간 중 하나라도 형식이 안 맞으면(비어있거나 파싱 실패)
  // 건드리지 않는다 — 총근무시간 자체는 여전히 수동으로 덮어쓸 수 있는 일반 입력칸이라,
  // 이 자동계산 이후에도 사람이 다시 고치면 그 값이 그대로 남는다.
  function setValue(key: string, v: string) {
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      if (!isBulk && (key === "출근시간" || key === "퇴근시간")) {
        const inMin = parseTimeToMinutes(next["출근시간"] ?? "");
        const outMin = parseTimeToMinutes(next["퇴근시간"] ?? "");
        if (inMin != null && outMin != null) {
          const elapsed = outMin >= inMin ? outMin - inMin : outMin + 24 * 60 - inMin;
          next["총근무시간"] = formatMinutesToHHMM(elapsed);
        }
      }
      return next;
    });
  }

  const activeKeys = fields.map((f) => f.key).filter((k) => enabled[k]);

  async function submit() {
    if (isBulk && activeKeys.length === 0) {
      setError("변경할 항목을 하나 이상 선택하세요.");
      return;
    }
    if (isNew && (!values["사원번호"]?.trim() || !values["근무일자"]?.trim())) {
      setError("사원번호·근무일자는 필수입니다.");
      return;
    }
    if (isNew && !values["수정 사유"]?.trim()) {
      setError("수정 사유는 필수입니다.");
      return;
    }
    setSaving(true);
    setError(null);
    setProgress(0);
    if (isNew) {
      const res = await fetch("/api/attendance-card-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detail: values }),
      });
      setSaving(false);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "저장에 실패했습니다.");
        return;
      }
      onSaved();
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const r of rows) {
      const patch: Record<string, string> = {};
      for (const k of activeKeys) patch[k] = values[k];
      const res = await fetch(`/api/attendance-card-status/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detail: patch }),
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

  const inputCls =
    "border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white w-full disabled:bg-slate-50 disabled:text-slate-300";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">
            {isNew ? (
              "카드 신규 등록"
            ) : isBulk ? (
              <>
                선택 일괄변경 <span className="text-slate-400 font-normal">({rows.length}건)</span>
              </>
            ) : (
              "카드 정보 수정"
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          {isNew && (
            <p className="text-xs text-slate-500 mb-3">
              카드를 놓고 와서 출근/퇴근이 안 찍힌 경우 등 원본 업로드에 행 자체가 없을 때
              씁니다(근태신청서 결재 후 담당자가 채워 넣는 용도). 사원번호·근무일자·수정
              사유는 필수이고, 같은 사원번호·근무일자 행이 이미 있으면 저장이 거부됩니다
              (그때는 목록에서 수정을 이용하세요). 이름 칸에 입력하면 등록된 작업자 목록에서
              찾아주고, 선택하면 도급사 접두사가 붙은 세콤 표기·사원번호(비즈사번)·근무조
              (비즈 부서)가 자동으로 채워집니다. 조직·직급은 작업자등록에 대응되는 값이
              없어, 같은 사람의 이 화면(PSN-02) 최근 기록에서 그대로 가져옵니다(카드
              이력이 없는 사람은 직접 입력하세요).
            </p>
          )}
          {isBulk && (
            <p className="text-xs text-slate-500 mb-3">
              체크한 항목만 선택된 {rows.length}건 전부에게 같은 값으로 적용됩니다. 체크하지
              않은 항목은 그대로 둡니다. (사원번호·근무일자는 행마다 달라야 해서 일괄변경할
              수 없습니다 — 단일행 수정에서 고쳐주세요.)
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                {isBulk && (
                  <input
                    type="checkbox"
                    checked={enabled[f.key]}
                    onChange={() => toggleField(f.key)}
                    aria-label={`${f.title} 변경`}
                  />
                )}
                <label className="text-xs text-slate-500 w-24 shrink-0">
                  {f.title}
                  {isNew && f.key === "수정 사유" && <span className="text-rose-500">*</span>}
                </label>
                {isNew && f.key === "이름" ? (
                  <WorkerNameAutocomplete
                    workers={workers}
                    value={values[f.key]}
                    onChangeText={(v) => setValue(f.key, v)}
                    onSelect={async (w) => {
                      setValue("이름", secomStyleName(w.worker_name, w.contractor));
                      const bizNo = w.biz_employee_no ?? w.employee_no;
                      setValue("사원번호", bizNo);
                      // "근무조"는 BASE-09 화면에 같은 이름으로 표시되는 workers.team(1조/
                      // 2조/3조)과 헷갈리기 쉽지만, 세콤 카드 원본의 "근무조" 칸은 실제로는
                      // workers.biz_dept(비즈 연동 원본 부서, 예: "출하포장")와 항상 일치한다
                      // (2026-09-24 실 데이터 대조로 확인 — team과는 값 자체가 다름).
                      if (w.biz_dept) setValue("근무조", w.biz_dept);
                      // "조직"/"직급"은 BASE-09에 대응되는 값이 없다(도급사·직무와 무관하게
                      // 뒤섞여 있음, 2026-09-24 사용자 확인). 대신 같은 사람의 PSN-02 원본
                      // 데이터 중 가장 최근 행에서 그대로 가져온다(2026-09-24 사용자 요청) —
                      // 세콤이 그 사람에게 실제로 매겼던 조직·직급이라 새로 만드는 행에도
                      // 그대로 이어지는 게 맞다. 카드 이력이 아예 없는 사람(신규 입사자 등)은
                      // 채울 값이 없어 그대로 빈칸으로 둔다.
                      const res = await fetch(
                        `/api/attendance-card-status?employeeNo=${encodeURIComponent(bizNo)}&pageSize=1`,
                        { cache: "no-store" }
                      );
                      const data: AttendanceCardListResponse = await res.json().catch(() => null);
                      const latest = data?.rows?.[0]?.detail;
                      if (latest?.["조직"]) setValue("조직", String(latest["조직"]));
                      if (latest?.["직급"]) setValue("직급", String(latest["직급"]));
                    }}
                  />
                ) : TIME_FIELD_KEYS.has(f.key) ? (
                  <TimeSegmentInput
                    value={values[f.key]}
                    onChange={(v) => setValue(f.key, v)}
                    disabled={isBulk && !enabled[f.key]}
                  />
                ) : (
                  <input
                    type="text"
                    value={values[f.key]}
                    onChange={(e) => setValue(f.key, e.target.value)}
                    disabled={isBulk && !enabled[f.key]}
                    className={inputCls}
                  />
                )}
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
          {saving && (
            <p className="text-xs text-slate-400 mt-2">
              저장 중... ({progress}/{rows.length})
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
          >
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

// 신규 등록 팝업의 "이름" 자동완성(2026-09-24 사용자 요청, PSN-05 조회탭 사번·성명
// 검색과 같은 맥락) — 등록된 작업자(workers) 중 이름·사번이 일치하는 목록을 보여주고
// 고르면 이름 칸을 도급사 접두사가 붙은 세콤 표기(secomStyleName)로, 사원번호 칸을
// 비즈사번(세콤 카드 매칭에 실제로 쓰이는 13자리 사번, 없으면 workers.employee_no)으로
// 같이 채운다 — 담당자가 접두사를 몰라서 안 붙이면 근태대사(PSN-06)가 이름불일치로
// 잘못 표시하던 문제(2026-09-24 실사례, 이준영 9/18)를 막기 위함. 자동완성은 어디까지나
// 보조라 선택 없이 자유 타이핑도 그대로 허용한다.
function WorkerNameAutocomplete({
  workers,
  value,
  onChangeText,
  onSelect,
}: {
  workers: Worker[];
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (w: Worker) => void;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return workers
      .filter((w) => w.worker_name.toLowerCase().includes(q) || w.employee_no.toLowerCase().includes(q))
      .slice(0, 20);
  }, [workers, q]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChangeText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="이름 또는 사번 검색"
        className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white w-full"
      />
      {open && q && (
        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">일치하는 작업자가 없습니다.</li>
          )}
          {results.map((w) => (
            <li
              key={w.employee_no}
              className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
              onMouseDown={() => {
                onSelect(w);
                setOpen(false);
              }}
            >
              <div className="font-medium">
                {w.worker_name}
                <span className="text-slate-400 font-normal">
                  {" "}
                  · {w.contractor ?? "메디오스"} · {w.work_group ?? "-"}
                </span>
              </div>
              <div className="text-xs text-slate-400 font-mono">{w.employee_no}</div>
            </li>
          ))}
        </ul>
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
  const drag = useDraggableModal();

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/attendance-card-status/import", { method: "POST", body: fd });
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
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
                  ` (건너뜀(사원번호·근무일자 없음) ${result.skipped.toLocaleString()}건)`}
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
                카드 태깅 근태관리 시스템에서 뽑은 원본 리포트(.xlsx) 첫 시트를 읽습니다.
                1행은 컬럼 제목이어야 하며 &quot;사원번호&quot;, &quot;근무일자&quot; 컬럼은
                필수입니다. 업로드 파일의 근무일자 최소~최대 구간을 구해 그 구간의 기존
                데이터를 전부 삭제한 뒤 파일 내용을 새로 입력합니다(구간 밖 데이터는
                유지됩니다).
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
