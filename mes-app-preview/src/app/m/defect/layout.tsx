import type { Metadata } from "next";

// 모바일 불량입력 — 홈 화면에 추가했을 때 앱처럼 열리도록(아이폰 사파리)
export const metadata: Metadata = {
  title: "불량입력",
  appleWebApp: { capable: true, title: "불량입력", statusBarStyle: "default" },
};

export default function MobileDefectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
