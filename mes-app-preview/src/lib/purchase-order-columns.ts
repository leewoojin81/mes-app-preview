// 원본 "구매발주현황"(ERP 발주 리포트, d_phmr210) 엑셀 컬럼 순서 그대로
// ("No."는 엑셀 행번호일 뿐이라 제외 — 화면 자체 No. 컬럼을 쓴다). key는 detail JSON
// 키(=원본 헤더명), title은 화면에 표시되는 제목이다.
export const PURCHASE_ORDER_COLS = [
  { key: "발주일자", title: "발주일자" },
  { key: "매입구분", title: "매입구분" },
  { key: "납기일자", title: "납기일자" },
  { key: "품목계정", title: "품목계정" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "단위", title: "단위" },
  { key: "화폐", title: "화폐" },
  { key: "수량", title: "수량" },
  { key: "단가", title: "단가" },
  { key: "금액", title: "금액" },
  { key: "환율", title: "환율" },
  { key: "환산금액", title: "환산금액" },
  { key: "상태", title: "상태" },
  { key: "단가구분", title: "단가구분" },
  { key: "창고", title: "창고" },
  { key: "코드", title: "코드" },
  { key: "거래처명", title: "거래처명" },
  { key: "조달처", title: "조달처" },
  { key: "조달처명", title: "조달처명" },
  { key: "포장단위", title: "포장단위" },
  { key: "포장수량", title: "포장수량" },
  { key: "발주구분", title: "발주구분" },
  { key: "비고", title: "비고" },
  { key: "협력사확인시각", title: "협력사확인시각" },
  { key: "발주번호", title: "발주번호" },
  { key: "순번", title: "순번" },
  { key: "사업장", title: "사업장" },
  { key: "등록자", title: "등록자" },
  { key: "등록일", title: "등록일" },
] as const;

// 하단 합계 행 — 수량·금액·환산금액만 순수 수량/금액이라 합계가 의미 있다
// (단가·환율은 비율이라 제외).
export const PURCHASE_ORDER_SUM_KEYS = ["수량", "금액", "환산금액"] as const;

// 원본 리포트가 갖는 고정된 값 집합 — 종류가 적어 매번 distinct 조회를 하지 않고
// 화면에 고정 옵션으로 둔다.
export const PURCHASE_ORDER_STATUS_OPTIONS = ["발주", "입고", "완료", "중단"] as const;

// 원본 "발주일자"가 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(order_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizePoDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
