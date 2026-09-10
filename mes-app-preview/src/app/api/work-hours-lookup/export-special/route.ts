import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { fetchSpecialWorkDayTotals, resolveEmployeeNos } from "@/lib/work-hours-lookup";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 근무시간조회(PSN-05) "특근일" 다운로드(2026-09-08 사용자 요청) — 화면에서 이미 선택된
// 작업자들(workGroup/employeeNo, 조장이면 세션으로 추가 스코프) 기준으로, 사용자가 달력에서
// 고른 특근일들의 PSN-01 저장 실근무시간(work_hours_daily.total_hours)을 읽어
// 기본근무시간=min(그날 총근무시간,8), 연장근무시간=max(그날 총근무시간-8,0)을 사람별로
// 선택 일자 전체에 걸쳐 합산한 뒤, 시급을 곱해 금액을 낸다. 첨부 참고 양식("일요일근무.xlsx")은
// 요일별 넓은 피벗 서식이라 이 화면이 요청받은 6개 고정 컬럼(이름/근무구분/근무일수/근무시간/
// 금액/비고)과는 다르지만, "기본근무 계"/"연장근무 계"를 사람당 별도 행으로 나누는 방식은
// 그 원본과 같은 개념이라 근무구분을 "휴일근무-기본"/"휴일근무-연장" 두 행으로 낸다.
// 연장 행은 실제로 연장이 발생한 사람에게만 낸다(0시간짜리 빈 행을 만들지 않는다).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });

  const workGroup: string = typeof body.workGroup === "string" ? body.workGroup : "";
  const employeeNo: string = typeof body.employeeNo === "string" ? body.employeeNo : "";
  const dates: string[] = Array.isArray(body.dates)
    ? body.dates.filter((d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  const baseRate = Number(body.baseRate);
  const overtimeRate = Number(body.overtimeRate);

  if (dates.length === 0) {
    return NextResponse.json({ error: "특근일을 하나 이상 선택해 주세요." }, { status: 400 });
  }
  if (!Number.isFinite(baseRate) || baseRate < 0 || !Number.isFinite(overtimeRate) || overtimeRate < 0) {
    return NextResponse.json({ error: "기본근무 시급/연장근무 시급을 올바르게 입력해 주세요." }, { status: 400 });
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;

  const employeeNos = resolveEmployeeNos(db, { workGroup, employeeNo, leaderWorkGroups });
  const totals = fetchSpecialWorkDayTotals(db, { employeeNos, dates: [...new Set(dates)] });

  const header = ["이름", "근무구분", "근무일수", "근무시간", "금액", "비고"];
  const aoa: (string | number)[][] = [header];
  for (const t of totals) {
    if (t.base_days === 0) continue;
    aoa.push([
      t.worker_name,
      "휴일근무-기본",
      t.base_days,
      Number(t.base_hours.toFixed(2)),
      Math.round(t.base_hours * baseRate),
      "특근수당",
    ]);
    if (t.overtime_days > 0) {
      aoa.push([
        t.worker_name,
        "휴일근무-연장",
        t.overtime_days,
        Number(t.overtime_hours.toFixed(2)),
        Math.round(t.overtime_hours * overtimeRate),
        "특근수당",
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "특근일");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `특근일_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
