// 월별수주(목표) 등록(SALES-01) 임시 거래처 — 아직 거래처로 등록되지 않은 신규 거래처의 계획을 먼저
// 잡아 두는 용도(2026-10-01 사용자 요청). 고객사 마스터(customers)에는 저장하지 않고, 목표 행의
// customer_code에 "TMP:이름" 형태로 이름만 남긴다. 거래처가 확정돼 등록되면 이 목표를 수정해 실제
// 거래처로 바꾼다. 서버·화면이 함께 쓰므로 다른 모듈을 끌어오지 않는다.
export const TEMP_CUSTOMER_PREFIX = "TMP:";

export function tempCustomerCode(name: string): string {
  return `${TEMP_CUSTOMER_PREFIX}${name.trim().slice(0, 100)}`;
}

export function isTempCustomerCode(code: string | null | undefined): boolean {
  return !!code && code.startsWith(TEMP_CUSTOMER_PREFIX);
}

export function tempCustomerName(code: string): string {
  return code.slice(TEMP_CUSTOMER_PREFIX.length);
}
