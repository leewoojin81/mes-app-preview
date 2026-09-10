// 품질관리 "직경 분포 분석(QC-03)" 화면이 쓰는 WHERE 절 빌더.
// daily_work_status(일일작업현황, PROD-10과 같은 원본 테이블)에서 형명(json_extract)·
// 몰드(=품목코드, item_code 컬럼)·작업일자(work_date) 조건만 걸면 된다. HEMA No는
// 그룹 안에서 나누는 축이라 여기서 필터링하지 않는다. (B.C 분포 분석/QC-02와 동일 구조)

export type DiameterDistributionFilterParam = "model" | "mold";

export function buildDiameterDistributionWhere(
  params: URLSearchParams,
  opts?: { skipParams?: DiameterDistributionFilterParam[] }
): { where: string; args: string[] } {
  const conditions: string[] = [];
  const args: string[] = [];
  const skip = new Set(opts?.skipParams ?? []);

  if (!skip.has("model")) {
    const model = params.get("model");
    if (model) {
      conditions.push(`json_extract(detail, '$."형명"') = ?`);
      args.push(model);
    }
  }
  if (!skip.has("mold")) {
    const mold = params.get("mold");
    if (mold) {
      conditions.push("item_code = ?");
      args.push(mold);
    }
  }

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

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
