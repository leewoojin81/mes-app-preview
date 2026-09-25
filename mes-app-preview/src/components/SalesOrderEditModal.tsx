"use client";

import { useRef, useState } from "react";
import CustomerSearchSelect from "@/components/CustomerSearchSelect";
import ItemSearchSelect from "@/components/ItemSearchSelect";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { Customer, Item, SalesOrder, SalesOrderStatus } from "@/lib/types";

const STATUS_OPTIONS: SalesOrderStatus[] = ["수주", "Packing", "출고", "완료", "중단"];
const SALES_TYPE_OPTIONS = ["국내", "Local", "직수출"];
const CURRENCY_OPTIONS = ["KRW", "USD", "CNY", "JPY", "EUR"];

// "YYYY.MM.DD"(원본 엑셀 표기) -> "YYYY-MM-DD"(<input type="date"> 표준 표기)
function toDateInputValue(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v).replace(/\./g, "-");
}

// 엑셀에서 복사한 숫자는 천단위 콤마가 붙어 있는 경우가 많다("1,000") — 그대로 Number()에
// 넘기면 NaN이 되므로, 계산 시에는 콤마와 공백을 제거하고 파싱한다.
function parseNum(value: string): number {
  return Number(value.replace(/,/g, "").trim());
}

export default function SalesOrderEditModal({
  so,
  items,
  customers,
  onClose,
  onSaved,
}: {
  so: SalesOrder;
  items: Item[];
  customers: Customer[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [customerCode, setCustomerCode] = useState(so.customer_code);
  const [itemCode, setItemCode] = useState(so.item_code);
  const [orderQty, setOrderQty] = useState(String(so.order_qty));
  const [unitPrice, setUnitPrice] = useState(so.unit_price != null ? String(so.unit_price) : "");
  const [dueDate, setDueDate] = useState(toDateInputValue(so.due_date));
  // status 컬럼이 아니라 화면에 실제 표시되는 값(detail.상태 우선)을 기준으로 시작해야
  // 이미 detail.상태가 붙은 건(엑셀 업로드분, 중단 처리한 건 등)을 고쳐서 저장할 수 있다.
  const [status, setStatus] = useState<SalesOrderStatus>(
    (so.detail?.["상태"] as SalesOrderStatus | undefined) ?? so.status
  );
  const [orderDate, setOrderDate] = useState(toDateInputValue(so.detail?.["수주일자"]));
  const [salesType, setSalesType] = useState(String(so.detail?.["매출구분"] ?? ""));
  const [currency, setCurrency] = useState(String(so.detail?.["화폐"] ?? ""));
  const [sampleType, setSampleType] = useState(String(so.detail?.["샘플구분"] ?? ""));
  const [moNo, setMoNo] = useState(String(so.detail?.["MO-번호"] ?? ""));
  const [remark, setRemark] = useState(String(so.detail?.["비고"] ?? ""));
  const [exchangeRate, setExchangeRate] = useState(
    so.detail?.["환율"] != null ? String(so.detail["환율"]) : ""
  );
  const [convertedAmount, setConvertedAmount] = useState(
    so.detail?.["환산금액"] != null ? String(so.detail["환산금액"]) : ""
  );
  // 환산금액을 사용자가 직접 수정하면, 수량/단가/환율이 바뀌어도 자동 재계산으로 덮어쓰지 않는다.
  const convertedAmountManual = useRef(false);

  // 수량×단가×환율로 환산금액을 다시 계산한다. 환산금액을 직접 수정한 뒤에는 호출하지 않는다.
  function recomputeConvertedAmount(qtyStr: string, priceStr: string, rateStr: string) {
    if (convertedAmountManual.current) return;
    const qty = parseNum(qtyStr);
    const price = parseNum(priceStr);
    const rate = parseNum(rateStr);
    if (qtyStr && priceStr && rateStr && Number.isFinite(qty) && Number.isFinite(price) && Number.isFinite(rate)) {
      setConvertedAmount(String(Math.round(qty * price * rate)));
    }
  }

  function handleOrderQtyChange(value: string) {
    setOrderQty(value);
    recomputeConvertedAmount(value, unitPrice, exchangeRate);
  }
  function handleUnitPriceChange(value: string) {
    setUnitPrice(value);
    recomputeConvertedAmount(orderQty, value, exchangeRate);
  }
  function handleExchangeRateChange(value: string) {
    setExchangeRate(value);
    recomputeConvertedAmount(orderQty, unitPrice, value);
  }
  function handleConvertedAmountChange(value: string) {
    convertedAmountManual.current = true;
    setConvertedAmount(value);
  }

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 창을 헤더(제목 표시줄)를 드래그해 화면 어디로든 옮길 수 있게 한다.
  const drag = useDraggableModal();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerCode || !itemCode || !orderQty || Number(orderQty) <= 0) {
      setError("거래처, 품목, 수량을 확인해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-orders/${encodeURIComponent(so.so_no)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          customer_code: customerCode,
          item_code: itemCode,
          order_qty: Number(orderQty),
          unit_price: unitPrice ? Number(unitPrice) : null,
          due_date: dueDate || null,
          status,
          order_date: orderDate || null,
          sales_type: salesType || null,
          currency: currency || null,
          sample_type: sampleType || null,
          mo_no: moNo || null,
          remark: remark || null,
          exchange_rate: exchangeRate ? parseNum(exchangeRate) : null,
          converted_amount: convertedAmount ? parseNum(convertedAmount) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "수정에 실패했습니다.");
      onSaved(`${so.so_no} 수주가 수정되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`${so.so_no} 수주를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-orders/${encodeURIComponent(so.so_no)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "삭제에 실패했습니다.");
      onSaved(`${so.so_no} 수주가 삭제되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <form
        onSubmit={handleSave}
        style={drag.style}
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]"
      >
        <div
          onMouseDown={drag.onMouseDown}
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move select-none"
        >
          <div>
            <h2 className="text-base font-bold text-navy">수주 수정</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{so.so_no}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className="text-xs font-medium text-slate-500">거래처</label>
            <CustomerSearchSelect customers={customers} value={customerCode} onChange={setCustomerCode} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">상태</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SalesOrderStatus)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-3">
            <label className="text-xs font-medium text-slate-500">품목</label>
            <ItemSearchSelect items={items} value={itemCode} onChange={setItemCode} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">수량</label>
            <input
              type="number"
              min={1}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={orderQty}
              onChange={(e) => handleOrderQtyChange(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">단가</label>
            <input
              type="number"
              min={0}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={unitPrice}
              onChange={(e) => handleUnitPriceChange(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">납품일자</label>
            <input
              type="date"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">수주일자</label>
            <input
              type="date"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">매출구분</label>
            <select
              value={salesType}
              onChange={(e) => setSalesType(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              <option value=""></option>
              {SALES_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">화폐</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              <option value=""></option>
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">환율</label>
            <input
              type="text"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={exchangeRate}
              onChange={(e) => handleExchangeRateChange(e.target.value)}
              placeholder="예: 1350"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">환산금액</label>
            <input
              type="text"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={convertedAmount}
              onChange={(e) => handleConvertedAmountChange(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">샘플구분</label>
            <input
              type="text"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={sampleType}
              onChange={(e) => setSampleType(e.target.value)}
              placeholder="예: 일반, 무상Sample"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">MO-번호</label>
            <input
              type="text"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={moNo}
              onChange={(e) => setMoNo(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">비고</label>
            <input
              type="text"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 shrink-0">
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="px-3.5 py-2 rounded-md text-sm font-medium border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
          >
            {deleting ? "삭제 중..." : "삭제"}
          </button>
          <div className="flex items-center gap-2">
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
