"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type { AttendanceCardListResponse, AttendanceCardRow } from "@/lib/types";
import { ATTENDANCE_CARD_COLS as DETAIL_COLS } from "@/lib/attendance-card-columns";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

// 사원번호·근무일자는 행의 자연키(record_key)라 선택 일괄변경 대상에서 뺀다 — 여러 행에
// 같은 값을 한꺼번에 넣으면 서로 record_key가 겹쳐 저장이 실패한다. 단일행 수정에서는
// (한 행만 고치는 것이라 충돌 걱정이 없어) 그대로 편집 가능하다.
const BULK_EXCLUDED_KEYS = new Set(["사원번호", "근무일자"]);

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

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingRow, setEditingRow] = useState<AttendanceCardRow | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);

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
  }, [page, pageSize, dateFrom, dateTo, org, team, search, refreshKey]);

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
                      <button
                        onClick={() => setEditingRow(row)}
                        className="text-xs font-medium text-navy hover:underline"
                      >
                        수정
                      </button>
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
    </div>
  );
}

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

// 행 수정 겸 선택 일괄변경 모달 — rows가 1개면 "행 수정"(전체 컬럼 항상 편집 가능, 사원번호·
// 근무일자 포함), 2개 이상이면 "선택 일괄변경"(컬럼별로 체크해야 그 값이 선택된 모든 행에
// 같은 값으로 적용되고, 자연키인 사원번호·근무일자는 목록에서 뺀다) 화면을 같이 쓴다.
function AttendanceCardEditModal({
  rows,
  onClose,
  onSaved,
}: {
  rows: AttendanceCardRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isBulk = rows.length > 1;
  const fields = DETAIL_COLS.filter((c) => !isBulk || !BULK_EXCLUDED_KEYS.has(c.key));

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, !isBulk]))
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, !isBulk ? String(rows[0].detail?.[f.key] ?? "") : ""])
    )
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
    setSaving(true);
    setError(null);
    setProgress(0);
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            {isBulk ? (
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
                <label className="text-xs text-slate-500 w-24 shrink-0">{f.title}</label>
                <input
                  type="text"
                  value={values[f.key]}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  disabled={isBulk && !enabled[f.key]}
                  className={inputCls}
                />
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
