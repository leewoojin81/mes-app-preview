// 원본 "일일작업현황"(ERP 실적 로그, d_pmmr810) 엑셀 컬럼 순서 그대로. key는 detail
// JSON 키(=원본 헤더명), title은 화면에 표시되는 제목이다.
export const DAILY_WORK_STATUS_COLS = [
  { key: "작업일자", title: "작업일자" },
  { key: "라인", title: "라인" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "형명", title: "형명" },
  { key: "공정코드", title: "공정코드" },
  { key: "공정명", title: "공정명" },
  { key: "구분", title: "구분" },
  { key: "작지번호", title: "작지번호" },
  { key: "LOT No", title: "LOT No" },
  { key: "공정순서", title: "공정순서" },
  { key: "양품수량", title: "양품수량" },
  { key: "불량수량", title: "불량수량" },
  { key: "유실시간", title: "유실시간" },
  { key: "작업시간", title: "작업시간" },
  { key: "개당작업시간", title: "개당작업시간" },
  { key: "인원", title: "인원" },
  { key: "작업자", title: "작업자" },
  { key: "도수1", title: "도수1" },
  { key: "도수2", title: "도수2" },
  { key: "도수3", title: "도수3" },
  { key: "품목직경", title: "품목직경" },
  { key: "직경1", title: "직경1" },
  { key: "직경2", title: "직경2" },
  { key: "직경3", title: "직경3" },
  { key: "품목B.C", title: "품목B.C" },
  { key: "B.C1", title: "B.C1" },
  { key: "B.C2", title: "B.C2" },
  { key: "B.C3", title: "B.C3" },
  { key: "두께1", title: "두께1" },
  { key: "두께2", title: "두께2" },
  { key: "두께3", title: "두께3" },
  { key: "D.PW1", title: "D.PW1" },
  { key: "D.PW2", title: "D.PW2" },
  { key: "D.PW3", title: "D.PW3" },
  { key: "중합체 No", title: "중합체 No" },
  { key: "HEMA No", title: "HEMA No" },
  { key: "포장방법", title: "포장방법" },
  { key: "렌즈구분", title: "렌즈구분" },
  { key: "주기", title: "주기" },
  { key: "비고", title: "비고" },
  { key: "검사등급", title: "검사등급" },
  { key: "HEMA LOT No", title: "HEMA LOT No" },
  { key: "프로그램", title: "프로그램" },
  { key: "수주번호", title: "수주번호" },
  { key: "높이", title: "높이" },
  { key: "파워", title: "파워" },
  { key: "분사시간", title: "분사시간" },
  { key: "사업장", title: "사업장" },
  { key: "노즐Air", title: "노즐Air" },
  { key: "등록자", title: "등록자" },
  { key: "원재료점도", title: "원재료점도" },
  { key: "등록시각", title: "등록시각" },
  { key: "Air온도", title: "Air온도" },
  { key: "Air압력", title: "Air압력" },
  { key: "최종수정자", title: "최종수정자" },
  { key: "최종수정시각", title: "최종수정시각" },
] as const;

// 하단 합계 행 — 양품/불량수량만 순수 숫자라 합계가 의미 있다(작업시간류는
// "65 分"처럼 단위가 붙은 텍스트라 제외).
export const DAILY_WORK_STATUS_SUM_KEYS = ["양품수량", "불량수량"] as const;

// 원본 "작업일자"가 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(work_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizeWorkDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
