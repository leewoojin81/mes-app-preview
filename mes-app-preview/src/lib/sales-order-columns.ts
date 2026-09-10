import type { SalesOrder } from "./types";

// 원본 "수주현황" 엑셀 컬럼 순서 그대로 — 수주번호는 맨 앞에 고정 표시(행 식별자)하면서
// 원본 위치(비고 다음, 순번 앞)에도 그대로 유지하고, "순번"처럼 같은 제목이 두 번
// 나오는 컬럼도 그대로 유지한다.
// key는 데이터 조회용 고유 식별자(detail JSON 키), title은 화면/엑셀에 표시되는 제목이다.
// 화면 표시(sales-orders/page.tsx)와 엑셀 다운로드(api/sales-orders/export)가 공유한다.
export const SALES_ORDER_DETAIL_COLS = [
  { key: "No.", title: "No." },
  { key: "수주일자", title: "수주일자" },
  { key: "코드", title: "코드" },
  { key: "거래처명", title: "거래처명" },
  { key: "품목군", title: "품목군" },
  { key: "대표품목", title: "대표품목" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "매출구분", title: "매출구분" },
  { key: "화폐", title: "화폐" },
  { key: "수량", title: "수량" },
  { key: "단가", title: "단가" },
  { key: "금액", title: "금액" },
  { key: "환율", title: "환율" },
  { key: "환산금액", title: "환산금액" },
  { key: "납기일자", title: "납기일자" },
  { key: "상태", title: "상태" },
  { key: "MO-번호", title: "MO-번호" },
  { key: "순번", title: "순번" },
  { key: "비고", title: "비고" },
  { key: "수주번호", title: "수주번호" },
  { key: "순번__2", title: "순번" },
  { key: "샘플구분", title: "샘플구분" },
  { key: "사업장", title: "사업장" },
  { key: "등록자", title: "등록자" },
  { key: "등록일", title: "등록일" },
] as const;

// 하단 합계 행에 표시할 수량성 컬럼만 — 단가처럼 단가(단위당 값)라 합계가 의미
// 없는 컬럼은 제외한다.
export const SALES_ORDER_SUM_KEYS = ["수량", "금액", "환산금액"] as const;

// 수동 등록한 수주(detail 없음)를 위한 엑셀 컬럼 대체값
export function salesOrderFallbackCell(so: SalesOrder, key: string): string | number | null {
  switch (key) {
    case "코드":
      return so.customer_code;
    case "거래처명":
      return so.customer_name;
    case "품목코드":
      return so.item_code;
    case "품목정보":
      return so.item_name;
    case "수량":
      return so.order_qty;
    case "단가":
      return so.unit_price;
    case "금액":
      return so.unit_price != null ? so.order_qty * so.unit_price : null;
    case "납기일자":
      return so.due_date;
    case "상태":
      return so.status;
    case "등록일":
      return so.created_at;
    case "수주번호":
      return so.so_no;
    default:
      return null;
  }
}
