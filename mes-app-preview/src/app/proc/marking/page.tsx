"use client";

import { useTabState } from "@/lib/use-tab-state";
import DefectHistoryTab from "./DefectHistoryTab";

type Tab = "defect";

const TABS: { v: Tab; label: string }[] = [{ v: "defect", label: "불량이력관리" }];

// 공정관리 "마킹(PROC-06-02)" — 마킹출하공정(PROC-06) 아래 별도 메뉴(2026-11-09 추가).
// 불량이력관리 탭(2026-11-17): 일일작업현황 마킹(P400) 실적에 불량 내용·사진·동영상을 붙인다.
export default function MarkingPage() {
  const [tab, setTab] = useTabState<Tab>("procMarkingTab", "defect");
  return (
    <div>
      <div className="w-full px-4 sm:px-6 pt-6">
        <h1 className="text-xl font-bold text-navy">마킹</h1>
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
      {tab === "defect" && <DefectHistoryTab />}
    </div>
  );
}
