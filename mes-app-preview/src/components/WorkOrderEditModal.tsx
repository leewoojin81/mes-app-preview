"use client";

import { useState } from "react";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { WorkOrder } from "@/lib/types";

const LINES = ["LINE-1", "LINE-2"];

export default function WorkOrderEditModal({
  wo,
  onClose,
  onSaved,
}: {
  wo: WorkOrder;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [lineId, setLineId] = useState(wo.line_id);
  const [orderQty, setOrderQty] = useState(String(wo.order_qty));
  const [dueDate, setDueDate] = useState(wo.due_date ?? "");
  const [seq, setSeq] = useState(String(wo.detail?.["순서"] ?? ""));
  const [lineSeq, setLineSeq] = useState(String(wo.detail?.["순번"] ?? ""));
  const [urgent, setUrgent] = useState(wo.detail?.["긴급"] === "Y");
  const [releaseUse, setReleaseUse] = useState(wo.detail?.["Release사용"] === "Y");
  const [requestNo, setRequestNo] = useState(String(wo.detail?.["의뢰번호"] ?? ""));
  const [remark, setRemark] = useState(String(wo.detail?.["비고"] ?? ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useDraggableModal();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!lineId || !orderQty || Number(orderQty) <= 0) {
      setError("라인, 지시수량을 확인해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(wo.wo_no)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          line_id: lineId,
          order_qty: Number(orderQty),
          due_date: dueDate || null,
          seq: seq || null,
          line_seq: lineSeq || null,
          urgent,
          release_use: releaseUse,
          request_no: requestNo || null,
          remark: remark || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "수정에 실패했습니다.");
      onSaved(`${wo.wo_no} 작업지시가 수정되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`${wo.wo_no} 작업지시를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(wo.wo_no)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "삭제에 실패했습니다.");
      onSaved(`${wo.wo_no} 작업지시가 삭제되었습니다.`);
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
        className="bg-white rounded-lg shadow-xl w-full max-w-xl flex flex-col max-h-[90vh]"
        style={drag.style}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <div>
            <h2 className="text-base font-bold text-navy">작업지시 수정</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{wo.wo_no}</p>
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
          <div className="flex flex-col gap-1 sm:col-span-3">
            <label className="text-xs font-medium text-slate-500">품목</label>
            <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
              {wo.item_code} · {wo.item_name}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">라인</label>
            <select
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              {LINES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">순서</label>
            <input
              value={seq}
              onChange={(e) => setSeq(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">순번</label>
            <input
              value={lineSeq}
              onChange={(e) => setLineSeq(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">지시수량</label>
            <input
              type="number"
              min={1}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={orderQty}
              onChange={(e) => setOrderQty(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">납기일자</label>
            <input
              type="date"
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">의뢰번호</label>
            <input
              value={requestNo}
              onChange={(e) => setRequestNo(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              id="wo-urgent"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
            />
            <label htmlFor="wo-urgent" className="text-sm text-slate-600">
              긴급
            </label>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input
              type="checkbox"
              id="wo-release"
              checked={releaseUse}
              onChange={(e) => setReleaseUse(e.target.checked)}
            />
            <label htmlFor="wo-release" className="text-sm text-slate-600">
              Release사용
            </label>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-3">
            <label className="text-xs font-medium text-slate-500">비고</label>
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
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
