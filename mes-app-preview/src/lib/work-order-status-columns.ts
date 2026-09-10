// 원본 "작업지시현황"(ERP 작업지시 실적 리포트, d_pmmr540) 엑셀 컬럼 순서 그대로
// ("No."는 엑셀 행번호일 뿐이라 제외 — 화면 자체 No. 컬럼을 쓴다). key는 detail JSON
// 키(=원본 헤더명), title은 화면에 표시되는 제목이다.
export const WORK_ORDER_STATUS_COLS = [
  { key: "지시일자", title: "지시일자" },
  { key: "구분", title: "구분" },
  { key: "라인", title: "라인" },
  { key: "작업지시번호", title: "작업지시번호" },
  { key: "LOT-NO", title: "LOT-NO" },
  { key: "순서", title: "순서" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "지시수량", title: "지시수량" },
  { key: "실적수량", title: "실적수량" },
  { key: "미생산량", title: "미생산량" },
  { key: "상태", title: "상태" },
  { key: "준수율", title: "준수율" },
  { key: "T/Time(초)", title: "T/Time(초)" },
  { key: "비고", title: "비고" },
  { key: "수주번호", title: "수주번호" },
  { key: "순번", title: "순번" },
  { key: "납기일자", title: "납기일자" },
  { key: "최초등록자", title: "최초등록자" },
  { key: "최초등록일자", title: "최초등록일자" },
  { key: "최종수정자", title: "최종수정자" },
  { key: "최종수정일자", title: "최종수정일자" },
] as const;

// 하단 합계 행 — 지시/실적/미생산 수량만 순수 수량이라 합계가 의미 있다
// (준수율·T/Time은 비율/단위시간이라 합계 대상에서 제외).
export const WORK_ORDER_STATUS_SUM_KEYS = ["지시수량", "실적수량", "미생산량"] as const;

// 원본 리포트가 갖는 고정된 값 집합 — 종류가 적어 매번 distinct 조회를 하지 않고
// 화면에 고정 옵션으로 둔다.
export const WORK_ORDER_STATUS_GUBUN_OPTIONS = ["주간", "야간"] as const;
export const WORK_ORDER_STATUS_LINE_OPTIONS = ["착색라인", "조립라인"] as const;
export const WORK_ORDER_STATUS_STATUS_OPTIONS = ["신규", "진행", "완료", "중단"] as const;

// 원본 "지시일자"가 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(order_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizeOrderDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
