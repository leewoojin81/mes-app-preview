import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { ProcessWorkSummaryRow, SupportMatrixCell } from "@/lib/types";

export const runtime = "nodejs";

// 인원관리(PSN-04) "공정별근무현황" — 관리자용 조회기간 집계. 2026-09-07 PSN-01의
// 지원공정 선택지가 work_group(소속 9개)에서 BASE-04 세부공정(공정등록에 있는 사용중인
// 공정 전체, process_group별로 묶어서 표시)으로 바뀌면서, 이 리포트도 두 축을 같은
// 기준으로 맞췄다 — "본공정"은 work_hours_daily.process_code(그날 저장 시점 workers.
// process_code 스냅샷, PSN-01엔 더 이상 안 보이지만 계속 저장은 되고 있던 값)를
// processes.process_name으로 변환해서 쓰고, "지원공정"은 이미 PSN-01에서 고른 공정명
// 텍스트(work_support_detail.support_work_group)를 그대로 쓴다 — 이제 두 축 다
// "공정명" 단위라 매트릭스가 실제로 의미 있게 맞물린다. process_code가 비어있는(본공정
// 미지정) 기록은 집계에서 제외한다. 전부 "연인원"(person-day, 그 기간 동안의 일별
// 기록 건수 합)으로 센다.
export async function GET(req: NextRequest) {
  const dateFrom = req.nextUrl.searchParams.get("dateFrom");
  const dateTo = req.nextUrl.searchParams.get("dateTo");
  if (!dateFrom || !dateTo || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return NextResponse.json(
      { error: "dateFrom/dateTo는 YYYY-MM-DD 형식이어야 합니다." },
      { status: 400 }
    );
  }
  const db = getDb();

  const normalRows = db
    .prepare(
      `SELECT p.process_name AS process_name, COUNT(*) AS cnt
       FROM work_hours_daily d
       JOIN processes p ON p.process_code = d.process_code
       WHERE d.work_date BETWEEN ? AND ? AND d.normal_hours > 0
       GROUP BY p.process_name`
    )
    .all(dateFrom, dateTo) as { process_name: string; cnt: number }[];
  const normalByProcess = new Map(normalRows.map((r) => [r.process_name, r.cnt]));

  // 지원받은 인원/시간: work_support_detail을 지원처(support_work_group, 이미 공정명 텍스트) 기준으로.
  const supportInRows = db
    .prepare(
      `SELECT support_work_group AS process_name, COUNT(*) AS cnt, SUM(support_hours) AS hrs
       FROM work_support_detail WHERE work_date BETWEEN ? AND ?
       GROUP BY support_work_group`
    )
    .all(dateFrom, dateTo) as { process_name: string; cnt: number; hrs: number }[];
  const supportInByProcess = new Map(supportInRows.map((r) => [r.process_name, r]));

  // 지원 나간 인원/시간: work_support_detail을 work_hours_daily와 (work_date, employee_no)로
  // 조인해 그날 저장된 본공정(process_code) 스냅샷을 "보낸 쪽" 공정명으로 집계.
  const supportOutRows = db
    .prepare(
      `SELECT p.process_name AS process_name, COUNT(*) AS cnt, SUM(s.support_hours) AS hrs
       FROM work_support_detail s
       JOIN work_hours_daily d ON d.work_date = s.work_date AND d.employee_no = s.employee_no
       JOIN processes p ON p.process_code = d.process_code
       WHERE s.work_date BETWEEN ? AND ?
       GROUP BY p.process_name`
    )
    .all(dateFrom, dateTo) as { process_name: string; cnt: number; hrs: number }[];
  const supportOutByProcess = new Map(supportOutRows.map((r) => [r.process_name, r]));

  const allProcessNames = new Set<string>([
    ...normalByProcess.keys(),
    ...supportInByProcess.keys(),
    ...supportOutByProcess.keys(),
  ]);

  const byProcess: ProcessWorkSummaryRow[] = Array.from(allProcessNames)
    .map((processName) => {
      const inRow = supportInByProcess.get(processName);
      const outRow = supportOutByProcess.get(processName);
      return {
        process_name: processName,
        normal_person_days: normalByProcess.get(processName) ?? 0,
        support_in_person_days: inRow?.cnt ?? 0,
        support_out_person_days: outRow?.cnt ?? 0,
        support_in_hours: inRow?.hrs ?? 0,
        support_out_hours: outRow?.hrs ?? 0,
      };
    })
    .sort((a, b) => a.process_name.localeCompare(b.process_name, "ko"));

  // 지원 매트릭스: (본공정 -> 지원공정) 조합별 연인원/시간합.
  const matrixRows = db
    .prepare(
      `SELECT p.process_name AS from_process_name, s.support_work_group AS to_process_name,
              COUNT(*) AS cnt, SUM(s.support_hours) AS hrs
       FROM work_support_detail s
       JOIN work_hours_daily d ON d.work_date = s.work_date AND d.employee_no = s.employee_no
       JOIN processes p ON p.process_code = d.process_code
       WHERE s.work_date BETWEEN ? AND ?
       GROUP BY p.process_name, s.support_work_group
       ORDER BY p.process_name, s.support_work_group`
    )
    .all(dateFrom, dateTo) as {
    from_process_name: string;
    to_process_name: string;
    cnt: number;
    hrs: number;
  }[];

  const matrix: SupportMatrixCell[] = matrixRows.map((r) => ({
    from_process_name: r.from_process_name,
    to_process_name: r.to_process_name,
    person_days: r.cnt,
    total_hours: r.hrs ?? 0,
  }));

  return NextResponse.json({ dateFrom, dateTo, byProcess, matrix });
}
