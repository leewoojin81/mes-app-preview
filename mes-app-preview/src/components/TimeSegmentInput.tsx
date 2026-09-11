"use client";

import { useEffect, useRef, useState } from "react";

// 브라우저 기본 time input(특히 Windows Chrome)은 lang 속성을 줘도 OS 지역 설정을
// 따라 오전/오후로 표시되는 경우가 있어(2026-09-11 사용자 확인), 시/분/초를
// DateSegmentInput과 같은 방식으로 별도 칸으로 분리해 항상 24시간제 숫자만
// 보이게 한다. 위/아래 화살표로 각 자리를 조절할 수 있다.
export default function TimeSegmentInput({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string; // "HH:MM:SS" 또는 "HH:MM", 불완전하면 ""
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  function parse(v: string) {
    const m = v.trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return { h: "", mi: "", s: "" };
    return { h: m[1].padStart(2, "0"), mi: m[2].padStart(2, "0"), s: m[3] ? m[3].padStart(2, "0") : "" };
  }

  const initial = parse(value);
  const [h, setH] = useState(initial.h);
  const [mi, setMi] = useState(initial.mi);
  const [s, setS] = useState(initial.s);
  const hRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const sRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);

  function emit(nh: string, nm: string, ns: string) {
    const next = nh.length === 2 && nm.length === 2 ? `${nh}:${nm}:${ns.length === 2 ? ns : "00"}` : "";
    lastEmitted.current = next;
    onChange(next);
  }

  useEffect(() => {
    if (value !== lastEmitted.current) {
      const p = parse(value);
      setH(p.h);
      setMi(p.mi);
      setS(p.s);
      lastEmitted.current = value;
    }
  }, [value]);

  function wrap(cur: string, dir: 1 | -1, max: number): string {
    return String((((Number(cur) || 0) + dir) % (max + 1) + (max + 1)) % (max + 1)).padStart(2, "0");
  }

  const boxCls =
    className ??
    `flex items-center gap-1 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm font-mono ${
      disabled ? "bg-slate-50" : "bg-white"
    }`;
  const segCls = "w-5 outline-none bg-transparent text-center disabled:text-slate-300";

  return (
    <div className={boxCls}>
      <input
        ref={hRef}
        type="text"
        inputMode="numeric"
        placeholder="HH"
        value={h}
        maxLength={2}
        disabled={disabled}
        className={segCls}
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          setH(digits);
          emit(digits, mi, s);
          if (digits.length === 2) mRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            const next = wrap(h, 1, 23);
            setH(next);
            emit(next, mi, s);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = wrap(h, -1, 23);
            setH(next);
            emit(next, mi, s);
          }
        }}
      />
      <span className="text-slate-400">:</span>
      <input
        ref={mRef}
        type="text"
        inputMode="numeric"
        placeholder="MM"
        value={mi}
        maxLength={2}
        disabled={disabled}
        className={segCls}
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          setMi(digits);
          emit(h, digits, s);
          if (digits.length === 2) sRef.current?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && mi === "") hRef.current?.focus();
          if (e.key === "ArrowUp") {
            e.preventDefault();
            const next = wrap(mi, 1, 59);
            setMi(next);
            emit(h, next, s);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = wrap(mi, -1, 59);
            setMi(next);
            emit(h, next, s);
          }
        }}
      />
      <span className="text-slate-400">:</span>
      <input
        ref={sRef}
        type="text"
        inputMode="numeric"
        placeholder="SS"
        value={s}
        maxLength={2}
        disabled={disabled}
        className={segCls}
        onFocus={(e) => e.target.select()}
        onMouseUp={(e) => e.preventDefault()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          setS(digits);
          emit(h, mi, digits);
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && s === "") mRef.current?.focus();
          if (e.key === "ArrowUp") {
            e.preventDefault();
            const next = wrap(s, 1, 59);
            setS(next);
            emit(h, mi, next);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const next = wrap(s, -1, 59);
            setS(next);
            emit(h, mi, next);
          }
        }}
      />
    </div>
  );
}
