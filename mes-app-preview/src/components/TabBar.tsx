"use client";

import { useTabs } from "./TabsProvider";

export default function TabBar() {
  const { tabs, activePath, switchTab, closeTab } = useTabs();

  if (activePath === "/login" || tabs.length === 0) return null;

  // 공정별생산현황(MGMT-05)은 상단 요약을 고정한 화면이라 최근 열어본 페이지 탭바도 같이
  // 상단에 고정한다(2026-09-28 사용자 요청). 탭바 높이(34px)는 그 화면 고정
  // 영역의 sticky top 오프셋(production-status/page.tsx)과 맞아야 한다.
  const stuck = activePath === "/production-status";

  return (
    <div
      className={`flex items-stretch border-b border-slate-200 bg-slate-100 overflow-x-auto print:hidden ${
        stuck ? "sticky top-0 z-30" : ""
      }`}
    >
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div
            key={tab.path}
            role="button"
            tabIndex={0}
            onClick={() => switchTab(tab.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") switchTab(tab.path);
            }}
            title={tab.code ? `${tab.label} (${tab.code})` : tab.label}
            className={`group flex items-center gap-2 pl-3 pr-1.5 py-2 text-xs border-r border-slate-200 cursor-pointer whitespace-nowrap shrink-0 select-none ${
              active
                ? "bg-white text-navy font-semibold border-b-2 border-b-navy -mb-px"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <span>{tab.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.path);
              }}
              aria-label={`${tab.label} 탭 닫기`}
              className="rounded-sm w-4 h-4 flex items-center justify-center leading-none text-sm text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
