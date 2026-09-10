// 원본 "도수변경등록"(ERP 조립 실적 리포트, d_pmmr543) 엑셀 컬럼 순서 그대로. key는
// detail JSON 키, title은 화면에 표시되는 제목이다. 원본 헤더에 "주야간"이 두 번(작업
// 주야간·검사 주야간) 나와 JSON 키가 겹치므로, 두 번째는 내부 key만 "검사주야간"으로
// 구분하고 표시 제목은 원본과 동일하게 "주야간"으로 둔다.
export const DOSU_CHANGE_COLS = [
  { key: "지시일자", title: "지시일자" },
  { key: "주야간", title: "주야간" },
  { key: "검사일자", title: "검사일자" },
  { key: "검사주야간", title: "주야간" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "LOT No", title: "LOT No" },
  { key: "작업지시번호", title: "작업지시번호" },
  { key: "조립 호기", title: "조립 호기" },
  { key: "조립자", title: "조립자" },
  { key: "조립 실적 입력시각", title: "조립 실적 입력시각" },
  { key: "지시수량", title: "지시수량" },
  { key: "실제도수", title: "실제도수" },
  { key: "이전품목", title: "이전품목" },
  { key: "이전도수", title: "이전도수" },
  { key: "검사수량", title: "검사수량" },
  { key: "양품수량", title: "양품수량" },
  { key: "불량수량", title: "불량수량" },
  { key: "상몰드1", title: "상몰드1" },
  { key: "상몰드2", title: "상몰드2" },
  { key: "하몰드1", title: "하몰드1" },
  { key: "하몰드2", title: "하몰드2" },
  { key: "도수1", title: "도수1" },
  { key: "도수2", title: "도수2" },
  { key: "도수3", title: "도수3" },
  { key: "조립투입품목", title: "조립투입품목" },
  { key: "조립투입품목명", title: "조립투입품목명" },
  { key: "조립투입LOT No", title: "조립투입LOT No" },
] as const;

// 하단 합계 행 — 지시/검사/양품/불량 수량만 순수 수량이라 합계가 의미 있다
// (도수류·몰드번호는 수량이 아니라 합계 대상에서 제외).
export const DOSU_CHANGE_SUM_KEYS = ["지시수량", "검사수량", "양품수량", "불량수량"] as const;

export const DOSU_CHANGE_GUBUN_OPTIONS = ["주간", "야간"] as const;

// 품질관리 "도수변경현황(QC-01)"의 몰드별 파레토 랭킹에서 쓰는 고정 몰드 목록
// (조립투입품목명에 "몰드"가 들어간 행의 조립투입품목 코드). 조회 기간에 해당 몰드
// 검사/조립 실적이 하나도 없어도 0건으로 랭킹에 항상 나오도록 이 목록 기준으로 채운다.
export const DOSU_CHANGE_MOLD_CODES = [
  "3860D",
  "3862D",
  "3875D",
  "4372D",
  "4375D",
  "4872D",
  "5872D",
] as const;

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
