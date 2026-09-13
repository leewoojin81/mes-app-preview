// 원본 "창고이동현황"(ERP 창고간 이동 리포트, d_mmmr010) 엑셀 컬럼 순서 그대로
// ("No."는 엑셀 행번호일 뿐이라 제외 — 화면 자체 No. 컬럼을 쓴다). key는 detail JSON
// 키(=원본 헤더명), title은 화면에 표시되는 제목이다.
export const WAREHOUSE_TRANSFER_COLS = [
  { key: "이동일자", title: "이동일자" },
  { key: "이동번호", title: "이동번호" },
  { key: "순번", title: "순번" },
  { key: "출고창고", title: "출고창고" },
  { key: "품목군", title: "품목군" },
  { key: "Lot번호", title: "Lot번호" },
  { key: "출고품목", title: "출고품목" },
  { key: "출고품목명", title: "출고품목명" },
  { key: "출고수량", title: "출고수량" },
  { key: "출고금액", title: "출고금액" },
  { key: "이동유형", title: "이동유형" },
  { key: "이동사유", title: "이동사유" },
  { key: "입고창고", title: "입고창고" },
  { key: "입고품목", title: "입고품목" },
  { key: "입고품목명", title: "입고품목명" },
  { key: "입고수량", title: "입고수량" },
  { key: "입고금액", title: "입고금액" },
  { key: "의뢰번호", title: "의뢰번호" },
  { key: "출고담당", title: "출고담당" },
  { key: "비고", title: "비고" },
  { key: "등록자", title: "등록자" },
  { key: "등록일", title: "등록일" },
  { key: "사업장", title: "사업장" },
] as const;

// 하단 합계 행 — 출고수량·입고수량만 순수 수량이라 합계가 의미 있다(출고금액/입고금액은
// 원본에 항상 비어있어 제외).
export const WAREHOUSE_TRANSFER_SUM_KEYS = ["출고수량", "입고수량"] as const;

// 원본 리포트가 갖는 고정된 값 집합 — 종류가 적어 매번 distinct 조회를 하지 않고
// 화면에 고정 옵션으로 둔다(2026-09-13 확인).
export const WAREHOUSE_TRANSFER_REASON_OPTIONS = ["생산용", "반품", "창고이동용"] as const;
export const WAREHOUSE_TRANSFER_WAREHOUSE_OPTIONS = [
  "원.부자재창고",
  "사출창고",
  "포장창고",
  "조립창고",
  "착색창고",
  "연구소창고",
  "대화동창고",
  "불량창고",
  "[외주]대동리빙",
  "[외주]씨엔엠테크",
] as const;

// 원본 "이동일자"가 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(transfer_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizeTransferDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
