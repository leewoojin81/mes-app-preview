// "HH:MM" 두 시각 사이 분(分) 차이에서 식사시간을 뺀 잔업시간. 종료가 시작보다 이르면
// 자정을 넘긴 것으로 보고 24시간을 더한다. 생산캘린더(BASE-08)·공정별 캘린더 양쪽에서
// 공유하는 범용 계산이라 여기 둔다.
export function calcOtMinutes(
  start: string | null,
  end: string | null,
  mealMinutes: number | null
): number {
  if (!start || !end) return 0;
  const m = /^(\d{2}):(\d{2})$/;
  const sMatch = start.match(m);
  const eMatch = end.match(m);
  if (!sMatch || !eMatch) return 0;
  const startMin = Number(sMatch[1]) * 60 + Number(sMatch[2]);
  let endMin = Number(eMatch[1]) * 60 + Number(eMatch[2]);
  if (endMin < startMin) endMin += 24 * 60;
  return Math.max(0, endMin - startMin - (mealMinutes ?? 0));
}
