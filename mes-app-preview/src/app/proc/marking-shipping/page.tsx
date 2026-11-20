"use client";

import { useTabState } from "@/lib/use-tab-state";
import LabelScheduleTab from "./LabelScheduleTab";
import OrderFormTab from "./OrderFormTab";

type Tab = "label" | "order";

const TABS: { v: Tab; label: string }[] = [
  { v: "label", label: "라벨일정" },
  { v: "order", label: "오더양식" },
];

// 공정관리 "마킹출하공정(PROC-06)" — 공정에서 쓰던 업무관리를 탭으로 옮긴다.
// 라벨일정: 엑셀 "라벨실적 업무.xlsx" 라벨진행현황 시트(2026-10-23)
// 오더양식: 엑셀 "1 오더양식(ANW) 형명추가ver.xlsx" ANW 본표 + 소/중 박스 라벨(2026-10-26)
export default function MarkingShippingPage() {
  const [tab, setTab] = useTabState<Tab>("procMsTab", "label");

  return (
    <div>
      <div className="w-full px-4 sm:px-6 pt-6">
        <h1 className="text-xl font-bold text-navy">마킹출하공정</h1>
        <p className="text-sm text-slate-500 mt-1">PROC-06 · 공정 업무관리</p>
        <div className="flex gap-1 mt-4 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setTab(t.v)}
              className={`px-5 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === t.v ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "label" && <LabelScheduleTab />}
      {tab === "order" && <OrderFormTab />}
    </div>
  );
}
