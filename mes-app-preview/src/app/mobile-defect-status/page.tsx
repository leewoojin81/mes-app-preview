"use client";

// 모바일 불량입력 PC 조회(단독 페이지) — 메뉴에는 없고 주소로 연다. 같은 패널이 PROD-07·PROC-06 탭에도 있다.
import MobileDefectPanel from "@/components/MobileDefectPanel";

export default function MobileDefectStatusPage() {
  return <MobileDefectPanel showTitle />;
}
