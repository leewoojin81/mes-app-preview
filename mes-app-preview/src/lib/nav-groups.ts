// 사이드바 메뉴 구조 — 탭바(TabsProvider)가 경로별 탭 제목/코드를 찾을 때도
// 이 목록을 그대로 참조한다(하나의 소스만 유지).
export type NavChild = { href: string; label: string; code: string };
export type NavGroup = { label: string; children: NavChild[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "기준정보",
    children: [
      { href: "/items", label: "제품정보", code: "BASE-01" },
      { href: "/materials", label: "자재정보", code: "BASE-02" },
      { href: "/bom", label: "BOM정보", code: "BASE-03" },
      { href: "/processes", label: "공정정보", code: "BASE-04" },
      { href: "/equipments", label: "설비정보", code: "BASE-05" },
      { href: "/customers", label: "거래처정보", code: "BASE-06" },
      { href: "/warehouses", label: "창고정보", code: "BASE-07" },
      { href: "/production-calendar", label: "생산캘린더", code: "BASE-08" },
      { href: "/workers", label: "작업자정보", code: "BASE-09" },
      { href: "/master-data-change-history", label: "기준정보변경이력", code: "BASE-10" },
    ],
  },
  {
    label: "인원관리",
    children: [
      { href: "/work-hours", label: "일일근태입력", code: "PSN-01" },
      { href: "/attendance-card-status", label: "출퇴근카드등록", code: "PSN-02" },
      { href: "/ppe-issuance", label: "보호구지급관리", code: "PSN-03" },
      { href: "/work-hours-status", label: "공정별근무현황", code: "PSN-04" },
      { href: "/work-hours-lookup", label: "근무시간조회", code: "PSN-05" },
      { href: "/attendance-audit", label: "근태대사", code: "PSN-06" },
      { href: "/shift-time-slots", label: "근무시간정보", code: "PSN-07" },
    ],
  },
  {
    label: "영업관리",
    children: [
      { href: "/sales-monthly-target", label: "월별수주(목표)", code: "SALES-01" },
      { href: "/sales-orders", label: "수주등록", code: "SALES-02" },
      { href: "/product-shipment", label: "제품출고등록", code: "SALES-03" },
    ],
  },
  {
    label: "생산계획",
    children: [
      { href: "/production-priority", label: "생산순위지정", code: "PLAN-01" },
      { href: "/plan-info", label: "계획정보", code: "PLAN-02" },
    ],
  },
  {
    label: "생산관리",
    children: [
      { href: "/work-orders", label: "작업지시발행", code: "PROD-01" },
      { href: "/pop", label: "POP 실적입력", code: "PROD-02" },
      { href: "/work-order-register", label: "작업지시등록", code: "PROD-03" },
      { href: "/process-schedule", label: "공정표발행", code: "PROD-04" },
      { href: "/work-order-status", label: "작업지시현황", code: "PROD-05" },
      { href: "/dosu-change", label: "도수변경등록", code: "PROD-06" },
      { href: "/defect-type-status", label: "불량종합현황", code: "PROD-07" },
      { href: "/daily-work-status", label: "일일작업현황", code: "PROD-10" },
    ],
  },
  {
    label: "재고관리",
    children: [
      { href: "/inventory", label: "실시간 재고", code: "INV-01" },
      { href: "/inventory-status", label: "현재고현황", code: "INV-02" },
      { href: "/process-wip", label: "공정재공현황", code: "INV-03" },
      { href: "/mold-receipt-status", label: "MOLD입고현황", code: "INV-04" },
    ],
  },
  {
    label: "품질관리",
    children: [
      { href: "/dosu-trend", label: "도수변경현황", code: "QC-01" },
      { href: "/bc-distribution", label: "B.C 분포 분석", code: "QC-02" },
      { href: "/diameter-distribution", label: "직경 분포 분석", code: "QC-03" },
      { href: "/dosu-distribution", label: "도수 분포 분석", code: "QC-04" },
    ],
  },
  {
    label: "구매관리",
    children: [
      { href: "/purchase-orders", label: "구매발주등록", code: "PUR-01" },
      { href: "/purchase-receipts", label: "구매입고등록", code: "PUR-02" },
    ],
  },
  {
    label: "경영정보",
    children: [
      { href: "/dashboard", label: "실시간 대시보드", code: "MGMT-01" },
      { href: "/reports/monthly-orders", label: "월별수주현황", code: "MGMT-02" },
      { href: "/reports/customer-orders", label: "거래처별수주추이", code: "MGMT-03" },
      { href: "/reports/sales-dashboard", label: "월별수주현황분석", code: "MGMT-04" },
    ],
  },
  {
    label: "시스템관리",
    children: [{ href: "/users", label: "사용자계정관리", code: "SYS-01" }],
  },
];

// href -> {label, code} 조회용 flat map (탭 제목 표시에 사용)
export const NAV_ITEM_BY_HREF: Record<string, { label: string; code: string }> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.children).map((c) => [c.href, { label: c.label, code: c.code }])
);
