"use client";

import { useEffect, useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import WorkOrderCreateModal from "@/components/WorkOrderCreateModal";
import WorkOrderEditModal from "@/components/WorkOrderEditModal";
import { useTabState } from "@/lib/use-tab-state";
import type { WorkOrder, WorkOrderStatus } from "@/lib/types";

const FILTER_TABS: ("전체" | WorkOrderStatus)[] = ["전체", "대기", "발행", "진행", "완료"];

// 사용자가 지정한 화면 컬럼 순서 그대로. 라인/지시수량/실적수량/상태/품목코드/품목정보/
// Lot No/수주번호/지시번호는 work_orders 실제 컬럼(또는 조인 결과)이고, 나머지는
// 작업지시 생성 시 detail JSON에 저장된 값(직접 입력 항목 또는 품목 마스터 스냅샷)이다.
type ColumnDef = { key: string; get: (wo: WorkOrder) => string | number | null | undefined };

const COLUMNS: ColumnDef[] = [
  { key: "라인", get: (wo) => wo.line_id },
  { key: "순서", get: (wo) => wo.detail?.["순서"] },
  { key: "품목군", get: (wo) => wo.detail?.["품목군"] },
  { key: "품목코드", get: (wo) => wo.item_code },
  { key: "품목정보", get: (wo) => wo.item_name },
  { key: "지시수량", get: (wo) => wo.order_qty },
  { key: "실적수량", get: (wo) => wo.produced_qty },
  { key: "상태", get: (wo) => wo.status },
  { key: "Lot No", get: (wo) => wo.lot_no },
  { key: "비고", get: (wo) => wo.detail?.["비고"] },
  { key: "수주번호", get: (wo) => wo.so_no },
  { key: "지시번호", get: (wo) => wo.wo_no },
  { key: "순번", get: (wo) => wo.detail?.["순번"] },
  { key: "긴급", get: (wo) => wo.detail?.["긴급"] },
  { key: "입고창고", get: (wo) => wo.detail?.["입고창고"] },
  { key: "Release사용", get: (wo) => wo.detail?.["Release사용"] },
  { key: "직경", get: (wo) => wo.detail?.["직경"] },
  { key: "포장방법", get: (wo) => wo.detail?.["포장방법"] },
  { key: "캡(실링지)", get: (wo) => wo.detail?.["캡(실링지)"] },
  { key: "Tone", get: (wo) => wo.detail?.["Tone"] },
  { key: "형명", get: (wo) => wo.detail?.["형명"] },
  { key: "BC", get: (wo) => wo.detail?.["BC"] },
  { key: "렌즈구분", get: (wo) => wo.detail?.["렌즈구분"] },
  { key: "주기", get: (wo) => wo.detail?.["주기"] },
  { key: "Radius", get: (wo) => wo.detail?.["Radius"] },
  { key: "BOM", get: (wo) => wo.detail?.["BOM"] },
  { key: "의뢰번호", get: (wo) => wo.detail?.["의뢰번호"] },
];

// 하단 합계 행에 표시할 수량성 컬럼만 — 순서/순번/BC/Radius 등은 수량이 아니라 제외한다.
const SUM_KEYS = ["지시수량", "실적수량"];

export default function WorkOrderRegisterPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  // 탭을 전환했다 돌아와도 보고 있던 필터/검색어는 유지되도록 세션 단위로 저장한다.
  const [filter, setFilter] = useTabState<(typeof FILTER_TABS)[number]>("filter", "전체");
  const [searchInput, setSearchInput] = useTabState("searchInput", "");
  const [search, setSearch] = useTabState("search", "");
  const [showCreate, setShowCreate] = useState(false);
  const [editingWo, setEditingWo] = useState<WorkOrder | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  async function loadWorkOrders() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "전체") params.set("status", filter);
    const res = await fetch(`/api/work-orders?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();
    setWorkOrders(data);
    setLoading(false);
    setSelected(new Set());
  }

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch]);

  useEffect(() => {
    loadWorkOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // 검색어는 지시번호/수주번호/거래처명 중 하나라도 맞으면 노출 — 위 API 호출은 각각을
  // OR 조건이 아니라 세 파라미터 모두로 필터링해 좁혀지므로, 클라이언트에서 합집합으로 재필터한다.
  const filtered = useMemo(() => {
    if (!search) return workOrders;
    const q = search.toLowerCase();
    return workOrders.filter(
      (wo) =>
        wo.wo_no.toLowerCase().includes(q) ||
        (wo.so_no ?? "").toLowerCase().includes(q) ||
        (wo.customer_name ?? "").toLowerCase().includes(q) ||
        wo.item_name.toLowerCase().includes(q)
    );
  }, [workOrders, search]);

  async function handleIssue(wo_no: string) {
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(wo_no)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "발행에 실패했습니다.");
      setToast(`${wo_no} 작업지시가 발행되었습니다.`);
      loadWorkOrders();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "발행에 실패했습니다.");
    }
  }

  async function handleDelete(wo: WorkOrder) {
    if (!window.confirm(`${wo.wo_no} 작업지시를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(wo.wo_no)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "삭제에 실패했습니다.");
      setToast(`${wo.wo_no} 작업지시가 삭제되었습니다.`);
      loadWorkOrders();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`선택한 작업지시 ${selected.size}건을 삭제할까요? 되돌릴 수 없습니다.`))
      return;
    try {
      const res = await fetch("/api/work-orders/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wo_nos: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "삭제에 실패했습니다.");
      setToast(`${(data.deleted ?? selected.size).toLocaleString()}건이 삭제되었습니다.`);
      loadWorkOrders();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  const colSpan = COLUMNS.length + 3; // 선택 체크박스 + No. + 처리

  // 전체 데이터를 한 번에 불러오는 화면이라(페이지네이션 없음) 필터링된 결과 전체를
  // 그대로 클라이언트에서 합산한다.
  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const key of SUM_KEYS) out[key] = 0;
    for (const wo of filtered) {
      out["지시수량"] += wo.order_qty ?? 0;
      out["실적수량"] += wo.produced_qty ?? 0;
    }
    return out;
  }, [filtered]);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">작업지시등록</h1>
          <p className="text-sm text-slate-500 mt-1">
            PROD-03 · 확정 수주 선택으로 작업지시 자동 생성 · 렌즈 속성은 품목등록 기준 자동 저장
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-navy text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-navy-light transition-colors"
        >
          + 작업지시등록
        </button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
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
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="지시번호, 수주번호, 거래처, 품목 검색"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-64"
          />
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
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(filtered.map((w) => w.wo_no)) : new Set())
                    }
                  />
                </th>
                <th className="text-center px-3 py-3 font-semibold sticky left-10 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0]">
                  No.
                </th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]"
                  >
                    {col.key}
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
                  <td colSpan={colSpan} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="text-center py-10 text-slate-400">
                    작업지시가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((wo, idx) => (
                  <tr key={wo.wo_no} className="hover:bg-slate-50 group">
                    <td className="px-2 py-2.5 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 w-10">
                      <input
                        type="checkbox"
                        checked={selected.has(wo.wo_no)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(wo.wo_no);
                            else next.delete(wo.wo_no);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-400 sticky left-10 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200">
                      {idx + 1}
                    </td>
                    {COLUMNS.map((col) => {
                      const v = col.get(wo);
                      if (col.key === "상태") {
                        return (
                          <td key={col.key} className="px-3 py-2.5">
                            <StatusBadge status={wo.status} />
                          </td>
                        );
                      }
                      const isMono = col.key === "지시번호" || col.key === "수주번호";
                      return (
                        <td
                          key={col.key}
                          title={v == null ? undefined : String(v)}
                          className={`px-3 py-2.5 max-w-64 truncate ${
                            isMono
                              ? "font-mono text-xs text-navy"
                              : typeof v === "number"
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
                        {wo.status === "대기" && (
                          <button
                            onClick={() => handleIssue(wo.wo_no)}
                            className="bg-gold text-navy-dark text-xs font-semibold px-3 py-1.5 rounded-md hover:brightness-95"
                          >
                            발행
                          </button>
                        )}
                        <button
                          onClick={() => setEditingWo(wo)}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-300 text-slate-600 hover:border-navy hover:text-navy"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDelete(wo)}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-semibold sticky bottom-0 z-20">
                  <td className="px-2 py-2.5 text-center sticky left-0 z-10 bg-slate-100 border-r border-slate-200 w-10" />
                  <td
                    className="px-3 py-2.5 text-center sticky left-10 z-10 bg-slate-100 border-r border-slate-200"
                    title="검색 결과 전체 기준 합계"
                  >
                    합계
                  </td>
                  {COLUMNS.map((col, i) => {
                    const isSum = SUM_KEYS.includes(col.key);
                    const isRowsLabel = i === 0;
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 whitespace-nowrap ${
                          isSum
                            ? "text-right text-navy font-mono text-xs"
                            : isRowsLabel
                              ? "text-slate-700"
                              : "text-slate-300"
                        }`}
                      >
                        {isSum
                          ? (totals[col.key] ?? 0).toLocaleString()
                          : isRowsLabel
                            ? `(${filtered.length.toLocaleString()} Rows)`
                            : "-"}
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
          <p className="text-xs text-slate-500">전체 {filtered.length.toLocaleString()}건 표시</p>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}

      {showCreate && (
        <WorkOrderCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(message) => {
            setToast(message);
            setShowCreate(false);
            loadWorkOrders();
          }}
        />
      )}

      {editingWo && (
        <WorkOrderEditModal
          wo={editingWo}
          onClose={() => setEditingWo(null)}
          onSaved={(message) => {
            setToast(message);
            setEditingWo(null);
            loadWorkOrders();
          }}
        />
      )}
    </div>
  );
}
