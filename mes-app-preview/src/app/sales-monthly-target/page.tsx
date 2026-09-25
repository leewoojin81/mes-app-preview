"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import { useDraggableModal } from "@/lib/use-draggable-modal";

interface PlanRow {
  id: number;
  year: number;
  month: number;
  customer_code: string;
  customer_name: string;
  qty: number;
  updated_at: string;
}
interface CustomerOption {
  customer_code: string;
  customer_name: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function SalesMonthlyTargetPage() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);

  // 탭을 전환했다 돌아와도 보고 있던 필터는 유지되도록 세션 단위로 저장한다.
  const [yearFilter, setYearFilter] = useTabState("yearFilter", "");
  const [customerFilter, setCustomerFilter] = useTabState("customerFilter", "");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDrag = useDraggableModal();

  async function load() {
    setLoading(true);
    const res = await fetch("/api/sales-monthly-customer-plan", { cache: "no-store" });
    const data: PlanRow[] = await res.json();
    setRows(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/customers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: CustomerOption[]) =>
        setCustomers(
          [...data]
            .map((c) => ({ customer_code: c.customer_code, customer_name: c.customer_name }))
            .sort((a, b) => a.customer_name.localeCompare(b.customer_name))
        )
      );
  }, []);

  const yearOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => b - a),
    [rows]
  );

  const visibleRows = rows.filter((r) => {
    if (yearFilter && String(r.year) !== yearFilter) return false;
    if (customerFilter && r.customer_code !== customerFilter) return false;
    return true;
  });

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">월별수주(목표) 등록</h1>
          <p className="text-sm text-slate-500 mt-1">
            SALES-01 · 연도 · 월 · 고객사별 수주 목표수량을 직접 입력해 관리합니다.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          목표 추가
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">전체 연도</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <select
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600 max-w-56"
        >
          <option value="">전체 고객사</option>
          {customers.map((c) => (
            <option key={c.customer_code} value={c.customer_code}>
              {c.customer_name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-13.5rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  No
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  연도
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  월
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  고객사
                </th>
                <th className="text-right px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  목표수량(EA)
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    등록된 목표가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500 text-center">{idx + 1}</td>
                    <td className="px-4 py-3 text-center">{r.year}년</td>
                    <td className="px-4 py-3 text-center">{r.month}월</td>
                    <td className="px-4 py-3 font-medium">{r.customer_name}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.qty.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
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
        <PlanFormModal
          editing={editing}
          customers={customers}
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
              <h2 className="text-base font-bold text-navy">목표 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-medium">
                  {deleteTarget.year}년 {deleteTarget.month}월 · {deleteTarget.customer_name}
                </span>{" "}
                목표를 정말 삭제하시겠습니까?
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
                  await fetch(`/api/sales-monthly-customer-plan/${deleteTarget.id}`, {
                    method: "DELETE",
                  });
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

function PlanFormModal({
  editing,
  customers,
  onClose,
  onSaved,
}: {
  editing: PlanRow | null;
  customers: CustomerOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(editing?.year ?? currentYear));
  const [month, setMonth] = useState(String(editing?.month ?? new Date().getMonth() + 1));
  const [customerCode, setCustomerCode] = useState(editing?.customer_code ?? "");
  // 고객사 텍스트 자동완성 — 수주등록(SALES-02)의 거래처 검색과 같은 패턴(드롭다운
  // select 대신 입력하며 후보를 좁혀 고른다, 2026-08-26 사용자 요청). 화면엔 이름만
  // 보이고 실제 제출값(customerCode)은 정확히 일치하는 거래처를 찾았을 때만 채워진다
  // — 목록에 없는 이름을 그냥 타이핑해서 잘못된 코드로 저장되는 걸 막기 위해서다.
  const [customerInput, setCustomerInput] = useState(editing?.customer_name ?? "");
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [qty, setQty] = useState(editing ? String(editing.qty) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useDraggableModal();

  const customerSuggestions = useMemo(() => {
    const q = customerInput.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter(
        (c) =>
          c.customer_code.toLowerCase().includes(q) || c.customer_name.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [customers, customerInput]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const body = { year: Number(year), month: Number(month), customer_code: customerCode, qty: qty === "" ? 0 : Number(qty) };
    const url = editing
      ? `/api/sales-monthly-customer-plan/${editing.id}`
      : "/api/sales-monthly-customer-plan";
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">{editing ? "목표 수정" : "목표 추가"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                연도 <span className="text-rose-600">*</span>
              </span>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={inputCls}
                placeholder="예: 2026"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                월 <span className="text-rose-600">*</span>
              </span>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm relative">
            <span className="text-slate-600">
              고객사 <span className="text-rose-600">*</span>
            </span>
            <input
              value={customerInput}
              onChange={(e) => {
                const v = e.target.value;
                setCustomerInput(v);
                const exact = customers.find((c) => c.customer_name === v);
                setCustomerCode(exact ? exact.customer_code : "");
              }}
              onFocus={() => setShowCustomerSuggestions(true)}
              onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 150)}
              placeholder="거래처명 또는 코드 검색"
              autoComplete="off"
              className={inputCls}
            />
            {showCustomerSuggestions && customerSuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
                {customerSuggestions.map((c) => (
                  <li
                    key={c.customer_code}
                    className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                    onMouseDown={() => {
                      setCustomerInput(c.customer_name);
                      setCustomerCode(c.customer_code);
                      setShowCustomerSuggestions(false);
                    }}
                  >
                    <div className="font-medium">{c.customer_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{c.customer_code}</div>
                  </li>
                ))}
              </ul>
            )}
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">
              목표수량(EA) <span className="text-rose-600">*</span>
            </span>
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`${inputCls} text-right font-mono`}
              placeholder="0"
            />
          </label>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={saving || !customerCode || !year || !month}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
