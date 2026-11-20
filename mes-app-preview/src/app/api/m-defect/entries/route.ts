import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import {
  MAX_PHOTO_BYTES,
  MD_PROCESSES,
  ensureMobileDefectTables,
  extractWoNo,
  isJpeg,
  linkPendingMobileDefects,
  lookupWorkOrder,
  savePhoto,
  type EntryRow,
} from "@/lib/mobile-defect";

export const runtime = "nodejs";

// 모바일 불량입력(/m/defect)
// GET  : 오늘 내가 입력한 내역
// POST : multipart/form-data { wo_no, process, type_code, qty, memo?, method(QR|수동), qr_raw?, photo1..3(JPG) }
export async function GET(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const db = getDb();
  ensureMobileDefectTables(db);
  try {
    linkPendingMobileDefects(db); // 마킹 실적이 그사이 올라왔으면 PROC-06-02에 붙인다
  } catch (e) {
    console.error("[모바일 불량입력] 연결 실패", e);
  }
  const rows = db
    .prepare(
      `SELECT id, wo_no, lot_no, item_info, process_name, defect_type_name, qty, memo,
              photo1, photo2, photo3, input_method, created_at, linked_key, linked_at
       FROM mobile_defect_entries
       WHERE username = ? AND deleted_at IS NULL AND date(created_at) = date('now','localtime')
       ORDER BY id DESC`
    )
    .all(session.u) as EntryRow[];
  return NextResponse.json({ entries: rows, user: session.n, processes: session.p });
}

export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "입력값을 읽지 못했습니다. 다시 저장해 주세요." }, { status: 400 });

  const woNo = extractWoNo(String(form.get("wo_no") ?? ""));
  const processName = String(form.get("process") ?? "");
  const typeCode = String(form.get("type_code") ?? "");
  const qty = Number(form.get("qty"));
  const memo = String(form.get("memo") ?? "").trim().slice(0, 500) || null;
  const method = String(form.get("method") ?? "") === "QR" ? "QR" : "수동";
  const qrRaw = String(form.get("qr_raw") ?? "").slice(0, 500) || null;

  if (!woNo) return NextResponse.json({ error: "작업지시번호를 확인해 주세요." }, { status: 400 });
  if (!(MD_PROCESSES as readonly string[]).includes(processName))
    return NextResponse.json({ error: "공정을 선택해 주세요." }, { status: 400 });
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000)
    return NextResponse.json({ error: "불량 수량을 1 이상 숫자로 입력해 주세요." }, { status: 400 });

  const db = getDb();
  ensureMobileDefectTables(db);
  const type = db
    .prepare("SELECT type_code, type_name FROM defect_type_master WHERE type_code = ? AND use_yn = 'Y'")
    .get(typeCode) as { type_code: string; type_name: string } | undefined;
  if (!type) return NextResponse.json({ error: "불량 유형을 선택해 주세요." }, { status: 400 });

  const wo = lookupWorkOrder(db, woNo);
  if (!wo) {
    return NextResponse.json(
      { error: `${woNo} 작업지시를 찾을 수 없어 저장하지 않았습니다.` },
      { status: 404 }
    );
  }

  const photos: Buffer[] = [];
  for (const key of ["photo1", "photo2", "photo3"]) {
    const f = form.get(key);
    if (!f || typeof f === "string") continue;
    if (f.size > MAX_PHOTO_BYTES)
      return NextResponse.json({ error: "사진 용량이 너무 큽니다(장당 4MB 이하)." }, { status: 400 });
    const buf = Buffer.from(await f.arrayBuffer());
    if (!isJpeg(buf)) return NextResponse.json({ error: "사진은 JPG만 저장할 수 있습니다." }, { status: 400 });
    photos.push(buf);
  }

  const info = db
    .prepare(
      `INSERT INTO mobile_defect_entries
         (wo_no, lot_no, item_code, item_info, process_name, defect_type_code, defect_type_name,
          qty, memo, input_method, qr_raw, username, display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      woNo, wo.lot_no, wo.item_code, wo.item_info, processName, type.type_code, type.type_name,
      qty, memo, method, qrRaw, session.u, session.n
    );
  const id = Number(info.lastInsertRowid);
  const row = db.prepare("SELECT date(created_at) AS d FROM mobile_defect_entries WHERE id = ?").get(id) as { d: string };

  try {
    const rels = photos.map((buf, i) => savePhoto(id, i + 1, buf, row.d));
    if (rels.length) {
      db.prepare("UPDATE mobile_defect_entries SET photo1 = ?, photo2 = ?, photo3 = ? WHERE id = ?").run(
        rels[0] ?? null, rels[1] ?? null, rels[2] ?? null, id
      );
    }
  } catch {
    db.prepare("UPDATE mobile_defect_entries SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
    return NextResponse.json({ error: "사진 저장에 실패해 입력을 취소했습니다. 다시 저장해 주세요." }, { status: 500 });
  }

  // PROC-06-02 불량이력관리(같은 작업지시의 마킹 실적 줄)에 바로 붙여 본다 — 실적이 아직 없으면 대기
  let linked = false;
  try {
    linkPendingMobileDefects(db);
    linked = !!(db.prepare("SELECT linked_key FROM mobile_defect_entries WHERE id = ?").get(id) as { linked_key: string | null }).linked_key;
  } catch (e) {
    console.error("[모바일 불량입력] 연결 실패", e);
  }
  return NextResponse.json({ id, wo_no: woNo, type_name: type.type_name, qty, photos: photos.length, linked, process: processName }, { status: 201 });
}
