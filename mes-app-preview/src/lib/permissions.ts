// 화면단위 접근권한 — "역할(조장/관리자)"이 기본값이고, 그 위에 개별 사용자별 예외
// (user_permissions 테이블)를 얹어 최종 허용 화면 집합을 만든다. Sidebar(메뉴 숨김)와
// proxy.ts(URL 직접 접근 차단)가 getAllowedCodesForUser()로 매 요청 다시 계산해 공유한다
// (세션 쿠키에 스냅샷을 구워두면 재로그인 전까지 새 화면/권한 변경이 반영 안 됐었다).
import type { DatabaseSync } from "node:sqlite";
import { NAV_GROUPS } from "./nav-groups";
import type { Role } from "./auth";

// role='leader' 기본 허용 화면 — 작업자등록(BASE-09)/출퇴근등록(옛 PSN-02) 2개뿐이었던
// 기존 로직을 그대로 기본값으로 유지한다. role='admin'은 전체 화면이 기본값.
// 2026-09-07: 일일근태입력(PSN-01)은 조장이 직접 입력하는 화면이라 기본값에 추가했다 —
// 공정별근무현황(PSN-04)은 관리자용 집계 화면이라 기본값에서 뺐다(필요하면 SYS-01에서
// 개별 예외로 열어줄 것). 같은 날 출퇴근등록(PSN-02)이 삭제되고 그 코드가 원본 ERP 리포트
// 그대로 쌓는 출퇴근카드등록으로 교체되면서, PSN-02도 PSN-04와 같은 이유로 기본값에서
// 뺐다(사용자 확인 완료 — 필요한 조장에게는 개별 예외로 열어줄 것). 근무시간조회(PSN-05)는
// PSN-04와 달리 관리자용 집계가 아니라 조장이 이미 매일 입력하는 PSN-01 데이터를 작업자
// 1명씩 들여다보는 조회 화면(그것도 조장 소속공정 밖 작업자는 403으로 막힘)이라 PSN-01과
// 같이 기본값에 넣었다.
export const LEADER_DEFAULT_CODES = new Set(["BASE-09", "PSN-01", "PSN-05"]);

export const ALL_SCREEN_CODES: string[] = NAV_GROUPS.flatMap((g) => g.children.map((c) => c.code));

// 관리자 기본 허용 화면 — 2026-10-16 기준으로 이미 운영 중인 화면 목록(고정 스냅샷).
// 이 목록에 없는 화면(= 이후 새로 추가되는 모듈)은 관리자도 기본값이 "권한 없음"이라,
// 오픈서버(3001)에 동기화돼도 SYS-01 사용자계정관리에서 사용자별로 열어주기 전까지 보이지 않는다.
// 새 화면을 추가할 때는 이 목록에 코드를 넣지 말 것(INV-06/INV-07이 첫 적용 사례).
// 권한을 열어줄 때 개별 예외(user_permissions)로 처리하며, 화면을 정식 오픈하기로 하면 그때 이 목록에 추가한다.
const ADMIN_DEFAULT_CODES = new Set([
  "BASE-01", "BASE-02", "BASE-03", "BASE-04", "BASE-05", "BASE-06", "BASE-07", "BASE-08", "BASE-09", "BASE-10",
  "PSN-01", "PSN-02", "PSN-03", "PSN-04", "PSN-05", "PSN-06", "PSN-07",
  "SALES-01", "SALES-02", "SALES-03",
  "PLAN-01", "PLAN-02", "PLAN-03",
  "PROD-01", "PROD-02", "PROD-03", "PROD-04", "PROD-05", "PROD-06", "PROD-07", "PROD-10", "PROD-11",
  "INV-01", "INV-02", "INV-03", "INV-04", "INV-05",
  "QC-01", "QC-02",
  "PUR-01", "PUR-02",
  "MGMT-01", "MGMT-02", "MGMT-03", "MGMT-04", "MGMT-05",
  "SYS-01",
]);

export function roleDefaultAllowed(role: Role, code: string): boolean {
  if (role === "admin") return ADMIN_DEFAULT_CODES.has(code);
  return LEADER_DEFAULT_CODES.has(code);
}

export type PermissionOverride = { screen_code: string; allowed: "Y" | "N" };

// role 기본값 + 개별 예외(overrides) -> 최종 허용 화면코드 집합.
export function computeAllowedCodes(role: Role, overrides: PermissionOverride[]): Set<string> {
  const set = new Set(ALL_SCREEN_CODES.filter((code) => roleDefaultAllowed(role, code)));
  for (const o of overrides) {
    if (o.allowed === "Y") set.add(o.screen_code);
    else set.delete(o.screen_code);
  }
  return set;
}

// 세션 쿠키(session.ac)는 로그인 시점에 구운 스냅샷이라, 로그인 이후 화면이 새로 추가되거나
// 사용자계정관리에서 권한을 바꿔도 재로그인 전까진 반영이 안 된다 — 관리자 계정도 예외가
// 아니라서, "메뉴가 잠깐 보였다가 사라지는" 현상(새 화면 추가 후 재로그인 안 한 세션)의
// 원인이었다. proxy.ts/‌api/auth/me는 이제 session.ac를 신뢰하지 않고 role+username마다
// 매 요청 DB에서 다시 계산한다 — role 기본값 변경이든 개별 예외 변경이든 즉시 반영된다.
export function getAllowedCodesForUser(db: DatabaseSync, username: string, role: Role): Set<string> {
  const overrides = db
    .prepare("SELECT screen_code, allowed FROM user_permissions WHERE username = ?")
    .all(username) as PermissionOverride[];
  return computeAllowedCodes(role, overrides);
}

// 페이지 경로 -> 화면코드. nav href 접두어 매칭 중 가장 긴 것을 우선한다(예: /reports/...
// 하위 화면들처럼 접두어가 겹칠 수 있는 경우 대비).
export function codeForPagePath(pathname: string): string | null {
  let best: { code: string; len: number } | null = null;
  for (const g of NAV_GROUPS) {
    for (const c of g.children) {
      if (pathname === c.href || pathname.startsWith(c.href + "/")) {
        if (!best || c.href.length > best.len) best = { code: c.code, len: c.href.length };
      }
    }
  }
  return best?.code ?? null;
}

// 여러 화면이 공유해서 쓰는 기준정보/조회 API — 품목/공정/거래처/설비 검색select, 작업지시·
// 수주 조회 등 서로 다른 화면(BOM/작업지시/수주/생산순위/도수변경현황 등)에서 광범위하게
// 재사용되므로, 소유 화면 하나로 좁혀 막으면 무관한 다른 허용 화면까지 깨진다. 그래서
// 화면권한과 무관하게 로그인만 하면 접근 가능하게 둔다 — 기존 LEADER_ALLOWED_PATH_PREFIXES가
// 조장 2개 화면을 위해 /api/processes를 통째로 열어주던 것과 같은 원리를 전체로 확장.
const SHARED_API_PREFIXES = [
  "/api/items",
  "/api/processes",
  "/api/customers",
  "/api/equipments",
  "/api/work-orders",
  "/api/sales-orders",
  "/api/production-priority",
  "/api/dosu-change",
];

// 위 공유 목록에 없는 API는 화면 하나가 단독으로 쓰므로 그 화면코드로 막는다.
const CODE_API_PREFIXES: Record<string, string[]> = {
  "BASE-03": ["/api/bom"],
  "BASE-05": ["/api/equipments"],
  "BASE-07": ["/api/warehouses"],
  "BASE-08": ["/api/production-calendar", "/api/process-calendar"],
  "BASE-09": ["/api/workers"],
  "BASE-10": ["/api/master-data-change-history"],
  "PSN-01": ["/api/work-hours"],
  "PSN-02": ["/api/attendance-card-status"],
  "PSN-03": ["/api/ppe-items", "/api/ppe-issuances", "/api/ppe-status"],
  "PSN-04": ["/api/work-hours-status"],
  "PSN-05": ["/api/work-hours-lookup"],
  "PSN-06": ["/api/attendance-audit"],
  "PSN-07": ["/api/shift-time-slots"],
  "SALES-01": ["/api/sales-monthly-customer-plan"],
  "SALES-03": ["/api/product-shipment"],
  "PLAN-02": ["/api/item-process-routing", "/api/line-capa-plan"],
  "PLAN-03": ["/api/packaging-schedule"],
  "PROD-02": [
    "/api/production-results",
    "/api/defects",
    "/api/material-inputs",
    "/api/material-lots",
  ],
  "PROD-04": ["/api/process-schedule"],
  "PROD-05": ["/api/work-order-status"],
  "PROD-07": ["/api/defect-type-status"],
  "PROD-10": ["/api/daily-work-status"],
  "PROD-11": ["/api/weekly-report"],
  "PROD-12": ["/api/monthly-report"],
  "INV-01": ["/api/inventory"],
  "INV-02": ["/api/inventory-status"],
  "INV-03": ["/api/process-wip"],
  "INV-04": ["/api/mold-receipt-status"],
  "INV-05": ["/api/warehouse-transfer-status"],
  "INV-06": ["/api/stock-ledger"],
  "INV-07": ["/api/stock-reconcile"],
  "QC-02": ["/api/bc-distribution", "/api/diameter-distribution", "/api/dosu-distribution"],
  "PUR-01": ["/api/purchase-orders"],
  "PUR-02": ["/api/purchase-receipts"],
  "MGMT-01": ["/api/dashboard"],
  "MGMT-02": ["/api/analytics/monthly-orders"],
  "MGMT-03": ["/api/analytics/customers"],
  "MGMT-04": ["/api/analytics/sales-dashboard"],
  "MGMT-05": ["/api/production-status"],
  "SYS-01": ["/api/users"],
};

export function codeForApiPath(pathname: string): string | null {
  for (const prefix of SHARED_API_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return null;
  }
  for (const [code, prefixes] of Object.entries(CODE_API_PREFIXES)) {
    for (const prefix of prefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + "/")) return code;
    }
  }
  return null;
}

export function isPathAllowed(pathname: string, allowedCodes: Set<string>): boolean {
  const code = pathname.startsWith("/api/") ? codeForApiPath(pathname) : codeForPagePath(pathname);
  if (!code) return true; // 화면코드로 매핑 안 되는 경로(공유 API, 로그인 등)는 로그인만 하면 통과
  return allowedCodes.has(code);
}
