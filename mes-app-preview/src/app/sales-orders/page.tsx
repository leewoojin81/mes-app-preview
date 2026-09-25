"use client";

import { useEffect, useMemo, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import SalesOrderBulkModal from "@/components/SalesOrderBulkModal";
import SalesOrderEditModal from "@/components/SalesOrderEditModal";
import SalesOrderBulkEditModal from "@/components/SalesOrderBulkEditModal";
import { useTabState } from "@/lib/use-tab-state";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type {
  Customer,
  Item,
  SalesOrder,
  SalesOrderListResponse,
} from "@/lib/types";
import {
  SALES_ORDER_DETAIL_COLS as DETAIL_COLS,
  salesOrderFallbackCell as fallbackCell,
  SALES_ORDER_SUM_KEYS as SUM_KEYS,
} from "@/lib/sales-order-columns";

// 원본 엑셀 "상태" 값 그대로 — 목록 화면의 상태 컬럼도, 수동/일괄등록분의 상태값도
// 모두 이 다섯 값(수주/Packing/출고/완료/중단)만 쓴다.
const FILTER_TABS = ["전체", "수주", "Packing", "출고", "완료", "중단"] as const;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 자정 근처에 날짜가 밀릴 수 있음)
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function currentMonthStart(): string {
  const now = new Date();
  return toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
}
function today(): string {
  return toLocalDateStr(new Date());
}

// 대량등록으로 만든 수주는 한 수주번호 아래 여러 줄(so_no = "수주번호-순번")로 저장되므로,
// 선택/수정/삭제는 개별 줄(so_no)이 아니라 이 수주번호 단위로 묶어서 동작해야 한다.
function orderKeyOf(so: SalesOrder): string {
  return String(so.detail?.["수주번호"] ?? so.so_no);
}

// 상태 컬럼과 동일한 기준(detail.상태 우선, 없으면 status 컬럼)으로 "지금 수주 상태인지" 판단한다.
function effectiveStatus(so: SalesOrder): string {
  return String(so.detail?.["상태"] ?? so.status);
}

export default function SalesOrdersPage() {
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  // 탭을 전환했다 돌아와도 조회 조건은 유지되도록 세션 단위로 저장한다.
  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", 200);
  const [filter, setFilter] = useTabState<(typeof FILTER_TABS)[number]>("filter", "전체");
  const [customerSearchInput, setCustomerSearchInput] = useTabState("customerSearchInput", "");
  const [customerSearch, setCustomerSearch] = useTabState("customerSearch", "");
  const [soNoSearchInput, setSoNoSearchInput] = useTabState("soNoSearchInput", "");
  const [soNoSearch, setSoNoSearch] = useTabState("soNoSearch", "");
  const [dateFrom, setDateFrom] = useTabState("dateFrom", currentMonthStart);
  const [dateTo, setDateTo] = useTabState("dateTo", today);
  const [showBulk, setShowBulk] = useState(false);
  const [editingSo, setEditingSo] = useState<SalesOrder | null>(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 거래처 검색어는 300ms 디바운스 후 실제 조회에 반영
  useEffect(() => {
    const t = setTimeout(() => {
      setCustomerSearch(customerSearchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [customerSearchInput, setCustomerSearch, setPage]);

  // 수주번호 검색어도 동일하게 디바운스
  useEffect(() => {
    const t = setTimeout(() => {
      setSoNoSearch(soNoSearchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [soNoSearchInput, setSoNoSearch, setPage]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filter !== "전체") params.set("status", filter);
    if (customerSearch) params.set("customer", customerSearch);
    if (soNoSearch) params.set("soNo", soNoSearch);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    fetch(`/api/sales-orders?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: SalesOrderListResponse) => {
        if (cancelled) return;
        setSalesOrders(data.rows);
        setTotal(data.total);
        setTotals(data.totals ?? {});
        setLoading(false);
        setSelected(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, filter, customerSearch, soNoSearch, dateFrom, dateTo, refreshKey]);

  async function loadItems() {
    const res = await fetch("/api/items?category=완제품", { cache: "no-store" });
    const data: Item[] = await res.json();
    setItems(data);
  }

  async function loadCustomers() {
    const res = await fetch("/api/customers", { cache: "no-store" });
    const data: Customer[] = await res.json();
    setCustomers(data.filter((c) => c.is_sales === "Y"));
  }

  useEffect(() => {
    loadItems();
    loadCustomers();
  }, []);

  // 현재 화면에 보이는 행을 수주번호 기준으로 묶는다. 체크박스/삭제가 이 그룹 단위로 동작한다.
  const soNosByOrderKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const so of salesOrders) {
      const key = orderKeyOf(so);
      const list = map.get(key);
      if (list) list.push(so.so_no);
      else map.set(key, [so.so_no]);
    }
    return map;
  }, [salesOrders]);

  // 거래처 검색 자동완성 — 이미 불러온 customers 목록에서 클라이언트 사이드로 매칭
  const customerSuggestions = useMemo(() => {
    const q = customerSearchInput.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter(
        (c) =>
          c.customer_code.toLowerCase().includes(q) ||
          c.customer_name.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [customers, customerSearchInput]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  // 처리 컬럼의 유일한 상태 전환 버튼 — "수주" 상태인 줄만 "중단"(마감 처리)으로 바꾼다.
  // Packing/출고/완료 전환은 이 화면이 아니라 추후 PackList/제품출고등록에서 다룬다.
  async function handleCancel(so_no: string) {
    if (!window.confirm(`${so_no}를 중단 처리할까요?`)) return;
    try {
      const res = await fetch(`/api/sales-orders/${encodeURIComponent(so_no)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "중단 처리에 실패했습니다.");
      setToast(`${so_no}가 중단 처리되었습니다.`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "중단 처리에 실패했습니다.");
    }
  }

  // 수주번호 하나에 속한 줄 전체를 함께 삭제한다(대량등록분은 여러 줄이 한 수주번호를 공유).
  async function handleDeleteOrder(so: SalesOrder) {
    const orderKey = orderKeyOf(so);
    const soNos = soNosByOrderKey.get(orderKey) ?? [so.so_no];
    const label = soNos.length > 1 ? `${orderKey} 수주(${soNos.length}건)` : orderKey;
    if (!window.confirm(`${label}를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      const res = await fetch("/api/sales-orders/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ so_nos: soNos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "삭제에 실패했습니다.");
      setToast(`${label}가 삭제되었습니다.`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  // 체크박스로 선택한 수주(들)를 한 번에 삭제한다.
  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const orderKeys = new Set(
      salesOrders.filter((so) => selected.has(so.so_no)).map(orderKeyOf)
    );
    if (
      !window.confirm(
        `선택한 ${orderKeys.size}개 수주(${selected.size}건)를 삭제할까요? 되돌릴 수 없습니다.`
      )
    )
      return;
    try {
      const res = await fetch("/api/sales-orders/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ so_nos: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "삭제에 실패했습니다.");
      setToast(`${(data.deleted ?? selected.size).toLocaleString()}건이 삭제되었습니다.`);
      setSelected(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">수주등록</h1>
          <p className="text-sm text-slate-500 mt-1">
            SALES-02 · 거래처 주문 접수 및 상태 관리 (수주 → Packing → 출고 → 완료/중단) · 원본 엑셀 전체 컬럼 표시
          </p>
        </div>
        <button
          onClick={() => setShowBulk(true)}
          className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light transition-colors"
        >
          + 수주등록
        </button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as (typeof FILTER_TABS)[number]);
              setPage(1);
            }}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white text-slate-600 font-medium"
          >
            {FILTER_TABS.map((tab) => (
              <option key={tab} value={tab}>
                {tab}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <input
              value={customerSearchInput}
              onChange={(e) => setCustomerSearchInput(e.target.value)}
              onFocus={() => setShowCustomerSuggestions(true)}
              onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowCustomerSuggestions(false);
              }}
              placeholder="거래처코드 또는 거래처명 검색"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm w-56"
            />
            {showCustomerSuggestions && customerSuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-64 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
                {customerSuggestions.map((c) => (
                  <li
                    key={c.customer_code}
                    className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                    onMouseDown={() => {
                      setCustomerSearchInput(c.customer_name);
                      setShowCustomerSuggestions(false);
                    }}
                  >
                    <div className="font-medium">{c.customer_name}</div>
                    <div className="text-xs text-slate-400 font-mono">{c.customer_code}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input
            value={soNoSearchInput}
            onChange={(e) => setSoNoSearchInput(e.target.value)}
            placeholder="수주번호 검색"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-40"
          />
          <div className="flex items-center gap-1.5">
            <DateSegmentInput
              value={dateFrom}
              onChange={(iso) => {
                setDateFrom(iso);
                setPage(1);
              }}
            />
            <span className="text-slate-400 text-sm">~</span>
            <DateSegmentInput
              value={dateTo}
              onChange={(iso) => {
                setDateTo(iso);
                setPage(1);
              }}
            />
          </div>
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
          <button
            onClick={() => {
              const params = new URLSearchParams();
              if (filter !== "전체") params.set("status", filter);
              if (customerSearch) params.set("customer", customerSearch);
              if (soNoSearch) params.set("soNo", soNoSearch);
              if (dateFrom) params.set("dateFrom", dateFrom);
              if (dateTo) params.set("dateTo", dateTo);
              window.location.href = `/api/sales-orders/export?${params.toString()}`;
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
            onClick={() => setShowBulkEdit(true)}
            disabled={selected.size === 0}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors disabled:opacity-40 disabled:hover:border-slate-300"
          >
            선택 일괄수정{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={selected.size === 0}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:hover:bg-white"
          >
            선택 일괄삭제{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-17rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-2 py-3 font-semibold sticky left-0 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-10">
                  <input
                    type="checkbox"
                    checked={salesOrders.length > 0 && selected.size === salesOrders.length}
                    onChange={(e) => {
                      setSelected(e.target.checked ? new Set(salesOrders.map((s) => s.so_no)) : new Set());
                    }}
                  />
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky left-10 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0]">
                  수주번호
                </th>
                {DETAIL_COLS.map((col) => (
                  <th
                    key={col.key}
                    className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]"
                  >
                    {col.title}
                  </th>
                ))}
                <th className="text-center px-3 py-3 font-semibold sticky right-0 top-0 z-30 bg-[#D9E1F2] border-l border-slate-200 shadow-[inset_0_1px_0_#e2e8f0]">
                  처리
                </th>
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
              {!loading && salesOrders.length === 0 && (
                <tr>
                  <td colSpan={DETAIL_COLS.length + 3} className="text-center py-10 text-slate-400">
                    수주가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                salesOrders.map((so, idx) => {
                  // 체크박스는 개별 줄이 아니라 이 줄이 속한 수주번호 전체를 함께 선택/해제한다.
                  const groupSoNos = soNosByOrderKey.get(orderKeyOf(so)) ?? [so.so_no];
                  const groupChecked = groupSoNos.every((n) => selected.has(n));
                  return (
                    <tr key={so.so_no} className="hover:bg-slate-50 group">
                      <td className="px-2 py-2.5 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 w-10">
                        <input
                          type="checkbox"
                          checked={groupChecked}
                          onChange={(e) => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              for (const n of groupSoNos) {
                                if (e.target.checked) next.add(n);
                                else next.delete(n);
                              }
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-navy font-mono text-xs sticky left-10 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200">
                        {so.detail?.["수주번호"] ?? so.so_no}
                      </td>
                      {DETAIL_COLS.map((col) => {
                        // detail은 엑셀 업로드분은 전체 컬럼을, 수동 등록분은 MO-번호/순번/
                        // 샘플구분/단가구분/비고만 담고 있어 컬럼 단위로 detail → fallback 순으로 조회한다.
                        const v =
                          col.key === "No."
                            ? (page - 1) * pageSize + idx + 1
                            : (so.detail?.[col.key] ?? fallbackCell(so, col.key));
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
                      <td className="px-3 py-2.5 sticky right-0 z-10 bg-white group-hover:bg-slate-50 border-l border-slate-200">
                        <div className="flex items-center justify-end gap-1.5">
                          {effectiveStatus(so) === "수주" && (
                            <button
                              onClick={() => handleCancel(so.so_no)}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600"
                            >
                              중단
                            </button>
                          )}
                          <button
                            onClick={() => setEditingSo(so)}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-300 text-slate-600 hover:border-navy hover:text-navy"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDeleteOrder(so)}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {!loading && salesOrders.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-semibold sticky bottom-0 z-20">
                  <td
                    className="px-2 py-2.5 text-center sticky left-0 z-10 bg-slate-100 border-r border-slate-200 w-10"
                    title="검색 결과 전체 기준 합계(현재 페이지만이 아님)"
                  >
                    합계
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 sticky left-10 z-10 bg-slate-100 border-r border-slate-200 whitespace-nowrap">
                    ({total.toLocaleString()} Rows)
                  </td>
                  {DETAIL_COLS.map((col) => {
                    const isSum = (SUM_KEYS as readonly string[]).includes(col.key);
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 whitespace-nowrap ${
                          isSum ? "text-right text-navy font-mono text-xs" : "text-slate-300"
                        }`}
                      >
                        {isSum ? (totals[col.key] ?? 0).toLocaleString() : "-"}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 sticky right-0 z-10 bg-slate-100 border-l border-slate-200" />
                </tr>
              </tfoot>
            )}
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onImported={() => {
            setPage(1);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {showBulk && (
        <SalesOrderBulkModal
          items={items}
          customers={customers}
          onClose={() => setShowBulk(false)}
          onSaved={(message) => {
            setToast(message);
            setPage(1);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editingSo && (
        <SalesOrderEditModal
          so={editingSo}
          items={items}
          customers={customers}
          onClose={() => setEditingSo(null)}
          onSaved={(message) => {
            setToast(message);
            setEditingSo(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {showBulkEdit && (
        <SalesOrderBulkEditModal
          orders={salesOrders.filter((so) => selected.has(so.so_no))}
          items={items}
          customers={customers}
          onClose={() => setShowBulkEdit(false)}
          onSaved={(message) => {
            setToast(message);
            setShowBulkEdit(false);
            setSelected(new Set());
            setRefreshKey((k) => k + 1);
          }}
        />
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
    inserted: number;
    updated: number;
    skippedInvalid: number;
    skippedCustomerNotFound: number;
    skippedItemNotFound: number;
  } | null>(null);
  const drag = useDraggableModal();

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/sales-orders/import", { method: "POST", body: fd });
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
                업로드 완료 — 신규 {result.inserted.toLocaleString()}건, 갱신{" "}
                {result.updated.toLocaleString()}건
                {result.skippedInvalid > 0 &&
                  `, 건너뜀(필수값 누락) ${result.skippedInvalid.toLocaleString()}건`}
                {result.skippedCustomerNotFound > 0 &&
                  `, 건너뜀(거래처 없음) ${result.skippedCustomerNotFound.toLocaleString()}건`}
                {result.skippedItemNotFound > 0 &&
                  `, 건너뜀(품목 없음) ${result.skippedItemNotFound.toLocaleString()}건`}
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
                &quot;수주현황&quot; 양식(.xlsx) 첫 시트를 읽습니다. 1행은 컬럼 제목이어야 하며
                &quot;수주번호&quot;·&quot;순번&quot;·&quot;코드&quot;·&quot;품목코드&quot;·&quot;수량&quot;
                컬럼은 필수입니다. 이미 있는 수주번호는 갱신됩니다.
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
