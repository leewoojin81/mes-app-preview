"use client";

import { useTabState } from "@/lib/use-tab-state";
import BcDistributionView from "@/components/performance/BcDistributionView";
import DiameterDistributionView from "@/components/performance/DiameterDistributionView";
import DosuDistributionView from "@/components/performance/DosuDistributionView";

type Tab = "bc" | "diameter" | "dosu";

const TABS: { v: Tab; label: string }[] = [
  { v: "bc", label: "B.C" },
  { v: "diameter", label: "직경" },
  { v: "dosu", label: "도수" },
];

// 성능 분석(QC-02) — 예전 B.C/직경/도수 분포 분석(QC-02/03/04) 세 화면을 탭으로 묶었다.
// 각 탭은 선택됐을 때만 마운트하며, 필터 상태는 각 뷰의 useTabState가 보존한다.
export default function PerformanceAnalysisPage() {
  const [tab, setTab] = useTabState<Tab>("perfTab", "bc");

  return (
    <div>
      <div className="w-full px-4 sm:px-6 pt-6">
        <h1 className="text-xl font-bold text-navy">성능 분석</h1>
        <p className="text-sm text-slate-500 mt-1">QC-02 · B.C / 직경 / 도수 분포 분석</p>
        <div className="flex gap-1 mt-4 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setTab(t.v)}
              className={`px-5 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === t.v
                  ? "border-navy text-navy"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "bc" && <BcDistributionView />}
      {tab === "diameter" && <DiameterDistributionView />}
      {tab === "dosu" && <DosuDistributionView />}
    </div>
  );
}
