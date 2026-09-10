import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import {
  ENTITY_TYPE_WORKER,
  fetchFieldHistoryMap,
  logFieldChanges,
  resolveFieldAsOf,
  WORKER_TRACKED_FIELDS,
} from "@/lib/master-data-history";

export const runtime = "nodejs";

// "주간고정"은 2026-09-10 사용자 요청으로 선택지에서 제거됨(workers/page.tsx TEAM_OPTIONS와
// 동일) — 기존에 이미 이 값으로 저장된 작업자는 남아있지만, 이 엔드포인트로 새로 이 값을
// 설정할 수는 없다.
const TEAM_VALUES = ["1조", "2조", "3조"] as const;

function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "YYYY-MM-DD" 하루 뒤를 로컬 날짜 성분으로 계산한다(toISOString은 UTC라 자정 근처에
// 하루 밀릴 수 있어 쓰지 않는다 — mes-app-structure 메모리에 기록된 프로젝트 공통 함정).
function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

// 근무조(작업자등록 BASE-09 workers.team) 전용 부분수정 엔드포인트 — 일일근태입력(PSN-01)
// 그리드에서 개별 선택/선택 일괄변경으로 즉시 반영할 때 쓴다(2026-09-10 사용자 요청 —
// 교대조는 BASE-09에서만 바꾸도록 PSN-01에서 편집을 없애고, 대신 근무조를 PSN-01에서도
// 바꿀 수 있게 함). /api/workers/[employee_no] PATCH는 전체 필드를 덮어쓰는 방식이라,
// PSN-01처럼 작업자의 일부 필드만 들고 있는 화면에서 그대로 쓰면 remark/방진복사이즈 등
// 나머지 필드가 null로 날아가서 team 하나만 부분수정하는 이 엔드포인트를 따로 둔다.
//
// **오늘 수정 vs 과거 날짜 수정을 다르게 처리한다**(2026-09-10 사용자 요청, 실사례로
// 확정) — PSN-01이 조회 중인 날짜(body.date)가:
//  - 오늘이면: 지금까지와 동일하게 workers.team(현재값)을 바로 바꾸고, 변경이력을 오늘
//    날짜로 남긴다 — "오늘부터 다음 변경일까지" 계속 적용되는 정상적인 재배정.
//  - 오늘이 아니면(과거의 이미 확정된 자료를 고치는 경우): workers.team(현재값)은 절대
//    건드리지 않고, 그 날짜 "하루만" 값이 바뀌어 보이도록 변경이력에 두 개의 경계를
//    남긴다 — (그 날짜부터, 새 값)과 (다음날부터, 원래대로 되돌아갈 값). 예: 9/3만 2조로
//    고치면 9/3은 2조로 보이고 9/4부터는(다른 이력이 없다면) 자동으로 원래 값(예: 3조)
//    으로 돌아간다. body.date가 없거나 형식이 안 맞으면(다른 호출부 대비) 안전하게 "오늘"
//    분기로 처리한다.
export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.employeeNos)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const employeeNos = (body.employeeNos as unknown[]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== ""
  );
  if (employeeNos.length === 0) {
    return NextResponse.json({ error: "대상 사번이 없습니다." }, { status: 400 });
  }
  const team = body.team === null ? null : String(body.team ?? "");
  if (team !== null && team !== "" && !TEAM_VALUES.includes(team as (typeof TEAM_VALUES)[number])) {
    return NextResponse.json({ error: "근무조는 1조/2조/3조 중 하나여야 합니다." }, { status: 400 });
  }
  const value = team === "" ? null : team;

  const rawDate = typeof body.date === "string" ? body.date : "";
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  const today = todayLocalStr();
  const isPastDateFix = requestedDate != null && requestedDate !== today;

  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  let targets = employeeNos;
  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) {
      targets = [];
    } else {
      const placeholders = leaderWorkGroups.map(() => "?").join(",");
      const allowed = new Set(
        (
          db
            .prepare(`SELECT employee_no FROM workers WHERE work_group IN (${placeholders})`)
            .all(...leaderWorkGroups) as { employee_no: string }[]
        ).map((r) => r.employee_no)
      );
      targets = employeeNos.filter((no) => allowed.has(no));
    }
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const placeholders = targets.map(() => "?").join(",");
  const changedBy = session?.u ?? null;

  // 대상마다 기존 근무조 값이 서로 다를 수 있어(예: 일부는 1조, 일부는 미지정), 일괄
  // 변경이어도 개인별로 실제 값이 바뀐 사람만 이력에 남긴다 — UPDATE 전에 미리 읽어둔다.
  const beforeRows = db
    .prepare(`SELECT employee_no, team FROM workers WHERE employee_no IN (${placeholders})`)
    .all(...targets) as { employee_no: string; team: string | null }[];
  const beforeByEmployee = new Map(beforeRows.map((r) => [r.employee_no, r.team]));

  db.exec("BEGIN");
  let changes = 0;
  try {
    if (isPastDateFix) {
      const historyMap = fetchFieldHistoryMap(db, ENTITY_TYPE_WORKER, "team", targets);
      const nextDate = addOneDay(requestedDate!);
      for (const employeeNo of targets) {
        const current = beforeByEmployee.get(employeeNo) ?? null;
        // 이 수정 전에 그 날짜/다음날 각각 원래 무슨 값으로 보였을지 먼저 계산해둔다 —
        // "다음날" 복귀값은 이 수정과 무관하게 원래 있던 트랙을 그대로 이어간다.
        const beforeAtDate = resolveFieldAsOf(historyMap, employeeNo, requestedDate!, current);
        const afterNextDay = resolveFieldAsOf(historyMap, employeeNo, nextDate, current);
        if (beforeAtDate !== value) {
          logFieldChanges(db, {
            entityType: ENTITY_TYPE_WORKER,
            entityId: employeeNo,
            trackedFields: WORKER_TRACKED_FIELDS,
            before: { team: beforeAtDate },
            after: { team: value },
            changedBy,
            changeDate: requestedDate!,
          });
          changes++;
        }
        if (afterNextDay !== value) {
          logFieldChanges(db, {
            entityType: ENTITY_TYPE_WORKER,
            entityId: employeeNo,
            trackedFields: WORKER_TRACKED_FIELDS,
            before: { team: value },
            after: { team: afterNextDay },
            changedBy,
            changeDate: nextDate,
          });
        }
      }
    } else {
      const result = db
        .prepare(`UPDATE workers SET team = ? WHERE employee_no IN (${placeholders})`)
        .run(value, ...targets);
      changes = Number(result.changes);

      for (const employeeNo of targets) {
        logFieldChanges(db, {
          entityType: ENTITY_TYPE_WORKER,
          entityId: employeeNo,
          trackedFields: WORKER_TRACKED_FIELDS,
          before: { team: beforeByEmployee.get(employeeNo) ?? null },
          after: { team: value },
          changedBy,
          changeDate: requestedDate ?? undefined,
        });
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ ok: true, count: changes });
}
