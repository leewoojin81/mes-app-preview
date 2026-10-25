import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { CONTROL_PLAN_MAX_BYTES, ensureControlPlanTables, listControlPlans } from "@/lib/control-plan";

export const runtime = "nodejs";

// Control Plan(QC-00) — 올린 PDF 목록 / PDF 올리기(multipart: file, title, rev_no, rev_date, note)
export async function GET() {
  return NextResponse.json({ files: listControlPlans(getDb()) });
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "업로드할 PDF 파일이 없습니다." }, { status: 400 });
  }
  if (file.size > CONTROL_PLAN_MAX_BYTES) {
    return NextResponse.json({ error: "파일 용량이 너무 큽니다(50MB 이하)." }, { status: 413 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  // 확장자만 바꾼 파일을 막는다 — PDF는 "%PDF-"로 시작한다
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "PDF 파일만 올릴 수 있습니다." }, { status: 400 });
  }
  const text = (k: string, max: number) => String(form.get(k) ?? "").trim().slice(0, max);
  const title = text("title", 200);
  if (!title) return NextResponse.json({ error: "문서명을 입력하세요." }, { status: 400 });
  const revDate = text("rev_date", 10);
  if (revDate && !/^\d{4}-\d{2}-\d{2}$/.test(revDate)) {
    return NextResponse.json({ error: "개정일자 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  const db = getDb();
  ensureControlPlanTables(db);
  const r = db
    .prepare(
      `INSERT INTO qc_control_plans (title, rev_no, rev_date, note, file_name, mime, size, data, uploaded_by)
       VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?)`
    )
    .run(title, text("rev_no", 20), revDate || null, text("note", 500), file.name.slice(0, 255), buf.length, buf, user);
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) }, { status: 201 });
}
