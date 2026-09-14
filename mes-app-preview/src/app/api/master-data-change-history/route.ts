import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { ENTITY_TYPE_WORKER, MASTER_DATA_ENTITY_TYPES } from "@/lib/master-data-history";

export const runtime = "nodejs";

// "기준정보 변경이력"(BASE-10) 조회 — master_data_change_history를 대상유형에 맞는
// 마스터(지금은 entity_type="작업자"일 때만 workers)와 조인해 대상명(현재값, 이력
// 테이블 자체엔 없음)을 참고용으로 붙여 내려준다. 대상유형/대상ID/변경항목/기존값/
// 신규값/변경일자/변경자로 필터링한다(2026-09-09 사용자 요청 — 처음엔 작업자 전용으로
// 만들었다가 같은 날 바로 범용 통합 화면으로 재설계됨). 다른 기준정보(품목 등)가 나중에
// 연결되면 이 SELECT의 entity_name LEFT JOIN에 그 마스터 테이블을 CASE로 추가하면 된다.
// 조장은 현재 소속(work_group) 작업자의 이력만 본다(entity_type="작업자"인 행에만
// 적용 — 다른 대상유형은 조장이 애초에 볼 일이 없는 기준정보라 필터를 걸지 않는다).
export async function GET(req: NextRequest) {
  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const params = req.nextUrl.searchParams;

  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50));

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  const entityType = params.get("entityType")?.trim();
  if (entityType) {
    conditions.push("h.entity_type = ?");
    args.push(entityType);
  }
  const entityId = params.get("entityId")?.trim();
  if (entityId) {
    conditions.push("h.entity_id LIKE ?");
    args.push(`%${entityId}%`);
  }
  const entityName = params.get("entityName")?.trim();
  if (entityName) {
    conditions.push("w.worker_name LIKE ?");
    args.push(`%${entityName}%`);
  }
  const field = params.get("field")?.trim();
  if (field) {
    conditions.push("h.field = ?");
    args.push(field);
  }
  const oldValue = params.get("oldValue")?.trim();
  if (oldValue) {
    conditions.push("h.old_value LIKE ?");
    args.push(`%${oldValue}%`);
  }
  const newValue = params.get("newValue")?.trim();
  if (newValue) {
    conditions.push("h.new_value LIKE ?");
    args.push(`%${newValue}%`);
  }
  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    conditions.push("h.change_date >= ?");
    args.push(dateFrom);
  }
  const dateTo = params.get("dateTo");
  if (dateTo) {
    conditions.push("h.change_date <= ?");
    args.push(dateTo);
  }
  const changedBy = params.get("changedBy")?.trim();
  if (changedBy) {
    conditions.push("h.changed_by = ?");
    args.push(changedBy);
  }

  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) {
      return NextResponse.json({ rows: [], total: 0, page, pageSize, entityTypes: MASTER_DATA_ENTITY_TYPES, fields: [], changedByOptions: [] });
    }
    const placeholders = leaderWorkGroups.map(() => "?").join(",");
    // 작업자 이력만 소속공정으로 좁힌다 — 다른 대상유형(entity_type != 작업자) 행은
    // work_group과 무관하니 그대로 둔다.
    conditions.push(`(h.entity_type != ? OR w.work_group IN (${placeholders}))`);
    args.push(ENTITY_TYPE_WORKER, ...leaderWorkGroups);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  // 지금은 entity_type="작업자"만 실제 데이터가 있어 workers 하나만 조인한다 — 다른
  // 기준정보가 연결되면 그 마스터도 LEFT JOIN하고 COALESCE로 대상명을 합치면 된다.
  // changed_by는 로그인 계정명(username)을 그대로 저장하므로(필터·통계용 키는 계정명이
  // 안정적), users에 조인해 표시용 이름(display_name, 없으면 계정명 그대로)만 따로
  // 붙인다 — src/lib/auth.ts의 세션 n 필드(표시이름) 계산과 동일한 폴백 규칙.
  const fromClause = `FROM master_data_change_history h
    LEFT JOIN workers w ON h.entity_type = '${ENTITY_TYPE_WORKER}' AND w.employee_no = h.entity_id
    LEFT JOIN users u ON h.changed_by = u.username`;

  const total = (db.prepare(`SELECT COUNT(*) AS c ${fromClause} ${where}`).get(...args) as { c: number }).c;

  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(
      `SELECT h.id, h.entity_type, h.entity_id, w.worker_name AS entity_name, h.field, h.field_label,
              h.old_value, h.new_value, h.change_date, h.changed_by,
              COALESCE(u.display_name, h.changed_by) AS changed_by_name, h.created_at
       ${fromClause}
       ${where}
       ORDER BY h.change_date DESC, h.created_at DESC, h.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, offset);

  const fields = db
    .prepare(
      `SELECT DISTINCT field, field_label FROM master_data_change_history
       ${entityType ? "WHERE entity_type = ?" : ""} ORDER BY field_label`
    )
    .all(...(entityType ? [entityType] : [])) as { field: string; field_label: string }[];

  const changedByOptions = db
    .prepare(
      `SELECT DISTINCT h.changed_by AS value, COALESCE(u.display_name, h.changed_by) AS label
       FROM master_data_change_history h LEFT JOIN users u ON h.changed_by = u.username
       WHERE h.changed_by IS NOT NULL ORDER BY label`
    )
    .all() as { value: string; label: string }[];

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize,
    entityTypes: MASTER_DATA_ENTITY_TYPES,
    fields: fields.map((f) => ({ key: f.field, label: f.field_label })),
    changedByOptions,
  });
}
