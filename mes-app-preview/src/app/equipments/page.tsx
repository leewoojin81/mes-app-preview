"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { Equipment } from "@/lib/types";

const USE_TABS = [
  { label: "전체", value: "" },
  { label: "사용", value: "Y" },
  { label: "중단", value: "N" },
] as const;

type FormState = {
  equipment_id: string;
  equipment_name: string;
  workplace: string;
  equipment_group: string;
  personnel: string;
  wage_rate: string;
  ton: string;
  line_id: string;
  bf_warehouse: string;
  defect_warehouse: string;
  defect_pattern: string;
  daily_work_minutes: string;
  work_time_type: string;
  uph: string;
  work_efficiency: string;
  use_yn: "Y" | "N";
};

const EMPTY_FORM: FormState = {
  equipment_id: "",
  equipment_name: "",
  workplace: "",
  equipment_group: "",
  personnel: "",
  wage_rate: "",
  ton: "",
  line_id: "",
  bf_warehouse: "",
  defect_warehouse: "",
  defect_pattern: "",
  daily_work_minutes: "",
  work_time_type: "",
  uph: "",
  work_efficiency: "",
  use_yn: "Y",
};

const COLUMNS: { key: keyof Equipment; label: string; align?: "right" }[] = [
  { key: "equipment_id", label: "설비코드" },
  { key: "equipment_name", label: "설비명" },
  { key: "workplace", label: "작업장" },
  { key: "equipment_group", label: "설비군" },
  { key: "personnel", label: "인원", align: "right" },
  { key: "wage_rate", label: "분당임율", align: "right" },
  { key: "ton", label: "Ton", align: "right" },
  { key: "line_id", label: "라인" },
  { key: "bf_warehouse", label: "B/F창고" },
  { key: "defect_warehouse", label: "불량창고" },
  { key: "defect_pattern", label: "불량패턴" },
  { key: "daily_work_minutes", label: "일취업시간(분)", align: "right" },
  { key: "work_time_type", label: "작업시간Type" },
  { key: "uph", label: "UPH", align: "right" },
  { key: "work_efficiency", label: "작업효율%", align: "right" },
];

export default function EquipmentMasterPage() {
  const [rows, setRows] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  // 탭을 전환했다 돌아와도 보고 있던 필터는 유지되도록 세션 단위로 저장한다.
  const [useFilter, setUseFilter] = useTabState<"" | "Y" | "N">("useFilter", "");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Equipment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDrag = useDraggableModal();

  const load = () => {
    setLoading(true);
    fetch("/api/equipments", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Equipment[]) => {
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
          <h1 className="text-xl font-bold text-navy">설비정보</h1>
          <p className="text-sm text-slate-500 mt-1">
            BASE-05 · 설비등록.xlsx 기준 작업장·설비군·라인 기준정보 관리
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          설비 추가
        </button>
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
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  No
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]"
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
                  <td colSpan={COLUMNS.length + 3} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 3} className="text-center py-10 text-slate-400">
                    등록된 설비가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr key={r.equipment_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    {COLUMNS.map((c) => {
                      const v = r[c.key];
                      return (
                        <td
                          key={c.key}
                          className={`px-4 py-3 ${
                            c.align === "right" ? "text-right" : ""
                          } ${
                            c.key === "equipment_id"
                              ? "font-mono text-xs text-slate-500"
                              : c.key === "equipment_name"
                                ? "font-medium"
                                : "text-slate-500"
                          }`}
                        >
                          {v == null || v === "" ? "-" : String(v)}
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
        <EquipmentFormModal
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
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
              <h2 className="text-base font-bold text-navy">설비 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">
                  {deleteTarget.equipment_id}
                </span>
                <span className="font-medium">{deleteTarget.equipment_name}</span>
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
                    `/api/equipments/${encodeURIComponent(deleteTarget.equipment_id)}`,
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

function EquipmentFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Equipment | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          equipment_id: editing.equipment_id,
          equipment_name: editing.equipment_name,
          workplace: editing.workplace ?? "",
          equipment_group: editing.equipment_group ?? "",
          personnel: editing.personnel == null ? "" : String(editing.personnel),
          wage_rate: editing.wage_rate == null ? "" : String(editing.wage_rate),
          ton: editing.ton == null ? "" : String(editing.ton),
          line_id: editing.line_id ?? "",
          bf_warehouse: editing.bf_warehouse ?? "",
          defect_warehouse: editing.defect_warehouse ?? "",
          defect_pattern: editing.defect_pattern ?? "",
          daily_work_minutes:
            editing.daily_work_minutes == null ? "" : String(editing.daily_work_minutes),
          work_time_type: editing.work_time_type ?? "",
          uph: editing.uph == null ? "" : String(editing.uph),
          work_efficiency:
            editing.work_efficiency == null ? "" : String(editing.work_efficiency),
          use_yn: editing.use_yn,
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useDraggableModal();

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    const body = {
      ...form,
      equipment_id: form.equipment_id.trim(),
      equipment_name: form.equipment_name.trim(),
      workplace: form.workplace.trim(),
      equipment_group: form.equipment_group.trim(),
      line_id: form.line_id.trim(),
      bf_warehouse: form.bf_warehouse.trim(),
      defect_warehouse: form.defect_warehouse.trim(),
      defect_pattern: form.defect_pattern.trim(),
      work_time_type: form.work_time_type.trim(),
    };
    const url = editing
      ? `/api/equipments/${encodeURIComponent(editing.equipment_id)}`
      : "/api/equipments";
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">
            {editing ? "설비 수정" : "설비 추가"}
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
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                설비코드 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.equipment_id}
                onChange={(e) => set("equipment_id", e.target.value)}
                disabled={!!editing}
                className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                placeholder="예: PM0248"
              />
            </label>
            <label className="block text-sm col-span-2">
              <span className="text-slate-600">
                설비명 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.equipment_name}
                onChange={(e) => set("equipment_name", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">작업장</span>
              <input
                value={form.workplace}
                onChange={(e) => set("workplace", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">설비군</span>
              <input
                value={form.equipment_group}
                onChange={(e) => set("equipment_group", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">라인</span>
              <input
                value={form.line_id}
                onChange={(e) => set("line_id", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">인원</span>
              <input
                value={form.personnel}
                onChange={(e) => set("personnel", e.target.value)}
                className={inputCls}
                inputMode="decimal"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">분당임율</span>
              <input
                value={form.wage_rate}
                onChange={(e) => set("wage_rate", e.target.value)}
                className={inputCls}
                inputMode="decimal"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Ton</span>
              <input
                value={form.ton}
                onChange={(e) => set("ton", e.target.value)}
                className={inputCls}
                inputMode="decimal"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">B/F창고</span>
              <input
                value={form.bf_warehouse}
                onChange={(e) => set("bf_warehouse", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">불량창고</span>
              <input
                value={form.defect_warehouse}
                onChange={(e) => set("defect_warehouse", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">불량패턴</span>
            <input
              value={form.defect_pattern}
              onChange={(e) => set("defect_pattern", e.target.value)}
              className={inputCls}
            />
          </label>
          <div className="grid grid-cols-4 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">일취업시간(분)</span>
              <input
                value={form.daily_work_minutes}
                onChange={(e) => set("daily_work_minutes", e.target.value)}
                className={inputCls}
                inputMode="decimal"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">작업시간Type</span>
              <input
                value={form.work_time_type}
                onChange={(e) => set("work_time_type", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">UPH</span>
              <input
                value={form.uph}
                onChange={(e) => set("uph", e.target.value)}
                className={inputCls}
                inputMode="decimal"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">작업효율%</span>
              <input
                value={form.work_efficiency}
                onChange={(e) => set("work_efficiency", e.target.value)}
                className={inputCls}
                inputMode="decimal"
              />
            </label>
          </div>
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
              disabled={saving || !form.equipment_id.trim() || !form.equipment_name.trim()}
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
