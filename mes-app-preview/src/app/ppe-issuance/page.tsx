"use client";

import { useEffect, useMemo, useState } from "react";
import type { PpeItem, PpeIssuance, PpeStatusCell } from "@/lib/types";
import { isOverdue, isUpcomingOrOverdue, todayStr } from "@/lib/ppe";

type WorkerOption = { employee_no: string; worker_name: string; process_code: string | null };

export default function PpeIssuancePage() {
  const [items, setItems] = useState<PpeItem[]>([]);
  const [cells, setCells] = useState<PpeStatusCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<WorkerOption | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/ppe-status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { items: PpeItem[]; cells: PpeStatusCell[] }) => {
        setItems(data.items);
        setCells(data.cells);
        setLoading(false);
      });
  };
  useEffect(load, []);

  const today = todayStr();

  const workers = useMemo(() => {
    const map = new Map<string, WorkerOption>();
    for (const c of cells) {
      if (!map.has(c.employee_no)) {
        map.set(c.employee_no, {
          employee_no: c.employee_no,
          worker_name: c.worker_name,
          process_code: c.process_code,
        });
      }
    }
    return Array.from(map.values());
  }, [cells]);

  const cellMap = useMemo(() => {
    const m = new Map<string, PpeStatusCell>();
    for (const c of cells) m.set(`${c.employee_no}|${c.item_code}`, c);
    return m;
  }, [cells]);

  const urgentCount = useMemo(() => {
    const set = new Set<string>();
    for (const c of cells) {
      if (isUpcomingOrOverdue(c.next_due_date, today)) set.add(c.employee_no);
    }
    return set.size;
  }, [cells, today]);

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">보호구지급관리</h1>
          <p className="text-sm text-slate-500 mt-1">
            PSN-03 · 작업자별 보호구(방진복&조끼, 방진화&안전화, 깔창) 지급이력과 다음지급예정일을
            관리합니다.
          </p>
        </div>
        <button
          onClick={() => setShowRegister(true)}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          지급등록
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5 shadow-sm">
          <p className="text-xs text-slate-500">재지급 임박 인원 수</p>
          <p
            className={`mt-1 text-2xl font-bold font-mono ${
              urgentCount > 0 ? "text-red-600" : "text-navy"
            }`}
          >
            {urgentCount}
            <span className="text-sm font-sans font-medium text-slate-400 ml-1">명</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-1">지난 항목 또는 7일 이내 예정 기준</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-16rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  순번
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  사번
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  성명
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  소속공정
                </th>
                {items.map((item) => (
                  <th
                    key={item.item_code}
                    className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]"
                  >
                    {item.item_name}
                  </th>
                ))}
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  이력
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={4 + items.length + 1} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && workers.length === 0 && (
                <tr>
                  <td colSpan={4 + items.length + 1} className="text-center py-10 text-slate-400">
                    재직 중인 작업자가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                workers.map((w, idx) => (
                  <tr key={w.employee_no} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{w.employee_no}</td>
                    <td className="px-4 py-3 font-medium">{w.worker_name}</td>
                    <td className="px-4 py-3 text-slate-500">{w.process_code || "-"}</td>
                    {items.map((item) => {
                      const cell = cellMap.get(`${w.employee_no}|${item.item_code}`);
                      return (
                        <td key={item.item_code} className="px-4 py-3">
                          <DueBadge dateStr={cell?.next_due_date ?? null} today={today} />
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setHistoryTarget(w)}
                        className="text-xs font-medium text-navy hover:underline"
                      >
                        이력
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
          전체 {workers.length.toLocaleString()}명
        </div>
      </div>

      {showRegister && (
        <RegisterModal
          workers={workers}
          items={items}
          onClose={() => setShowRegister(false)}
          onSaved={() => {
            setShowRegister(false);
            load();
          }}
        />
      )}

      {historyTarget && (
        <HistoryModal
          target={historyTarget}
          items={items}
          onClose={() => setHistoryTarget(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function DueBadge({ dateStr, today }: { dateStr: string | null; today: string }) {
  if (!dateStr) {
    return <span className="text-xs text-slate-300">미지급</span>;
  }
  const overdue = isOverdue(dateStr, today);
  const upcoming = !overdue && isUpcomingOrOverdue(dateStr, today);
  const cls = overdue
    ? "bg-rose-50 text-rose-700 border-rose-200"
    : upcoming
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-transparent text-slate-600 border-transparent";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {dateStr}
      {overdue && " · 지남"}
    </span>
  );
}

function RegisterModal({
  workers,
  items,
  onClose,
  onSaved,
}: {
  workers: WorkerOption[];
  items: PpeItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeNo, setEmployeeNo] = useState("");
  const [itemCode, setItemCode] = useState(items[0]?.item_code ?? "");
  const [issueDate, setIssueDate] = useState(todayStr());
  const [receivedYn, setReceivedYn] = useState<"Y" | "N">("Y");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/ppe-issuances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_no: employeeNo,
        item_code: itemCode,
        issue_date: issueDate,
        received_yn: receivedYn,
        note: note.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    onSaved();
  };

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">지급등록</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <label className="block text-sm">
            <span className="text-slate-600">
              작업자 <span className="text-rose-600">*</span>
            </span>
            <select
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              <option value="">선택</option>
              {workers.map((w) => (
                <option key={w.employee_no} value={w.employee_no}>
                  {w.employee_no} · {w.worker_name}
                  {w.process_code ? ` · ${w.process_code}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">
              보호구품목 <span className="text-rose-600">*</span>
            </span>
            <select
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              {items.map((item) => (
                <option key={item.item_code} value={item.item_code}>
                  {item.item_name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                지급일자 <span className="text-rose-600">*</span>
              </span>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">수령여부</span>
              <select
                value={receivedYn}
                onChange={(e) => setReceivedYn(e.target.value as "Y" | "N")}
                className={`${inputCls} bg-white`}
              >
                <option value="Y">Y (수령)</option>
                <option value="N">N (미수령)</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">비고</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || !employeeNo || !itemCode || !issueDate}
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

function HistoryModal({
  target,
  items,
  onClose,
  onChanged,
}: {
  target: WorkerOption;
  items: PpeItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<PpeIssuance[] | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const itemNameByCode = useMemo(
    () => new Map(items.map((i) => [i.item_code, i.item_name])),
    [items]
  );

  const load = () => {
    fetch(`/api/ppe-issuances?employee_no=${encodeURIComponent(target.employee_no)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data: PpeIssuance[]) => setRows(data));
  };
  useEffect(load, [target.employee_no]);

  const remove = async (id: number) => {
    await fetch(`/api/ppe-issuances/${id}`, { method: "DELETE" });
    setConfirmId(null);
    load();
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            지급이력 —{" "}
            <span className="font-mono text-sm text-slate-500">{target.employee_no}</span>{" "}
            {target.worker_name}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">품목</th>
                <th className="text-center px-4 py-2.5 font-semibold">차수</th>
                <th className="text-center px-4 py-2.5 font-semibold">지급일자</th>
                <th className="text-center px-4 py-2.5 font-semibold">다음예정일</th>
                <th className="text-center px-4 py-2.5 font-semibold">수령</th>
                <th className="text-left px-4 py-2.5 font-semibold">비고</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows === null && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {rows !== null && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    지급이력이 없습니다.
                  </td>
                </tr>
              )}
              {rows?.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">{itemNameByCode.get(r.item_code) ?? r.item_code}</td>
                  <td className="px-4 py-2.5 text-center">{r.issue_seq}차</td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs">{r.issue_date}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-500">
                    {r.next_due_date ?? "-"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span
                      className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        r.received_yn === "Y"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-rose-50 text-rose-700 border-rose-200"
                      }`}
                    >
                      {r.received_yn}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{r.note || "-"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {confirmId === r.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">삭제할까요?</span>
                        <button
                          onClick={() => remove(r.id)}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          예
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="text-xs font-medium text-slate-500 hover:underline"
                        >
                          아니오
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmId(r.id)}
                        className="text-xs font-medium text-rose-600 hover:underline"
                      >
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end px-5 py-3 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
