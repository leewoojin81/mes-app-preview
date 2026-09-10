// 원본 "현재고현황" 엑셀 컬럼 순서 그대로 (제목 없는 컬럼 1개는 의미가 없어 제외).
// key는 detail JSON 키(=원본 헤더명), title은 화면에 표시되는 제목이다.
export const INVENTORY_STATUS_COLS = [
  { key: "창고", title: "창고" },
  { key: "품목계정", title: "품목계정" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "단위", title: "단위" },
  { key: "LOT No", title: "LOT No" },
  { key: "Location", title: "Location" },
  { key: "발행수량", title: "발행수량" },
  { key: "재고수량", title: "재고수량" },
  { key: "유효기간", title: "유효기간" },
  { key: "검사대기", title: "검사대기" },
  { key: "대분류", title: "대분류" },
  { key: "중분류", title: "중분류" },
  { key: "소분류", title: "소분류" },
  { key: "구매담당자", title: "구매담당자" },
  { key: "출고담당자", title: "출고담당자" },
  { key: "사업장", title: "사업장" },
] as const;

// 하단 합계 행에 표시할 수량성 컬럼만 — Location/유효기간처럼 숫자값이 섞여 있어도
// 합계가 의미 없는 컬럼은 제외한다.
export const INVENTORY_STATUS_SUM_KEYS = ["발행수량", "재고수량", "검사대기"] as const;
