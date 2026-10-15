"use client";

import { useCallback, useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import {
  STOCK_REASON_OPTIONS,
  STOCK_TX_TYPES,
  type StockBalanceRow,
  type StockBaseline,
  type StockLedgerRow,
} from "@/lib/stock-ledger-shared";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const today = () => toLocalDateStr(new Date());
const firstDayOfMonth = () => {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

interface SyncResult {
  label: string;
  candidates: number;
  skipped: number;
  inserted: number;
}

export default function StockLedgerPage() {
  const [tab, setTab] = useTabState<"ledger" | "stock">("tab", "ledger");
  const [ledgerRows, setLedgerRows] = useState<StockLedgerRow[]>([]);
  const [balanceRows, setBalanceRows] = useState<StockBalanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sums, setSums] = useState({ plus: 0, minus: 0 });
  const [balanceSum, setBalanceSum] = useState(0);
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [baseline, setBaseline] = useState<StockBaseline | null>(null);
  const [baselineLoaded, setBaselineLoaded] = useState(false);

  const [modal, setModal] = useState<null | "baseline" | "sync" | "entry">(null);

  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", 100);
  const [dateFrom, setDateFrom] = useTabState("dateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("dateTo", today);
  const [txType, setTxType] = useTabState("txType", "");
  const [reason, setReason] = useTabState("reason", "");
  const [warehouse, setWarehouse] = useTabState("warehouse", "");
  const [searchInput, setSearchInput] = useTabState("searchInput", "");
  const [search, setSearch] = useTabState("search", "");

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch, setPage]);

  const loadBaseline = useCallback(() => {
    fetch("/api/stock-ledger/baseline", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setBaseline(d.baseline);
        setBaselineLoaded(true);
      });
  }, []);
  useEffect(() => {
    loadBaseline();
  }, [loadBaseline, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ view: tab, page: String(page), pageSize: String(pageSize) });
    if (warehouse) params.set("warehouse", warehouse);
    if (search) params.set("search", search);
    if (tab === "ledger") {
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (txType) params.set("txType", txType);
      if (reason) params.set("reason", reason);
    }
    fetch(`/api/stock-ledger?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (tab === "ledger") {
          setLedgerRows(d.rows);
          setSums(d.sums);
        } else {
          setBalanceRows(d.rows);
          setBalanceSum(d.sum);
        }
        setTotal(d.total);
        setWarehouses(d.warehouses ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, page, pageSize, dateFrom, dateTo, txType, reason, warehouse, search, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  const refresh = () => setRefreshKey((k) => k + 1);

  const selectCls = (active: boolean) =>
    `border rounded-md px-2.5 py-2 text-sm bg-white ${
      active ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
    }`;

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">재고수불원장</h1>
          <p className="text-sm text-slate-500 mt-1">
            INV-06 · MES가 쌓는 입고/출고/이동/조정 이력 · 현재고 = 품목×LOT×창고별 수불 합계 (ERP 현재고현황 INV-02는
            그대로 두고 INV-07 재고대사에서 비교)
          </p>
          {baselineLoaded && (
            <p className="text-xs mt-1 text-slate-500">
              {baseline
                ? `기초재고: ${baseline.base_date} 기준 · ${baseline.row_count.toLocaleString()}건 · 수량합 ${fmt(baseline.total_qty)} · ${baseline.created_by ?? "-"} (${baseline.created_at}) 적재`
                : "기초재고 미적재 — 먼저 ERP 스냅샷(INV-02)을 기초재고로 적재하세요."}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {baselineLoaded && !baseline && (
            <button
              onClick={() => setModal("baseline")}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-amber-600 text-white hover:bg-amber-700"
            >
              기초재고 적재
            </button>
          )}
          {baseline && (
            <button
              onClick={() => setModal("sync")}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800"
            >
              수불 반영
            </button>
          )}
          <button
            onClick={() => setModal("entry")}
            className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light"
          >
            수동 등록
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {(
          [
            ["ledger", "수불 내역"],
            ["stock", "현재고(수불 합계)"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setPage(1);
            }}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              tab === k ? "border-navy text-navy font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {tab === "ledger" && (
          <>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-500 shrink-0">일시</label>
              <DateSegmentInput
                value={dateFrom}
                onChange={(v) => {
                  setDateFrom(v);
                  setPage(1);
                }}
              />
              <span className="text-slate-400 text-sm">~</span>
              <DateSegmentInput
                value={dateTo}
                onChange={(v) => {
                  setDateTo(v);
                  setPage(1);
                }}
              />
            </div>
            <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
            <select
              value={txType}
              onChange={(e) => {
                setTxType(e.target.value);
                setPage(1);
              }}
              className={selectCls(!!txType)}
            >
              <option value="">구분 전체</option>
              {STOCK_TX_TYPES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setPage(1);
              }}
              className={selectCls(!!reason)}
            >
              <option value="">근거 전체</option>
              {STOCK_REASON_OPTIONS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </>
        )}
        <select
          value={warehouse}
          onChange={(e) => {
            setWarehouse(e.target.value);
            setPage(1);
          }}
          className={selectCls(!!warehouse)}
        >
          <option value="">창고 전체</option>
          {warehouses.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="품목코드, 품목명, LOT No, 참조번호 검색"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-72"
        />
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
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-21rem)]">
          <table className="text-sm whitespace-nowrap w-full">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {(tab === "ledger"
                  ? ["일시", "품목코드", "품목명", "LOT No", "창고", "구분", "수량", "근거", "참조번호", "비고", "등록자"]
                  : ["품목코드", "품목명", "LOT No", "창고", "수량(수불 합계)"]
                ).map((h) => (
                  <th key={h} className="text-center px-3 py-3 font-semibold sticky top-0 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && total === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-slate-400">
                    조건에 맞는 수불 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                tab === "ledger" &&
                ledgerRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{r.tx_at.slice(0, 16)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.item_code}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-64 truncate" title={r.item_name ?? ""}>
                      {r.item_name ?? "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.lot_no || "-"}</td>
                    <td className="px-3 py-2">{r.warehouse}</td>
                    <td className="px-3 py-2 text-center">{r.tx_type}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${r.qty < 0 ? "text-rose-600" : "text-emerald-700"}`}
                    >
                      {r.qty > 0 ? "+" : ""}
                      {fmt(r.qty)}
                    </td>
                    <td className="px-3 py-2">{r.reason}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.ref_no ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-48 truncate" title={r.memo ?? ""}>
                      {r.memo ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.created_by ?? "-"}</td>
                  </tr>
                ))}
              {!loading &&
                tab === "stock" &&
                balanceRows.map((r) => (
                  <tr key={`${r.item_code}|${r.lot_no}|${r.warehouse}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{r.item_code}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-64 truncate" title={r.item_name ?? ""}>
                      {r.item_name ?? "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.lot_no || "-"}</td>
                    <td className="px-3 py-2">{r.warehouse}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs ${r.qty < 0 ? "text-rose-600" : ""}`}>
                      {fmt(r.qty)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500">
            전체 {total.toLocaleString()}건 중 {rangeStart.toLocaleString()}-{rangeEnd.toLocaleString()}건 표시
            {tab === "ledger"
              ? ` · 조건 전체 기준 입고계 +${fmt(sums.plus)} / 출고계 ${fmt(sums.minus)}`
              : ` · 조건 전체 수량합 ${fmt(balanceSum)}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-sm text-slate-600">
              {page.toLocaleString()} / {totalPages.toLocaleString()}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      </div>

      {modal === "baseline" && <BaselineModal onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "sync" && baseline && <SyncModal baseDate={baseline.base_date} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === "entry" && <EntryModal warehouses={warehouses} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const drag = useDraggableModal();
  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

const btnGhost = "px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600";
const btnPrimary = "px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40";

function BaselineModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [snap, setSnap] = useState<{ rows: number; total: number; uploadedAt: string | null } | null>(null);
  const [baseDate, setBaseDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stock-ledger/baseline", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setSnap(d.snapshot);
        if (d.snapshot?.uploadedAt) setBaseDate(String(d.snapshot.uploadedAt).slice(0, 10));
      });
  }, []);

  const submit = async () => {
    if (!window.confirm(`${baseDate} 기준으로 현재고현황(INV-02) 스냅샷을 기초재고로 적재합니다.\n기초재고는 한 번만 적재할 수 있고 되돌릴 수 없습니다. 진행할까요?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/stock-ledger/baseline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseDate }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "적재에 실패했습니다.");
      return;
    }
    setDone(`기초재고 ${Number(data.rows).toLocaleString()}건(수량합 ${fmt(data.total)}) 적재 완료`);
    onDone();
  };

  return (
    <Modal title="기초재고 적재" onClose={onClose}>
      {done ? (
        <>
          <p className="text-sm text-slate-700">{done}</p>
          <div className="flex justify-end">
            <button onClick={onClose} className={btnPrimary}>
              닫기
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            현재고현황(INV-02)의 최근 업로드 스냅샷을 품목×LOT×창고별로 합산해 &quot;기초재고&quot; 수불(입고)로
            옮깁니다. 이후 수불 반영은 <b>기준일 다음 날부터</b>의 거래만 쌓으므로, 기준일은 스냅샷을 뽑은 ERP
            재고의 날짜(해당 일자 거래까지 반영된 시점)로 입력하세요.
          </p>
          {snap ? (
            <p className="text-sm text-slate-700">
              적재 대상: {snap.rows.toLocaleString()}건 · 수량합 {fmt(snap.total)}
              {snap.uploadedAt && ` · 스냅샷 업로드 ${snap.uploadedAt}`}
            </p>
          ) : (
            <p className="text-sm text-slate-400">스냅샷 확인 중...</p>
          )}
          <label className="block text-sm">
            <span className="text-slate-600">기준일</span>
            <div className="mt-1">
              <DateSegmentInput value={baseDate} onChange={setBaseDate} />
            </div>
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className={btnGhost}>
              취소
            </button>
            <button onClick={submit} disabled={busy || !snap || snap.rows === 0 || !baseDate} className={btnPrimary}>
              {busy ? "적재 중..." : "기초재고 적재"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function SyncModal({ baseDate, onClose, onDone }: { baseDate: string; onClose: () => void; onDone: () => void }) {
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/stock-ledger/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "수불 반영에 실패했습니다.");
      return false;
    }
    setResults(data.results);
    return true;
  }, []);

  useEffect(() => {
    call(true);
  }, [call]);

  const newTotal = results?.reduce((a, r) => a + r.inserted, 0) ?? 0;

  return (
    <Modal title="수불 반영" onClose={onClose}>
      <p className="text-xs text-slate-500">
        기초재고 기준일({baseDate}) 이후의 구매입고·MOLD입고·창고이동·제품출고 업로드 데이터를 수불 원장에 쌓습니다.
        이미 반영된 건은 건너뛰어 여러 번 눌러도 중복되지 않습니다. 생산투입/생산입고는 자동 반영 대상이 아니며
        &quot;수동 등록&quot;으로 입력합니다.
      </p>
      {results && (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="text-left py-1">소스</th>
              <th className="text-right py-1">기준일 이후</th>
              <th className="text-right py-1">{applied ? "반영됨" : "신규 반영 예정"}</th>
              <th className="text-right py-1" title="창고 또는 수량이 비어 있어 반영할 수 없는 행">
                제외
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.map((r) => (
              <tr key={r.label}>
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right font-mono text-xs">{r.candidates.toLocaleString()}</td>
                <td className="py-1.5 text-right font-mono text-xs">{r.inserted.toLocaleString()}</td>
                <td className="py-1.5 text-right font-mono text-xs text-slate-400">{r.skipped.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!results && !error && <p className="text-sm text-slate-400">반영 대상 확인 중...</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnGhost}>
          {applied ? "닫기" : "취소"}
        </button>
        {!applied && (
          <button
            disabled={busy || !results || newTotal === 0}
            className={btnPrimary}
            onClick={async () => {
              if (await call(false)) {
                setApplied(true);
                onDone();
              }
            }}
          >
            {busy ? "반영 중..." : newTotal === 0 ? "반영할 신규 건 없음" : `${newTotal.toLocaleString()}건 반영`}
          </button>
        )}
      </div>
    </Modal>
  );
}

function EntryModal({ warehouses, onClose, onDone }: { warehouses: string[]; onClose: () => void; onDone: () => void }) {
  const [txDate, setTxDate] = useState(today);
  const [txType, setTxType] = useState<string>("조정");
  const [itemCode, setItemCode] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [toWarehouse, setToWarehouse] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("재고조정");
  const [refNo, setRefNo] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/stock-ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_date: txDate,
        tx_type: txType,
        item_code: itemCode,
        lot_no: lotNo,
        warehouse,
        to_warehouse: toWarehouse,
        qty: Number(qty),
        reason,
        ref_no: refNo,
        memo,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "등록에 실패했습니다.");
      return;
    }
    onDone();
    onClose();
  };

  const field = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white";
  const whSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={field}>
      <option value="">선택</option>
      {warehouses.map((w) => (
        <option key={w}>{w}</option>
      ))}
    </select>
  );

  return (
    <Modal title="수불 수동 등록" onClose={onClose}>
      <p className="text-xs text-slate-500">
        생산투입·생산입고·재고조정 등을 직접 기록합니다. 입고/출고/이동은 수량을 양수로 입력하면 부호가 자동 적용되고,
        조정은 +/−를 그대로 입력합니다. 등록한 수불은 수정·삭제할 수 없으므로 잘못 입력하면 반대 부호의 조정으로 바로잡으세요.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-slate-600">일자</span>
          <div className="mt-1">
            <DateSegmentInput value={txDate} onChange={setTxDate} />
          </div>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">구분</span>
          <select
            value={txType}
            onChange={(e) => {
              setTxType(e.target.value);
              if (e.target.value === "이동") setReason("창고이동");
              else if (e.target.value === "조정") setReason("재고조정");
            }}
            className={field}
          >
            {STOCK_TX_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">품목코드</span>
          <input value={itemCode} onChange={(e) => setItemCode(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">LOT No</span>
          <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">{txType === "이동" ? "출발 창고" : "창고"}</span>
          {whSelect(warehouse, setWarehouse)}
        </label>
        {txType === "이동" ? (
          <label className="text-sm">
            <span className="text-slate-600">도착 창고</span>
            {whSelect(toWarehouse, setToWarehouse)}
          </label>
        ) : (
          <span />
        )}
        <label className="text-sm">
          <span className="text-slate-600">수량{txType === "조정" ? " (+/−)" : ""}</span>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">근거</span>
          <input list="stock-reason-options" value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
          <datalist id="stock-reason-options">
            {STOCK_REASON_OPTIONS.filter((r) => r !== "기초재고").map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="text-sm col-span-2">
          <span className="text-slate-600">참조번호 (발주번호·작지번호·수주번호)</span>
          <input value={refNo} onChange={(e) => setRefNo(e.target.value)} className={field} />
        </label>
        <label className="text-sm col-span-2">
          <span className="text-slate-600">비고</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} className={field} />
        </label>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={btnGhost}>
          취소
        </button>
        <button onClick={submit} disabled={busy} className={btnPrimary}>
          {busy ? "등록 중..." : "등록"}
        </button>
      </div>
    </Modal>
  );
}
