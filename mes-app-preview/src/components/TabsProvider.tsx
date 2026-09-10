"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEM_BY_HREF } from "@/lib/nav-groups";

export type Tab = { path: string; label: string; code?: string };

type TabsContextValue = {
  tabs: Tab[];
  activePath: string;
  switchTab: (path: string) => void;
  closeTab: (path: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

// 탭 목록은 세션 저장소에만 남는다(브라우저를 완전히 새로고침해도 열려있던
// 탭이 사라지지 않도록) — 여러 세션/기기 간에 공유될 필요는 없는 화면 상태다.
const STORAGE_KEY = "mes:open-tabs:v1";

function labelFor(path: string): Tab {
  const nav = NAV_ITEM_BY_HREF[path];
  if (nav) return { path, label: nav.label, code: nav.code };
  // NAV_GROUPS에 없는 하위 경로(향후 상세 페이지 등) 대비 fallback
  const seg = path.split("/").filter(Boolean).pop() ?? path;
  return { path, label: seg };
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  // 최초 마운트 시 세션 저장소에서 열려있던 탭 목록을 복원한다.
  useEffect(() => {
    let restored: Tab[] | null = null;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { paths?: string[] };
        if (Array.isArray(saved.paths) && saved.paths.length > 0) {
          restored = saved.paths.map(labelFor);
        }
      }
    } catch {}
    const base = restored ?? [];
    const withCurrent =
      pathname === "/login" || base.some((t) => t.path === pathname)
        ? base
        : [...base, labelFor(pathname)];
    setTabs(withCurrent);
    setActivePath(pathname);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 경로가 바뀔 때마다(사이드바 클릭, 브라우저 뒤/앞으로 가기 등) 탭 목록에 반영한다.
  // /login은 로그인 화면 자체를 탭으로 남기지 않는다(로그아웃 후 다시 로그인해도 매번
  // "login" 탭이 쌓이는 걸 방지).
  useEffect(() => {
    if (!hydrated) return;
    if (pathname !== "/login") {
      setTabs((prev) => (prev.some((t) => t.path === pathname) ? prev : [...prev, labelFor(pathname)]));
    }
    setActivePath(pathname);
  }, [pathname, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ paths: tabs.map((t) => t.path) }));
    } catch {}
  }, [tabs, hydrated]);

  function switchTab(path: string) {
    if (path !== activePath) router.push(path);
  }

  function closeTab(path: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.path !== path);
      if (path === activePath) {
        const fallback = next[idx - 1] ?? next[idx] ?? next[next.length - 1];
        router.push(fallback ? fallback.path : "/dashboard");
      }
      return next;
    });
  }

  const value = useMemo(
    () => ({ tabs, activePath, switchTab, closeTab }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, activePath]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within TabsProvider");
  return ctx;
}
