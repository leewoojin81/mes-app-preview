"use client";

import { useEffect, useMemo, useState } from "react";
import type { InventoryRow } from "@/lib/types";

const CATEGORY_TABS = ["전체", "완제품", "반제품", "원자재"] as const;
const POLL_MS = 4000;

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [category, setCategory] = useState<(typeof CATEGORY_TABS)[number]>("전체");
  const [search, setSearch] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(
      `/api/inventory${category !== "전체" ? `?category=${category}` : ""}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    setRows(data);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.item_name.toLowerCase().includes(q) ||
        r.item_code.toLowerCase().includes(q) ||
        r.lot_no.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const summary = useMemo(() => {
    const fg = rows.filter((r) => r.category === "완제품");
    const rm = rows.filter((r) => r.category === "원자재");
    return {
      fgQty: fg.reduce((s, r) => s + r.qty, 0),
      rmLots: rm.length,
      fgLots: fg.length,
      rmLowStock: rm.filter((r) => r.qty < 100).length,
    };
  }, [rows]);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">실시간 재고반영</h1>
          <p className="text-sm text-slate-500 mt-1">
            INV-01 · 완제품/원자재를 LOT·위치 기준으로 통합 조회 (생산실적·자재투입 실시간 반영)
          </p>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {lastUpdated
            ? `마지막 갱신 ${lastUpdated.toLocaleTimeString("ko-KR")}`
            : "불러오는 중..."}
          <button
            onClick={load}
            className="ml-1 text-navy font-medium hover:underline"
          >
            새로고침
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="완제품 LOT 수" value={summary.fgLots} />
        <SummaryCard label="완제품 총수량" value={summary.fgQty.toLocaleString()} />
        <SummaryCard label="원자재 LOT 수" value={summary.rmLots} />
        <SummaryCard
          label="원자재 저재고 LOT (100 미만)"
          value={summary.rmLowStock}
          warn={summary.rmLowStock > 0}
        />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setCategory(tab)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                category === tab
                  ? "bg-navy text-white border-navy"
                  : "bg-white text-slate-600 border-slate-300 hover:border-navy"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="품목명 · 품목코드 · LOT 검색"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-64"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">품목코드</th>
                <th className="text-left px-4 py-3 font-semibold">품목명</th>
                <th className="text-left px-4 py-3 font-semibold">구분</th>
                <th className="text-left px-4 py-3 font-semibold">LOT No</th>
                <th className="text-left px-4 py-3 font-semibold">위치</th>
                <th className="text-right px-4 py-3 font-semibold">수량</th>
                <th className="text-left px-4 py-3 font-semibold">단위</th>
                <th className="text-left px-4 py-3 font-semibold">상태</th>
                <th className="text-left px-4 py-3 font-semibold">최종갱신</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    조회된 재고가 없습니다.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr key={r.inventory_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {r.item_code}
                  </td>
                  <td className="px-4 py-3 font-medium">{r.item_name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                        r.category === "완제품"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {r.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.lot_no}</td>
                  <td className="px-4 py-3 text-slate-500">{r.location}</td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      r.category === "원자재" && r.qty < 100 ? "text-red-600" : "text-navy"
                    }`}
                  >
                    {r.qty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{r.unit}</td>
                  <td className="px-4 py-3 text-slate-500">{r.status}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{r.updated_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${warn ? "text-red-600" : "text-navy"}`}>
        {value}
      </p>
    </div>
  );
}
