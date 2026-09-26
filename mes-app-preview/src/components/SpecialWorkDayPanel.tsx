"use client";

import { useState } from "react";
import MultiDateCalendarPicker from "@/components/MultiDateCalendarPicker";

// PSN-05(근무시간조회) "특근일" 탭(2026-09-08 신설, 2026-09-23 팝업에서 탭 인라인 패널로
// 전환) — 화면 상단 필터(공정/사번)로 이미 좁혀진 작업자들 기준으로, 달력에서 고른
// 특근일들의 PSN-01 저장 실근무시간을 읽어 기본/연장 근무시간과 금액을 계산해 엑셀로
// 내려받는다. 계산 자체는 서버(export-special/route.ts)에서 하고, 이 패널은 입력
// (날짜/시급)을 모아 다운로드 요청만 보낸다.
// 선택한 특근일(dates)은 아래 그리드(SpecialWorkDayGrid)도 같이 쓰므로 부모(page.tsx)가
// 들고 있고, 이 패널은 달력 입력과 시급/다운로드만 맡는다(2026-09-26).
export default function SpecialWorkDayPanel({
  workGroup,
  employeeNo,
  dates,
  onDatesChange: setDates,
}: {
  workGroup: string;
  employeeNo: string;
  dates: string[];
  onDatesChange: (dates: string[]) => void;
}) {
  const [wage, setWage] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("");
  // 야간식대 — 야간 근무(카드 출근 20:00 이후) 1회당 금액. 비우면 0원(야간식대 없음).
  const [nightMeal, setNightMeal] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 시급/기본근무 시급/연장근무 시급은 내부적으로 콤마 없는 숫자 문자열로 들고 있다가
  // 화면에는 "10,600" 형태로 천단위 콤마 + "원" 단위를 붙여 보여준다. <input type="number">는
  // 콤마 표시를 못 해 text + inputMode="numeric"으로 쓴다.
  function onlyDigits(v: string): string {
    return v.replace(/[^\d]/g, "");
  }
  function formatWon(v: string): string {
    return v === "" ? "" : Number(v).toLocaleString("ko-KR");
  }

  // 시급을 넣으면 기본근무 시급(1.5배)/연장근무 시급(2.0배)을 자동계산해 채운다. 기본/연장
  // 시급칸은 그대로 남겨둬서, 자동계산된 값을 사람이 다시 손으로 고칠 수도 있다(그 뒤엔
  // 시급을 다시 바꾸기 전까진 그대로 유지됨).
  function handleWageChange(v: string) {
    setWage(v);
    const n = Number(v);
    if (v !== "" && Number.isFinite(n)) {
      setBaseRate(String(Math.round(n * 1.5)));
      setOvertimeRate(String(Math.round(n * 2.0)));
    }
  }

  const canDownload = dates.length > 0 && baseRate !== "" && overtimeRate !== "" && !downloading;

  async function download() {
    if (!canDownload) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/work-hours-lookup/export-special", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workGroup,
          employeeNo,
          dates,
          baseRate: Number(baseRate),
          overtimeRate: Number(overtimeRate),
          nightMeal: nightMeal === "" ? 0 : Number(nightMeal),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "다운로드에 실패했습니다.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // 파일명은 서버가 정한 값(예: "2026년 09월 특근일근무.xlsx")을 그대로 쓴다.
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      a.download = m ? decodeURIComponent(m[1]) : `특근일_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <p className="text-[11px] text-slate-500 mb-2 max-w-2xl">
        아래 필터로 좁혀진 작업자 기준으로, 여기서 고른 특근일들의 PSN-01 저장 근무시간을
        읽어 양식(정규세부 급여계산: 출근/퇴근/기본·연장근무/급여산출, 야간식대, 계, TTL)대로 엑셀로 내려받습니다.
        야간식대를 넣으면 카드 출근이 20시 이후인 날마다 그 금액이 급여에 합산됩니다.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <MultiDateCalendarPicker selected={dates} onChange={setDates} />
        <div className="flex-1 min-w-0">
          <label className="text-xs font-medium text-slate-500">선택한 특근일 ({dates.length}일)</label>
          <div className="mt-1 flex flex-wrap gap-1 max-h-14 overflow-auto border border-slate-100 rounded-md p-1.5 bg-slate-50/60">
            {dates.length === 0 && <span className="text-xs text-slate-400">달력에서 날짜를 선택하세요.</span>}
            {dates.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-full px-2 py-0.5 text-xs text-slate-600"
              >
                {d}
                <button
                  type="button"
                  onClick={() => setDates(dates.filter((x) => x !== d))}
                  className="text-slate-400 hover:text-rose-600"
                  aria-label={`${d} 선택 해제`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 max-w-md">
            <div>
              <label className="text-xs font-medium text-slate-500">시급</label>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatWon(wage)}
                  onChange={(e) => handleWageChange(onlyDigits(e.target.value))}
                  placeholder="예: 10,600"
                  className="w-full border border-slate-300 rounded-md pl-2 pr-6 py-1 text-xs text-right"
                />
                <span className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-400 pointer-events-none">
                  원
                </span>
              </div>
              <p className="mt-0.5 text-[10px] leading-tight text-slate-400">
                시급을 넣으면 기본근무 시급(×1.5)·연장근무 시급(×2.0)이 자동으로 채워집니다.
                필요하면 아래에서 직접 고칠 수 있습니다.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">기본근무 시급</label>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatWon(baseRate)}
                  onChange={(e) => setBaseRate(onlyDigits(e.target.value))}
                  placeholder="예: 15,900"
                  className="w-full border border-slate-300 rounded-md pl-2 pr-6 py-1 text-xs text-right"
                />
                <span className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-400 pointer-events-none">
                  원
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">연장근무 시급</label>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatWon(overtimeRate)}
                  onChange={(e) => setOvertimeRate(onlyDigits(e.target.value))}
                  placeholder="예: 21,200"
                  className="w-full border border-slate-300 rounded-md pl-2 pr-6 py-1 text-xs text-right"
                />
                <span className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-400 pointer-events-none">
                  원
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">야간식대</label>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatWon(nightMeal)}
                  onChange={(e) => setNightMeal(onlyDigits(e.target.value))}
                  placeholder="예: 4,000"
                  className="w-full border border-slate-300 rounded-md pl-2 pr-6 py-1 text-xs text-right"
                />
                <span className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-400 pointer-events-none">
                  원
                </span>
              </div>
              <p className="mt-0.5 text-[10px] leading-tight text-slate-400">
                야간 근무(카드 출근 20시 이후) 1회당 금액입니다. 비워 두면 야간식대 없이 계산합니다.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      <div className="mt-2 flex justify-end">
        <button
          onClick={download}
          disabled={!canDownload}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 transition-colors"
        >
          {downloading ? "다운로드 중..." : "다운로드"}
        </button>
      </div>
    </div>
  );
}
