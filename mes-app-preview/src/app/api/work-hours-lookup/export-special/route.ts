import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { resolveEmployeeNos } from "@/lib/work-hours-lookup";
import { fetchSpecialWorkGrid } from "@/lib/special-work-grid";
import { buildSpecialWorkbook, specialWorkFilename } from "@/lib/special-work-excel";

export const runtime = "nodejs";

// 근무시간조회(PSN-05) "특근일" 다운로드(2026-09-08 신설, 2026-09-26 양식 교체) — 화면에서 이미
// 선택된 작업자들(workGroup/employeeNo, 조장이면 세션으로 추가 스코프)과 달력에서 고른
// 특근일들로, 양식 "2026년 09월 일요일근무(양식).xlsx"의 "정규세부(급여계산)" 시트처럼
// 작업자당 5행(출근/퇴근/기본근무 계/연장근무 계/급여산출) 급여계산서를 내려준다. 시급은 화면
// 입력값(기본근무 시급=시급×1.5, 연장근무 시급=시급×2.0)을 엑셀 수식에 넣고, 야간식대는 패널에
// 입력한 1회당 금액(nightMeal) × 야간 근무일 수(카드 출근 20:00 이후)를 급여산출 행에 넣어
// TTL에 합산한다. 예전 6컬럼
// 요약표(이름/근무구분/근무일수/근무시간/금액/비고)는 이 양식으로 대체했다. 계산 규칙은
// lib/special-work-grid.ts(값)와 lib/special-work-excel.ts(양식).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });

  const workGroup: string = typeof body.workGroup === "string" ? body.workGroup : "";
  const employeeNo: string = typeof body.employeeNo === "string" ? body.employeeNo : "";
  const dates: string[] = Array.isArray(body.dates)
    ? body.dates.filter((d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  // 야간식대(1회당 원) — 안 보내거나 비우면 0원(야간식대 없음)
  const nightMealRaw = body.nightMeal === undefined || body.nightMeal === "" ? 0 : Number(body.nightMeal);
  const baseRate = Number(body.baseRate);
  const overtimeRate = Number(body.overtimeRate);

  if (dates.length === 0) {
    return NextResponse.json({ error: "특근일을 하나 이상 선택해 주세요." }, { status: 400 });
  }
  if (!Number.isFinite(baseRate) || baseRate < 0 || !Number.isFinite(overtimeRate) || overtimeRate < 0) {
    return NextResponse.json({ error: "기본근무 시급/연장근무 시급을 올바르게 입력해 주세요." }, { status: 400 });
  }
  if (!Number.isFinite(nightMealRaw) || nightMealRaw < 0) {
    return NextResponse.json({ error: "야간식대를 올바르게 입력해 주세요." }, { status: 400 });
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;

  const employeeNos = resolveEmployeeNos(db, { workGroup, employeeNo, leaderWorkGroups });
  const grid = fetchSpecialWorkGrid(db, { employeeNos, dates });
  if (grid.workers.length === 0) {
    return NextResponse.json({ error: "선택한 특근일에 근무기록(PSN-01)이 있는 작업자가 없습니다." }, { status: 400 });
  }

  let buf: ArrayBuffer;
  try {
    buf = await buildSpecialWorkbook(grid, { base: Math.round(baseRate), overtime: Math.round(overtimeRate) }, Math.round(nightMealRaw));
  } catch (e) {
    return NextResponse.json(
      { error: `서식 파일을 처리하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const filename = specialWorkFilename(grid.dates);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
