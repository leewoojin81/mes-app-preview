// 인원관리(PSN-02) "출퇴근카드등록" — 카드 태깅 근태관리 시스템 원본 리포트 엑셀 컬럼
// 순서 그대로. key는 detail JSON 키(=원본 헤더명), title은 화면 표시 제목이다.
export const ATTENDANCE_CARD_COLS = [
  { key: "사원번호", title: "사원번호" },
  { key: "조직", title: "조직" },
  { key: "이름", title: "이름" },
  { key: "직급", title: "직급" },
  { key: "근무일자", title: "근무일자" },
  { key: "출근시간", title: "출근시간" },
  { key: "퇴근시간", title: "퇴근시간" },
  { key: "근무조", title: "근무조" },
  { key: "근무스케줄", title: "근무스케줄" },
  { key: "출근판정", title: "출근판정" },
  { key: "퇴근판정", title: "퇴근판정" },
  { key: "지각시간", title: "지각시간" },
  { key: "외출시간", title: "외출시간" },
  { key: "조기출근시간", title: "조기출근시간" },
  { key: "연장근무시간", title: "연장근무시간" },
  { key: "야간근무시간", title: "야간근무시간" },
  { key: "휴일근무시간", title: "휴일근무시간" },
  { key: "실제근무시간", title: "실제근무시간" },
  { key: "총근무시간", title: "총근무시간" },
  { key: "정상근무시간", title: "정상근무시간" },
  { key: "외출여부", title: "외출여부" },
  { key: "수동 수정시간", title: "수동 수정시간" },
  { key: "수동 수정자", title: "수동 수정자" },
  { key: "수정 사유", title: "수정 사유" },
  { key: "외출List", title: "외출List" },
  { key: "복귀List", title: "복귀List" },
  { key: "출근 모드", title: "출근 모드" },
  { key: "퇴근 모드", title: "퇴근 모드" },
] as const;

// 원본 "근무일자"가 "YYYY-MM-DD"로 이미 정규화된 표기라 대부분 그대로 쓰지만, 혹시
// "YYYY.MM.DD"/"YYYY/MM/DD" 등 다른 구분자로 오는 경우까지 대비해 정규화한다.
export function normalizeCardDate(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return s || null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
