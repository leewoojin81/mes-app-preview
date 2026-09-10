"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { CalendarDayType, Process, ProcessCalendarDay } from "@/lib/types";
import { buildProcessCalendarDay, type ProcessBasePattern } from "@/lib/process-calendar";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const DAY_TYPE_OPTIONS: CalendarDayType[] = ["평일", "휴일", "특근"];

const DAY_TYPE_STYLE: Record<CalendarDayType, string> = {
  평일: "bg-white border-slate-200 text-slate-700",
  휴일: "bg-rose-200 border-rose-300 text-rose-800",
  특근: "bg-amber-50 border-amber-200 text-amber-700",
};

const DAY_TYPE_DOT: Record<CalendarDayType, string> = {
  평일: "bg-slate-300",
  휴일: "bg-rose-500",
  특근: "bg-amber-500",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function processPattern(p: Process): ProcessBasePattern {
  return {
    shift1_active_yn: p.shift1_active_yn,
    shift1_start: p.shift1_start,
    shift1_end: p.shift1_end,
    shift1_base_minutes: p.shift1_base_minutes,
    shift2_active_yn: p.shift2_active_yn,
    shift2_start: p.shift2_start,
    shift2_end: p.shift2_end,
    shift2_base_minutes: p.shift2_base_minutes,
  };
}

type CalCell = { date: string; day: number; weekday: number } | null;

function buildMonthCells(year: number, month: number): CalCell[] {
  const startWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: CalCell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: toDateStr(year, month, d), day: d, weekday: (startWeekday + d - 1) % 7 });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function parseDateTokens(input: string): string[] {
  const tokens = input
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const dates = new Set<string>();
  for (const token of tokens) {
    const range = token.match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/);
    if (range) {
      const start = new Date(range[1]);
      const end = new Date(range[2]);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
        const cur = new Date(start);
        while (cur <= end) {
          dates.add(
            `${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`
          );
          cur.setDate(cur.getDate() + 1);
        }
      }
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) dates.add(token);
  }
  return Array.from(dates).sort();
}

export default function ProductionCalendarPage() {
  const today = new Date();
  // 탭을 전환했다 돌아와도 보고 있던 연/월/공정은 유지되도록 세션 단위로 저장한다.
  const [year, setYear] = useTabState("year", today.getFullYear());
  const [month, setMonth] = useTabState("month", today.getMonth() + 1);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [processCode, setProcessCode] = useTabState("processCode", "");
  const [rows, setRows] = useState<ProcessCalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [applyingWeekend, setApplyingWeekend] = useState(false);
  const [applyingWeekday, setApplyingWeekday] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    fetch("/api/processes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Process[]) => {
        const active = data
          .filter((p) => p.use_yn === "Y" && p.apply_work_pattern_yn !== "N")
          .sort((a, b) => a.seq - b.seq);
        setProcesses(active);
        setProcessCode((prev) => prev || active[0]?.process_code || "");
      });
  }, [reloadTick, setProcessCode]);

  const load = () => {
    if (!processCode) return;
    setLoading(true);
    fetch(
      `/api/process-calendar?year=${year}&month=${month}&process_code=${encodeURIComponent(processCode)}`,
      { cache: "no-store" }
    )
      .then((res) => res.json())
      .then((data: ProcessCalendarDay[]) => {
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  };

  useEffect(load, [year, month, processCode, reloadTick]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedProcess = useMemo(
    () => processes.find((p) => p.process_code === processCode) ?? null,
    [processes, processCode]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, ProcessCalendarDay>();
    for (const r of rows) map.set(r.cal_date, r);
    return map;
  }, [rows]);

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);

  const summary = useMemo(() => {
    const s = { 평일: 0, 휴일: 0, 특근: 0, 미등록: 0 };
    for (const c of cells) {
      if (!c) continue;
      const r = byDate.get(c.date);
      if (!r || !r.company_day_type) s.미등록++;
      else s[r.company_day_type]++;
    }
    return s;
  }, [cells, byDate]);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  async function applyWeekendOff() {
    if (
      !confirm(
        `${year}년 전체의 토/일요일을 휴일(근무여부 N)로 일괄 처리합니다.\n기존 비고는 유지됩니다. 계속할까요?`
      )
    )
      return;
    setApplyingWeekend(true);
    try {
      const res = await fetch("/api/production-calendar/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "weekend_off", year }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "처리에 실패했습니다.");
      setToast(`${year}년 토/일요일 ${data.count ?? 0}일이 휴일로 처리되었습니다.`);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setApplyingWeekend(false);
    }
  }

  async function applyWeekdayDefault() {
    if (
      !confirm(
        `${year}년 전체의 평일(월~금) 중 아직 등록되지 않은 날짜를 평일 근무(가동 Y)로 채웁니다.\n이미 등록된 날짜(공휴일 등)는 건드리지 않습니다. 계속할까요?`
      )
    )
      return;
    setApplyingWeekday(true);
    try {
      const res = await fetch("/api/production-calendar/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "weekday_work", year }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "처리에 실패했습니다.");
      setToast(`${year}년 평일 ${data.count ?? 0}일이 근무일로 등록되었습니다.`);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setApplyingWeekday(false);
    }
  }

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">생산캘린더</h1>
          <p className="text-sm text-slate-500 mt-1">
            BASE-08 · 공정을 선택해 그 공정의 월별 근무 캘린더를 확인·수정합니다. 회사
            공통 휴일/근무구분은 모든 공정에 함께 적용됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 mr-1">회사 공통</span>
          <button
            onClick={applyWeekdayDefault}
            disabled={applyingWeekday}
            className="px-3.5 py-2 rounded-md text-sm font-medium border border-navy text-navy bg-white hover:bg-navy/5 disabled:opacity-40 transition-colors"
          >
            {applyingWeekday ? "처리 중..." : `${year}년 평일 자동 근무 등록`}
          </button>
          <button
            onClick={applyWeekendOff}
            disabled={applyingWeekend}
            className="px-3.5 py-2 rounded-md text-sm font-medium border border-navy text-navy bg-white hover:bg-navy/5 disabled:opacity-40 transition-colors"
          >
            {applyingWeekend ? "처리 중..." : `${year}년 토/일요일 자동 휴무`}
          </button>
          <button
            onClick={() => setShowHolidayModal(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
          >
            공휴일 일괄 등록
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center gap-3 flex-wrap">
        <label className="text-sm flex items-center gap-2">
          <span className="text-slate-600 font-medium">공정 선택</span>
          <select
            value={processCode}
            onChange={(e) => setProcessCode(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white min-w-48"
          >
            {processes.length === 0 && <option value="">사용 중인 공정이 없습니다</option>}
            {processes.map((p) => (
              <option key={p.process_code} value={p.process_code}>
                {p.process_name} ({p.process_code})
              </option>
            ))}
          </select>
        </label>
        {selectedProcess && (
          <span className="text-xs text-slate-400">
            기본패턴 · 1조 {selectedProcess.shift1_active_yn === "Y" ? "가동" : "비가동"}
            {selectedProcess.shift1_start && selectedProcess.shift1_end
              ? ` ${selectedProcess.shift1_start}~${selectedProcess.shift1_end}`
              : ""}{" "}
            ({selectedProcess.shift1_base_minutes ?? 480}분) · 2조{" "}
            {selectedProcess.shift2_active_yn === "Y" ? "가동" : "비가동"}
            {selectedProcess.shift2_start && selectedProcess.shift2_end
              ? ` ${selectedProcess.shift2_start}~${selectedProcess.shift2_end}`
              : ""}{" "}
            ({selectedProcess.shift2_base_minutes ?? 480}분) · 공정등록(BASE-04)에서 변경
          </span>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftMonth(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50"
              aria-label="이전 달"
            >
              ‹
            </button>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={year}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  if (Number.isInteger(y)) setYear(y);
                }}
                className="w-20 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-center font-mono"
              />
              <span className="text-sm text-slate-500">년</span>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => shiftMonth(1)}
              className="w-8 h-8 flex items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50"
              aria-label="다음 달"
            >
              ›
            </button>
            <button
              onClick={() => {
                setYear(today.getFullYear());
                setMonth(today.getMonth() + 1);
              }}
              className="ml-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-slate-300 text-slate-500 hover:bg-slate-50"
            >
              오늘
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {DAY_TYPE_OPTIONS.map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${DAY_TYPE_DOT[t]}`} />
                {t} {summary[t]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-100 border border-slate-300" />
              미등록 {summary.미등록}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-100">
          {WEEKDAY_LABELS.map((w, i) => (
            <div
              key={w}
              className={`text-center text-xs font-semibold py-2 ${
                i === 0 ? "text-rose-500" : i === 6 ? "text-blue-500" : "text-slate-500"
              }`}
            >
              {w}
            </div>
          ))}
        </div>

        {loading || !processCode ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            {processCode ? "불러오는 중..." : "사용 중인 공정을 먼저 공정등록(BASE-04)에서 등록해주세요."}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((c, idx) => {
              if (!c) return <div key={idx} className="min-h-28 border-b border-r border-slate-100" />;
              const r = byDate.get(c.date);
              const dayType = r?.company_day_type ?? null;
              const isToday = c.date === toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate());
              const showTotal = r && (r.registered || r.overridden);
              return (
                <button
                  key={c.date}
                  onClick={() => setEditDate(c.date)}
                  className={`min-h-28 border-b border-r border-slate-100 p-2 text-left align-top hover:bg-slate-50 transition-colors ${
                    dayType ? DAY_TYPE_STYLE[dayType].split(" ")[0] : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-sm font-medium ${
                        isToday
                          ? "w-5 h-5 flex items-center justify-center rounded-full bg-navy text-white text-xs"
                          : c.weekday === 0
                            ? "text-rose-500"
                            : c.weekday === 6
                              ? "text-blue-500"
                              : "text-slate-700"
                      }`}
                    >
                      {c.day}
                    </span>
                    <div className="flex items-center gap-1">
                      {r?.overridden && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-navy"
                          title="이 공정만 개별 설정됨"
                        />
                      )}
                      {dayType && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${DAY_TYPE_STYLE[dayType]}`}
                        >
                          {dayType}
                        </span>
                      )}
                    </div>
                  </div>
                  {r?.company_note && (
                    <p className="mt-1.5 text-[11px] text-slate-500 line-clamp-2">{r.company_note}</p>
                  )}
                  {r?.note && (
                    <p className="mt-1 text-[11px] text-navy line-clamp-2">{r.note}</p>
                  )}
                  {showTotal && (
                    <p className="mt-1 text-[10px] text-slate-400 font-mono">
                      {r!.total_minutes > 0 ? `총 ${r!.total_minutes.toLocaleString()}분` : "미가동"}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {editDate && selectedProcess && byDate.get(editDate) && (
        <ProcessDayEditModal
          date={editDate}
          processCode={selectedProcess.process_code}
          processName={selectedProcess.process_name}
          pattern={processPattern(selectedProcess)}
          existing={byDate.get(editDate) as ProcessCalendarDay}
          onClose={() => setEditDate(null)}
          onSaved={(msg) => {
            setEditDate(null);
            setToast(msg);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {showHolidayModal && (
        <HolidayBulkModal
          onClose={() => setShowHolidayModal(false)}
          onSaved={(msg) => {
            setShowHolidayModal(false);
            setToast(msg);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function ProcessDayEditModal({
  date,
  processCode,
  processName,
  pattern,
  existing,
  onClose,
  onSaved,
}: {
  date: string;
  processCode: string;
  processName: string;
  pattern: ProcessBasePattern;
  existing: ProcessCalendarDay;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [dayType, setDayType] = useState<CalendarDayType>(existing.company_day_type ?? "평일");
  const [workYn, setWorkYn] = useState<"Y" | "N">(dayType === "휴일" ? "N" : "Y");
  const [companyNote, setCompanyNote] = useState(existing.company_note ?? "");

  const [s1Active, setS1Active] = useState<"default" | "Y" | "N">(
    existing.shift1_active_override ?? "default"
  );
  const [s1OtStart, setS1OtStart] = useState(existing.shift1.ot_start ?? "");
  const [s1OtEnd, setS1OtEnd] = useState(existing.shift1.ot_end ?? "");
  const [s1OtMeal, setS1OtMeal] = useState(
    existing.shift1.ot_meal_minutes != null ? String(existing.shift1.ot_meal_minutes) : ""
  );
  const [s2Active, setS2Active] = useState<"default" | "Y" | "N">(
    existing.shift2_active_override ?? "default"
  );
  const [s2OtStart, setS2OtStart] = useState(existing.shift2.ot_start ?? "");
  const [s2OtEnd, setS2OtEnd] = useState(existing.shift2.ot_end ?? "");
  const [s2OtMeal, setS2OtMeal] = useState(
    existing.shift2.ot_meal_minutes != null ? String(existing.shift2.ot_meal_minutes) : ""
  );
  const [processNote, setProcessNote] = useState(existing.note ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeDayType(t: CalendarDayType) {
    setDayType(t);
    setWorkYn(t === "휴일" ? "N" : "Y");
  }

  const preview = useMemo(
    () =>
      buildProcessCalendarDay(date, processCode, dayType, companyNote || null, pattern, {
        shift1_active_override: s1Active === "default" ? null : s1Active,
        shift1_ot_start: s1OtStart || null,
        shift1_ot_end: s1OtEnd || null,
        shift1_ot_meal_minutes: s1OtMeal.trim() === "" ? null : Number(s1OtMeal),
        shift2_active_override: s2Active === "default" ? null : s2Active,
        shift2_ot_start: s2OtStart || null,
        shift2_ot_end: s2OtEnd || null,
        shift2_ot_meal_minutes: s2OtMeal.trim() === "" ? null : Number(s2OtMeal),
        note: processNote || null,
      }),
    [date, processCode, dayType, companyNote, pattern, s1Active, s1OtStart, s1OtEnd, s1OtMeal, s2Active, s2OtStart, s2OtEnd, s2OtMeal, processNote]
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const [companyRes, processRes] = await Promise.all([
        fetch(`/api/production-calendar/${date}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ day_type: dayType, work_yn: workYn, note: companyNote }),
        }),
        fetch(`/api/process-calendar/${date}/${processCode}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shift1_active_override: s1Active === "default" ? null : s1Active,
            shift1_ot_start: s1OtStart || null,
            shift1_ot_end: s1OtEnd || null,
            shift1_ot_meal_minutes: s1OtMeal.trim() === "" ? null : s1OtMeal,
            shift2_active_override: s2Active === "default" ? null : s2Active,
            shift2_ot_start: s2OtStart || null,
            shift2_ot_end: s2OtEnd || null,
            shift2_ot_meal_minutes: s2OtMeal.trim() === "" ? null : s2OtMeal,
            note: processNote,
          }),
        }),
      ]);
      const companyData = await companyRes.json().catch(() => ({}));
      const processData = await processRes.json().catch(() => ({}));
      if (!companyRes.ok) throw new Error(companyData.error ?? "회사 근무구분 저장에 실패했습니다.");
      if (!processRes.ok) throw new Error(processData.error ?? "공정 근무시간 저장에 실패했습니다.");
      onSaved(`${date} 저장되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function resetCompany() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/production-calendar/${date}`, { method: "DELETE" });
      if (!res.ok) throw new Error("회사 등록 취소에 실패했습니다.");
      onSaved(`${date} 회사 등록이 취소되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "취소에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function resetProcessOverride() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/process-calendar/${date}/${processCode}`, { method: "DELETE" });
      if (!res.ok) throw new Error("공정 예외 초기화에 실패했습니다.");
      onSaved(`${date} ${processName} 예외가 초기화되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "초기화에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";
  const ACTIVE_LABEL: Record<"default" | "Y" | "N", string> = {
    default: "기본값 사용",
    Y: "Y (가동)",
    N: "N (비가동)",
  };

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            {date} · {processName}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">근무구분 (회사 전체 공통)</p>
            <div className="space-y-2">
              <div className="flex gap-2">
                {DAY_TYPE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => changeDayType(t)}
                    className={`flex-1 px-2.5 py-2 rounded-md text-sm font-medium border transition-colors ${
                      dayType === t
                        ? "bg-navy text-white border-navy"
                        : "bg-white text-slate-600 border-slate-300 hover:border-navy"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {(["Y", "N"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setWorkYn(v)}
                    className={`flex-1 px-2.5 py-2 rounded-md text-sm font-medium border transition-colors ${
                      workYn === v
                        ? v === "Y"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-rose-600 text-white border-rose-600"
                        : "bg-white text-slate-600 border-slate-300 hover:border-navy"
                    }`}
                  >
                    {v === "Y" ? "Y (근무)" : "N (휴무)"}
                  </button>
                ))}
              </div>
              <input
                value={companyNote}
                onChange={(e) => setCompanyNote(e.target.value)}
                placeholder="회사 비고 — 예: 설날, 창립기념일"
                className={inputCls}
              />
              <button
                type="button"
                onClick={resetCompany}
                disabled={saving || !existing.registered}
                className="text-xs text-rose-600 hover:underline disabled:opacity-30 disabled:hover:no-underline"
              >
                회사 등록 취소(미등록으로)
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700">{processName} 근무시간 (이 공정만)</p>
              <button
                type="button"
                onClick={resetProcessOverride}
                disabled={saving || !existing.overridden}
                className="text-xs text-rose-600 hover:underline disabled:opacity-30 disabled:hover:no-underline"
              >
                공정 예외 초기화
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  {
                    label: "1조",
                    base: pattern.shift1_active_yn,
                    baseStart: pattern.shift1_start,
                    baseEnd: pattern.shift1_end,
                    baseMinutes: pattern.shift1_base_minutes,
                    active: s1Active,
                    setActive: setS1Active,
                    otStart: s1OtStart,
                    setOtStart: setS1OtStart,
                    otEnd: s1OtEnd,
                    setOtEnd: setS1OtEnd,
                    otMeal: s1OtMeal,
                    setOtMeal: setS1OtMeal,
                    info: preview.shift1,
                  },
                  {
                    label: "2조",
                    base: pattern.shift2_active_yn,
                    baseStart: pattern.shift2_start,
                    baseEnd: pattern.shift2_end,
                    baseMinutes: pattern.shift2_base_minutes,
                    active: s2Active,
                    setActive: setS2Active,
                    otStart: s2OtStart,
                    setOtStart: setS2OtStart,
                    otEnd: s2OtEnd,
                    setOtEnd: setS2OtEnd,
                    otMeal: s2OtMeal,
                    setOtMeal: setS2OtMeal,
                    info: preview.shift2,
                  },
                ] as const
              ).map((shift) => (
                <div key={shift.label} className="border border-slate-200 rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-navy">{shift.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                        shift.info.active_yn === "Y"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : shift.info.active_yn === "N"
                            ? "bg-slate-100 text-slate-400 border-slate-200"
                            : "bg-slate-50 text-slate-300 border-slate-200"
                      }`}
                    >
                      {shift.info.active_yn === "Y" ? "가동" : shift.info.active_yn === "N" ? "비가동" : "미등록"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    기본값: {shift.base === "Y" ? "가동" : "비가동"}
                    {shift.baseStart && shift.baseEnd ? ` ${shift.baseStart}~${shift.baseEnd}` : ""} ·{" "}
                    {shift.baseMinutes ?? 480}분
                  </p>
                  <div className="flex gap-1.5">
                    {(["default", "Y", "N"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => shift.setActive(v)}
                        className={`flex-1 px-1.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                          shift.active === v
                            ? "bg-navy text-white border-navy"
                            : "bg-white text-slate-600 border-slate-300 hover:border-navy"
                        }`}
                      >
                        {ACTIVE_LABEL[v]}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-slate-500">
                      잔업 시작
                      <input
                        type="time"
                        value={shift.otStart}
                        onChange={(e) => shift.setOtStart(e.target.value)}
                        className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-slate-500">
                      잔업 종료
                      <input
                        type="time"
                        value={shift.otEnd}
                        onChange={(e) => shift.setOtEnd(e.target.value)}
                        className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-slate-500">
                      식사시간(분)
                      <input
                        value={shift.otMeal}
                        onChange={(e) => shift.setOtMeal(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="0"
                        className="mt-0.5 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 text-right pt-1.5 border-t border-slate-100">
                    잔업 {shift.info.ot_minutes}분 · 합계{" "}
                    <span className="font-semibold text-navy">
                      {(shift.info.total_minutes ?? 0).toLocaleString()}분
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <label className="block text-sm mt-3">
              <span className="text-slate-600">비고 (이 공정만)</span>
              <input
                value={processNote}
                onChange={(e) => setProcessNote(e.target.value)}
                placeholder="예: 긴급주문으로 특근"
                className={inputCls}
              />
            </label>
            <p className="mt-2 text-right text-sm">
              일 총 작업가능시간:{" "}
              <span className="font-bold text-navy">{preview.total_minutes.toLocaleString()}분</span>
            </p>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
            >
              취소
            </button>
            <button
              onClick={save}
              disabled={saving}
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

function HolidayBulkModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseDateTokens(input), [input]);

  async function submit() {
    if (parsed.length === 0) {
      setError("등록할 날짜를 입력해주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/production-calendar/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "holidays", dates: parsed, note: note || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "등록에 실패했습니다.");
      onSaved(`${data.count ?? 0}일이 휴일로 등록되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-navy">공휴일 일괄 등록</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600">날짜</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={5}
              placeholder={"한 줄에 하나씩, 또는 쉼표로 구분\n예: 2026-01-01\n2026-02-16~2026-02-18"}
              className={`${inputCls} font-mono resize-none`}
            />
            <span className="text-xs text-slate-400 mt-1 block">
              {parsed.length > 0
                ? `${parsed.length}일 인식됨: ${parsed.slice(0, 5).join(", ")}${parsed.length > 5 ? " 외" : ""}`
                : "YYYY-MM-DD 형식, ~로 기간 지정 가능"}
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">비고</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 설날 연휴"
              className={inputCls}
            />
          </label>
          <p className="text-xs text-slate-400">
            선택한 날짜는 모두 근무구분 &quot;휴일&quot;·근무여부 &quot;N&quot;으로 등록됩니다(기존 등록도
            덮어씁니다).
          </p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || parsed.length === 0}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "등록 중..." : `${parsed.length || ""}일 등록`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
