// PLAN-02 "공정별 월 CAPA 및 근무계획" 인원 칸 — 직접 입력한 텍스트에서 인원 수를 뽑는다
// (2026-10-01 사용자 요청: 합계가 각 행에 입력한 값의 합과 맞아야 한다). 텍스트 안의 숫자를 모두
// 더한다("5" → 5, "정규 10 · 도급 2" → 12). 숫자가 없거나 비어 있으면 BASE-09 자동 집계 인원을 쓴다.
export function headcountFromText(text: string | null | undefined): number | null {
  const nums = (text ?? "").match(/\d+/g);
  if (!nums) return null;
  return nums.reduce((sum, n) => sum + Number(n), 0);
}

export function effectiveHeadcount(text: string | null | undefined, auto: number): number {
  return headcountFromText(text) ?? auto;
}
