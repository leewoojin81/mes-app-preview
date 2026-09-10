"use client";

import { useEffect, useMemo, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import StockCheckModal from "@/components/StockCheckModal";
import { useTabState } from "@/lib/use-tab-state";
import { priorityCell, type PriorityRow } from "@/lib/production-priority-columns";
import type { Process } from "@/lib/types";

const SHIFTS = ["주간", "야간"] as const;
type Shift = (typeof SHIFTS)[number];

// PROD-04에서 발행하는 작업지시는 전부 조립 공정이라 라인 선택 없이 고정값을 쓴다.
// 설비등록(BASE-05)에서 실제 쓰는 라인 코드("조립라인"/"사출라인"/"착색라인") 중 하나.
const FIXED_LINE_ID = "조립라인";

// 직행율 = 공정등록(BASE-04)에서 P300~P410 구간, 사용여부 "사용"인 공정들의
// 기본 생산수율을 전부 곱한 값. 후공정(조립~출하포장) 전체를 통과할 확률이라
// 공정 하나라도 수율이 낮으면 전체 직행율도 같이 낮아진다.
const STRAIGHT_YIELD_RANGE: [string, string] = ["P300", "P410"];

function computeStraightYield(processes: Process[]): number | null {
  const used = processes.filter(
    (p) =>
      p.process_code >= STRAIGHT_YIELD_RANGE[0] &&
      p.process_code <= STRAIGHT_YIELD_RANGE[1] &&
      p.use_yn === "Y"
  );
  if (used.length === 0) return null;
  const rate = used.reduce(
    (acc, p) => acc * (p.default_yield_rate != null ? p.default_yield_rate / 100 : 1),
    1
  );
  return rate * 100;
}

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 자정 근처에 날짜가 밀릴 수 있음)
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function currentYearStart(): string {
  const now = new Date();
  return toLocalDateStr(new Date(now.getFullYear(), 0, 1));
}
function today(): string {
  return toLocalDateStr(new Date());
}

// 대표품목 — 품목코드가 "대표코드-도수"(대시 2개, 예: 70A61-001-0225) 형태면
// 마지막 도수 접미사를 뗀 대표코드(70A61-001)를, 이미 대표코드(대시 1개 이하)면
// 품목코드 그대로 돌려준다. item-filters.ts의 "대표품목" 판별 규칙과 짝을 이룬다.
function repItemCode(itemCode: string): string {
  const parts = itemCode.split("-");
  return parts.length >= 3 ? parts.slice(0, 2).join("-") : itemCode;
}

// 조립공정표발행 최소단위 — 계획수량은 이 배수로만 발행할 수 있다.
const PLAN_QTY_UNIT = 60;

// 계획수량 = 수주수량 ÷ 직행율. 공정을 지나며 생기는 손실(직행율)만큼 더 투입해야
// 수주수량을 채울 수 있고, 그 값을 조립공정표발행 최소단위(60개) 배수로 올림한다.
function planQty(orderQty: number, straightYield: number | null): number | null {
  if (straightYield == null || straightYield <= 0) return null;
  const raw = orderQty / (straightYield / 100);
  return Math.ceil(raw / PLAN_QTY_UNIT) * PLAN_QTY_UNIT;
}

export default function ProcessSchedulePage() {
  const [rows, setRows] = useState<PriorityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // 탭을 전환했다 돌아와도 조회 조건은 유지되도록 세션 단위로 저장한다.
  // 필터 없이 열면 전체 확정 수주가 대상이 되므로 기본은 당해년도 1월 1일부터로 좁힌다.
  const [dateFrom, setDateFrom] = useTabState("dateFrom", currentYearStart);
  const [dateTo, setDateTo] = useTabState("dateTo", today);
  const [soNoInput, setSoNoInput] = useTabState("soNoInput", "");
  const [soNo, setSoNo] = useTabState("soNo", "");
  const [itemCodeInput, setItemCodeInput] = useTabState("itemCodeInput", "");
  const [itemCode, setItemCode] = useTabState("itemCode", "");
  const [issueDate, setIssueDate] = useTabState("issueDate", today);
  const [shift, setShift] = useTabState<Shift>("shift", SHIFTS[0]);
  const [straightYield, setStraightYield] = useState<number | null>(null);

  // 직행율은 화면에서 입력받는 값이 아니라 공정등록(BASE-04) 기준정보에서 계산한다.
  useEffect(() => {
    fetch("/api/processes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Process[]) => setStraightYield(computeStraightYield(data)));
  }, []);

  // 행별 지시수량/작업지시비고란 — 화면에서 직접 입력하는 값이라 so_no 기준으로 별도 관리한다.
  // 지시수량은 이번에 공정표로 발행할 수량이고, 발행수량(작지수량)은 지금까지 발행된
  // 지시수량의 누적 합계다 — 계획수량 2,000개를 1,000+1,000으로 나눠 지시하면
  // 발행수량은 2,000이 된다.
  const [directQty, setDirectQty] = useState<Record<string, string>>({});
  // 사용자가 지시수량을 직접 타이핑한 행 — LOT 잔량 자동배분 캐스케이드가 값을 덮어쓰지 않는다.
  const [manualRows, setManualRows] = useState<Set<string>>(new Set());
  const [remark, setRemark] = useState<Record<string, string>>({});

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 행 체크박스를 누른 순서 — 같은 대표품목의 LOT 잔량을 이 순서대로 나눠 배분한다.
  const [checkOrder, setCheckOrder] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);

  const [stockCheckTarget, setStockCheckTarget] = useState<{
    so_no: string;
    repCode: string;
    itemCode: string;
    planQty: number;
  } | null>(null);
  // 대표코드별 착색 반제품 보유 여부(그리드에 바로 뿌리기 위한 일괄 조회) — 상세 필요수량/
  // LOT 목록은 팝업을 열 때 따로 가져온다.
  const [stockSummary, setStockSummary] = useState<Record<string, boolean>>({});
  // 대표코드별로 재고확인 팝업에서 "확인"한 LOT 재고 시뮬레이션 — 잔량 표시는 이 화면
  // 세션 안에서만 계산하고(새로고침하면 초기화), 실제 현재고현황(INV-02) 차감은 저장
  // 시점에 lots(LOT별 id·수량)를 기준으로 딱 그만큼만 반영한다.
  const [lotPools, setLotPools] = useState<
    Record<string, { totalQty: number; unit: string; lots: { id: number; qty: number }[] }>
  >({});

  // 수주번호/품목코드 검색어는 300ms 디바운스 후 실제 조회에 반영
  useEffect(() => {
    const t = setTimeout(() => setSoNo(soNoInput.trim()), 300);
    return () => clearTimeout(t);
  }, [soNoInput, setSoNo]);
  useEffect(() => {
    const t = setTimeout(() => setItemCode(itemCodeInput.trim()), 300);
    return () => clearTimeout(t);
  }, [itemCodeInput, setItemCode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: "1", pageSize: "200" });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (soNo) params.set("soNo", soNo);
    if (itemCode) params.set("itemCode", itemCode);
    fetch(`/api/production-priority?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { rows: PriorityRow[] }) => {
        if (cancelled) return;
        setRows(data.rows);
        setLoading(false);
        setSelected(new Set());
        setCheckOrder([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, soNo, itemCode, refreshKey]);

  // 지시수량 기본값 = 계획수량 - 발행수량(작지수량) = 아직 지시하지 않은 잔량. 직행율이
  // 아직 로딩 전이면(공정등록 조회 중) 채우지 않고 기다렸다가 로딩되면 채운다.
  useEffect(() => {
    if (straightYield == null) return;
    setDirectQty((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.so_no] === undefined) {
          const v = planQty(Number(priorityCell(r, "수주수량") ?? 0), straightYield);
          const issued = Number(priorityCell(r, "작지수량") ?? 0);
          next[r.so_no] = String(v != null ? Math.max(0, v - issued) : 0);
        }
      }
      return next;
    });
  }, [rows, straightYield]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.so_no)), [rows, selected]);

  // so_no → 대표코드 — LOT 잔량 캐스케이드/표시가 여러 곳에서 공유해서 쓴다.
  const repCodeBySoNo = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const code = String(priorityCell(r, "품목코드") ?? "").trim();
      if (code) m.set(r.so_no, repItemCode(code));
    }
    return m;
  }, [rows]);

  // 그리드에 뜬 행들의 대표코드를 모아 재고 보유 여부를 한 번에 조회한다.
  useEffect(() => {
    const repCodes = [...new Set(repCodeBySoNo.values())];
    if (repCodes.length === 0) return;
    let cancelled = false;
    const params = new URLSearchParams({ itemCodes: repCodes.join(",") });
    fetch(`/api/process-schedule/stock-check/summary?${params.toString()}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data: { hasStock: Record<string, boolean> }) => {
        if (cancelled) return;
        setStockSummary((prev) => ({ ...prev, ...data.hasStock }));
      });
    return () => {
      cancelled = true;
    };
  }, [repCodeBySoNo]);

  // LOT 잔량 시뮬레이션 캐스케이드 — 대표코드별로 체크된 행을 체크 순서대로 훑으면서,
  // 사용자가 직접 타이핑하지 않은(수동 아닌) 행에는 "이 행의 계획수량"과 "그 시점까지
  // 남은 LOT 잔량" 중 작은 값을 채운다. 수동으로 고친 행은 그 값 그대로 잔량 계산에서만
  // 차감하고 건너뛴다.
  useEffect(() => {
    if (Object.keys(lotPools).length === 0) return;
    setDirectQty((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const repCode of Object.keys(lotPools)) {
        const pool = lotPools[repCode];
        const filtered = checkOrder.filter((so) => repCodeBySoNo.get(so) === repCode);
        let remaining = pool.totalQty;
        for (const so of filtered) {
          if (manualRows.has(so)) {
            remaining -= Number(next[so] ?? 0);
            continue;
          }
          const row = rows.find((r) => r.so_no === so);
          const planDefault = row
            ? (planQty(Number(priorityCell(row, "수주수량") ?? 0), straightYield) ?? 0)
            : 0;
          const consumed = Math.max(0, Math.min(planDefault, remaining));
          const str = String(consumed);
          if (next[so] !== str) {
            next[so] = str;
            changed = true;
          }
          remaining -= consumed;
        }
      }
      return changed ? next : prev;
    });
  }, [lotPools, checkOrder, manualRows, rows, straightYield, repCodeBySoNo]);

  // 대표코드별 LOT 잔량(선택한 LOT 합계 - 체크된 행들에 지시한 수량 합계).
  const poolRemainingByRepCode = useMemo(() => {
    const out: Record<string, number> = {};
    for (const repCode of Object.keys(lotPools)) {
      const pool = lotPools[repCode];
      const filtered = checkOrder.filter((so) => repCodeBySoNo.get(so) === repCode);
      const consumed = filtered.reduce((sum, so) => sum + Number(directQty[so] ?? 0), 0);
      out[repCode] = Math.max(0, pool.totalQty - consumed);
    }
    return out;
  }, [lotPools, checkOrder, directQty, repCodeBySoNo]);

  // 대표코드별 착색수량 — 재고확인 팝업에서 LOT을 선택해 둔 대표품목의 (지금 발행
  // 확인 화면에 뜬) 행에 한해, 지시수량만큼 그 LOT 재고에서 실제로 소진되는 양의 합이다
  // (LOT 선택을 안 한 행은 재고 확인 없이 지시한 것이라 착색수량에 잡히지 않는다).
  // 저장 시 이 값만큼 각 대표코드의 LOT id들을 순서대로 채워가며 실제 재고를 차감한다.
  const coloredQtyByRepCode = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of selectedRows) {
      const repCode = repCodeBySoNo.get(r.so_no);
      if (repCode && lotPools[repCode]) {
        out[repCode] = (out[repCode] ?? 0) + Number(directQty[r.so_no] ?? 0);
      }
    }
    return out;
  }, [selectedRows, repCodeBySoNo, lotPools, directQty]);

  // 발행 확인/인쇄 화면 표 하단 합계 행.
  const previewTotals = useMemo(() => {
    let orderQtySum = 0;
    let planQtySum = 0;
    let directQtySum = 0;
    let issuedQtySum = 0;
    for (const r of selectedRows) {
      orderQtySum += Number(priorityCell(r, "수주수량") ?? 0);
      const plan = planQty(Number(priorityCell(r, "수주수량") ?? 0), straightYield);
      planQtySum += plan ?? 0;
      directQtySum += Number(directQty[r.so_no] ?? 0);
      issuedQtySum += Number(priorityCell(r, "작지수량") ?? 0);
    }
    const coloredQtySum = Object.values(coloredQtyByRepCode).reduce((a, b) => a + b, 0);
    return { orderQtySum, planQtySum, directQtySum, issuedQtySum, coloredQtySum };
  }, [selectedRows, straightYield, directQty, coloredQtyByRepCode]);

  function toggleRowChecked(so_no: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(so_no);
      else next.delete(so_no);
      return next;
    });
    setCheckOrder((prev) => {
      if (checked) return prev.includes(so_no) ? prev : [...prev, so_no];
      return prev.filter((so) => so !== so_no);
    });
  }

  // 저장(공정표 발행 확정) — 선택된 행마다 실제 work_orders를 생성해 작지수량(발행수량)에
  // 반영되게 하고(작업지시등록(PROD-03)이 쓰는 것과 같은 일괄생성 API), 착색수량만큼
  // 재고확인 팝업에서 선택해 뒀던 LOT의 현재고현황(INV-02) 재고도 실제로 차감한다.
  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveWarnings([]);
    try {
      const payload = {
        rows: selectedRows
          .map((r) => ({
            so_no: r.so_no,
            line_id: FIXED_LINE_ID,
            order_qty: Number(directQty[r.so_no] ?? 0),
            due_date: issueDate || null,
            remark: remark[r.so_no] || null,
          }))
          .filter((r) => r.order_qty > 0),
      };
      if (payload.rows.length === 0) {
        throw new Error("지시수량이 0보다 큰 행이 없습니다.");
      }
      const res = await fetch("/api/work-orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      const warnings: string[] = Array.isArray(data.errors) ? [...data.errors] : [];

      // 대표코드별 착색수량만큼, 선택해 둔 LOT들을 순서대로 채워가며 차감 대상을 만든다.
      const deductions: { id: number; qty: number }[] = [];
      for (const [repCode, coloredQty] of Object.entries(coloredQtyByRepCode)) {
        let remaining = coloredQty;
        if (remaining <= 0) continue;
        for (const lot of lotPools[repCode]?.lots ?? []) {
          if (remaining <= 0) break;
          const take = Math.min(lot.qty, remaining);
          if (take > 0) deductions.push({ id: lot.id, qty: take });
          remaining -= take;
        }
      }
      if (deductions.length > 0) {
        const deductRes = await fetch("/api/process-schedule/stock-check/deduct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deductions }),
        });
        const deductData = await deductRes.json();
        if (!deductRes.ok) {
          warnings.push(deductData.error ?? "착색 반제품 재고 차감에 실패했습니다.");
        } else if (Array.isArray(deductData.errors) && deductData.errors.length > 0) {
          warnings.push(...deductData.errors);
        }
      }

      if (warnings.length > 0) setSaveWarnings(warnings);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // 목록으로 — 저장 전(확인화면 취소)이면 입력값을 그대로 두고 목록만 다시 보여주고,
  // 저장 후(인쇄화면)면 이번 배치 상태를 전부 비우고 최신 발행수량으로 다시 불러온다.
  function backToList() {
    setPreview(false);
    if (saved) {
      setSaved(false);
      setSaveWarnings([]);
      setSelected(new Set());
      setCheckOrder([]);
      setDirectQty({});
      setManualRows(new Set());
      setLotPools({});
      setRefreshKey((k) => k + 1);
    }
  }

  if (preview) {
    return (
      <div className="w-full px-4 sm:px-6 py-6 space-y-6 print:p-6 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
        <div className="flex items-center justify-between print:hidden">
          <div>
            <h1 className="text-xl font-bold text-navy">
              {saved ? "공정표 인쇄" : "공정표 발행 확인"}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {saved
                ? "인쇄 대화상자에서 '대상'을 PDF로 저장하면 PDF로도 저장됩니다."
                : "내용을 확인하고 저장하면 작업지시(work_orders)가 실제로 생성됩니다."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={backToList}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
            >
              목록으로
            </button>
            {saved ? (
              <button
                onClick={() => window.print()}
                className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light transition-colors"
              >
                인쇄
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light transition-colors disabled:opacity-40"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            )}
          </div>
        </div>

        {saveError && (
          <p className="text-sm text-rose-600 print:hidden bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {saveError}
          </p>
        )}
        {saveWarnings.length > 0 && (
          <div className="text-sm text-amber-700 print:hidden bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1">
            <p className="font-medium">일부 항목을 처리하지 못했습니다:</p>
            {saveWarnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5 shadow-sm print:border-0 print:shadow-none">
          <div className="flex items-start justify-between border-b border-slate-200 pb-4">
            <h2 className="text-2xl font-bold text-navy">공정표</h2>
            <div className="text-sm text-slate-600 text-right space-y-1">
              <p>
                발행일자 · <span className="font-mono">{issueDate || "-"}</span>
              </p>
              <p>
                근무조 · <span className="font-medium">{shift}</span>
              </p>
              <p>
                직행율 ·{" "}
                <span className="font-mono">
                  {straightYield != null ? `${straightYield.toFixed(1)}%` : "-"}
                </span>
              </p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-center px-3 py-2.5 font-semibold border-b border-slate-200">No.</th>
                <th className="text-left px-3 py-2.5 font-semibold border-b border-slate-200">대표품목</th>
                <th className="text-left px-3 py-2.5 font-semibold border-b border-slate-200">품목코드</th>
                <th className="text-right px-3 py-2.5 font-semibold border-b border-slate-200">수주수량</th>
                <th className="text-right px-3 py-2.5 font-semibold border-b border-slate-200">계획수량</th>
                <th className="text-right px-3 py-2.5 font-semibold border-b border-slate-200">지시수량</th>
                <th className="text-right px-3 py-2.5 font-semibold border-b border-slate-200">발행수량</th>
                <th className="text-right px-3 py-2.5 font-semibold border-b border-slate-200">착색수량</th>
                <th className="text-left px-3 py-2.5 font-semibold border-b border-slate-200">작업지시비고란</th>
                <th className="text-left px-3 py-2.5 font-semibold border-b border-slate-200">수주번호</th>
                <th className="text-left px-3 py-2.5 font-semibold border-b border-slate-200">순번</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selectedRows.map((r, idx) => (
                <tr key={r.so_no}>
                  <td className="px-3 py-2.5 text-center text-slate-400">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">
                    {repItemCode(String(priorityCell(r, "품목코드") ?? ""))}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-navy">
                    {priorityCell(r, "품목코드")}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {Number(priorityCell(r, "수주수량") ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {(() => {
                      const v = planQty(Number(priorityCell(r, "수주수량") ?? 0), straightYield);
                      return v != null ? v.toLocaleString() : "-";
                    })()}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {Number(directQty[r.so_no] ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {Number(priorityCell(r, "작지수량") ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {(() => {
                      const repCode = repCodeBySoNo.get(r.so_no);
                      const pool = repCode ? lotPools[repCode] : undefined;
                      return pool ? Number(directQty[r.so_no] ?? 0).toLocaleString() : "-";
                    })()}
                  </td>
                  <td className="px-3 py-2.5">{remark[r.so_no] || "-"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-navy">
                    {priorityCell(r, "수주번호")}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{priorityCell(r, "순번") ?? "-"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-semibold">
                <td className="px-3 py-2.5 text-center text-slate-500" colSpan={3}>
                  합계 ({selectedRows.length.toLocaleString()}건)
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-navy">
                  {previewTotals.orderQtySum.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-navy">
                  {previewTotals.planQtySum.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-navy">
                  {previewTotals.directQtySum.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-navy">
                  {previewTotals.issuedQtySum.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-navy">
                  {previewTotals.coloredQtySum.toLocaleString()}
                </td>
                <td className="px-3 py-2.5" colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">공정표발행</h1>
          <p className="text-sm text-slate-500 mt-1">
            PROD-04 · 확정 수주 선택 후 발행일자·근무조를 지정해 공정표를 발행합니다.
          </p>
        </div>
        <button
          onClick={() => setPreview(true)}
          disabled={selected.size === 0}
          className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light transition-colors disabled:opacity-40 disabled:hover:bg-navy"
        >
          공정표 발행{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4 flex-wrap shadow-sm">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">수주일자</label>
          <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput value={dateTo} onChange={setDateTo} />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">수주번호</label>
          <input
            value={soNoInput}
            onChange={(e) => setSoNoInput(e.target.value)}
            placeholder="수주번호 검색"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-40"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">품목코드</label>
          <input
            value={itemCodeInput}
            onChange={(e) => setItemCodeInput(e.target.value)}
            placeholder="품목코드 검색"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-40"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">발행일자</label>
          <DateSegmentInput value={issueDate} onChange={setIssueDate} />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">근무조</label>
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value as Shift)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white text-slate-600 font-medium"
          >
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">직행율</label>
          <span
            title="공정등록(BASE-04) P300~P410 구간, 사용여부 '사용' 공정의 기본 생산수율을 모두 곱한 값"
            className="border border-slate-200 bg-slate-50 rounded-md px-3 py-2 text-sm font-mono text-slate-700 w-20 text-right inline-block"
          >
            {straightYield != null ? `${straightYield.toFixed(1)}%` : "-"}
          </span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-19rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-2 py-3 font-semibold sticky left-0 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-10">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(rows.map((r) => r.so_no)));
                        setCheckOrder((prev) => [
                          ...prev,
                          ...rows.map((r) => r.so_no).filter((so) => !prev.includes(so)),
                        ]);
                      } else {
                        setSelected(new Set());
                        setCheckOrder([]);
                      }
                    }}
                  />
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  No.
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  대표품목
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  품목코드
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  수주수량
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  계획수량
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  재고확인
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  지시수량
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  발행수량
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  작업지시비고란
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  수주번호
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                  순번
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-slate-400">
                    조건에 맞는 수주가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, idx) => (
                  <tr key={r.so_no} className="hover:bg-slate-50 group">
                    <td className="px-2 py-2.5 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 w-10">
                      <input
                        type="checkbox"
                        checked={selected.has(r.so_no)}
                        onChange={(e) => toggleRowChecked(r.so_no, e.target.checked)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">
                      {repItemCode(String(priorityCell(r, "품목코드") ?? ""))}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-navy">
                      {priorityCell(r, "품목코드")}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {Number(priorityCell(r, "수주수량") ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {(() => {
                        const v = planQty(Number(priorityCell(r, "수주수량") ?? 0), straightYield);
                        return v != null ? v.toLocaleString() : "-";
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {(() => {
                        const itemCodeVal = String(priorityCell(r, "품목코드") ?? "");
                        const v = planQty(Number(priorityCell(r, "수주수량") ?? 0), straightYield);
                        if (!itemCodeVal || v == null) {
                          return <span className="text-slate-300 text-xs">-</span>;
                        }
                        const repCode = repItemCode(itemCodeVal);
                        const pool = lotPools[repCode];
                        const hasStock = pool ? poolRemainingByRepCode[repCode] > 0 : stockSummary[repCode];
                        return (
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setStockCheckTarget({
                                  so_no: r.so_no,
                                  repCode,
                                  itemCode: itemCodeVal,
                                  planQty: v,
                                })
                              }
                              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                                hasStock === undefined
                                  ? "border-slate-300 text-slate-500 hover:border-navy hover:text-navy"
                                  : hasStock
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                    : "border-slate-300 text-slate-500 hover:border-navy hover:text-navy"
                              }`}
                            >
                              {hasStock === undefined ? "재고확인" : hasStock ? "착색보유" : "재고없음"}
                            </button>
                            {pool && (
                              <span className="text-[11px] text-slate-500 font-mono">
                                잔량 {poolRemainingByRepCode[repCode].toLocaleString()} {pool.unit}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={0}
                        value={directQty[r.so_no] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDirectQty((prev) => ({ ...prev, [r.so_no]: value }));
                          setManualRows((prev) => {
                            if (prev.has(r.so_no)) return prev;
                            const next = new Set(prev);
                            next.add(r.so_no);
                            return next;
                          });
                        }}
                        className="w-24 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right font-mono"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {Number(priorityCell(r, "작지수량") ?? 0).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={remark[r.so_no] ?? ""}
                        onChange={(e) => setRemark((prev) => ({ ...prev, [r.so_no]: e.target.value }))}
                        placeholder="비고 입력"
                        className="w-40 border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-navy">
                      {priorityCell(r, "수주번호")}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">{priorityCell(r, "순번") ?? "-"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500">전체 {rows.length.toLocaleString()}건 표시</p>
        </div>
      </div>

      {stockCheckTarget && (
        <StockCheckModal
          repItemCode={stockCheckTarget.repCode}
          itemCode={stockCheckTarget.itemCode}
          planQty={stockCheckTarget.planQty}
          onClose={() => setStockCheckTarget(null)}
          onConfirm={({ totalQty, unit, lots }) => {
            setLotPools((prev) => ({
              ...prev,
              [stockCheckTarget.repCode]: { totalQty, unit, lots },
            }));
            setStockCheckTarget(null);
          }}
        />
      )}
    </div>
  );
}
