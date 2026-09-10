// 품목 등록(단건/대표코드+도수 일괄) API가 공유하는 값 정규화 헬퍼.

export function strVal(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
export function strOrNull(v: unknown): string | null {
  const s = strVal(v);
  return s === "" ? null : s;
}
/** 숫자 변환 결과: 값 없음=null, 변환 실패=undefined(에러 신호), 성공=number */
export function numOrNull(v: unknown): number | null | undefined {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
/** numOrNull 결과 배열 중 undefined(변환 실패)가 하나라도 있으면 null을 반환 */
export function allValidNums(
  values: (number | null | undefined)[]
): (number | null)[] | null {
  if (values.some((v) => v === undefined)) return null;
  return values as (number | null)[];
}

/** "HH:MM" 형식 검증: 값 없음=null, 형식 오류=undefined(에러 신호), 성공=그대로 반환 */
export function timeOrNull(v: unknown): string | null | undefined {
  const s = strVal(v);
  if (s === "") return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : undefined;
}

export function todayDot(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
