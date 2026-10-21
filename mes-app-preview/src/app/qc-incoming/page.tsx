"use client";

import { useTabState } from "@/lib/use-tab-state";
import SupplyTab from "./SupplyTab";
import NcrTab from "./NcrTab";

type Tab = "supply" | "ncr";

const TABS: { v: Tab; label: string }[] = [
  { v: "supply", label: "부자재" },
  { v: "ncr", label: "부적합" },
];

// 수입검사(QC-03) — 입고검사 대시보드의 부자재 관리대장·부적합 관리대장을 탭으로 옮겼다(2026-10-21).
// 각 탭은 선택됐을 때만 마운트한다.
export default function QcIncomingPage() {
  const [tab, setTab] = useTabState<Tab>("qcInTab", "supply");

  return (
    <div>
      <div className="w-full px-4 sm:px-6 pt-6">
        <h1 className="text-xl font-bold text-navy">수입검사</h1>
        <p className="text-sm text-slate-500 mt-1">QC-03 · 부자재 입고검사 로트 관리 / 부적합 로트 처리(부적합률 10% 이상)</p>
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
      {tab === "supply" && <SupplyTab />}
      {tab === "ncr" && <NcrTab />}
    </div>
  );
}
