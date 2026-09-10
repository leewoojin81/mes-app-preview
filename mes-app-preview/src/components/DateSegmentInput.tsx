"use client";

import { useEffect, useRef, useState } from "react";

// 브라우저 기본 date input은 연도(4자리) 입력 후 월 칸으로 자동으로 넘어가지
// 않는 경우가 있어, 연도/월/일을 별도 칸으로 분리하고 자릿수(4/2/2)를 채우면
// 다음 칸으로 자동 이동하는 방식으로 대체한다.
export default function DateSegmentInput({
  value,
  onChange,
}: {
  value: string; // ISO yyyy-mm-dd, or "" when incomplete
  onChange: (iso: string) => void;
}) {
  const [y, setY] = useState(() => value.slice(0, 4));
  const [m, setM] = useState(() => value.slice(5, 7));
  const [d, setD] = useState(() => value.slice(8, 10));
  const yRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const dRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  // 이 컴포넌트가 직접 emit한 값은 기억해 뒀다가, 그 값과 다른 value가 props로
  // 들어오면(=부모가 외부에서 날짜를 바꿈, 예: 주별/월별 토글의 자동 기간 설정)
  // 화면 표시(y/m/d)도 그에 맞춰 다시 채운다. 타이핑 중간의 미완성 값(emit("")도
  // 포함)은 항상 lastEmitted에 먼저 반영되므로 리렌더 때 덮어써지지 않는다.
  const lastEmitted = useRef(value);

  function emit(ny: string, nm: string, nd: string) {
    const iso = ny.length === 4 && nm.length === 2 && nd.length === 2 ? `${ny}-${nm}-${nd}` : "";
    lastEmitted.current = iso;
    onChange(iso);
  }

  useEffect(() => {
    if (value !== lastEmitted.current && value.length === 10) {
      setY(value.slice(0, 4));
      setM(value.slice(5, 7));
      setD(value.slice(8, 10));
      lastEmitted.current = value;
    }
  }, [value]);

  return (
    <div className="relative flex items-center gap-1 border border-slate-300 rounded-md px-2.5 py-2 text-sm text-slate-600 font-mono">
      <input
        ref={yRef}
        type="text"
        inputMode="numeric"
        placeholder="YYYY"
        value={y}
        maxLength={4}
        className="w-9 outline-none"
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
          setY(digits);
          emit(digits, m, d);
          if (digits.length === 4) mRef.current?.focus();
        }}
      />
      <span className="text-slate-400">-</span>
      <input
        ref={mRef}
        type="text"
        inputMode="numeric"
        placeholder="MM"
        value={m}
        maxLength={2}
        className="w-5 outline-none"
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          setM(digits);
          emit(y, digits, d);
          if (digits.length === 2) dRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && m === "") yRef.current?.focus();
        }}
      />
      <span className="text-slate-400">-</span>
      <input
        ref={dRef}
        type="text"
        inputMode="numeric"
        placeholder="DD"
        value={d}
        maxLength={2}
        className="w-5 outline-none"
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          setD(digits);
          emit(y, m, digits);
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && d === "") mRef.current?.focus();
        }}
      />
      <button
        type="button"
        aria-label="달력에서 날짜 선택"
        className="text-slate-400 hover:text-slate-600"
        onClick={() => {
          try {
            pickerRef.current?.showPicker?.();
          } catch {
            pickerRef.current?.focus();
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        value={y.length === 4 && m.length === 2 && d.length === 2 ? `${y}-${m}-${d}` : ""}
        onChange={(e) => {
          const iso = e.target.value;
          if (!iso) return;
          const [ny, nm, nd] = iso.split("-");
          setY(ny);
          setM(nm);
          setD(nd);
          emit(ny, nm, nd);
        }}
        className="absolute w-0 h-0 opacity-0 pointer-events-none"
      />
    </div>
  );
}
