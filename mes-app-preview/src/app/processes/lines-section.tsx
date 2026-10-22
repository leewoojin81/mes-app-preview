"use client";

import { useState } from "react";
import { useIsOperator } from "@/lib/use-operator";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { Process } from "@/lib/types";

// 기준정보 공정정보(BASE-04) "생산 라인" 섹션 — 공정을 회사에서 부르는 단위로 묶은 라인 목록(2026-10-22).
// 계획정보(PLAN-02)는 라인별 소속 공정의 인원으로 CAPA/UPH를, 공정별생산현황(MGMT-05)·목표 UPH는 라인의
// 실적 공정 하나로 생산량·인원·근무시간을 센다. 공정의 소속 라인은 공정정보 탭의 "라인" 열(공정 수정)에서 고른다.
// 저장·검사 규칙은 src/app/api/production-lines, 계산 쪽 근거는 src/lib/production-lines.ts.
export interface LineRow {
  line_key: string;
  line_name: string;
  status_name: string | null;
  result_process_code: string | null;
  is_indirect: "Y" | "N";
  seq: number;
  use_yn: "Y" | "N";
  remark: string | null;
  updated_at: string | null;
  processCodes: string[];
  /** 저장된 계획(일CAPA·목표 UPH) 행 수 — 있으면 삭제 대신 사용중단 */
  planCount: number;
}

type FormState = {
  line_key: string;
  line_name: string;
  status_name: string;
  result_process_code: string;
  is_indirect: "Y" | "N";
  seq: string;
  use_yn: "Y" | "N";
  remark: string;
};

export default function ProductionLinesSection({
  lines,
  processes,
  loading,
  onChanged,
}: {
  lines: LineRow[];
  processes: Process[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<LineRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LineRow | null>(null);
  const isOperator = useIsOperator(); // 기준정보 삭제는 운영자만
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDrag = useDraggableModal();
  const nameOf = new Map(processes.map((p) => [p.process_code, p.process_name]));
  const unassigned = processes.filter((p) => !p.line_key);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-navy">생산 라인</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            계획정보(PLAN-02)는 소속 공정의 인원으로, 공정별생산현황(MGMT-05)·목표 UPH는 실적 공정으로 집계 · 소속 공정은 공정정보 탭에서
            공정을 수정해 &quot;라인&quot;을 고름
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="px-3.5 py-1.5 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          라인 추가
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
            <tr>
              <th className="text-center px-4 py-2.5 font-semibold">No</th>
              <th className="text-center px-4 py-2.5 font-semibold">관리</th>
              <th className="text-center px-4 py-2.5 font-semibold">순서</th>
              <th className="text-center px-4 py-2.5 font-semibold">라인코드</th>
              <th className="text-center px-4 py-2.5 font-semibold">라인명</th>
              <th className="text-center px-4 py-2.5 font-semibold">현황 표시명</th>
              <th className="text-center px-4 py-2.5 font-semibold">실적 공정</th>
              <th className="text-center px-4 py-2.5 font-semibold">소속 공정</th>
              <th className="text-center px-4 py-2.5 font-semibold">사용여부</th>
              <th className="text-center px-4 py-2.5 font-semibold">비고</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-slate-400">
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading &&
              lines.map((l, idx) => (
                <tr key={l.line_key} className={`hover:bg-slate-50 ${l.use_yn === "N" ? "text-slate-400" : ""}`}>
                  <td className="px-4 py-2 text-center text-slate-500">{idx + 1}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => setEditing(l)} className="text-xs font-medium text-navy hover:underline">
                        수정
                      </button>
                      {isOperator && (
                        <button
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(l);
                          }}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-center text-slate-500">{l.seq}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{l.line_key}</td>
                  <td className="px-4 py-2 font-medium">{l.line_name}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {l.is_indirect === "Y" ? <span className="text-xs">간접직 · 현황 제외</span> : l.status_name || l.line_name}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {l.result_process_code ? (
                      <>
                        <span className="font-mono text-xs mr-1">{l.result_process_code}</span>
                        {nameOf.get(l.result_process_code) ?? "(없는 공정)"}
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-normal min-w-[16rem]">
                    {l.processCodes.length === 0 ? (
                      <span className="text-xs text-slate-400">없음</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {l.processCodes.map((c) => (
                          <span key={c} className="inline-flex px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-xs text-slate-600">
                            {nameOf.get(c) ?? c}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                        l.use_yn === "Y" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
                      }`}
                    >
                      {l.use_yn === "Y" ? "사용" : "중단"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-xs">{l.remark ?? ""}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && unassigned.length > 0 && (
        <p className="px-4 py-2.5 text-xs border-t border-slate-100 text-amber-700">
          라인이 없는 공정 {unassigned.length}개: {unassigned.map((p) => p.process_name).join(", ")} — 계획정보 인원 집계에서 빠집니다.
        </p>
      )}

      {editing && (
        <LineFormModal
          editing={editing === "new" ? null : editing}
          processes={processes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" style={deleteDrag.style}>
            <div className="px-5 py-4 border-b border-slate-200 cursor-move" onMouseDown={deleteDrag.onMouseDown}>
              <h2 className="text-base font-bold text-navy">라인 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">{deleteTarget.line_key}</span>
                <span className="font-medium">{deleteTarget.line_name}</span> 라인을 삭제할까요?
              </p>
              <p className="text-xs text-slate-400">
                소속 공정이나 저장된 계획(일CAPA·목표 UPH)이 있는 라인은 삭제할 수 없습니다. 그때는 사용여부를 중단으로 바꾸세요.
              </p>
              {deleteError && <p className="text-sm text-rose-600">{deleteError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  setDeleting(true);
                  const res = await fetch(`/api/production-lines/${encodeURIComponent(deleteTarget.line_key)}`, { method: "DELETE" });
                  const data = await res.json().catch(() => ({}));
                  setDeleting(false);
                  if (!res.ok) {
                    setDeleteError(data.error ?? "삭제에 실패했습니다.");
                    return;
                  }
                  setDeleteTarget(null);
                  onChanged();
                }}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm font-medium bg-rose-600 text-white disabled:opacity-40"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LineFormModal({
  editing,
  processes,
  onClose,
  onSaved,
}: {
  editing: LineRow | null;
  processes: Process[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          line_key: editing.line_key,
          line_name: editing.line_name,
          status_name: editing.status_name ?? "",
          result_process_code: editing.result_process_code ?? "",
          is_indirect: editing.is_indirect,
          seq: String(editing.seq),
          use_yn: editing.use_yn,
          remark: editing.remark ?? "",
        }
      : { line_key: "", line_name: "", status_name: "", result_process_code: "", is_indirect: "N", seq: "", use_yn: "Y", remark: "" }
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useDraggableModal();
  const set = (key: keyof FormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  const submit = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(editing ? `/api/production-lines/${encodeURIComponent(editing.line_key)}` : "/api/production-lines", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        line_key: form.line_key.trim(),
        line_name: form.line_name.trim(),
        status_name: form.status_name.trim(),
        seq: editing ? form.seq.trim() || String(editing.seq) : form.seq.trim(),
        remark: form.remark.trim(),
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

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">{editing ? "라인 수정" : "라인 추가"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                라인코드 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.line_key}
                onChange={(e) => set("line_key", e.target.value.toLowerCase())}
                disabled={!!editing}
                className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                placeholder="예: cleaning"
              />
              {!editing && <span className="text-xs text-slate-400">영문 소문자·숫자·_ · 만든 뒤에는 바꿀 수 없음</span>}
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">순서</span>
              <input
                value={form.seq}
                onChange={(e) => set("seq", e.target.value.replace(/[^0-9]/g, ""))}
                className={inputCls}
                inputMode="numeric"
                placeholder="비우면 맨 뒤"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                라인명 <span className="text-rose-600">*</span>
              </span>
              <input value={form.line_name} onChange={(e) => set("line_name", e.target.value)} className={inputCls} placeholder="계획정보에 표시" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">구분</span>
              <select value={form.is_indirect} onChange={(e) => set("is_indirect", e.target.value)} className={`${inputCls} bg-white`}>
                <option value="N">생산 라인</option>
                <option value="Y">간접직 (인원만 집계)</option>
              </select>
            </label>
          </div>
          {form.is_indirect === "N" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-600">현황 표시명</span>
                <input
                  value={form.status_name}
                  onChange={(e) => set("status_name", e.target.value)}
                  className={inputCls}
                  placeholder="비우면 라인명"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">실적 공정</span>
                <select
                  value={form.result_process_code}
                  onChange={(e) => set("result_process_code", e.target.value)}
                  className={`${inputCls} bg-white`}
                >
                  <option value="">(없음)</option>
                  {processes.map((p) => (
                    <option key={p.process_code} value={p.process_code}>
                      {p.process_code} {p.process_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {form.is_indirect === "N" && (
            <p className="text-xs text-slate-400 -mt-1">
              공정별생산현황(MGMT-05)은 실적 공정의 일일작업현황 양품수량을 실적으로, 그 공정 작업자의 근무시간으로 UPH를 계산합니다.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">사용여부</span>
              <select value={form.use_yn} onChange={(e) => set("use_yn", e.target.value)} className={`${inputCls} bg-white`}>
                <option value="Y">사용</option>
                <option value="N">중단 (계획·현황 화면에서 숨김)</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">비고</span>
              <input value={form.remark} onChange={(e) => set("remark", e.target.value)} className={inputCls} />
            </label>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600">
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || !form.line_key.trim() || !form.line_name.trim()}
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
