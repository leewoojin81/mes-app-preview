"use client";

import { useTabs } from "./TabsProvider";

export default function TabBar() {
  const { tabs, activePath, switchTab, closeTab } = useTabs();

  if (activePath === "/login" || tabs.length === 0) return null;

  return (
    <div className="flex items-stretch border-b border-slate-200 bg-slate-100 overflow-x-auto print:hidden">
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
