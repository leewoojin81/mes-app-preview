// 원본 "불량종합현황"(ERP 불량 유형별 리포트, d_pmmr8c0) 엑셀 컬럼 순서 그대로
// ("No."는 엑셀 행번호일 뿐이라 제외, 끝의 제목 없는 6개 컬럼은 원본에 데이터가 전혀
// 없어 제외). key는 detail JSON 키, title은 화면에 표시되는 제목이다. 원본 헤더에
// "기타"가 두 번 나와 JSON 키가 겹치므로, 두 번째는 내부 key만 "기타2"로 구분하고
// 표시 제목은 원본과 동일하게 "기타"로 둔다.
export const DEFECT_TYPE_STATUS_COLS = [
  { key: "생산일자", title: "생산일자" },
  { key: "구분", title: "구분" },
  { key: "품목군", title: "품목군" },
  { key: "품목코드", title: "품목코드" },
  { key: "품목정보", title: "품목정보" },
  { key: "지시번호", title: "지시번호" },
  { key: "LOT No", title: "LOT No" },
  { key: "작업장", title: "작업장" },
  { key: "설비코드", title: "설비코드" },
  { key: "설비명", title: "설비명" },
  { key: "공정명", title: "공정명" },
  { key: "지시수량", title: "지시수량" },
  { key: "양품수량", title: "양품수량" },
  { key: "불량수량", title: "불량수량" },
  { key: "불량율(%)", title: "불량율(%)" },
  { key: "깨짐", title: "깨짐" },
  { key: "안쪽깨짐", title: "안쪽깨짐" },
  { key: "뜯낌", title: "뜯낌" },
  { key: "이물 1", title: "이물 1" },
  { key: "이물 2", title: "이물 2" },
  { key: "이물 3", title: "이물 3" },
  { key: "색퍼짐", title: "색퍼짐" },
  { key: "인쇄 不", title: "인쇄 不" },
  { key: "S/C", title: "S/C" },
  { key: "성형 不", title: "성형 不" },
  { key: "안착불량", title: "안착불량" },
  { key: "기포", title: "기포" },
  { key: "색,지렁이", title: "색,지렁이" },
  { key: "수량착오", title: "수량착오" },
  { key: "기타", title: "기타" },
  { key: "색맞춤", title: "색맞춤" },
  { key: "Test(SAMPLE)", title: "Test(SAMPLE)" },
  { key: "중심", title: "중심" },
  { key: "터짐", title: "터짐" },
  { key: "식염수 부족", title: "식염수 부족" },
  { key: "수량 부족", title: "수량 부족" },
  { key: "수량 이상", title: "수량 이상" },
  { key: "실링지 이물", title: "실링지 이물" },
  { key: "실링지 오부착", title: "실링지 오부착" },
  { key: "실링지 찍힘", title: "실링지 찍힘" },
  { key: "실링지 밀림", title: "실링지 밀림" },
  { key: "실링지 끊어짐", title: "실링지 끊어짐" },
  { key: "잔량", title: "잔량" },
  { key: "기타2", title: "기타" },
  { key: "출고생산", title: "출고생산" },
  { key: "미분리1", title: "미분리1" },
  { key: "미분리3", title: "미분리3" },
  { key: "마킹불량", title: "마킹불량" },
  { key: "융착불량", title: "융착불량" },
  { key: "무렌즈", title: "무렌즈" },
  { key: "캡불량", title: "캡불량" },
  { key: "도수측정", title: "도수측정" },
  { key: "렌즈붙음", title: "렌즈붙음" },
  { key: "렌즈혼입", title: "렌즈혼입" },
  { key: "렌즈끼임", title: "렌즈끼임" },
  { key: "렌즈겹침", title: "렌즈겹침" },
  { key: "팩불량", title: "팩불량" },
  { key: "팩이물", title: "팩이물" },
  { key: "하몰드붙음", title: "하몰드붙음" },
  { key: "BASE이물", title: "BASE이물" },
  { key: "양품불량", title: "양품불량" },
  { key: "유실", title: "유실" },
  { key: "설비오작동", title: "설비오작동" },
  { key: "미해마", title: "미해마" },
  { key: "PPT", title: "PPT" },
  { key: "직경불량", title: "직경불량" },
  { key: "도수불량", title: "도수불량" },
  { key: "BC불량", title: "BC불량" },
  { key: "두께불량", title: "두께불량" },
] as const;

// 하단 합계 행 — 지시/양품/불량 수량과 유형별 불량 수량은 모두 순수 수량이라 합계가
// 의미 있다(불량율은 비율이라 제외). 유형별 합계는 기간 내 어떤 불량이 많은지 바로
// 보여주는 이 화면의 핵심 기능이라 전부 포함한다.
export const DEFECT_TYPE_STATUS_SUM_KEYS = DEFECT_TYPE_STATUS_COLS.map((c) => c.key).filter(
  (k) =>
    ![
      "생산일자",
      "구분",
      "품목군",
      "품목코드",
      "품목정보",
      "지시번호",
      "LOT No",
      "작업장",
      "설비코드",
      "설비명",
      "공정명",
      "불량율(%)",
    ].includes(k)
);

// 원본 리포트가 갖는 고정된 값 집합 — 종류가 적어 매번 distinct 조회를 하지 않고
// 화면에 고정 옵션으로 둔다.
export const DEFECT_TYPE_STATUS_GUBUN_OPTIONS = ["주간", "야간"] as const;
export const DEFECT_TYPE_STATUS_PROCESS_OPTIONS = [
  "Base 인쇄",
  "착색 인쇄",
  "정렬",
  "조립",
  "분리3",
  "외관검사",
  "습윤",
  "이재기",
  "실링",
  "멸균",
  "입고대기",
  "중간창고",
  "마킹",
  "출하포장",
] as const;

// 원본 "생산일자"가 "YYYY.MM.DD" 표기라 필터/정렬용 컬럼(order_date)에는
// "YYYY-MM-DD"로 정규화해 저장한다. 형식이 다르면 원본 문자열 그대로 둔다.
export function normalizeOrderDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
