"use client";

import { useState } from "react";
import { isKrPublicHoliday } from "@/lib/kr-holidays";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 달력에서 여러 날짜를 클릭으로 토글 선택하는 컴포넌트(PSN-05 "특근일" 기능,
// 2026-09-08 사용자 요청) — 이 저장소엔 날짜 라이브러리가 없어 순수 Date 계산으로
// 월 그리드를 만든다. 선택값은 "YYYY-MM-DD" 문자열 배열(정렬 보장 없음, 호출부에서
// 필요시 정렬)로 관리한다.
export default function MultiDateCalendarPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (dates: string[]) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() }; // month: 0-11
  });

  const selectedSet = new Set(selected);

  function toggle(dateStr: string) {
    if (selectedSet.has(dateStr)) onChange(selected.filter((d) => d !== dateStr));
    else onChange([...selected, dateStr].sort());
  }

  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=일
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${cursor.year}-${pad2(cursor.month + 1)}-${pad2(day)}`);
  }

  return (
    <div className="border border-slate-200 rounded-md p-3 w-full max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))
          }
          className="px-2 py-1 text-slate-500 hover:text-navy"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-slate-700">
          {cursor.year}년 {cursor.month + 1}월
        </span>
        <button
          type="button"
          onClick={() =>
            setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))
          }
          className="px-2 py-1 text-slate-500 hover:text-navy"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400 mb-1">
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((dateStr, idx) => {
          if (!dateStr) return <div key={idx} />;
          const weekday = idx % 7;
          const isSelected = selectedSet.has(dateStr);
          const isHoliday = isKrPublicHoliday(dateStr);
          const day = Number(dateStr.slice(8, 10));
          let colorClass = "text-slate-600";
          if (weekday === 0) colorClass = "text-rose-600";
          else if (weekday === 6) colorClass = "text-blue-600";
          else if (isHoliday) colorClass = "text-rose-600";
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => toggle(dateStr)}
              className={`aspect-square rounded-md text-sm transition-colors ${
                isSelected
                  ? "bg-navy text-white font-semibold"
                  : `hover:bg-slate-100 ${colorClass}`
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
