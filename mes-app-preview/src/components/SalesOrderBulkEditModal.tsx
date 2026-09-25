"use client";

import { useMemo, useRef, useState } from "react";
import CustomerSearchSelect from "@/components/CustomerSearchSelect";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { Customer, Item, SalesOrder } from "@/lib/types";

type ColKey =
  | "so_no"
  | "customer_code"
  | "customer_name"
  | "item_code"
  | "item_name"
  | "qty"
  | "unit_price"
  | "amount"
  | "exchange_rate"
  | "converted_amount"
  | "sales_type"
  | "currency"
  | "due_date"
  | "order_date"
  | "sample_type"
  | "status"
  | "mo_no"
  | "remark";

interface Column {
  key: ColKey;
  label: string;
  width: number;
  readOnly: boolean;
  options?: string[];
}

const SALES_TYPE_OPTIONS = ["국내", "Local", "직수출"];
const CURRENCY_OPTIONS = ["KRW", "USD", "CNY", "JPY", "EUR"];
const STATUS_OPTIONS = ["수주", "Packing", "출고", "완료", "중단"];

// 수주등록 그리드(SalesOrderBulkModal)와 같은 순서 감각을 유지하되, 이미 존재하는 행을
// 다루므로 수주번호를 식별자로 맨 앞에 고정 표시(읽기전용)한다. 대량등록과 달리 행마다
// 값이 다를 수 있어(수정 대상 건들이 서로 다른 매출구분/화폐/상태일 수 있음) 별도 헤더
// 없이 셀 단위 드롭다운으로 제공한다.
const COLUMNS: Column[] = [
  { key: "so_no", label: "수주번호", width: 130, readOnly: true },
  { key: "customer_code", label: "납품처", width: 90, readOnly: false },
  { key: "customer_name", label: "납품처명", width: 140, readOnly: false },
  { key: "item_code", label: "품목코드", width: 130, readOnly: false },
  { key: "item_name", label: "품목정보", width: 220, readOnly: false },
  { key: "qty", label: "수량", width: 70, readOnly: false },
  { key: "unit_price", label: "단가", width: 80, readOnly: false },
  { key: "amount", label: "금액", width: 100, readOnly: true },
  { key: "exchange_rate", label: "환율", width: 70, readOnly: false },
  { key: "converted_amount", label: "환산금액", width: 100, readOnly: false },
  { key: "sales_type", label: "매출구분", width: 90, readOnly: false, options: SALES_TYPE_OPTIONS },
  { key: "currency", label: "화폐", width: 80, readOnly: false, options: CURRENCY_OPTIONS },
  { key: "due_date", label: "납품일자", width: 100, readOnly: false },
  { key: "order_date", label: "수주일자", width: 100, readOnly: false },
  { key: "sample_type", label: "샘플구분", width: 90, readOnly: false },
  { key: "status", label: "상태", width: 70, readOnly: false, options: STATUS_OPTIONS },
  { key: "mo_no", label: "MO-번호", width: 110, readOnly: false },
  { key: "remark", label: "비고", width: 140, readOnly: false },
];

type EditRow = Record<ColKey, string>;

function toRow(so: SalesOrder): EditRow {
  return {
    so_no: so.so_no,
    customer_code: so.customer_code,
    customer_name: so.customer_name,
    item_code: so.item_code,
    item_name: so.item_name,
    qty: String(so.order_qty),
    unit_price: so.unit_price != null ? String(so.unit_price) : "",
    amount: so.unit_price != null ? String(so.order_qty * so.unit_price) : "",
    exchange_rate: so.detail?.["환율"] != null ? String(so.detail["환율"]) : "",
    converted_amount: so.detail?.["환산금액"] != null ? String(so.detail["환산금액"]) : "",
    sales_type: String(so.detail?.["매출구분"] ?? ""),
    currency: String(so.detail?.["화폐"] ?? ""),
    due_date: so.due_date ?? "",
    order_date: String(so.detail?.["수주일자"] ?? "").replace(/\./g, "-"),
    sample_type: String(so.detail?.["샘플구분"] ?? ""),
    status: String(so.detail?.["상태"] ?? so.status),
    mo_no: String(so.detail?.["MO-번호"] ?? ""),
    remark: String(so.detail?.["비고"] ?? ""),
  };
}

// 엑셀에서 복사한 숫자는 천단위 콤마가 붙어 있는 경우가 많다("1,000") — 계산/검증 시
// 콤마와 공백을 제거하고 파싱한다.
function parseNum(value: string): number {
  return Number(value.replace(/,/g, "").trim());
}

export default function SalesOrderBulkEditModal({
  orders,
  items,
  customers,
  onClose,
  onSaved,
}: {
  orders: SalesOrder[];
  items: Item[];
  customers: Customer[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [rows, setRows] = useState<EditRow[]>(() => orders.map(toRow));
  // 환산금액을 사용자가 직접 수정한 행(so_no)은 수량/단가/환율이 바뀌어도 자동 재계산으로 덮어쓰지 않는다.
  const manualConvertedAmountSoNos = useRef<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    updated: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const drag = useDraggableModal();

  // 전표 상단 일괄 적용 항목. 값을 채우면 현재 그리드에 로드된 모든 행에 즉시 반영된다
  // ("전체로 수정") — 여러 줄이 한 수주번호를 공유하는 경우 한 번에 값을 맞출 때 쓴다.
  const [headerCustomerCode, setHeaderCustomerCode] = useState("");
  const [headerSalesType, setHeaderSalesType] = useState("");
  const [headerCurrency, setHeaderCurrency] = useState("");
  const [headerExchangeRate, setHeaderExchangeRate] = useState("");
  const [headerStatus, setHeaderStatus] = useState("");
  const [headerDueDate, setHeaderDueDate] = useState("");
  const [headerMoNo, setHeaderMoNo] = useState("");
  const [headerRemark, setHeaderRemark] = useState("");

  const itemByCode = useMemo(() => new Map(items.map((it) => [it.item_code, it])), [items]);
  const customerByCode = useMemo(
    () => new Map(customers.map((c) => [c.customer_code, c])),
    [customers]
  );
  const headerCustomerName = customerByCode.get(headerCustomerCode.trim())?.customer_name ?? "";

  function recompute(list: EditRow[]): EditRow[] {
    return list.map((row) => {
      const qty = parseNum(row.qty);
      const price = parseNum(row.unit_price);
      const rate = parseNum(row.exchange_rate);
      const amount =
        row.qty && row.unit_price && Number.isFinite(qty) && Number.isFinite(price)
          ? String(qty * price)
          : "";
      const converted_amount =
        row.qty &&
        row.unit_price &&
        row.exchange_rate &&
        Number.isFinite(qty) &&
        Number.isFinite(price) &&
        Number.isFinite(rate) &&
        !manualConvertedAmountSoNos.current.has(row.so_no)
          ? String(Math.round(qty * price * rate))
          : row.converted_amount;
      const item = itemByCode.get(row.item_code.trim());
      const customer = customerByCode.get(row.customer_code.trim());
      return {
        ...row,
        amount,
        converted_amount,
        item_name: item ? item.item_name : row.item_name,
        customer_name: customer ? customer.customer_name : row.customer_name,
      };
    });
  }

  function updateCell(rowIndex: number, key: ColKey, value: string) {
    if (key === "converted_amount") {
      manualConvertedAmountSoNos.current.add(rows[rowIndex].so_no);
    }
    setRows((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [key]: value };
      return recompute(next);
    });
  }

  // 전표 상단 항목이 바뀌면 현재 그리드의 모든 행에 즉시 반영한다.
  function updateHeaderCustomerCode(value: string) {
    setHeaderCustomerCode(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, customer_code: value }))));
  }
  function updateHeaderSalesType(value: string) {
    setHeaderSalesType(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, sales_type: value }))));
  }
  function updateHeaderCurrency(value: string) {
    setHeaderCurrency(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, currency: value }))));
  }
  function updateHeaderExchangeRate(value: string) {
    setHeaderExchangeRate(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, exchange_rate: value }))));
  }
  function updateHeaderStatus(value: string) {
    setHeaderStatus(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, status: value }))));
  }
  function updateHeaderDueDate(value: string) {
    setHeaderDueDate(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, due_date: value }))));
  }
  function updateHeaderMoNo(value: string) {
    setHeaderMoNo(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, mo_no: value }))));
  }
  function updateHeaderRemark(value: string) {
    setHeaderRemark(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, remark: value }))));
  }

  // 엑셀에서 복사한 탭/줄바꿈 구분 데이터를 붙여넣은 셀 위치를 기준으로 표에 그대로 채운다.
  // 행은 이미 존재하는 것만 다루므로(신규 행 추가 없음) 붙여넣기 범위가 표를 벗어나면 자른다.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();

    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

    setRows((prev) => {
      const next = [...prev];
      lines.forEach((line, ri) => {
        const targetRow = rowIndex + ri;
        if (targetRow >= next.length) return;
        const cells = line.split("\t");
        const updated = { ...next[targetRow] };
        cells.forEach((cell, ci) => {
          const col = COLUMNS[colIndex + ci];
          if (!col || col.readOnly) return;
          if (col.key === "converted_amount") {
            manualConvertedAmountSoNos.current.add(next[targetRow].so_no);
          }
          updated[col.key] = cell.trim();
        });
        next[targetRow] = updated;
      });
      return recompute(next);
    });
  }

  const validRows = rows.filter(
    (r) => r.customer_code.trim() && r.item_code.trim() && parseNum(r.qty) > 0
  );
  const totalCount = validRows.length;
  const totalAmount = validRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  async function handleSave() {
    setError(null);
    setResult(null);
    if (totalCount === 0) {
      setError("수정할 행이 없습니다. 거래처/품목코드/수량을 확인해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const payload = validRows.map((r) => ({
        so_no: r.so_no,
        customer_code: r.customer_code,
        item_code: r.item_code,
        qty: Number(r.qty),
        unit_price: r.unit_price ? Number(r.unit_price) : null,
        exchange_rate: r.exchange_rate ? parseNum(r.exchange_rate) : null,
        converted_amount: r.converted_amount ? parseNum(r.converted_amount) : null,
        due_date: r.due_date || null,
        status: r.status || null,
        order_date: r.order_date || null,
        sales_type: r.sales_type || null,
        currency: r.currency || null,
        sample_type: r.sample_type || null,
        mo_no: r.mo_no || null,
        remark: r.remark || null,
      }));
      const res = await fetch("/api/sales-orders/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "수정에 실패했습니다.");
      setResult(data);
      if (data.updated > 0) onSaved(`${data.updated}건이 수정되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-[95vw] max-h-[90vh] flex flex-col"
        style={drag.style}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <div>
            <h2 className="text-base font-bold text-navy">수주 일괄수정</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              선택한 {orders.length.toLocaleString()}건을 그리드에서 직접 고치거나, 엑셀에서 복사한 값을
              셀에 붙여넣어(Ctrl+V) 한 번에 반영할 수 있습니다. 상단 &quot;전체 적용&quot; 항목은 값을 채우는
              즉시 모든 행에 반영됩니다. 수주번호는 변경할 수 없습니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="relative z-20 flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 shrink-0 flex-wrap">
          <span className="text-xs text-slate-400">전체 적용:</span>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500 shrink-0">납품처</label>
            <div className="w-44">
              <CustomerSearchSelect
                customers={customers}
                value={headerCustomerCode}
                onChange={updateHeaderCustomerCode}
                placeholder="거래처코드 또는 거래처명"
              />
            </div>
          </div>
          {headerCustomerName && (
            <span className="text-xs text-slate-400">({headerCustomerName})</span>
          )}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">매출구분</label>
            <select
              value={headerSalesType}
              onChange={(e) => updateHeaderSalesType(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            >
              <option value=""></option>
              {SALES_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">화폐</label>
            <select
              value={headerCurrency}
              onChange={(e) => updateHeaderCurrency(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            >
              <option value=""></option>
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">환율</label>
            <input
              type="text"
              value={headerExchangeRate}
              onChange={(e) => updateHeaderExchangeRate(e.target.value)}
              placeholder="예: 1350"
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs w-20"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">상태</label>
            <select
              value={headerStatus}
              onChange={(e) => updateHeaderStatus(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            >
              <option value=""></option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">납품일자</label>
            <input
              type="date"
              value={headerDueDate}
              onChange={(e) => updateHeaderDueDate(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">MO-번호</label>
            <input
              type="text"
              value={headerMoNo}
              onChange={(e) => updateHeaderMoNo(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs w-28"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">비고</label>
            <input
              type="text"
              value={headerRemark}
              onChange={(e) => updateHeaderRemark(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs w-32"
            />
          </div>
          {error && <p className="text-sm text-rose-600 ml-2">{error}</p>}
        </div>

        <div className="flex-1 overflow-auto px-5">
          <table className="text-xs border-collapse w-full">
            <thead className="bg-[#D9E1F2] sticky top-0 z-10">
              <tr>
                <th className="border border-slate-200 px-1 py-1.5 w-8 text-slate-500">#</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="border border-slate-200 px-1 py-1.5 font-semibold text-slate-600"
                    style={{ minWidth: col.width }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row.so_no} className="hover:bg-slate-50">
                  <td className="border border-slate-200 px-1 text-center text-slate-400">
                    {rowIndex + 1}
                  </td>
                  {COLUMNS.map((col, colIndex) =>
                    col.options ? (
                      <td key={col.key} className="border border-slate-200 p-0">
                        <select
                          value={row[col.key]}
                          onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                          className="w-full px-1 py-1 text-xs outline-none bg-white focus:bg-blue-50"
                        >
                          <option value=""></option>
                          {col.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : (
                      <td key={col.key} className="border border-slate-200 p-0">
                        <input
                          value={row[col.key]}
                          readOnly={col.readOnly}
                          onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                          onPaste={(e) => handlePaste(e, rowIndex, colIndex)}
                          className={`w-full px-1.5 py-1 text-xs outline-none focus:bg-blue-50 ${
                            col.readOnly ? "bg-slate-50 text-slate-500" : ""
                          } ${col.key === "amount" ? "text-right" : ""}`}
                        />
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 shrink-0 bg-slate-50">
          <div className="text-sm text-slate-600">
            총 <span className="font-semibold text-navy">{totalCount.toLocaleString()}</span>건 · 합계 금액{" "}
            <span className="font-semibold text-navy">{totalAmount.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <p className="text-sm text-slate-600">
                수정 {result.updated.toLocaleString()}건
                {result.skipped > 0 && `, 건너뜀 ${result.skipped.toLocaleString()}건`}
              </p>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              닫기
            </button>
            <button
              onClick={handleSave}
              disabled={saving || totalCount === 0}
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
