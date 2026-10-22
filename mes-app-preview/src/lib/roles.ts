// 계정 권한레벨 — 화면(클라이언트)에서도 쓰므로 node:crypto를 쓰는 auth.ts와 분리해 둔다.
// 운영자(operator, 2026-10-22 추가)는 관리자의 모든 권한에 더해 기준정보 삭제를 할 수 있는 최상위 레벨이다.
// 관리자와 같은 기본 화면권한·전체 공정 범위를 가지므로 "관리자 이상" 판정은 isAdminRole로 한다.
export type Role = "leader" | "admin" | "operator";

export const ROLE_LABEL: Record<Role, string> = {
  operator: "운영자",
  admin: "관리자",
  leader: "조장",
};

/** 관리자 이상(관리자·운영자) */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}

/** 요청 본문의 role 값 → Role(모르는 값은 조장) */
export function parseRole(v: unknown): Role {
  return v === "operator" ? "operator" : v === "admin" ? "admin" : "leader";
}
