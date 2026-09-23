// 출퇴근카드등록(PSN-02) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

export function buildAttendanceCardWhere(params: URLSearchParams): {
  where: string;
  args: string[];
} {
  const conditions: string[] = [];
  const args: string[] = [];

  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    conditions.push("work_date >= ?");
    args.push(dateFrom);
  }
  const dateTo = params.get("dateTo");
  if (dateTo) {
    conditions.push("work_date <= ?");
    args.push(dateTo);
  }
  const org = params.get("org");
  if (org) {
    conditions.push("org = ?");
    args.push(org);
  }
  // 정확히 일치하는 사원번호(비즈사번) 한 명만 찾을 때 쓴다 — search(LIKE)와 달리 부분
  // 일치를 허용하지 않는다. 신규 등록(PSN-02) 팝업의 이름 자동완성이 그 사람의 최근
  // 조직·직급을 가져올 때 쓴다(2026-09-24 사용자 요청).
  const employeeNo = params.get("employeeNo");
  if (employeeNo) {
    conditions.push("employee_no = ?");
    args.push(employeeNo);
  }
  const team = params.get("team");
  if (team) {
    conditions.push("team = ?");
    args.push(team);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push("(employee_no LIKE ? OR worker_name LIKE ?)");
    args.push(`%${search}%`, `%${search}%`);
  }
  // "수정" 필터(2026-09-24 사용자 요청) — 업로드 이후 사람이 손으로 고친 행(edited_fields
  // 있는 행)만 본다. PATCH([id]/route.ts)가 실제로 바뀐 게 없으면 null로 저장하므로
  // NOT NULL 조건만으로 충분하다.
  if (params.get("edited") === "1") {
    conditions.push("edited_fields IS NOT NULL");
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
