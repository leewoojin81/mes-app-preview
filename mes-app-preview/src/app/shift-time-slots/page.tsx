"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import type { ShiftTimeSlot } from "@/lib/types";

const SHIFT_CODES = ["1조", "2조", "3조"] as const;

// 구간명 추천 목록(자유 입력도 그대로 허용) — 근무시간.xlsx 원본에 실제로 쓰인 이름들.
const SEGMENT_NAME_SUGGESTIONS = ["조출", "1Q", "휴식", "2Q", "식사", "3Q", "잔업", "식사1", "식사2", "휴식2"];

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}

// 분 단위 값을 "HH:MM (N분)" 형태로 함께 보여준다(2026-09-09 사용자 요청, 예: 120분 ->
// "02:00 (120분)") — 시:분으로 환산한 값과 원래 분 단위 값을 한 번에 확인할 수 있게.
function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")} (${m.toLocaleString()}분)`;
}

// "휴식"/"식사"로 시작하는 구간(휴식·휴식2·식사1·식사2 등 변형 포함)은 실제로 일하지
// 않는 시간이라 조별 "실 근로시간 합계"에서 뺀다(2026-09-09 사용자 요청) — 각 구간
// 자체의 근로시간(분) 값은 그대로 기록만 남기고, 합계 계산에서만 제외한다. 이 합계가
// 나중에 근태대사(PSN-06)의 판정 기준 숫자로 쓰일 예정이라 정확히 맞아야 한다.
function isBreakOrMeal(segmentName: string): boolean {
  return segmentName.startsWith("휴식") || segmentName.startsWith("식사");
}

type FormState = {
  shift_code: string;
  segment_name: string;
  start_time: string;
  end_time: string;
  effective_date: string;
  seq: string;
};

function emptyForm(shiftCode: string): FormState {
  return { shift_code: shiftCode, segment_name: "", start_time: "", end_time: "", effective_date: today(), seq: "" };
}

export default function ShiftTimeSlotsPage() {
  const [rows, setRows] = useState<ShiftTimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ShiftTimeSlot | null>(null);
  const [formShiftCode, setFormShiftCode] = useState<string>(SHIFT_CODES[0]);
  const [deleteTarget, setDeleteTarget] = useState<ShiftTimeSlot | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/shift-time-slots", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ShiftTimeSlot[]) => {
        setRows(data);
        setLoading(false);
      });
  };
  useEffect(load, []);

  function openAdd(shiftCode: string) {
    setEditing(null);
    setFormShiftCode(shiftCode);
    setShowForm(true);
  }
  function openEdit(r: ShiftTimeSlot) {
    setEditing(r);
    setFormShiftCode(r.shift_code);
    setShowForm(true);
  }

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-navy">근무시간정보</h1>
        <p className="text-sm text-slate-500 mt-1">
          PSN-07 · 조(1조/2조/3조)별 근무시간표 구간을 관리합니다. 근로시간(분)은 시작~종료
          시각으로 자동 계산되고, 적용시작일로 나중에 시간표가 개정돼도 이전 구성을 이력으로
          남길 수 있습니다. 이 화면의 데이터는 이후 근태대사(PSN-06)의 지각/조출/잔업 판정
          기준으로 참조될 예정입니다(연동은 별도 진행).
        </p>
      </div>

      {SHIFT_CODES.map((shiftCode) => {
        const shiftRows = rows.filter((r) => r.shift_code === shiftCode);
        const rawTotal = shiftRows.reduce((sum, r) => sum + r.work_minutes, 0);
        const workTotal = shiftRows
          .filter((r) => !isBreakOrMeal(r.segment_name))
          .reduce((sum, r) => sum + r.work_minutes, 0);
        const excludedTotal = rawTotal - workTotal;
        return (
          <div key={shiftCode} className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-navy">{shiftCode}</h2>
              <button
                onClick={() => openAdd(shiftCode)}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-navy text-white hover:opacity-90 transition-opacity"
              >
                구간 추가
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
                  <tr>
                    <th className="text-center px-3 py-2 font-semibold">구간명</th>
                    <th className="text-center px-3 py-2 font-semibold">시작시간</th>
                    <th className="text-center px-3 py-2 font-semibold">종료시간</th>
                    <th className="text-center px-3 py-2 font-semibold">작업시간(분)</th>
                    <th className="text-center px-3 py-2 font-semibold">휴게시간(분)</th>
                    <th className="text-center px-3 py-2 font-semibold">근로시간(분)</th>
                    <th className="text-center px-3 py-2 font-semibold">적용시작일</th>
                    <th className="text-center px-3 py-2 font-semibold">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400">
                        불러오는 중...
                      </td>
                    </tr>
                  )}
                  {!loading && shiftRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-400">
                        등록된 구간이 없습니다.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    shiftRows.map((r) => {
                      const isBreak = isBreakOrMeal(r.segment_name);
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-700">
                            {r.segment_name}
                            {(r.segment_name === "식사1" || r.segment_name === "식사2") && (
                              <span className="block text-[10px] font-normal text-slate-400">
                                중식교대 해당 (30분)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-slate-600">{r.start_time}</td>
                          <td className="px-3 py-2 text-center font-mono text-slate-600">
                            {r.end_time}
                            {r.crosses_midnight && <span className="text-xs text-amber-600 ml-1">(다음날)</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-navy">
                            {isBreak ? "-" : fmtMinutes(r.work_minutes)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-500">
                            {isBreak ? fmtMinutes(r.work_minutes) : "-"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-navy">
                            {fmtMinutes(r.work_minutes)}
                          </td>
                          <td className="px-3 py-2 text-center text-slate-500">{r.effective_date}</td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => openEdit(r)}
                                className="text-xs font-medium text-navy hover:underline"
                              >
                                수정
                              </button>
                              <button
                                onClick={() => setDeleteTarget(r)}
                                className="text-xs font-medium text-rose-600 hover:underline"
                              >
                                삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                {!loading && shiftRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                      <td colSpan={3} className="px-3 py-2.5 text-right text-slate-500">
                        {shiftCode} 합계
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-navy">{fmtMinutes(workTotal)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-500">{fmtMinutes(excludedTotal)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-navy">{fmtMinutes(rawTotal)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        );
      })}

      {showForm && (
        <ShiftSlotFormModal
          editing={editing}
          defaultShiftCode={formShiftCode}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-navy">구간 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-medium">
                  {deleteTarget.shift_code} {deleteTarget.segment_name}
                </span>
                ({deleteTarget.start_time}~{deleteTarget.end_time})을(를) 정말 삭제하시겠습니까?
              </p>
              <p className="text-xs text-slate-400">이 작업은 되돌릴 수 없습니다.</p>
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
                  if (!deleteTarget) return;
                  setDeleting(true);
                  await fetch(`/api/shift-time-slots/${deleteTarget.id}`, { method: "DELETE" });
                  setDeleting(false);
                  setDeleteTarget(null);
                  load();
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

function ShiftSlotFormModal({
  editing,
  defaultShiftCode,
  onClose,
  onSaved,
}: {
  editing: ShiftTimeSlot | null;
  defaultShiftCode: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          shift_code: editing.shift_code,
          segment_name: editing.segment_name,
          start_time: editing.start_time,
          end_time: editing.end_time,
          effective_date: editing.effective_date,
          seq: String(editing.seq),
        }
      : emptyForm(defaultShiftCode)
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  // 저장 전 화면에서 바로 근로시간(분)을 미리 계산해 보여준다(서버도 같은 방식으로 다시
  // 계산해 저장하므로 여기서 보여주는 값과 실제 저장값이 항상 일치한다).
  const previewMinutes = (() => {
    if (!form.start_time || !form.end_time || form.start_time === form.end_time) return null;
    const [sh, sm] = form.start_time.split(":").map(Number);
    const [eh, em] = form.end_time.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    return end < start ? end + 1440 - start : end - start;
  })();

  const submit = async () => {
    setSaving(true);
    setError(null);
    const body = {
      shift_code: form.shift_code,
      segment_name: form.segment_name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      effective_date: form.effective_date,
      seq: form.seq.trim() === "" ? null : Number(form.seq),
    };
    const url = editing ? `/api/shift-time-slots/${editing.id}` : "/api/shift-time-slots";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  const canSubmit =
    form.segment_name.trim() !== "" && form.start_time !== "" && form.end_time !== "" && form.effective_date !== "";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-navy">{editing ? "구간 수정" : "구간 추가"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                조구분 <span className="text-rose-600">*</span>
              </span>
              <select value={form.shift_code} onChange={(e) => set("shift_code", e.target.value)} className={`${inputCls} bg-white`}>
                {SHIFT_CODES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                구간명 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.segment_name}
                onChange={(e) => set("segment_name", e.target.value)}
                list="segment-name-suggestions"
                placeholder="예: 1Q, 휴식, 식사1"
                className={inputCls}
              />
              <datalist id="segment-name-suggestions">
                {SEGMENT_NAME_SUGGESTIONS.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                시작시각 <span className="text-rose-600">*</span>
              </span>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => set("start_time", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                종료시각 <span className="text-rose-600">*</span>
              </span>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => set("end_time", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          {previewMinutes != null && (
            <p className="text-xs text-slate-500">
              근로시간(분): <span className="font-mono font-semibold text-navy">{fmtMinutes(previewMinutes)}</span>
              {form.start_time && form.end_time && form.end_time < form.start_time && (
                <span className="text-amber-600 ml-1">(종료시각이 다음날로 계산됨)</span>
              )}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                적용시작일 <span className="text-rose-600">*</span>
              </span>
              <div className="mt-1">
                <DateSegmentInput value={form.effective_date} onChange={(v) => set("effective_date", v)} />
              </div>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">정렬순서</span>
              <input
                value={form.seq}
                onChange={(e) => set("seq", e.target.value)}
                placeholder="비우면 자동"
                inputMode="numeric"
                className={inputCls}
              />
            </label>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600">
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || !canSubmit}
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
