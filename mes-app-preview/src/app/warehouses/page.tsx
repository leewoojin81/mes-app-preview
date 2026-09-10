"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { Warehouse } from "@/lib/types";

const USE_TABS = [
  { label: "전체", value: "" },
  { label: "사용", value: "Y" },
  { label: "중단", value: "N" },
] as const;

type FormState = {
  warehouse_code: string;
  warehouse_name: string;
  workplace: string;
  procure_type: string;
  warehouse_type: string;
  use_yn: "Y" | "N";
};

const EMPTY_FORM: FormState = {
  warehouse_code: "",
  warehouse_name: "",
  workplace: "",
  procure_type: "",
  warehouse_type: "",
  use_yn: "Y",
};

const COLUMNS: { key: keyof Warehouse; label: string; align?: "right" }[] = [
  { key: "warehouse_code", label: "창고코드" },
  { key: "warehouse_name", label: "창고명" },
  { key: "workplace", label: "사업장" },
  { key: "procure_type", label: "조달구분" },
  { key: "warehouse_type", label: "창고유형" },
];

export default function WarehouseMasterPage() {
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  // 탭을 전환했다 돌아와도 보고 있던 필터는 유지되도록 세션 단위로 저장한다.
  const [useFilter, setUseFilter] = useTabState<"" | "Y" | "N">("useFilter", "");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Warehouse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/warehouses", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Warehouse[]) => {
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
          <h1 className="text-xl font-bold text-navy">창고정보</h1>
          <p className="text-sm text-slate-500 mt-1">
            BASE-07 · 창고코드등록.xlsx 기준 사업장·조달구분별 창고 기준정보 관리
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          창고 추가
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
                    등록된 창고가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr key={r.warehouse_code} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    {COLUMNS.map((c) => {
                      const v = r[c.key];
                      return (
                        <td
                          key={c.key}
                          className={`px-4 py-3 ${
                            c.align === "right" ? "text-right" : ""
                          } ${
                            c.key === "warehouse_code"
                              ? "font-mono text-xs text-slate-500"
                              : c.key === "warehouse_name"
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
        <WarehouseFormModal
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
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-navy">창고 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">
                  {deleteTarget.warehouse_code}
                </span>
                <span className="font-medium">{deleteTarget.warehouse_name}</span>
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
                    `/api/warehouses/${encodeURIComponent(deleteTarget.warehouse_code)}`,
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

function WarehouseFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Warehouse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          warehouse_code: editing.warehouse_code,
          warehouse_name: editing.warehouse_name,
          workplace: editing.workplace ?? "",
          procure_type: editing.procure_type ?? "",
          warehouse_type: editing.warehouse_type ?? "",
          use_yn: editing.use_yn,
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
      ...form,
      warehouse_code: form.warehouse_code.trim(),
      warehouse_name: form.warehouse_name.trim(),
    };
    const url = editing
      ? `/api/warehouses/${encodeURIComponent(editing.warehouse_code)}`
      : "/api/warehouses";
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
            {editing ? "창고 수정" : "창고 추가"}
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
                창고코드 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.warehouse_code}
                onChange={(e) => set("warehouse_code", e.target.value)}
                disabled={!!editing}
                className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                placeholder="예: S010"
              />
            </label>
            <label className="block text-sm col-span-2">
              <span className="text-slate-600">
                창고명 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.warehouse_name}
                onChange={(e) => set("warehouse_name", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">사업장</span>
            <input
              value={form.workplace}
              onChange={(e) => set("workplace", e.target.value)}
              className={inputCls}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">조달구분</span>
              <input
                value={form.procure_type}
                onChange={(e) => set("procure_type", e.target.value)}
                className={inputCls}
                placeholder="사내가공/외주가공"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">창고유형</span>
              <input
                value={form.warehouse_type}
                onChange={(e) => set("warehouse_type", e.target.value)}
                className={inputCls}
                placeholder="양품/불용"
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
              disabled={saving || !form.warehouse_code.trim() || !form.warehouse_name.trim()}
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
