// 품목 목록/엑셀 다운로드/필터 옵션 API가 공유하는 WHERE 절 빌더.
// 품목계정·대분류·중분류·소분류는 원본 엑셀 컬럼(detail JSON)이라 json_extract로 조회한다.

export const DETAIL_FILTERS = [
  { param: "acct", key: "품목계정" },
  { param: "cat1", key: "대분류" },
  { param: "cat2", key: "중분류" },
  { param: "cat3", key: "소분류" },
] as const;

export type DetailFilterParam = (typeof DETAIL_FILTERS)[number]["param"];

// 숫자로 저장된 값도 문자열 파라미터와 비교되도록 항상 TEXT로 캐스팅
export function detailExpr(key: string): string {
  return `CAST(json_extract(detail, '$.${key}') AS TEXT)`;
}

export function buildItemWhere(
  params: URLSearchParams,
  opts?: { skipParam?: DetailFilterParam }
): { where: string; args: string[] } {
  const conditions: string[] = [];
  const args: string[] = [];

  const category = params.get("category");
  if (category && category !== "전체") {
    conditions.push("category = ?");
    args.push(category);
  }
  // cats=완제품,반제품 — 화면 범위 제한용 복수 분류 필터 (category와 병행 가능)
  const cats = params
    .get("cats")
    ?.split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (cats && cats.length) {
    conditions.push(`category IN (${cats.map(() => "?").join(",")})`);
    args.push(...cats);
  }
  // 사용여부: use=Y(사용) / use=N(중단), 없으면 전체.
  // 화면의 사용여부 컬럼(원본 엑셀 값, detail JSON)과 항상 일치하도록
  // detail을 우선 참조하고 use_yn 컬럼은 fallback으로만 쓴다.
  const use = params.get("use");
  if (use === "Y" || use === "N") {
    conditions.push(
      "COALESCE(json_extract(detail, '$.사용여부'), use_yn) = ?"
    );
    args.push(use);
  }
  // 대표품목: 품목코드가 "00000-000" 형태(대시 1개)인 품목.
  // "00000-000-0000" 같은 변형코드는 대시가 2개 이상이라 제외된다.
  if (params.get("rep") === "1") {
    conditions.push(
      "(LENGTH(item_code) - LENGTH(REPLACE(item_code, '-', ''))) = 1"
    );
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR item_name LIKE ? OR spec LIKE ? OR ${detailExpr("품목군")} LIKE ?)`
    );
    const like = `%${search}%`;
    args.push(like, like, like, like);
  }
  for (const f of DETAIL_FILTERS) {
    if (opts?.skipParam === f.param) continue;
    const v = params.get(f.param)?.trim();
    if (v) {
      conditions.push(`${detailExpr(f.key)} = ?`);
      args.push(v);
    }
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    args,
  };
}
