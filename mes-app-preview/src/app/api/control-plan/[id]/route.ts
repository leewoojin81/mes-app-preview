import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureControlPlanTables } from "@/lib/control-plan";

export const runtime = "nodejs";

// Control Plan(QC-00) PDF 한 개 — 보기(화면 안 미리보기, ?download=1이면 내려받기) / 삭제
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new NextResponse("bad request", { status: 400 });
  const db = getDb();
  ensureControlPlanTables(db);
  const r = db.prepare("SELECT file_name, mime, data FROM qc_control_plans WHERE id = ?").get(id) as
    | { file_name: string; mime: string; data: Uint8Array }
    | undefined;
  if (!r?.data) return new NextResponse("not found", { status: 404 });
  const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(r.data), {
    headers: {
      "Content-Type": r.mime,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(r.file_name)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const db = getDb();
  ensureControlPlanTables(db);
  const r = db.prepare("DELETE FROM qc_control_plans WHERE id = ?").run(id);
  if (Number(r.changes) === 0) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
