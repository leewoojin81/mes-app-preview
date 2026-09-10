"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { Customer } from "@/lib/types";

const USE_TABS = [
  { label: "전체", value: "" },
  { label: "사용", value: "Y" },
  { label: "중단", value: "N" },
] as const;

type FormState = {
  customer_code: string;
  customer_name: string;
  customer_type: string;
  biz_reg_no: string;
  ceo_name: string;
  zip_code: string;
  address: string;
  phone: string;
  fax: string;
  biz_type: string;
  biz_item: string;
  manager_name: string;
  settle_customer_code: string;
  settle_customer_name: string;
  trade_start_date: string;
  trade_end_date: string;
  category_large: string;
  category_mid: string;
  category_small: string;
  bank_name: string;
  bank_account: string;
  account_holder: string;
  website: string;
  is_purchase: "Y" | "N";
  is_outsourcing: "Y" | "N";
  is_sales: "Y" | "N";
  country: string;
  use_yn: "Y" | "N";
};

const EMPTY_FORM: FormState = {
  customer_code: "",
  customer_name: "",
  customer_type: "",
  biz_reg_no: "",
  ceo_name: "",
  zip_code: "",
  address: "",
  phone: "",
  fax: "",
  biz_type: "",
  biz_item: "",
  manager_name: "",
  settle_customer_code: "",
  settle_customer_name: "",
  trade_start_date: "",
  trade_end_date: "",
  category_large: "",
  category_mid: "",
  category_small: "",
  bank_name: "",
  bank_account: "",
  account_holder: "",
  website: "",
  is_purchase: "N",
  is_outsourcing: "N",
  is_sales: "N",
  country: "",
  use_yn: "Y",
};

const COLUMNS: { key: keyof Customer; label: string; align?: "right" }[] = [
  { key: "customer_code", label: "거래처코드" },
  { key: "customer_name", label: "거래처명" },
  { key: "customer_type", label: "구분" },
  { key: "biz_reg_no", label: "사업자번호" },
  { key: "ceo_name", label: "대표자" },
  { key: "phone", label: "전화번호" },
  { key: "manager_name", label: "담당자" },
  { key: "address", label: "주소" },
  { key: "bank_name", label: "결제은행" },
  { key: "bank_account", label: "계좌번호" },
  { key: "country", label: "국가정보" },
];

export default function CustomerMasterPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  // 탭을 전환했다 돌아와도 보고 있던 필터/검색어는 유지되도록 세션 단위로 저장한다.
  const [useFilter, setUseFilter] = useTabState<"" | "Y" | "N">("useFilter", "");
  const [typeFilter, setTypeFilter] = useTabState("typeFilter", "");
  const [keyword, setKeyword] = useTabState("keyword", "");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/customers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Customer[]) => {
        setRows(data);
        setLoading(false);
      });
  };

  useEffect(load, []);

  const typeOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.customer_type).filter(Boolean))) as string[],
    [rows]
  );

  const visibleRows = rows.filter((r) => {
    if (useFilter && r.use_yn !== useFilter) return false;
    if (typeFilter && r.customer_type !== typeFilter) return false;
    if (keyword) {
      const k = keyword.trim().toLowerCase();
      if (
        !r.customer_code.toLowerCase().includes(k) &&
        !r.customer_name.toLowerCase().includes(k)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">거래처정보</h1>
          <p className="text-sm text-slate-500 mt-1">
            BASE-06 · 거래처등록.xlsx 기준 고객사·공급사·외주처 마스터 관리
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          거래처 추가
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
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
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="ml-2 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">전체 구분</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="거래처코드 · 거래처명 검색"
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-56"
        />
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
                    등록된 거래처가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr key={r.customer_code} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    {COLUMNS.map((c) => {
                      const v = r[c.key];
                      return (
                        <td
                          key={c.key}
                          className={`px-4 py-3 ${
                            c.align === "right" ? "text-right" : ""
                          } ${
                            c.key === "customer_code"
                              ? "font-mono text-xs text-slate-500"
                              : c.key === "customer_name"
                                ? "font-medium"
                                : c.key === "address"
                                  ? "max-w-xs truncate"
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
        <CustomerFormModal
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
              <h2 className="text-base font-bold text-navy">거래처 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">
                  {deleteTarget.customer_code}
                </span>
                <span className="font-medium">{deleteTarget.customer_name}</span>
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
                    `/api/customers/${encodeURIComponent(deleteTarget.customer_code)}`,
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

function CustomerFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          customer_code: editing.customer_code,
          customer_name: editing.customer_name,
          customer_type: editing.customer_type ?? "",
          biz_reg_no: editing.biz_reg_no ?? "",
          ceo_name: editing.ceo_name ?? "",
          zip_code: editing.zip_code ?? "",
          address: editing.address ?? "",
          phone: editing.phone ?? "",
          fax: editing.fax ?? "",
          biz_type: editing.biz_type ?? "",
          biz_item: editing.biz_item ?? "",
          manager_name: editing.manager_name ?? "",
          settle_customer_code: editing.settle_customer_code ?? "",
          settle_customer_name: editing.settle_customer_name ?? "",
          trade_start_date: editing.trade_start_date ?? "",
          trade_end_date: editing.trade_end_date ?? "",
          category_large: editing.category_large ?? "",
          category_mid: editing.category_mid ?? "",
          category_small: editing.category_small ?? "",
          bank_name: editing.bank_name ?? "",
          bank_account: editing.bank_account ?? "",
          account_holder: editing.account_holder ?? "",
          website: editing.website ?? "",
          is_purchase: editing.is_purchase,
          is_outsourcing: editing.is_outsourcing,
          is_sales: editing.is_sales,
          country: editing.country ?? "",
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
      customer_code: form.customer_code.trim(),
      customer_name: form.customer_name.trim(),
    };
    const url = editing
      ? `/api/customers/${encodeURIComponent(editing.customer_code)}`
      : "/api/customers";
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            {editing ? "거래처 수정" : "거래처 추가"}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* 기본정보 */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                거래처코드 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.customer_code}
                onChange={(e) => set("customer_code", e.target.value)}
                disabled={!!editing}
                className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                placeholder="예: 100"
              />
            </label>
            <label className="block text-sm col-span-2">
              <span className="text-slate-600">
                거래처명 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.customer_name}
                onChange={(e) => set("customer_name", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">구분</span>
              <input
                value={form.customer_type}
                onChange={(e) => set("customer_type", e.target.value)}
                className={inputCls}
                placeholder="판매/구매/외주/관리 등"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">사업자번호</span>
              <input
                value={form.biz_reg_no}
                onChange={(e) => set("biz_reg_no", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">대표자</span>
              <input
                value={form.ceo_name}
                onChange={(e) => set("ceo_name", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          {/* 주소/연락처 */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">우편번호</span>
              <input
                value={form.zip_code}
                onChange={(e) => set("zip_code", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm col-span-2">
              <span className="text-slate-600">주소</span>
              <input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">전화번호</span>
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">팩스번호</span>
              <input
                value={form.fax}
                onChange={(e) => set("fax", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">담당자</span>
              <input
                value={form.manager_name}
                onChange={(e) => set("manager_name", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">업태</span>
              <input
                value={form.biz_type}
                onChange={(e) => set("biz_type", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">종목</span>
              <input
                value={form.biz_item}
                onChange={(e) => set("biz_item", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">국가정보</span>
              <input
                value={form.country}
                onChange={(e) => set("country", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          {/* 분류 */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">대분류</span>
              <input
                value={form.category_large}
                onChange={(e) => set("category_large", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">중분류</span>
              <input
                value={form.category_mid}
                onChange={(e) => set("category_mid", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">소분류</span>
              <input
                value={form.category_small}
                onChange={(e) => set("category_small", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          {/* 정산/거래정보 */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">정산거래처</span>
              <input
                value={form.settle_customer_code}
                onChange={(e) => set("settle_customer_code", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">정산거래처명</span>
              <input
                value={form.settle_customer_name}
                onChange={(e) => set("settle_customer_name", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">거래일자(시작)</span>
              <input
                value={form.trade_start_date}
                onChange={(e) => set("trade_start_date", e.target.value)}
                className={inputCls}
                placeholder="YYYY.MM.DD"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">거래일자(종료)</span>
              <input
                value={form.trade_end_date}
                onChange={(e) => set("trade_end_date", e.target.value)}
                className={inputCls}
                placeholder="YYYY.MM.DD"
              />
            </label>
          </div>

          {/* 은행정보 */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">결제은행</span>
              <input
                value={form.bank_name}
                onChange={(e) => set("bank_name", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">계좌번호</span>
              <input
                value={form.bank_account}
                onChange={(e) => set("bank_account", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">예금주</span>
              <input
                value={form.account_holder}
                onChange={(e) => set("account_holder", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">홈페이지</span>
            <input
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
              className={inputCls}
            />
          </label>

          {/* 거래유형 */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">구매</span>
              <select
                value={form.is_purchase}
                onChange={(e) => set("is_purchase", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="N">N</option>
                <option value="Y">Y</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">외주</span>
              <select
                value={form.is_outsourcing}
                onChange={(e) => set("is_outsourcing", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="N">N</option>
                <option value="Y">Y</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">판매</span>
              <select
                value={form.is_sales}
                onChange={(e) => set("is_sales", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="N">N</option>
                <option value="Y">Y</option>
              </select>
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
              disabled={saving || !form.customer_code.trim() || !form.customer_name.trim()}
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
