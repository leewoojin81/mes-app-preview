// "생산순위지정.xlsx"(원본 화면 컬럼 정의) 헤더 순서 그대로 — No./작업순서/계획제외 다음부터는
// 수주등록(SALES-02)과 같은 원본 "수주현황" 데이터에 품목 마스터의 MODEL(형명)/포장방법,
// 그리고 이미 작업지시로 발행된 수량(작지수량)을 덧붙인 화면이다.
// 화면 표시(production-priority/page.tsx)와 엑셀 다운로드/업로드가 이 정의를 공유한다.
export const PRIORITY_DETAIL_COLS = [
  { key: "수주일자", title: "수주일자" },
  { key: "코드", title: "코드" },
  { key: "거래처명", title: "거래처명" },
  { key: "품목군", title: "품목군" },
  { key: "MODEL", title: "MODEL" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "포장방법", title: "포장방법" },
  { key: "납기일자", title: "납기일자" },
  { key: "수주수량", title: "수주수량" },
  { key: "작지수량", title: "작지수량" },
  { key: "지시잔량", title: "지시잔량" },
  { key: "수주번호", title: "수주번호" },
  { key: "순번", title: "순번" },
  { key: "샘플구분", title: "샘플구분" },
  { key: "상태", title: "상태" },
  { key: "비고", title: "비고" },
] as const;

export const PRIORITY_SUM_KEYS = ["수주수량", "작지수량", "지시잔량"] as const;

export interface PriorityRow {
  so_no: string;
  customer_code: string;
  customer_name: string;
  item_code: string;
  item_name: string;
  order_qty: number;
  due_date: string | null;
  status: string;
  detail: Record<string, string | number | null> | null;
  model_name: string | number | null;
  packing_method: string | number | null;
  item_group: string | number | null;
  issued_qty: number;
}

// 원본 수주(so.detail)에 없는 값(MODEL/포장방법 등 품목 마스터 전용, 작지수량/지시잔량 등
// 집계값)은 조인·계산 결과에서, 그 외에는 수주등록과 동일하게 so.detail → 기본 컬럼 순으로 조회한다.
export function priorityCell(r: PriorityRow, key: string): string | number | null {
  switch (key) {
    case "수주일자":
      return r.detail?.["수주일자"] ?? null;
    case "코드":
      return r.detail?.["코드"] ?? r.customer_code;
    case "거래처명":
      return r.detail?.["거래처명"] ?? r.customer_name;
    case "품목군":
      return r.detail?.["품목군"] ?? r.item_group;
    case "MODEL":
      return r.model_name;
    case "품목코드":
      return r.detail?.["품목코드"] ?? r.item_code;
    case "품목정보":
      return r.detail?.["품목정보"] ?? r.item_name;
    case "포장방법":
      return r.packing_method;
    case "납기일자":
      return r.detail?.["납기일자"] ?? r.due_date;
    case "수주수량":
      return r.detail?.["수량"] ?? r.order_qty;
    case "작지수량":
      return r.issued_qty;
    case "지시잔량":
      return Number(r.detail?.["수량"] ?? r.order_qty) - r.issued_qty;
    case "수주번호":
      return r.detail?.["수주번호"] ?? r.so_no;
    case "순번":
      // 원본 엑셀은 "순번"이 두 번 나오는데 앞쪽(순번)은 항상 0인 상수이고 실제 줄 일련번호는
      // 뒤쪽(순번__2)이다 — sales-orders/import/route.ts 와 동일한 규칙.
      return r.detail?.["순번__2"] ?? r.detail?.["순번"] ?? null;
    case "샘플구분":
      return r.detail?.["샘플구분"] ?? null;
    case "상태":
      return r.detail?.["상태"] ?? r.status;
    case "비고":
      return r.detail?.["비고"] ?? null;
    default:
      return null;
  }
}
