"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type {
  ReconcileKind,
  ReconcileRow,
  ReconcileSummary,
  StockBaseline,
} from "@/lib/stock-ledger-shared";

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

const KIND_LABEL: Record<ReconcileKind, string> = {
  diff: "수량 차이",
  erp_only: "ERP에만 있음",
  mes_only: "MES에만 있음",
  match: "일치",
};
const KIND_CLS: Record<ReconcileKind, string> = {
  diff: "bg-amber-50 text-amber-700",
  erp_only: "bg-sky-50 text-sky-700",
  mes_only: "bg-violet-50 text-violet-700",
  match: "bg-emerald-50 text-emerald-700",
};

export default function StockReconcilePage() {
  const [rows, setRows] = useState<ReconcileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReconcileSummary | null>(null);
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<StockBaseline | null>(null);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", 100);
  const [diffOnly, setDiffOnly] = useTabState("diffOnly", true);
  const [kind, setKind] = useTabState("kind", "");
  const [warehouse, setWarehouse] = useTabState("warehouse", "");
  const [asOf, setAsOf] = useTabState("asOf", "");
  const [searchInput, setSearchInput] = useTabState("searchInput", "");
  const [search, setSearch] = useTabState("search", "");

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch, setPage]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (diffOnly) params.set("diffOnly", "1");
    if (kind) params.set("kind", kind);
    if (warehouse) params.set("warehouse", warehouse);
    if (asOf) params.set("asOf", asOf);
    if (search) params.set("search", search);
    fetch(`/api/stock-reconcile?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRows(d.rows);
        setTotal(d.total);
        setSummary(d.summary);
        setWarehouses(d.warehouses ?? []);
        setSnapshotAt(d.snapshotAt);
        setBaseline(d.baseline);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, diffOnly, kind, warehouse, asOf, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  const selectCls = (active: boolean) =>
    `border rounded-md px-2.5 py-2 text-sm bg-white ${
      active ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
    }`;

  const cards: { label: string; value: number; k: ReconcileKind | "" }[] = summary
    ? [
        { label: "비교 대상(키)", value: summary.keys, k: "" },
        { label: "일치", value: summary.match, k: "match" },
        { label: "수량 차이", value: summary.diff, k: "diff" },
        { label: "ERP에만 있음", value: summary.erp_only, k: "erp_only" },
        { label: "MES에만 있음", value: summary.mes_only, k: "mes_only" },
      ]
    : [];

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">재고대사</h1>
        <p className="text-sm text-slate-500 mt-1">
          INV-07 · ERP 현재고현황(INV-02 스냅샷)과 MES 수불 합계(INV-06)를 품목·LOT·창고 기준으로 비교 · 차이 =
          MES − ERP
          {snapshotAt && ` · ERP 스냅샷 업로드 ${snapshotAt}`}
        </p>
        {!baseline && !loading && (
          <p className="text-xs mt-1 text-amber-700">
            기초재고가 아직 적재되지 않아 MES 수불이 비어 있습니다 — 재고수불원장(INV-06)에서 먼저 적재하세요.
          </p>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {cards.map((c) => (
            <button
              key={c.label}
              onClick={() => {
                setKind(c.k);
                setDiffOnly(false);
                setPage(1);
              }}
              className={`text-left rounded-lg border px-4 py-3 bg-white hover:border-navy ${
                kind === c.k && !diffOnly ? "border-navy" : "border-slate-200"
              }`}
            >
              <div className="text-xs text-slate-500">{c.label}</div>
              <div className="text-lg font-bold text-navy font-mono">{c.value.toLocaleString()}</div>
            </button>
          ))}
        </div>
      )}
      {summary && (
        <p className="text-xs text-slate-500">
          수량 합계 — ERP {fmt(summary.erp_total)} / MES {fmt(summary.mes_total)} / 차이{" "}
          {fmt(Math.round((summary.mes_total - summary.erp_total) * 1000) / 1000)}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm text-slate-700 border border-slate-300 rounded-md px-2.5 py-2 bg-white cursor-pointer">
          <input
            type="checkbox"
            checked={diffOnly}
            onChange={(e) => {
              setDiffOnly(e.target.checked);
              if (e.target.checked) setKind("");
              setPage(1);
            }}
          />
          불일치만 보기
        </label>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            if (e.target.value) setDiffOnly(false);
            setPage(1);
          }}
          className={selectCls(!!kind)}
        >
          <option value="">유형 전체</option>
          {(Object.keys(KIND_LABEL) as ReconcileKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          value={warehouse}
          onChange={(e) => {
            setWarehouse(e.target.value);
            setPage(1);
          }}
          className={selectCls(!!warehouse)}
        >
          <option value="">창고 전체</option>
          {warehouses.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5" title="비우면 MES 수불 전체를 집계합니다. ERP 스냅샷 날짜에 맞추려면 그 날짜를 지정하세요.">
          <label className="text-xs font-medium text-slate-500 shrink-0">MES 집계 기준일</label>
          <DateSegmentInput
            value={asOf}
            onChange={(v) => {
              setAsOf(v);
              setPage(1);
            }}
          />
          {asOf && (
            <button onClick={() => setAsOf("")} className="text-xs text-slate-500 underline">
              전체
            </button>
          )}
        </div>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="품목코드, 품목명, LOT No, 창고 검색"
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
        <div className="overflow-auto max-h-[calc(100vh-27rem)]">
          <table className="text-sm whitespace-nowrap w-full">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["품목코드", "품목명", "LOT No", "창고", "ERP 수량", "MES 수량", "차이(MES−ERP)", "유형"].map((h) => (
                  <th key={h} className="text-center px-3 py-3 font-semibold sticky top-0 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    {diffOnly ? "불일치 항목이 없습니다." : "조건에 맞는 데이터가 없습니다."}
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={`${r.item_code}|${r.lot_no}|${r.warehouse}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{r.item_code}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-64 truncate" title={r.item_name ?? ""}>
                      {r.item_name ?? "-"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.lot_no || "-"}</td>
                    <td className="px-3 py-2">{r.warehouse}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.erp_qty)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.mes_qty)}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${
                        r.diff > 0 ? "text-emerald-700" : r.diff < 0 ? "text-rose-600" : "text-slate-400"
                      }`}
                    >
                      {r.diff > 0 ? "+" : ""}
                      {fmt(r.diff)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${KIND_CLS[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500">
            전체 {total.toLocaleString()}건 중 {rangeStart.toLocaleString()}-{rangeEnd.toLocaleString()}건 표시 · 차이가
            큰 순서
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
    </div>
  );
}
