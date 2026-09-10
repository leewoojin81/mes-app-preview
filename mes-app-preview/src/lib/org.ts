// 회사 조직구조 분류 — 사용자계정관리(SYS-01) 계정에 붙는 소속팀/구분/직급.
// 지금 당장은 권한 계산에 쓰이지 않는 순수 분류 정보이고, 이후 별도 작업에서 이
// 조합(예: "생산팀+현장직+조장")별로 화면 접근권한 기본값을 매핑하는 규칙을 추가할
// 예정이다(src/lib/permissions.ts의 role 기반 기본값과는 별개 축).
export const TEAMS = [
  "인사팀",
  "구매팀",
  "재경팀",
  "마케팅팀",
  "디자인팀",
  "품질인증팀",
  "연구소",
  "생산기술팀",
  "공정QC팀",
  "생산팀",
] as const;
export type Team = (typeof TEAMS)[number];

export const EMPLOYMENT_TYPES = ["관리직", "현장직"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

// 직급 선택지는 구분(관리직/현장직)에 따라 달라진다 — 구분을 먼저 골라야 직급을
// 고를 수 있다(화면/API 양쪽에서 이 표를 기준으로 유효성을 검사한다).
export const POSITIONS_BY_EMPLOYMENT_TYPE: Record<EmploymentType, readonly string[]> = {
  관리직: ["사원", "대리", "과장", "차장", "부장", "이사", "상무", "전무", "부사장", "사장"],
  현장직: ["조원", "라인장", "조장", "반장"],
};

export function isValidTeam(v: unknown): v is Team {
  return typeof v === "string" && (TEAMS as readonly string[]).includes(v);
}

export function isValidEmploymentType(v: unknown): v is EmploymentType {
  return typeof v === "string" && (EMPLOYMENT_TYPES as readonly string[]).includes(v);
}

// position이 employmentType의 직급 목록에 속하는지 검사한다. employmentType이 없으면
// (구분 미지정) 어떤 직급도 유효하지 않다 — 구분 없이 직급만 저장되는 상태를 막는다.
export function isValidPosition(employmentType: EmploymentType | null, v: unknown): v is string {
  if (!employmentType || typeof v !== "string") return false;
  return POSITIONS_BY_EMPLOYMENT_TYPE[employmentType].includes(v);
}

export type OrgFields = { team: string | null; employment_type: string | null; position: string | null };

// 사용자계정관리(SYS-01) POST/PATCH 요청 바디에서 소속팀/구분/직급을 검증해 뽑아낸다.
// 셋 다 선택값(미지정 허용)이지만, 지정한다면 목록에 있는 값이어야 하고 직급은 반드시
// 구분과 짝이 맞아야 한다(구분 없이 직급만 오는 상태를 막는다).
export function parseOrgFields(body: Record<string, unknown>): OrgFields | { error: string } {
  const teamRaw = body.team;
  const team = teamRaw == null || teamRaw === "" ? null : teamRaw;
  if (team !== null && !isValidTeam(team)) {
    return { error: "소속팀 값이 올바르지 않습니다." };
  }

  const employmentTypeRaw = body.employment_type;
  const employmentType = employmentTypeRaw == null || employmentTypeRaw === "" ? null : employmentTypeRaw;
  if (employmentType !== null && !isValidEmploymentType(employmentType)) {
    return { error: "구분 값이 올바르지 않습니다." };
  }

  const positionRaw = body.position;
  const position = positionRaw == null || positionRaw === "" ? null : positionRaw;
  if (position !== null) {
    if (!employmentType) {
      return { error: "직급을 지정하려면 구분을 먼저 선택해야 합니다." };
    }
    if (!isValidPosition(employmentType, position)) {
      return { error: "직급 값이 구분과 맞지 않습니다." };
    }
  }

  return { team, employment_type: employmentType, position };
}
