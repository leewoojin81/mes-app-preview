"use client";

// 불량종합현황(PROD-07) 위에 "ERP 불량종합현황 | 모바일 입력" 탭을 얹는 감싸개(2026-11-20).
// 기존 PROD-07 화면 코드는 그대로 두고(이름만 바꿔 erp로 넘김) 탭만 추가한다.
import type { ReactNode } from "react";
import { useTabState } from "@/lib/use-tab-state";
import MobileDefectPanel from "./MobileDefectPanel";

type Tab = "erp" | "mobile";

export default function MobileDefectTabs({ erp, erpLabel = "ERP 불량종합현황", stateKey = "prod07MobileTab" }: { erp: ReactNode; erpLabel?: string; stateKey?: string }) {
  const [tab, setTab] = useTabState<Tab>(stateKey, "erp");
  const tabs: { v: Tab; label: string }[] = [
    { v: "erp", label: erpLabel },
    { v: "mobile", label: "모바일 입력" },
  ];
  return (
    <div>
      <div className="w-full px-4 sm:px-6 pt-4">
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((t) => (
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
      {tab === "erp" ? erp : <MobileDefectPanel />}
    </div>
  );
}
