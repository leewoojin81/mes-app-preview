import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildAttendanceCardWhere } from "@/lib/attendance-card-filters";
import { normalizeCardDate } from "@/lib/attendance-card-columns";

export const runtime = "nodejs";

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseDetail<T extends { detail?: string | null; edited_fields?: string | null }>(r: T) {
  return {
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
    edited_fields: r.edited_fields ? (JSON.parse(r.edited_fields) as string[]) : null,
  };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50));

  const { where, args } = buildAttendanceCardWhere(params);

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM attendance_card_status ${where}`).get(...args) as {
      c: number;
    }
  ).c;
  const offset = (page - 1) * pageSize;
  const rows = (
    db
      .prepare(
        `SELECT * FROM attendance_card_status ${where} ORDER BY work_date DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, pageSize, offset) as { detail: string | null; edited_fields: string | null }[]
  ).map(parseDetail);

  const uploadedAt = (
    db.prepare("SELECT MAX(uploaded_at) as t FROM attendance_card_status").get() as {
      t: string | null;
    }
  ).t;

  return NextResponse.json({ rows, total, page, pageSize, uploadedAt });
}

// PSN-02 "신규 등록"(2026-09-24 사용자 요청) — 작업자가 카드를 안 찍어(분실/미태깅 등)
// 그 사원번호·근무일자에 아예 행이 없으면 "수정" 버튼을 누를 대상 자체가 없다. 회사
// 실제 업무 절차(근태신청서 결재 → 담당 직원이 출퇴근카드등록에 직접 채워 넣음)를 그대로
// 반영해, 행이 없는 경우엔 이 엔드포인트로 새 행을 만든다. 세콤 업로드가 아니라 사람이
// 처음부터 채운 행이라 값이 있는 필드는 전부 edited_fields에 넣어 그리드에서 빨간색으로
// 표시한다(원본 세콤 데이터가 아님을 구분).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.detail !== "object" || body.detail == null) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const rawDetail = body.detail as Record<string, string | number | null>;
  const detail: Record<string, string | number | null> = {};
  for (const k of Object.keys(rawDetail)) detail[k] = str(rawDetail[k]);

  const employeeNo = str(detail["사원번호"]);
  const workDate = normalizeCardDate(detail["근무일자"] == null ? null : String(detail["근무일자"]));
  if (!employeeNo || !workDate) {
    return NextResponse.json({ error: "사원번호·근무일자는 필수입니다." }, { status: 400 });
  }
  detail["근무일자"] = workDate;
  const recordKey = `${employeeNo}|${workDate}`;

  const db = getDb();
  const conflict = db.prepare("SELECT id FROM attendance_card_status WHERE record_key = ?").get(recordKey);
  if (conflict) {
    return NextResponse.json(
      { error: "같은 사원번호·근무일자의 행이 이미 있습니다. 목록에서 수정을 이용하세요." },
      { status: 409 }
    );
  }

  const editedFields = Object.keys(detail).filter((k) => detail[k] != null);

  const info = db
    .prepare(
      `INSERT INTO attendance_card_status
         (record_key, employee_no, work_date, org, worker_name, team, detail, edited_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      recordKey,
      employeeNo,
      workDate,
      str(detail["조직"]),
      str(detail["이름"]),
      str(detail["근무조"]),
      JSON.stringify(detail),
      editedFields.length > 0 ? JSON.stringify(editedFields) : null
    );

  return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) });
}
