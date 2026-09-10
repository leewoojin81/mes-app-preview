"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_GROUPS, type NavGroup } from "@/lib/nav-groups";
import ChangePasswordModal from "./ChangePasswordModal";

// 현재 경로가 속한 대분류(있으면) 라벨을 찾는다 — 아코디언 초기/자동 펼침 기준.
function activeGroupLabel(pathname: string | null): string | null {
  return NAV_GROUPS.find((g) => g.children.some((c) => pathname?.startsWith(c.href)))?.label ?? null;
}

// 로그인한 사용자의 최종 허용 화면(역할 기본값 + 사용자계정관리에서 설정한 개별 예외,
// /api/auth/me의 allowedCodes)만 남긴다 — 그 외 대분류는 자식이 다 걸러져 빈 그룹이
// 되므로 통째로 안 보인다.
function filterByAllowedCodes(groups: NavGroup[], allowedCodes: string[] | null): NavGroup[] {
  if (!allowedCodes) return groups;
  const allowed = new Set(allowedCodes);
  return groups
    .map((g) => ({ ...g, children: g.children.filter((c) => allowed.has(c.code)) }))
    .filter((g) => g.children.length > 0);
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{
    username: string;
    role: string;
    displayName: string;
    allowedCodes: string[];
  } | null>(null);

  useEffect(() => {
    if (pathname === "/login") return;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
  }, [pathname]);

  const navGroups = filterByAllowedCodes(NAV_GROUPS, me?.allowedCodes ?? null);

  // 아코디언 — 한 번에 하나의 대분류만 펼쳐진다. 처음엔 현재 화면이 속한
  // 대분류로 시작하고, 화면(탭)을 이동하면 그 화면이 속한 대분류로 따라간다.
  const [openGroup, setOpenGroup] = useState<string | null>(() => activeGroupLabel(pathname));

  useEffect(() => {
    const label = activeGroupLabel(pathname);
    if (label) setOpenGroup(label);
  }, [pathname]);

  const [showChangePassword, setShowChangePassword] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (pathname === "/login") return null;

  return (
    <aside className="w-56 shrink-0 bg-navy-dark text-white flex flex-col sticky top-0 h-screen print:hidden">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <div className="w-9 h-9 rounded-md bg-white flex items-center justify-center shrink-0 p-1">
          <Image
            src="/medios-logo.png"
            alt="메디오스"
            width={36}
            height={36}
            priority
            className="w-full h-full object-contain"
          />
        </div>
        <div className="leading-tight">
          <p className="font-semibold text-sm">메디오스 MES</p>
          <p className="text-[11px] text-white/60">1단계 프로토타입</p>
        </div>
      </div>
      <nav className="flex-1 py-3 overflow-y-auto">
        <ul className="space-y-1.5">
          {navGroups.map((group) => {
            const groupActive = group.children.some((c) =>
              pathname?.startsWith(c.href)
            );
            const hasChildren = group.children.length > 0;
            const isOpen = hasChildren && openGroup === group.label;
            return (
              <li key={group.label}>
                <button
                  type="button"
                  onClick={() =>
                    hasChildren &&
                    setOpenGroup((prev) => (prev === group.label ? null : group.label))
                  }
                  aria-expanded={hasChildren ? isOpen : undefined}
                  className={`w-full flex items-center gap-2.5 pl-3 pr-4 py-2.5 border-l-4 text-[13.5px] font-semibold tracking-wide transition-colors ${
                    isOpen ? "border-gold bg-white/[0.07]" : "border-transparent"
                  } ${
                    !hasChildren
                      ? "text-white/35 cursor-default"
                      : groupActive
                        ? "text-gold cursor-pointer hover:bg-white/10"
                        : "text-white/80 cursor-pointer hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {hasChildren ? (
                    <span className="w-3.5 shrink-0 text-[10px]">{isOpen ? "▼" : "▶"}</span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-white/25" />
                  )}
                  <span className="flex-1 text-left">{group.label}</span>
                  {!hasChildren && (
                    <span className="text-[9px] font-normal normal-case border border-white/15 rounded px-1 py-px text-white/35">
                      준비중
                    </span>
                  )}
                </button>
                {isOpen && (
                  <ul className="bg-white/[0.035] py-1 space-y-0.5">
                    {group.children.map((item) => {
                      const active = pathname?.startsWith(item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-2.5 pl-9 pr-4 py-2.5 border-l-4 text-[12px] transition-colors ${
                              active
                                ? "border-gold bg-gold/15 text-gold font-semibold"
                                : "border-transparent text-white/70 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <span className="flex-1">{item.label}</span>
                            <span className="text-[10px] opacity-50">
                              {item.code}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="px-4 py-3 border-t border-white/10 text-[11px] text-white/50">
        {me && (
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="text-white/70 truncate">
              {me.displayName}
              <span className="ml-1 text-white/40">
                ({me.role === "admin" ? "관리자" : "조장"})
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowChangePassword(true)}
                className="text-white/50 hover:text-white underline underline-offset-2"
              >
                비밀번호 변경
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="text-white/50 hover:text-white underline underline-offset-2"
              >
                로그아웃
              </button>
            </span>
          </div>
        )}
        메디오스 v0.2 프로토타입
      </div>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </aside>
  );
}
