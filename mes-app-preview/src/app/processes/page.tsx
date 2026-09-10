"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { Process } from "@/lib/types";

const USE_TABS = [
  { label: "전체", value: "" },
  { label: "사용", value: "Y" },
  { label: "중단", value: "N" },
] as const;

type FormState = {
  process_code: string;
  process_name: string;
  seq: string;
  procure_type: string;
  productivity_type: string;
  process_group: string;
  process_group2: string;
  single_process: "Y" | "N";
  use_yn: "Y" | "N";
  reg_date: string;
  reg_by: string;
  default_daily_capa: string;
  default_yield_rate: string;
  default_lot_size: string;
  shift1_active_yn: "Y" | "N";
  shift1_start: string;
  shift1_end: string;
  shift1_base_minutes: string;
  shift2_active_yn: "Y" | "N";
  shift2_start: string;
  shift2_end: string;
  shift2_base_minutes: string;
  apply_work_pattern_yn: "Y" | "N";
};

const EMPTY_FORM: FormState = {
  process_code: "",
  process_name: "",
  seq: "",
  procure_type: "",
  productivity_type: "",
  process_group: "",
  process_group2: "",
  single_process: "Y",
  use_yn: "Y",
  reg_date: "",
  reg_by: "",
  default_daily_capa: "",
  default_yield_rate: "",
  default_lot_size: "",
  shift1_active_yn: "Y",
  shift1_start: "",
  shift1_end: "",
  shift1_base_minutes: "",
  shift2_active_yn: "Y",
  shift2_start: "",
  shift2_end: "",
  shift2_base_minutes: "",
  apply_work_pattern_yn: "Y",
};

export default function ProcessMasterPage() {
  const [rows, setRows] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  // 탭을 전환했다 돌아와도 보고 있던 필터는 유지되도록 세션 단위로 저장한다.
  const [useFilter, setUseFilter] = useTabState<"" | "Y" | "N">("useFilter", "");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Process | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Process | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/processes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Process[]) => {
        setRows(data);
        setLoading(false);
      });
  };

  useEffect(load, []);

  const visibleRows = rows.filter((r) => !useFilter || r.use_yn === useFilter);

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">공정정보</h1>
          <p className="text-sm text-slate-500 mt-1">
            BASE-04 · 공정코드등록.xlsx 기준 생산 공정 순서·그룹 기준정보 관리
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (useFilter) params.set("use", useFilter);
              const qs = params.toString();
              window.location.href = `/api/processes/export${qs ? `?${qs}` : ""}`;
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
            공정 추가
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

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        {/* 엑셀 틀 고정: 세로 스크롤을 이 컨테이너 안으로 한정해야 sticky 헤더가 동작 */}
        <div className="overflow-auto max-h-[calc(100vh-13.5rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">No</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">공정코드</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">공정명</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">조달구분</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">생산성구분</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">공정그룹</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">공정그룹2</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">단공정</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">기본 일CAPA</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">기본 생산수율</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">기본 Lot Size</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">기본 근무패턴</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">패턴적용</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">사용여부</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">등록일자</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">등록자</th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={17} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={17} className="text-center py-10 text-slate-400">
                    등록된 공정이 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr key={r.process_code} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {r.process_code}
                    </td>
                    <td className="px-4 py-3 font-medium">{r.process_name}</td>
                    <td className="px-4 py-3 text-slate-500">{r.procure_type ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.productivity_type ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.process_group ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.process_group2 ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.single_process ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {r.default_daily_capa != null ? r.default_daily_capa.toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {r.default_yield_rate != null ? `${r.default_yield_rate}%` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {r.default_lot_size != null ? r.default_lot_size.toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {(["1", "2"] as const)
                        .map((n) => {
                          const active = n === "1" ? r.shift1_active_yn : r.shift2_active_yn;
                          const start = n === "1" ? r.shift1_start : r.shift2_start;
                          const end = n === "1" ? r.shift1_end : r.shift2_end;
                          const minutes = n === "1" ? r.shift1_base_minutes : r.shift2_base_minutes;
                          if (active === "N") return `${n}조 중단`;
                          const time = start && end ? ` ${start}~${end}` : "";
                          return `${n}조${time} (${minutes ?? 480}분)`;
                        })
                        .join(" · ")}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          r.apply_work_pattern_yn === "N"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {r.apply_work_pattern_yn === "N" ? "N" : "Y"}
                      </span>
                    </td>
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
                    <td className="px-4 py-3 text-slate-500">{r.reg_date ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.reg_by ?? "-"}</td>
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
                          onClick={() => setDeleteTarget(r)}
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
        <ProcessFormModal
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {showUpload && (
        <ProcessUploadModal
          onClose={() => setShowUpload(false)}
          onImported={load}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-navy">공정 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">
                  {deleteTarget.process_code}
                </span>
                <span className="font-medium">{deleteTarget.process_name}</span>
                을(를) 정말 삭제하시겠습니까?
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
                  await fetch(
                    `/api/processes/${encodeURIComponent(deleteTarget.process_code)}`,
                    { method: "DELETE" }
                  );
                  setDeleting(false);
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

function ProcessFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Process | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          process_code: editing.process_code,
          process_name: editing.process_name,
          seq: String(editing.seq),
          procure_type: editing.procure_type ?? "",
          productivity_type: editing.productivity_type ?? "",
          process_group: editing.process_group ?? "",
          process_group2: editing.process_group2 ?? "",
          single_process: editing.single_process === "N" ? "N" : "Y",
          use_yn: editing.use_yn,
          reg_date: editing.reg_date ?? "",
          reg_by: editing.reg_by ?? "",
          default_daily_capa: editing.default_daily_capa != null ? String(editing.default_daily_capa) : "",
          default_yield_rate: editing.default_yield_rate != null ? String(editing.default_yield_rate) : "",
          default_lot_size: editing.default_lot_size != null ? String(editing.default_lot_size) : "",
          shift1_active_yn: editing.shift1_active_yn === "N" ? "N" : "Y",
          shift1_start: editing.shift1_start ?? "",
          shift1_end: editing.shift1_end ?? "",
          shift1_base_minutes: editing.shift1_base_minutes != null ? String(editing.shift1_base_minutes) : "",
          shift2_active_yn: editing.shift2_active_yn === "N" ? "N" : "Y",
          shift2_start: editing.shift2_start ?? "",
          shift2_end: editing.shift2_end ?? "",
          shift2_base_minutes: editing.shift2_base_minutes != null ? String(editing.shift2_base_minutes) : "",
          apply_work_pattern_yn: editing.apply_work_pattern_yn === "N" ? "N" : "Y",
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    const body = {
      process_code: form.process_code.trim(),
      process_name: form.process_name.trim(),
      seq: form.seq.trim(),
      procure_type: form.procure_type.trim(),
      productivity_type: form.productivity_type.trim(),
      process_group: form.process_group.trim(),
      process_group2: form.process_group2.trim(),
      single_process: form.single_process,
      use_yn: form.use_yn,
      reg_date: form.reg_date.trim(),
      reg_by: form.reg_by.trim(),
      default_daily_capa: form.default_daily_capa.trim(),
      default_yield_rate: form.default_yield_rate.trim(),
      default_lot_size: form.default_lot_size.trim(),
      shift1_active_yn: form.shift1_active_yn,
      shift1_start: form.shift1_start.trim(),
      shift1_end: form.shift1_end.trim(),
      shift1_base_minutes: form.shift1_base_minutes.trim(),
      shift2_active_yn: form.shift2_active_yn,
      shift2_start: form.shift2_start.trim(),
      shift2_end: form.shift2_end.trim(),
      shift2_base_minutes: form.shift2_base_minutes.trim(),
      apply_work_pattern_yn: form.apply_work_pattern_yn,
    };
    const url = editing
      ? `/api/processes/${encodeURIComponent(editing.process_code)}`
      : "/api/processes";
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            {editing ? "공정 수정" : "공정 추가"}
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
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                공정코드 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.process_code}
                onChange={(e) => set("process_code", e.target.value)}
                disabled={!!editing}
                className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                placeholder="예: P420"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">순서</span>
              <input
                value={form.seq}
                onChange={(e) => set("seq", e.target.value.replace(/[^0-9]/g, ""))}
                className={inputCls}
                inputMode="numeric"
                placeholder="비우면 맨 뒤"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">
              공정명 <span className="text-rose-600">*</span>
            </span>
            <input
              value={form.process_name}
              onChange={(e) => set("process_name", e.target.value)}
              className={inputCls}
              placeholder="예: 세척"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">조달구분</span>
              <input
                value={form.procure_type}
                onChange={(e) => set("procure_type", e.target.value)}
                className={inputCls}
                placeholder="예: 사내가공"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">생산성구분</span>
              <input
                value={form.productivity_type}
                onChange={(e) => set("productivity_type", e.target.value)}
                className={inputCls}
                placeholder="예: 설비/노동/해당없음"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">공정그룹</span>
              <input
                value={form.process_group}
                onChange={(e) => set("process_group", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">공정그룹2</span>
              <input
                value={form.process_group2}
                onChange={(e) => set("process_group2", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">단공정</span>
              <select
                value={form.single_process}
                onChange={(e) => set("single_process", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="Y">Y</option>
                <option value="N">N</option>
              </select>
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
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">기본 일CAPA</span>
              <input
                value={form.default_daily_capa}
                onChange={(e) => set("default_daily_capa", e.target.value.replace(/[^0-9.]/g, ""))}
                className={inputCls}
                inputMode="decimal"
                placeholder="예: 5000"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">기본 생산수율(%)</span>
              <input
                value={form.default_yield_rate}
                onChange={(e) => set("default_yield_rate", e.target.value.replace(/[^0-9.]/g, ""))}
                className={inputCls}
                inputMode="decimal"
                placeholder="예: 98.5"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">기본 Lot Size</span>
              <input
                value={form.default_lot_size}
                onChange={(e) => set("default_lot_size", e.target.value.replace(/[^0-9.]/g, ""))}
                className={inputCls}
                inputMode="decimal"
                placeholder="예: 500"
              />
            </label>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-600">
                기본 근무패턴{" "}
                <span className="text-xs text-slate-400 font-normal">
                  — 생산캘린더(BASE-08)가 이 공정 날짜별 근무시간의 기본값으로 쓴다
                </span>
              </p>
            </div>
            <label className="flex items-center justify-between text-sm mb-3 border border-slate-200 rounded-md px-3 py-2">
              <span className="text-slate-600">
                근무패턴 적용여부{" "}
                <span className="text-xs text-slate-400 font-normal">
                  — N이면 생산캘린더(BASE-08) 계산 대상에서 이 공정을 제외 (공정 사용/중단과는 별개)
                </span>
              </span>
              <select
                value={form.apply_work_pattern_yn}
                onChange={(e) => set("apply_work_pattern_yn", e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white shrink-0 ml-2"
              >
                <option value="Y">Y</option>
                <option value="N">N</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  {
                    label: "1조",
                    activeKey: "shift1_active_yn" as const,
                    startKey: "shift1_start" as const,
                    endKey: "shift1_end" as const,
                    minutesKey: "shift1_base_minutes" as const,
                  },
                  {
                    label: "2조",
                    activeKey: "shift2_active_yn" as const,
                    startKey: "shift2_start" as const,
                    endKey: "shift2_end" as const,
                    minutesKey: "shift2_base_minutes" as const,
                  },
                ] as const
              ).map((shift) => (
                <div key={shift.label} className="border border-slate-200 rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-navy">{shift.label}</span>
                    <select
                      value={form[shift.activeKey]}
                      onChange={(e) => set(shift.activeKey, e.target.value)}
                      className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white"
                    >
                      <option value="Y">사용</option>
                      <option value="N">중단</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs text-slate-500">
                      시작시각
                      <input
                        type="time"
                        value={form[shift.startKey]}
                        onChange={(e) => set(shift.startKey, e.target.value)}
                        className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-slate-500">
                      종료시각
                      <input
                        type="time"
                        value={form[shift.endKey]}
                        onChange={(e) => set(shift.endKey, e.target.value)}
                        className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                  <label className="block text-xs text-slate-500">
                    기본작업시간(분, 식사 제외)
                    <input
                      value={form[shift.minutesKey]}
                      onChange={(e) => set(shift.minutesKey, e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="예: 480"
                      className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">등록일자</span>
              <input
                value={form.reg_date}
                onChange={(e) => set("reg_date", e.target.value)}
                className={inputCls}
                placeholder="예: 2026.08.12 (비우면 오늘)"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">등록자</span>
              <input
                value={form.reg_by}
                onChange={(e) => set("reg_by", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
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
              disabled={saving || !form.process_code.trim() || !form.process_name.trim()}
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

function ProcessUploadModal({
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
    skippedNoCode: number;
    skippedInvalid: number;
  } | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/processes/import", { method: "POST", body: fd });
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
                {result.skippedNoCode > 0 &&
                  `, 건너뜀(공정코드/공정명 없음) ${result.skippedNoCode.toLocaleString()}건`}
                {result.skippedInvalid > 0 &&
                  `, 건너뜀(값 형식 오류) ${result.skippedInvalid.toLocaleString()}건`}
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
                읽습니다. 1행은 컬럼 제목이어야 하며 &quot;공정코드&quot;·&quot;공정명&quot;
                컬럼은 필수입니다. 이미 있는 공정코드는 해당 행 값으로 전체 덮어씁니다.
                시작/종료시각은 HH:MM 형식이어야 합니다.
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
