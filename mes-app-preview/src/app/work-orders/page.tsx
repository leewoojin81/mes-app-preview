"use client";

import { useEffect, useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import ItemSearchSelect from "@/components/ItemSearchSelect";
import { useTabState } from "@/lib/use-tab-state";
import type { Item, WorkOrder, WorkOrderStatus } from "@/lib/types";

const FILTER_TABS: ("전체" | WorkOrderStatus)[] = ["전체", "대기", "발행", "진행", "완료"];
const LINES = ["LINE-1", "LINE-2"];

export default function WorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  // 탭을 전환했다 돌아와도 보고 있던 상태 필터는 유지되도록 세션 단위로 저장한다.
  const [filter, setFilter] = useTabState<(typeof FILTER_TABS)[number]>("filter", "전체");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    item_code: "",
    line_id: LINES[0],
    order_qty: "",
    due_date: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function loadWorkOrders() {
    const res = await fetch("/api/work-orders", { cache: "no-store" });
    const data = await res.json();
    setWorkOrders(data);
    setLoading(false);
  }

  async function loadItems() {
    const res = await fetch("/api/items", { cache: "no-store" });
    const data: Item[] = await res.json();
    setItems(data.filter((i) => i.category === "완제품"));
  }

  useEffect(() => {
    loadWorkOrders();
    loadItems();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(
    () =>
      filter === "전체"
        ? workOrders
        : workOrders.filter((w) => w.status === filter),
    [workOrders, filter]
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.item_code || !form.order_qty) {
      setError("품목과 지시수량을 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_code: form.item_code,
          line_id: form.line_id,
          order_qty: Number(form.order_qty),
          due_date: form.due_date || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "등록에 실패했습니다.");
      setToast(`${data.wo_no} 작업지시가 등록되었습니다.`);
      setForm({ item_code: "", line_id: LINES[0], order_qty: "", due_date: "" });
      setShowForm(false);
      loadWorkOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleIssue(wo_no: string) {
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${wo_no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "발행에 실패했습니다.");
      setToast(`${wo_no} 작업지시가 발행되어 POP 단말로 전송되었습니다.`);
      loadWorkOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "발행에 실패했습니다.");
    }
  }

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">작업지시 발행</h1>
          <p className="text-sm text-slate-500 mt-1">
            PROD-01 · 생산계획 기반 작업지시 생성, 발행 시 POP 단말로 자동 전송
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light transition-colors"
        >
          {showForm ? "닫기" : "+ 작업지시 등록"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 sm:grid-cols-4 gap-4 shadow-sm"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">품목</label>
            <ItemSearchSelect
              items={items}
              value={form.item_code}
              onChange={(item_code) => setForm({ ...form, item_code })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">라인</label>
            <select
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={form.line_id}
              onChange={(e) => setForm({ ...form, line_id: e.target.value })}
            >
              {LINES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">지시수량</label>
            <input
              type="number"
              min={1}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={form.order_qty}
              onChange={(e) => setForm({ ...form, order_qty: e.target.value })}
              placeholder="예: 300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">납기일</label>
            <input
              type="date"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
          <div className="sm:col-span-4 flex items-center justify-between">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="ml-auto bg-navy text-white text-sm font-medium px-5 py-2.5 rounded-md hover:bg-navy-light transition-colors disabled:opacity-50"
            >
              {submitting ? "등록 중..." : "등록"}
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filter === tab
                ? "bg-navy text-white border-navy"
                : "bg-white text-slate-600 border-slate-300 hover:border-navy"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">작업지시번호</th>
                <th className="text-left px-4 py-3 font-semibold">품목</th>
                <th className="text-left px-4 py-3 font-semibold">라인</th>
                <th className="text-right px-4 py-3 font-semibold">지시수량</th>
                <th className="text-right px-4 py-3 font-semibold">실적수량</th>
                <th className="text-left px-4 py-3 font-semibold">납기일</th>
                <th className="text-left px-4 py-3 font-semibold">상태</th>
                <th className="text-left px-4 py-3 font-semibold">등록일시</th>
                <th className="text-right px-4 py-3 font-semibold">발행</th>
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
                    작업지시가 없습니다.
                  </td>
                </tr>
              )}
              {filtered.map((wo) => (
                <tr key={wo.wo_no} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-navy">{wo.wo_no}</td>
                  <td className="px-4 py-3">{wo.item_name}</td>
                  <td className="px-4 py-3 text-slate-500">{wo.line_id}</td>
                  <td className="px-4 py-3 text-right">{wo.order_qty.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    {wo.produced_qty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{wo.due_date ?? "-"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={wo.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {wo.created_at}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {wo.status === "대기" ? (
                      <button
                        onClick={() => handleIssue(wo.wo_no)}
                        className="bg-gold text-navy-dark text-xs font-semibold px-3 py-1.5 rounded-md hover:brightness-95"
                      >
                        발행
                      </button>
                    ) : (
                      <span className="text-xs text-slate-300">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
