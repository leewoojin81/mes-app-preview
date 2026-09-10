// 인원관리(PSN-03) "보호구지급관리" 다음지급예정일 계산 — API 라우트(등록 시 저장값
// 계산)와 지급현황 조회(미지급 항목의 가상 예정일 계산) 양쪽이 공유한다.
import type { PpeItem } from "./types";

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "YYYY-MM-DD" + n개월 → "YYYY-MM-DD". 월말 오버플로우(예: 1/31+1개월)는 JS Date의
// 기본 롤오버 처리에 맡긴다 — 지급주기(6개월/1년 단위) 계산에서 실무상 문제 없는 수준.
export function addMonthsToDateStr(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + months, d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// 아직 지급 이력이 없는 작업자×품목의 "다음지급예정일"(가상값 — 저장되지 않고 조회 때만
// 계산). single(방진복/방진화)은 최초 지급 전 예정일이 정의되지 않아 null(미지급 표시).
// first_then_repeat(깔창)은 입사일+first_issue_months.
export function firstDueDate(item: PpeItem, hireDate: string | null): string | null {
  if (item.cycle_type !== "first_then_repeat") return null;
  if (!hireDate || item.first_issue_months == null) return null;
  return addMonthsToDateStr(hireDate, item.first_issue_months);
}

// 지급이력 한 건을 등록할 때 그 건에 저장할 다음지급예정일 — 방식 불문 항상
// "이번 지급일 + repeat_months"(최초/재지급 구분 없이 동일한 규칙).
export function nextDueDateAfterIssuance(item: PpeItem, issueDate: string): string {
  return addMonthsToDateStr(issueDate, item.repeat_months);
}

// "재지급 임박"(지났거나 withinDays일 이내) 판정 — YYYY-MM-DD 문자열은 사전식 비교가
// 시간순 비교와 같아서 그대로 비교한다.
export function isUpcomingOrOverdue(
  nextDueDate: string | null,
  today: string,
  withinDays = 7
): boolean {
  if (!nextDueDate) return false;
  return nextDueDate <= addDaysToDateStr(today, withinDays);
}

export function isOverdue(nextDueDate: string | null, today: string): boolean {
  if (!nextDueDate) return false;
  return nextDueDate < today;
}
