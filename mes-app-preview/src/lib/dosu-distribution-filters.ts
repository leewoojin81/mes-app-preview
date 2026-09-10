// 품질관리 "도수 분포 분석(QC-04)" 화면이 쓰는 WHERE 절 빌더.
// daily_work_status(일일작업현황, PROD-10과 같은 원본 테이블)에서 형명(json_extract)·
// 몰드(=품목코드, item_code 컬럼)·작업일자(work_date) 조건만 걸면 된다. HEMA No는
// 그룹 안에서 나누는 축이라 여기서 필터링하지 않는다. (B.C 분포 분석/QC-02, 직경 분포
// 분석/QC-03과 완전히 동일한 구조)

export type DosuDistributionFilterParam = "model" | "mold";

export function buildDosuDistributionWhere(
  params: URLSearchParams,
  opts?: { skipParams?: DosuDistributionFilterParam[] }
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

// item_code 마지막 "-NNNN"(4자리 숫자) 세그먼트가 지시도수(목표 파워) 절대값×100이다
// (2026-08-26 실측 검증: 예 "39A31-001-0300"→3.00D 자리, "28A82-001-0175"→1.75D 자리,
// "-0000"→0.00D(무도수) — 같은 item_code의 실측 도수1/2/3 중앙값 절대값이 이 값과
// 거의 일치하고, 이 접미사가 항상 0.25D 배수라 이 공장의 도수 발주 단위(1/4D)와도
// 맞는다). daily_work_status 원본은 부호 없이 절대값만 기록하지만(전 샘플 확인 결과
// 크기 0.5D를 넘는 값은 전부 양수), 이 공장 제품은 전부 근시(마이너스) 렌즈라 실제
// 표기 관례는 음수다(참고 엑셀 도수분포분석.xlsx, 2026-08-26 사용자 확인) — 그래서
// 여기서 부호를 뒤집어 반환한다. 접미사가 4자리 숫자로 안 끝나면(원부자재 등 도수
// 개념이 없는 품목) 지시도수를 알 수 없어 그 행은 제외한다. route.ts(메인 집계)와
// filters/route.ts(도수 필터 옵션)가 값이 어긋나면 안 되므로 여기 한 곳에만 둔다.
export function extractTargetDosu(itemCode: string): number | null {
  const m = itemCode.match(/-(\d{4})$/);
  if (!m) return null;
  return -(Number(m[1]) / 100);
}
