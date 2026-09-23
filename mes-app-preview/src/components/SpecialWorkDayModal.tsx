"use client";

import { useState } from "react";
import MultiDateCalendarPicker from "@/components/MultiDateCalendarPicker";

// PSN-05(근무시간조회) "특근일" 기능(2026-09-08 사용자 요청) — 화면에서 이미 선택된
// 작업자들(부모의 workGroup/employeeNo 필터) 기준으로, 달력에서 고른 특근일들의 PSN-01
// 저장 실근무시간을 읽어 기본/연장 근무시간과 금액을 계산해 엑셀로 내려받는다. 계산 자체는
// 서버(export-special/route.ts)에서 하고, 이 팝업은 입력(날짜/시급)을 모아 다운로드
// 요청만 보낸다.
export default function SpecialWorkDayModal({
  workGroup,
  employeeNo,
  onClose,
}: {
  workGroup: string;
  employeeNo: string;
  onClose: () => void;
}) {
  const [dates, setDates] = useState<string[]>([]);
  const [wage, setWage] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 시급/기본근무 시급/연장근무 시급은 내부적으로 콤마 없는 숫자 문자열로 들고 있다가
  // 화면에는 "10,600" 형태로 천단위 콤마 + "원" 단위를 붙여 보여준다(2026-09-23 사용자
  // 요청). <input type="number">는 콤마 표시를 못 해 text + inputMode="numeric"으로 바꿨다.
  function onlyDigits(v: string): string {
    return v.replace(/[^\d]/g, "");
  }
  function formatWon(v: string): string {
    return v === "" ? "" : Number(v).toLocaleString("ko-KR");
  }

  // 시급을 넣으면 기본근무 시급(1.5배)/연장근무 시급(2.0배)을 자동계산해 채운다(2026-09-23
  // 사용자 요청). 기본/연장 시급칸은 그대로 남겨둬서, 자동계산된 값을 사람이 다시 손으로
  // 고칠 수도 있다(그 뒤엔 시급을 다시 바꾸기 전까진 그대로 유지됨).
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
      a.download = `특근일_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-navy">특근일</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              현재 화면에 선택된 작업자 기준으로, 아래에서 고른 특근일들의 PSN-01 저장 근무시간을
              읽어 기본/연장 근무시간과 금액을 계산해 엑셀로 내려받습니다.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <MultiDateCalendarPicker selected={dates} onChange={setDates} />
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-slate-500">선택한 특근일 ({dates.length}일)</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-28 overflow-auto border border-slate-100 rounded-md p-2 bg-slate-50/60">
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

              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">시급</label>
                  <div className="relative mt-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatWon(wage)}
                      onChange={(e) => handleWageChange(onlyDigits(e.target.value))}
                      placeholder="예: 10,600"
                      className="w-full border border-slate-300 rounded-md pl-3 pr-8 py-2 text-sm text-right"
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 pointer-events-none">
                      원
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
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
                      className="w-full border border-slate-300 rounded-md pl-3 pr-8 py-2 text-sm text-right"
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 pointer-events-none">
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
                      className="w-full border border-slate-300 rounded-md pl-3 pr-8 py-2 text-sm text-right"
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 pointer-events-none">
                      원
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            취소
          </button>
          <button
            onClick={download}
            disabled={!canDownload}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 transition-colors"
          >
            {downloading ? "다운로드 중..." : "다운로드"}
          </button>
        </div>
      </div>
    </div>
  );
}
