// 원본 "MOLD입고현황"(ERP 몰드 입고 리포트) 엑셀 컬럼 순서 그대로("No."는 엑셀 행번호일
// 뿐이라 제외 — 화면 자체 No. 컬럼을 쓴다). key는 detail JSON 키(=원본 헤더명), title은
// 화면에 표시되는 제목이다.
export const MOLD_RECEIPT_COLS = [
  { key: "입고일", title: "입고일" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "LOT No", title: "LOT No" },
  { key: "Radius", title: "Radius" },
  { key: "고객사LOT No", title: "고객사LOT No" },
  { key: "입고량", title: "입고량" },
  { key: "입고창고", title: "입고창고" },
  { key: "비고", title: "비고" },
  { key: "직경", title: "직경" },
  { key: "형명", title: "형명" },
  { key: "B.C", title: "B.C" },
  { key: "렌즈구분", title: "렌즈구분" },
  { key: "주기", title: "주기" },
  { key: "입고전표번호", title: "입고전표번호" },
  { key: "순번", title: "순번" },
  { key: "사업장", title: "사업장" },
  { key: "등록자", title: "등록자" },
  { key: "등록일", title: "등록일" },
  { key: "포장유형", title: "포장유형" },
] as const;

// 하단 합계 행 — 입고량만 순수 수량이라 합계가 의미 있다.
export const MOLD_RECEIPT_SUM_KEYS = ["입고량"] as const;

// 원본 리포트가 갖는 고정된 값 집합 — 종류가 적어 매번 distinct 조회를 하지 않고
// 화면에 고정 옵션으로 둔다(2026-09-13 확인: 상몰드/하몰드/원데이팩 3종).
export const MOLD_RECEIPT_GROUP_OPTIONS = ["상몰드", "하몰드", "원데이팩"] as const;

// 원본 "입고일"이 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(receipt_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizeMoldReceiptDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
