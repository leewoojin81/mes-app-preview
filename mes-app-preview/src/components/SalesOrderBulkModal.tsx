"use client";

import { useMemo, useRef, useState } from "react";
import CustomerSearchSelect from "@/components/CustomerSearchSelect";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { Customer, Item } from "@/lib/types";

type ColKey =
  | "item_group"
  | "rep_code"
  | "item_code"
  | "item_name"
  | "sales_type"
  | "currency"
  | "qty"
  | "sample_type"
  | "unit_price"
  | "amount"
  | "converted_amount"
  | "due_date"
  | "customer_code"
  | "customer_name"
  | "status"
  | "remark"
  | "mo_no";

interface BulkColumn {
  key: ColKey;
  label: string;
  width: number;
  readOnly: boolean;
}

const SALES_TYPE_OPTIONS = ["국내", "Local", "직수출"];
const CURRENCY_OPTIONS = ["KRW", "USD", "CNY", "JPY", "EUR"];
const SAMPLE_TYPE_OPTIONS = ["일반", "무상샘플", "유상샘플"];

// 캡쳐 참고 ERP 대량등록 화면과 동일한 컬럼 구성/순서.
// 화폐는 그리드 컬럼이 아니라 상단(전표 헤더)에서만 일괄 설정한다. 매출구분은 헤더에서
// 값을 고르면 전체 행에 일괄 반영되지만, 그리드에도 컬럼으로 표시해 행별로 개별 수정할 수 있다.
const BULK_COLUMNS: BulkColumn[] = [
  { key: "item_group", label: "품목군", width: 90, readOnly: false },
  { key: "rep_code", label: "대표코드", width: 100, readOnly: false },
  { key: "item_code", label: "품목코드", width: 130, readOnly: false },
  { key: "item_name", label: "품목정보", width: 220, readOnly: false },
  { key: "qty", label: "수량", width: 70, readOnly: false },
  { key: "sample_type", label: "샘플구분", width: 90, readOnly: false },
  { key: "sales_type", label: "매출구분", width: 90, readOnly: false },
  { key: "unit_price", label: "단가", width: 80, readOnly: false },
  { key: "amount", label: "금액", width: 100, readOnly: true },
  { key: "converted_amount", label: "환산금액", width: 100, readOnly: false },
  { key: "due_date", label: "납품일자", width: 100, readOnly: false },
  { key: "customer_code", label: "납품처", width: 90, readOnly: false },
  { key: "customer_name", label: "납품처명", width: 140, readOnly: false },
  { key: "status", label: "상태", width: 70, readOnly: false },
  { key: "remark", label: "비고", width: 140, readOnly: false },
  { key: "mo_no", label: "MO-번호", width: 110, readOnly: false },
];

type BulkRow = Record<ColKey, string> & { id: number };

function emptyRow(id: number, overrides: Partial<BulkRow> = {}): BulkRow {
  return {
    id,
    item_group: "",
    rep_code: "",
    item_code: "",
    item_name: "",
    sales_type: "",
    currency: "",
    qty: "",
    sample_type: "",
    unit_price: "",
    amount: "",
    converted_amount: "",
    due_date: "",
    customer_code: "",
    customer_name: "",
    status: "",
    remark: "",
    mo_no: "",
    ...overrides,
  };
}

const INITIAL_ROWS = 15;

// 엑셀에서 복사한 숫자는 천단위 콤마가 붙어 있는 경우가 많다("1,000") — 그대로 Number()에
// 넘기면 NaN이 되어 금액 계산·유효성 검사가 실패하므로, 계산/검증 시에는 콤마와 공백을 제거하고 파싱한다.
function parseNum(value: string): number {
  return Number(value.replace(/,/g, "").trim());
}

// 품목코드에서 마지막 "-XXXX"(색상/옵션 등 세부 구분) 세그먼트를 뗀 대표코드.
// 예: "59A11-001-0275" -> "59A11-001"
function repCodeFromItemCode(item_code: string): string {
  const parts = item_code.split("-");
  return parts.length > 1 ? parts.slice(0, -1).join("-") : item_code;
}

// 수량×단가(금액)를 계산한다. recompute()와 환율 일괄 적용에서 공통으로 쓴다.
function rowAmount(row: Pick<BulkRow, "qty" | "unit_price">): number | null {
  const qty = parseNum(row.qty);
  const price = parseNum(row.unit_price);
  return row.qty && row.unit_price && Number.isFinite(qty) && Number.isFinite(price)
    ? qty * price
    : null;
}

export default function SalesOrderBulkModal({
  items,
  customers,
  onClose,
  onSaved,
}: {
  items: Item[];
  customers: Customer[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const nextId = useRef(INITIAL_ROWS);
  const [rows, setRows] = useState<BulkRow[]>(() =>
    Array.from({ length: INITIAL_ROWS }, (_, i) => emptyRow(i))
  );
  // 환산금액을 사용자가 직접 수정한 행은 환율이 바뀌어도 자동 재계산으로 덮어쓰지 않는다.
  const manualConvertedAmountIds = useRef<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const drag = useDraggableModal();

  // 전표 상단 공통 항목. 수주일자는 등록되는 모든 건에 공통으로 적용되는 값(그리드 컬럼이 아님)이고,
  // 나머지는 값을 채우면 아래 모든 행(및 새로 추가되는 행)에 그대로 적용된다.
  const [headerOrderDate, setHeaderOrderDate] = useState("");
  const [headerCustomerCode, setHeaderCustomerCode] = useState("");
  const [headerMoNo, setHeaderMoNo] = useState("");
  const [headerSalesType, setHeaderSalesType] = useState("");
  const [headerSampleType, setHeaderSampleType] = useState("");
  const [headerUnitPrice, setHeaderUnitPrice] = useState("");
  const [headerCurrency, setHeaderCurrency] = useState("");
  const [headerRemark, setHeaderRemark] = useState("");
  const [headerDueDate, setHeaderDueDate] = useState("");
  const [headerExchangeRate, setHeaderExchangeRate] = useState("");

  const itemByCode = useMemo(() => new Map(items.map((it) => [it.item_code, it])), [items]);
  const customerByCode = useMemo(
    () => new Map(customers.map((c) => [c.customer_code, c])),
    [customers]
  );
  const headerCustomerName = customerByCode.get(headerCustomerCode.trim())?.customer_name ?? "";

  function headerOverrides(): Partial<BulkRow> {
    return {
      customer_code: headerCustomerCode,
      customer_name: headerCustomerName,
      mo_no: headerMoNo,
      sales_type: headerSalesType,
      sample_type: headerSampleType,
      unit_price: headerUnitPrice,
      currency: headerCurrency,
      remark: headerRemark,
      due_date: headerDueDate,
    };
  }

  // 품목코드→품목군/대표코드/품목정보, 납품처(코드)→납품처명 자동 채움 + 수량×단가 금액 자동 계산.
  // 환산금액(금액×환율)도 여기서 함께 갱신한다 — 행 내용이 바뀌거나(붙여넣기 포함) 헤더 환율이
  // 바뀔 때마다 항상 최신 금액 기준으로 다시 계산되어야, 환율을 먼저 넣고 나중에 엑셀을 붙여넣어도
  // 환산금액이 채워진다. 단, 사용자가 환산금액을 직접 수정한 행은 덮어쓰지 않는다.
  function recompute(list: BulkRow[]): BulkRow[] {
    return recomputeWithRate(list, headerExchangeRate);
  }

  // exchangeRateStr을 인자로 받는 이유: 환율 입력값이 바뀌는 바로 그 이벤트 핸들러 안에서는
  // headerExchangeRate state가 아직 새 값으로 갱신되기 전이라(리렌더 전), recompute()가 참조하는
  // 클로저 값이 한 박자 뒤처진다. 방금 입력한 값을 즉시 반영하려면 그 값을 직접 넘겨야 한다.
  function recomputeWithRate(list: BulkRow[], exchangeRateStr: string): BulkRow[] {
    const rate = parseNum(exchangeRateStr);
    const hasRate = exchangeRateStr.trim() !== "" && Number.isFinite(rate);
    return list.map((row) => {
      const computedAmount = rowAmount(row);
      const amount = computedAmount != null ? String(computedAmount) : "";
      const itemCode = row.item_code.trim();
      const item = itemByCode.get(itemCode);
      const customer = customerByCode.get(row.customer_code.trim());
      const converted_amount =
        hasRate && computedAmount != null && !manualConvertedAmountIds.current.has(row.id)
          ? String(Math.round(computedAmount * rate))
          : row.converted_amount;
      return {
        ...row,
        amount,
        converted_amount,
        item_name: item ? item.item_name : row.item_name,
        item_group: item?.item_group != null ? String(item.item_group) : row.item_group,
        rep_code: itemCode ? repCodeFromItemCode(itemCode) : row.rep_code,
        customer_name: customer ? customer.customer_name : row.customer_name,
      };
    });
  }

  function updateCell(rowIndex: number, key: ColKey, value: string) {
    if (key === "converted_amount") {
      manualConvertedAmountIds.current.add(rows[rowIndex].id);
    }
    setRows((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [key]: value };
      return recompute(next);
    });
  }

  function addRows(n: number) {
    const overrides = headerOverrides();
    setRows((prev) => [
      ...prev,
      ...Array.from({ length: n }, () => emptyRow(nextId.current++, overrides)),
    ]);
  }

  function removeRow(rowIndex: number) {
    setRows((prev) => prev.filter((_, i) => i !== rowIndex));
  }

  function clearAll() {
    manualConvertedAmountIds.current.clear();
    setHeaderOrderDate("");
    setHeaderCustomerCode("");
    setHeaderMoNo("");
    setHeaderSalesType("");
    setHeaderSampleType("");
    setHeaderUnitPrice("");
    setHeaderCurrency("");
    setHeaderRemark("");
    setHeaderDueDate("");
    setHeaderExchangeRate("");
    nextId.current = INITIAL_ROWS;
    setRows(Array.from({ length: INITIAL_ROWS }, (_, i) => emptyRow(i)));
    setResult(null);
    setError(null);
  }

  // 전표 상단 항목이 바뀌면 이미 입력된 모든 행에도 즉시 반영한다.
  function updateHeaderCustomerCode(value: string) {
    setHeaderCustomerCode(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, customer_code: value }))));
  }
  function updateHeaderMoNo(value: string) {
    setHeaderMoNo(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, mo_no: value }))));
  }
  function updateHeaderSalesType(value: string) {
    setHeaderSalesType(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, sales_type: value }))));
  }
  function updateHeaderSampleType(value: string) {
    setHeaderSampleType(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, sample_type: value }))));
  }
  function updateHeaderUnitPrice(value: string) {
    setHeaderUnitPrice(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, unit_price: value }))));
  }
  function updateHeaderCurrency(value: string) {
    setHeaderCurrency(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, currency: value }))));
  }
  function updateHeaderRemark(value: string) {
    setHeaderRemark(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, remark: value }))));
  }
  function updateHeaderDueDate(value: string) {
    setHeaderDueDate(value);
    setRows((prev) => recompute(prev.map((r) => ({ ...r, due_date: value }))));
  }
  function updateHeaderExchangeRate(value: string) {
    setHeaderExchangeRate(value);
    setRows((prev) => recomputeWithRate(prev, value));
  }

  // 엑셀에서 복사한 탭/줄바꿈 구분 데이터를 붙여넣은 셀 위치를 기준으로 표에 그대로 채운다.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();

    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

    const overrides = headerOverrides();
    setRows((prev) => {
      const next = [...prev];
      const neededLength = rowIndex + lines.length;
      while (next.length < neededLength) next.push(emptyRow(nextId.current++, overrides));

      lines.forEach((line, ri) => {
        const cells = line.split("\t");
        const targetRow = rowIndex + ri;
        const updated = { ...next[targetRow] };
        cells.forEach((cell, ci) => {
          const col = BULK_COLUMNS[colIndex + ci];
          if (!col || col.readOnly) return;
          if (col.key === "converted_amount") manualConvertedAmountIds.current.add(next[targetRow].id);
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
      setError("등록할 행이 없습니다. 거래처/품목코드/수량을 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const payload = validRows.map((r) => ({
        item_group: r.item_group || null,
        rep_code: r.rep_code || null,
        item_code: r.item_code,
        sales_type: r.sales_type || null,
        currency: r.currency || null,
        qty: parseNum(r.qty),
        sample_type: r.sample_type || null,
        unit_price: r.unit_price ? parseNum(r.unit_price) : null,
        converted_amount: r.converted_amount ? parseNum(r.converted_amount) : null,
        due_date: r.due_date || null,
        customer_code: r.customer_code,
        status: r.status || null,
        remark: r.remark || null,
        mo_no: r.mo_no || null,
        order_date: headerOrderDate || null,
        exchange_rate: headerExchangeRate ? parseNum(headerExchangeRate) : null,
      }));
      const res = await fetch("/api/sales-orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "등록에 실패했습니다.");
      if (data.inserted > 0) {
        onSaved(
          `${data.inserted.toLocaleString()}건이 등록되었습니다.` +
            (data.skipped > 0 ? ` (건너뜀 ${data.skipped.toLocaleString()}건)` : "")
        );
        // 저장 후에도 창이 닫히지 않으므로, 다음 건을 이어서 입력할 수 있도록
        // 그리드를 빈 상태로 초기화한다(같은 행을 실수로 다시 저장하는 것도 방지).
        // clearAll()이 result/error도 함께 지우므로, 저장 결과 배너는 그 다음에 다시 세팅한다.
        clearAll();
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록에 실패했습니다.");
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
            <h2 className="text-base font-bold text-navy">수주 일괄등록</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              엑셀에서 표를 복사(Ctrl+C)한 뒤 첫 셀을 클릭하고 붙여넣기(Ctrl+V) 하면 여러 행이 한 번에 채워집니다.
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

        {result && (
          <div
            className={`mx-5 mt-4 rounded-md border px-4 py-3 text-sm flex items-start gap-2 ${
              result.skipped > 0
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-emerald-50 border-emerald-200 text-emerald-800"
            }`}
          >
            <span className="text-base leading-none">{result.skipped > 0 ? "⚠" : "✓"}</span>
            <div className="flex-1">
              <p className="font-semibold">
                저장 완료 — 등록 {result.inserted.toLocaleString()}건
                {result.skipped > 0 && `, 건너뜀 ${result.skipped.toLocaleString()}건`}
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-1.5 list-disc list-inside space-y-0.5 text-xs">
                  {result.errors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-xs opacity-60 hover:opacity-100"
              aria-label="알림 닫기"
            >
              ×
            </button>
          </div>
        )}

        <div className="relative z-20 flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 shrink-0 flex-wrap">
          <button
            onClick={() => addRows(10)}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-slate-300 bg-white hover:border-navy"
          >
            + 10행 추가
          </button>
          <button
            onClick={clearAll}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-slate-300 bg-white hover:border-rose-400 text-rose-600"
          >
            전체 초기화
          </button>
          <div className="w-px self-stretch bg-slate-200 mx-1" />
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">수주일자</label>
            <input
              type="date"
              value={headerOrderDate}
              onChange={(e) => setHeaderOrderDate(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500 shrink-0">납품처</label>
            <div className="w-48">
              <CustomerSearchSelect
                customers={customers}
                value={headerCustomerCode}
                onChange={updateHeaderCustomerCode}
                placeholder="거래처코드 또는 거래처명"
              />
            </div>
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
            <label className="text-xs text-slate-500">샘플구분</label>
            <select
              value={headerSampleType}
              onChange={(e) => updateHeaderSampleType(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white"
            >
              <option value=""></option>
              {SAMPLE_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">단가</label>
            <input
              type="text"
              value={headerUnitPrice}
              onChange={(e) => updateHeaderUnitPrice(e.target.value)}
              placeholder="예: 1000"
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs w-20"
            />
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
            <label className="text-xs text-slate-500">납품일자</label>
            <input
              type="date"
              value={headerDueDate}
              onChange={(e) => updateHeaderDueDate(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-xs"
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
                {BULK_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="border border-slate-200 px-1 py-1.5 font-semibold text-slate-600"
                    style={{ minWidth: col.width }}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="border border-slate-200 px-1 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="border border-slate-200 px-1 text-center text-slate-400">
                    {rowIndex + 1}
                  </td>
                  {BULK_COLUMNS.map((col, colIndex) => {
                    // 단가×수량 계산값(금액)은 화폐(헤더에서 설정) 단위를 붙여 표시한다.
                    // 환산금액도 천단위 콤마를 붙여 표시한다(입력값 자체는 parseNum이 콤마를 제거하고 읽으므로
                    // 사용자가 그대로 수정해도 계산/저장에는 영향이 없다).
                    const displayValue =
                      col.key === "amount"
                        ? row.amount
                          ? `${Number(row.amount).toLocaleString()}${row.currency ? ` ${row.currency}` : ""}`
                          : ""
                        : col.key === "converted_amount"
                        ? row.converted_amount.trim() !== "" &&
                          Number.isFinite(parseNum(row.converted_amount))
                          ? Number(parseNum(row.converted_amount)).toLocaleString()
                          : row.converted_amount
                        : row[col.key];
                    if (col.key === "sample_type" || col.key === "sales_type") {
                      const options =
                        col.key === "sample_type" ? SAMPLE_TYPE_OPTIONS : SALES_TYPE_OPTIONS;
                      return (
                        <td key={col.key} className="border border-slate-200 p-0">
                          <select
                            value={row[col.key]}
                            onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                            className="w-full px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-white"
                          >
                            <option value=""></option>
                            {options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} className="border border-slate-200 p-0">
                        <input
                          value={displayValue}
                          readOnly={col.readOnly}
                          onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                          onPaste={(e) => handlePaste(e, rowIndex, colIndex)}
                          className={`w-full px-1.5 py-1 text-xs outline-none focus:bg-blue-50 ${
                            col.readOnly
                              ? "bg-slate-50 text-slate-500 text-right"
                              : ""
                          }`}
                        />
                      </td>
                    );
                  })}
                  <td className="border border-slate-200 text-center">
                    <button
                      onClick={() => removeRow(rowIndex)}
                      className="text-slate-300 hover:text-rose-500 px-1"
                      aria-label="행 삭제"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 shrink-0 bg-slate-50">
          <div className="text-sm text-slate-600">
            총 <span className="font-semibold text-navy">{totalCount.toLocaleString()}</span>건 · 합계 금액{" "}
            <span className="font-semibold text-navy">
              {totalAmount.toLocaleString()}
              {headerCurrency ? ` ${headerCurrency}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
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
