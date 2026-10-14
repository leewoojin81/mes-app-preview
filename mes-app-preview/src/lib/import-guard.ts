// 엑셀 업로드 "구간 재동기화" 안전장치(2026-10-14 사용자 요청) — 업로드 파일의 날짜 구간에 있는 기존
// 데이터를 지우고 파일 내용으로 다시 채우는 방식이라, 구간이 잘못 잡히거나(예: 날짜가 아닌 행이 끝
// 날짜가 됨) 일부만 담긴 파일을 올리면 구간 안의 나머지가 통째로 사라진다(일일작업현황 5월~10월 삭제
// 사고). 지울 건수가 새로 넣을 건수보다 훨씬 많으면 바로 지우지 않고 확인을 요구한다 — 화면은
// lib/import-upload.ts의 postImport가 확인창을 띄우고 force=1로 다시 보낸다.

/** 지울 건수가 넣을 건수의 이 배수 + 여유분을 넘으면 확인을 요구한다. */
const DELETE_RATIO = 1.2;
const DELETE_SLACK = 50;

export interface RangeDeleteWarning {
  error: string;
  needsConfirm: true;
  existing: number;
  incoming: number;
  dateFrom: string;
  dateTo: string;
}

export function rangeDeleteGuard(p: {
  existing: number;
  incoming: number;
  dateFrom: string;
  dateTo: string;
  force: boolean;
}): RangeDeleteWarning | null {
  if (p.force) return null;
  if (p.existing <= p.incoming * DELETE_RATIO + DELETE_SLACK) return null;
  const n = (v: number) => v.toLocaleString("ko-KR");
  return {
    error:
      `이 파일로 ${p.dateFrom} ~ ${p.dateTo} 구간의 기존 ${n(p.existing)}건을 삭제하고 ` +
      `${n(p.incoming)}건을 새로 입력합니다. 지워지는 건수가 훨씬 많습니다 — ` +
      "파일에 일부 기간·공정만 있거나 날짜가 잘못된 행이 있으면 기존 데이터가 사라질 수 있습니다.",
    needsConfirm: true,
    existing: p.existing,
    incoming: p.incoming,
    dateFrom: p.dateFrom,
    dateTo: p.dateTo,
  };
}
