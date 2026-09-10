// 원본 "구매입고현황"(ERP 입고 실적 리포트, d_phmr320) 엑셀 컬럼 순서 그대로
// ("No."는 엑셀 행번호일 뿐이라 제외 — 화면 자체 No. 컬럼을 쓴다). key는 detail JSON
// 키(=원본 헤더명), title은 화면에 표시되는 제목이다.
export const PURCHASE_RECEIPT_COLS = [
  { key: "입고일", title: "입고일" },
  { key: "거래처", title: "거래처" },
  { key: "거래처명", title: "거래처명" },
  { key: "조달처명", title: "조달처명" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "LOT No", title: "LOT No" },
  { key: "고객사LOT No", title: "고객사LOT No" },
  { key: "구분", title: "구분" },
  { key: "입고유형", title: "입고유형" },
  { key: "매입구분", title: "매입구분" },
  { key: "화폐", title: "화폐" },
  { key: "입고량", title: "입고량" },
  { key: "단가", title: "단가" },
  { key: "금액", title: "금액" },
  { key: "환율", title: "환율" },
  { key: "환산금액", title: "환산금액" },
  { key: "입고창고", title: "입고창고" },
  { key: "단가구분", title: "단가구분" },
  { key: "구매담당", title: "구매담당" },
  { key: "비고", title: "비고" },
  { key: "입고전표번호", title: "입고전표번호" },
  { key: "순번", title: "순번" },
  { key: "접수번호", title: "접수번호" },
  { key: "사업장", title: "사업장" },
  { key: "등록자", title: "등록자" },
  { key: "등록일", title: "등록일" },
  { key: "발생프로그램", title: "발생프로그램" },
] as const;

// 하단 합계 행 — 입고량·금액·환산금액만 순수 수량/금액이라 합계가 의미 있다
// (단가·환율은 비율이라 제외).
export const PURCHASE_RECEIPT_SUM_KEYS = ["입고량", "금액", "환산금액"] as const;

// 원본 리포트가 갖는 고정된 값 집합 — 종류가 적어 매번 distinct 조회를 하지 않고
// 화면에 고정 옵션으로 둔다.
export const PURCHASE_RECEIPT_GUBUN_OPTIONS = ["정상", "예외"] as const;

// 원본 "입고일"이 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(receipt_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizeReceiptDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
