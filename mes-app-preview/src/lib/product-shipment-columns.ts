// 원본 "제품출고현황"(ERP 출고 실적 리포트, d_smmr430) 엑셀 컬럼 순서 그대로
// ("No."는 엑셀 행번호일 뿐이라 제외 — 화면 자체 No. 컬럼을 쓴다). key는 detail JSON
// 키(=원본 헤더명), title은 화면에 표시되는 제목이다.
export const PRODUCT_SHIPMENT_COLS = [
  { key: "출고일자", title: "출고일자" },
  { key: "코드", title: "코드" },
  { key: "거래처명", title: "거래처명" },
  { key: "납품처", title: "납품처" },
  { key: "납품처명", title: "납품처명" },
  { key: "품목군", title: "품목군" },
  { key: "대표품목", title: "대표품목" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "Lotno", title: "Lotno" },
  { key: "매출구분", title: "매출구분" },
  { key: "출고유형", title: "출고유형" },
  { key: "반품유형", title: "반품유형" },
  { key: "화폐", title: "화폐" },
  { key: "출고수량", title: "출고수량" },
  { key: "단가구분", title: "단가구분" },
  { key: "단가", title: "단가" },
  { key: "금액", title: "금액" },
  { key: "환율", title: "환율" },
  { key: "환산금액", title: "환산금액" },
  { key: "출고창고", title: "출고창고" },
  { key: "출고번호", title: "출고번호" },
  { key: "출고담당자", title: "출고담당자" },
  { key: "PO번호", title: "PO번호" },
  { key: "PO순번", title: "PO순번" },
  { key: "비고", title: "비고" },
  { key: "사업장", title: "사업장" },
  { key: "등록자", title: "등록자" },
  { key: "등록일", title: "등록일" },
] as const;

// 하단 합계 행 — 출고수량·금액·환산금액만 순수 수량/금액이라 합계가 의미 있다
// (단가·환율은 비율이라 제외).
export const PRODUCT_SHIPMENT_SUM_KEYS = ["출고수량", "금액", "환산금액"] as const;

// 원본 리포트가 갖는 고정된 값 집합 — 종류가 적어 매번 distinct 조회를 하지 않고
// 화면에 고정 옵션으로 둔다.
export const PRODUCT_SHIPMENT_SALE_TYPE_OPTIONS = ["직수출", "Local", "국내"] as const;

// 원본 "출고일자"가 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(ship_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizeShipDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
