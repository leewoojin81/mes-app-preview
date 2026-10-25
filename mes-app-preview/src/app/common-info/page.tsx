"use client";

import { useTabState } from "@/lib/use-tab-state";
import ModelNameTab from "./ModelNameTab";

type Tab = "model";

const TABS: { v: Tab; label: string }[] = [{ v: "model", label: "형명" }];

// 기준정보 "공통정보(BASE-10)" — 여러 화면이 같이 쓰는 기준 값을 탭으로 모은다.
// 형명: 품질 문서 F706-3 형명식별기호 관리대장(2026-10-23)
export default function CommonInfoPage() {
  const [tab, setTab] = useTabState<Tab>("commonInfoTab", "model");

  return (
    <div>
      <div className="w-full px-4 sm:px-6 pt-6">
        <h1 className="text-xl font-bold text-navy">공통정보</h1>
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
      {tab === "model" && <ModelNameTab />}
    </div>
  );
}
