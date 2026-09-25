"use client";

import { useEffect, useMemo, useState } from "react";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { SalesOrder, WorkOrder } from "@/lib/types";

const LINES = ["LINE-1", "LINE-2"];

interface ReviewRow {
  so_no: string;
  customer_name: string;
  item_code: string;
  item_name: string;
  remainingQty: number;
  line_id: string;
  order_qty: string;
  seq: string;
  urgent: boolean;
  release_use: boolean;
  request_no: string;
  remark: string;
}

// 확정 수주를 선택하면 해당 수주의 품목/수량을 그대로 넘겨받아 작업지시를 생성한다.
// 렌즈 속성(직경/포장방법/캡실링지/Tone/형명/BC/렌즈구분/주기/Radius/BOM/입고창고)은
// 서버에서 품목 마스터를 스냅샷해 저장하므로 이 화면에서 별도로 입력받지 않는다.
export default function WorkOrderCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<"select" | "review">("select");
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useDraggableModal();

  useEffect(() => {
    Promise.all([
      fetch("/api/sales-orders", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/work-orders", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([so, wo]) => {
      setSalesOrders(so);
      setWorkOrders(wo);
      setLoading(false);
    });
  }, []);

  // 수주번호별로 이미 생성된 작업지시 지시수량 합계 — 남은(잔여) 수량 계산에 사용.
  const orderedQtyBySoNo = useMemo(() => {
    const map = new Map<string, number>();
    for (const wo of workOrders) {
      if (!wo.so_no) continue;
      map.set(wo.so_no, (map.get(wo.so_no) ?? 0) + wo.order_qty);
    }
    return map;
  }, [workOrders]);

  // 목록 화면(수주등록)과 동일한 기준으로 상태를 계산한다 — 엑셀 업로드분은 원본
  // "상태"(수주/Packing/출고/완료/중단), 수동 등록분은 내부 워크플로 상태(대기/확정/완료).
  function displayStatus(so: SalesOrder): string {
    return String(so.detail?.["상태"] ?? so.status);
  }

  // 완료/중단(종료) 건은 작업지시 생성 대상에서 기본 제외 — 검색으로 필요하면 여전히 찾을 수 있다.
  const selectable = useMemo(
    () => salesOrders.filter((so) => !["완료", "중단"].includes(displayStatus(so))),
    [salesOrders]
  );

  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return selectable;
    return selectable.filter(
      (so) =>
        so.so_no.toLowerCase().includes(q) ||
        so.customer_name.toLowerCase().includes(q) ||
        so.item_name.toLowerCase().includes(q)
    );
  }, [selectable, search]);

  // 수천 건을 한 번에 그리드로 그리면 브라우저가 멈추므로 화면에는 상위 200건만
  // 표시한다 — 더 찾으려면 검색으로 좁혀야 한다(체크박스 전체선택도 이 200건 기준).
  const DISPLAY_LIMIT = 200;
  const filtered = useMemo(() => matched.slice(0, DISPLAY_LIMIT), [matched]);

  function remainingQty(so: SalesOrder): number {
    return Math.max(0, so.order_qty - (orderedQtyBySoNo.get(so.so_no) ?? 0));
  }

  function toReview() {
    const rows = salesOrders
      .filter((so) => selected.has(so.so_no))
      .map((so, i) => ({
        so_no: so.so_no,
        customer_name: so.customer_name,
        item_code: so.item_code,
        item_name: so.item_name,
        remainingQty: remainingQty(so),
        line_id: LINES[0],
        order_qty: String(remainingQty(so) || so.order_qty),
        seq: String(i + 1),
        urgent: false,
        release_use: false,
        request_no: "",
        remark: "",
      }));
    setReviewRows(rows);
    setStage("review");
  }

  function updateRow(so_no: string, patch: Partial<ReviewRow>) {
    setReviewRows((prev) => prev.map((r) => (r.so_no === so_no ? { ...r, ...patch } : r)));
  }

  async function handleSubmit() {
    setError(null);
    for (const r of reviewRows) {
      const qty = Number(r.order_qty);
      if (!r.line_id || !qty || qty <= 0) {
        setError(`${r.so_no}: 라인과 지시수량을 확인해 주세요.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/work-orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: reviewRows.map((r) => ({
            so_no: r.so_no,
            line_id: r.line_id,
            order_qty: Number(r.order_qty),
            seq: r.seq,
            urgent: r.urgent,
            release_use: r.release_use,
            request_no: r.request_no,
            remark: r.remark,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "작업지시 생성에 실패했습니다.");
      if (data.errors?.length) {
        setError(data.errors.join(" / "));
        setSubmitting(false);
        return;
      }
      onCreated(`작업지시 ${data.inserted}건이 생성되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업지시 생성에 실패했습니다.");
    } finally {
      setSubmitting(false);
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
            <h2 className="text-base font-bold text-navy">작업지시등록</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {stage === "select"
                ? "완료/중단을 제외한 수주를 선택하면 품목/수량을 그대로 가져와 작업지시를 생성합니다."
                : "라인/지시수량 등을 확인하고 작업지시를 생성합니다. 렌즈 속성은 품목등록 정보에서 자동 저장됩니다."}
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

        {stage === "select" && (
          <>
            <div className="px-5 py-3 border-b border-slate-200 shrink-0 flex items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="수주번호, 거래처, 품목 검색"
                className="border border-slate-300 rounded-md px-3 py-2 text-sm w-72"
              />
              {matched.length > DISPLAY_LIMIT && (
                <p className="text-xs text-amber-600">
                  {matched.length.toLocaleString()}건 중 상위 {DISPLAY_LIMIT}건만 표시됩니다. 검색으로 좁혀 주세요.
                </p>
              )}
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-[#D9E1F2] text-slate-500 text-xs sticky top-0">
                  <tr>
                    <th className="text-center px-3 py-2.5 font-semibold w-10">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && filtered.every((so) => selected.has(so.so_no))}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? new Set(filtered.map((so) => so.so_no)) : new Set()
                          )
                        }
                      />
                    </th>
                    <th className="text-left px-3 py-2.5 font-semibold">수주번호</th>
                    <th className="text-left px-3 py-2.5 font-semibold">거래처</th>
                    <th className="text-left px-3 py-2.5 font-semibold">품목</th>
                    <th className="text-left px-3 py-2.5 font-semibold">상태</th>
                    <th className="text-right px-3 py-2.5 font-semibold">수주수량</th>
                    <th className="text-right px-3 py-2.5 font-semibold">기지시수량</th>
                    <th className="text-right px-3 py-2.5 font-semibold">잔여수량</th>
                    <th className="text-left px-3 py-2.5 font-semibold">납기일자</th>
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
                        선택 가능한 수주가 없습니다.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    filtered.map((so) => {
                      const ordered = orderedQtyBySoNo.get(so.so_no) ?? 0;
                      const remaining = remainingQty(so);
                      return (
                        <tr key={so.so_no} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={selected.has(so.so_no)}
                              onChange={(e) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(so.so_no);
                                  else next.delete(so.so_no);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-navy">{so.so_no}</td>
                          <td className="px-3 py-2">{so.customer_name}</td>
                          <td className="px-3 py-2">{so.item_name}</td>
                          <td className="px-3 py-2 text-slate-500">{displayStatus(so)}</td>
                          <td className="px-3 py-2 text-right">{so.order_qty.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-slate-400">
                            {ordered.toLocaleString()}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${
                              remaining <= 0 ? "text-slate-300" : "text-navy"
                            }`}
                          >
                            {remaining.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{so.due_date ?? "-"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 shrink-0 bg-slate-50">
              <p className="text-xs text-slate-500">{selected.size}건 선택됨</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
                >
                  취소
                </button>
                <button
                  onClick={toReview}
                  disabled={selected.size === 0}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
                >
                  다음 ({selected.size})
                </button>
              </div>
            </div>
          </>
        )}

        {stage === "review" && (
          <>
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-[#D9E1F2] text-slate-500 text-xs sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold">수주번호</th>
                    <th className="text-left px-3 py-2.5 font-semibold">품목</th>
                    <th className="text-left px-3 py-2.5 font-semibold">라인</th>
                    <th className="text-left px-3 py-2.5 font-semibold">순서</th>
                    <th className="text-right px-3 py-2.5 font-semibold">지시수량</th>
                    <th className="text-center px-3 py-2.5 font-semibold">긴급</th>
                    <th className="text-center px-3 py-2.5 font-semibold">Release사용</th>
                    <th className="text-left px-3 py-2.5 font-semibold">의뢰번호</th>
                    <th className="text-left px-3 py-2.5 font-semibold">비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reviewRows.map((r) => (
                    <tr key={r.so_no}>
                      <td className="px-3 py-2 font-mono text-xs text-navy">{r.so_no}</td>
                      <td className="px-3 py-2 max-w-56 truncate" title={r.item_name}>
                        {r.item_name}
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={r.line_id}
                          onChange={(e) => updateRow(r.so_no, { line_id: e.target.value })}
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
                        >
                          {LINES.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={r.seq}
                          onChange={(e) => updateRow(r.so_no, { seq: e.target.value })}
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-16"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={r.order_qty}
                          onChange={(e) => updateRow(r.so_no, { order_qty: e.target.value })}
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-24 text-right"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.urgent}
                          onChange={(e) => updateRow(r.so_no, { urgent: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.release_use}
                          onChange={(e) => updateRow(r.so_no, { release_use: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={r.request_no}
                          onChange={(e) => updateRow(r.so_no, { request_no: e.target.value })}
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-28"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={r.remark}
                          onChange={(e) => updateRow(r.so_no, { remark: e.target.value })}
                          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm w-32"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 shrink-0 bg-slate-50">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStage("select")}
                  className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
                >
                  이전
                </button>
                {error && <p className="text-sm text-rose-600">{error}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
                >
                  취소
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
                >
                  {submitting ? "생성 중..." : `작업지시 생성 (${reviewRows.length})`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
