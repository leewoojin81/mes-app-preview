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

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
