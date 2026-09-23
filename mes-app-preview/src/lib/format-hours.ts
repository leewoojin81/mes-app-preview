// 소수 시간(0.5)을 "시:분"(0:30) 형식으로 바꾸는 공용 포맷터 — PSN-01/PSN-05/PSN-06의
// 그리드·미리보기 표시에서 공유한다(2026-09-24 사용자 요청). 24시간을 넘는 값(예: 24.7
// -> "24:42")도 그대로 처리한다(하루를 꼬박 넘긴 근무 등, PSN-06 대사 참고). 값이 0이거나
// null일 때 어떻게 보여줄지는 화면마다 관례가 달라(PSN-01은 "0", PSN-05/PSN-06 일부는
// 빈칸·"-") 이 함수는 건드리지 않고 호출부에서 따로 처리한다. 내부 계산·판정에 쓰는
// 소수 시간 값 자체(MISMATCH_THRESHOLD_HOURS 등)는 이 함수와 무관하게 그대로 둔다 —
// 어디까지나 표시 전용 변환이다.
export function formatHoursClock(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
