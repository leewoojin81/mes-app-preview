"use client";

import { useEffect, useRef, useState } from "react";

// 근태 수정 팝업의 시간(잔업/조출/중교/지각/조퇴/외출/지원시간) 입력칸 — 소수 시간(1.5)
// 대신 그리드·미리보기와 같은 "시:분"(1:30) 형식으로 직접 입력한다(2026-09-24 사용자
// 요청). 분 칸에서 위/아래 화살표를 누르면 10분 단위로 움직이고, 59분에서 +10분처럼
// 시를 넘기면 시 칸이 자동으로 올라간다(자정 개념이 없는 순수 소요시간 합산이라 24시간을
// 넘어도 그대로 누적, PSN-06 대사가 24시간 넘는 근무를 다루는 것과 동일). 직접 타이핑한
// 값은 스냅하지 않고 그대로 반영한다 — 10분 단위 검증은 저장 시 validate()가 한다.
export default function HourMinuteInput({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number; // 소수 시간(예: 1.5 = 1시간30분)
  onChange: (hours: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  function toParts(v: number) {
    const totalMinutes = Math.max(0, Math.round((Number.isFinite(v) ? v : 0) * 60));
    return { h: String(Math.floor(totalMinutes / 60)), m: String(totalMinutes % 60).padStart(2, "0") };
  }

  const initial = toParts(value);
  const [h, setH] = useState(initial.h);
  const [m, setM] = useState(initial.m);
  const hRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);

  function emit(nh: string, nm: string) {
    const hours = (Number(nh) || 0) + (Number(nm) || 0) / 60;
    lastEmitted.current = hours;
    onChange(hours);
  }

  useEffect(() => {
    if (value !== lastEmitted.current) {
      const p = toParts(value);
      setH(p.h);
      setM(p.m);
      lastEmitted.current = value;
    }
  }, [value]);

  function stepMinutes(dir: 1 | -1) {
    const totalMinutes = Math.max(0, (Number(h) || 0) * 60 + (Number(m) || 0) + dir * 10);
    const nh = String(Math.floor(totalMinutes / 60));
    const nm = String(totalMinutes % 60).padStart(2, "0");
    setH(nh);
    setM(nm);
    emit(nh, nm);
  }

  function stepHours(dir: 1 | -1) {
    const nh = String(Math.max(0, (Number(h) || 0) + dir));
    setH(nh);
    emit(nh, m);
  }

  const boxCls =
    className ??
    `flex items-center gap-1 w-full justify-end border border-slate-300 rounded-md px-2.5 py-1.5 text-sm font-mono ${
      disabled ? "bg-slate-50" : "bg-white"
    }`;
  const segCls = "w-5 outline-none bg-transparent text-center disabled:text-slate-300";

  return (
    <div className={boxCls}>
      <input
        ref={hRef}
        type="text"
        inputMode="numeric"
        placeholder="0"
        value={h}
        maxLength={2}
        disabled={disabled}
        className={segCls}
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          setH(digits);
          emit(digits, m);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            stepHours(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            stepHours(-1);
          }
        }}
      />
      <span className="text-slate-400">:</span>
      <input
        ref={mRef}
        type="text"
        inputMode="numeric"
        placeholder="00"
        value={m}
        maxLength={2}
        disabled={disabled}
        className={segCls}
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          setM(digits);
          emit(h, digits);
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && m === "") hRef.current?.focus();
          if (e.key === "ArrowUp") {
            e.preventDefault();
            stepMinutes(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            stepMinutes(-1);
          }
        }}
      />
    </div>
  );
}
