// 잔업 "고정 신청분" 기준값 — 18:30 종료(정식 잔업 종료시각, PSN-07 1조 잔업 구간
// 16:10~18:30)까지 채운 고정 신청값 2.34시간(2시간20분). 근태대사(PSN-06,
// attendance-audit.ts)와 근무시간조회(PSN-05) "초과신청" 다운로드/탭 미리보기가 이
// 값을 공유한다. attendance-audit.ts는 node:sqlite 의존 모듈(master-data-history 등)을
// 물고 있어 브라우저(클라이언트 컴포넌트) 번들에 못 들어가므로, 순수 상수만 이
// 별도 파일로 뺐다.
export const FIXED_OVERTIME_APPLICATION_HOURS = 2.34;
