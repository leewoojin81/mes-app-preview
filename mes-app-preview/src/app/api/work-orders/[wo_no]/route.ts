import { NextRequest, NextResponse } from "next/server";
import { getDb, nowLocal } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ wo_no: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { wo_no } = await params;
  const db = getDb();

  const wo = db
    .prepare(
      `SELECT wo.*, it.item_name as item_name
       FROM work_orders wo JOIN items it ON it.item_code = wo.item_code
       WHERE wo.wo_no = ?`
    )
    .get(wo_no);

  if (!wo) {
    return NextResponse.json({ error: "작업지시를 찾을 수 없습니다." }, { status: 404 });
  }

  const results = db
    .prepare(
      `SELECT pr.*, eq.equipment_name as equipment_name
       FROM production_results pr
       LEFT JOIN equipments eq ON eq.equipment_id = pr.equipment_id
       WHERE pr.wo_no = ? ORDER BY pr.reg_time DESC LIMIT 20`
    )
    .all(wo_no);

  const defects = db
    .prepare(
      `SELECT * FROM defects WHERE wo_no = ? ORDER BY reg_time DESC LIMIT 20`
    )
    .all(wo_no);

  const materialInputs = db
    .prepare(
      `SELECT mi.*, it.item_name as item_name
       FROM material_inputs mi
       JOIN lots l ON l.lot_no = mi.material_lot_no
       JOIN items it ON it.item_code = l.item_code
       WHERE mi.wo_no = ? ORDER BY mi.reg_time DESC LIMIT 20`
    )
    .all(wo_no);

  return NextResponse.json({ workOrder: wo, results, defects, materialInputs });
}

function str(v: string | number | null | undefined): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

interface UpdateBody {
  action: "update";
  line_id?: string | null;
  order_qty?: number | string | null;
  due_date?: string | null;
  seq?: string | number | null;
  line_seq?: string | number | null;
  urgent?: boolean | null;
  release_use?: boolean | null;
  request_no?: string | null;
  remark?: string | null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { wo_no } = await params;
  const body = await req.json();
  const action = (body as { action?: string }).action;

  const db = getDb();
  const wo = db
    .prepare("SELECT * FROM work_orders WHERE wo_no = ?")
    .get(wo_no) as { status: string; detail: string | null } | undefined;

  if (!wo) {
    return NextResponse.json({ error: "작업지시를 찾을 수 없습니다." }, { status: 404 });
  }

  if (action === "issue") {
    if (wo.status !== "대기") {
      return NextResponse.json(
        { error: "대기 상태의 작업지시만 발행할 수 있습니다." },
        { status: 400 }
      );
    }
    db.prepare(
      "UPDATE work_orders SET status = '발행', issued_at = ? WHERE wo_no = ?"
    ).run(nowLocal(db), wo_no);
  } else if (action === "update") {
    const b = body as UpdateBody;
    const line_id = str(b.line_id);
    const order_qty = b.order_qty != null ? Number(b.order_qty) : null;
    if (!line_id || !order_qty || order_qty <= 0) {
      return NextResponse.json(
        { error: "라인, 지시수량을 확인해 주세요." },
        { status: 400 }
      );
    }

    // 렌즈 속성 등 기존 detail 값(생성 시 품목 마스터 스냅샷)은 보존하고, 수정 폼에서
    // 다루는 항목만 덮어쓴다.
    const existingDetail = wo.detail
      ? (JSON.parse(wo.detail) as Record<string, string | number | null>)
      : {};
    const detail = {
      ...existingDetail,
      순서: str(b.seq),
      순번: str(b.line_seq),
      긴급: b.urgent ? "Y" : "N",
      "Release사용": b.release_use ? "Y" : "N",
      의뢰번호: str(b.request_no),
      비고: str(b.remark),
    };

    db.prepare(
      `UPDATE work_orders SET line_id = ?, order_qty = ?, due_date = ?, detail = ? WHERE wo_no = ?`
    ).run(line_id, order_qty, str(b.due_date), JSON.stringify(detail), wo_no);
  } else {
    return NextResponse.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  }

  const updated = db
    .prepare(
      `SELECT wo.*, it.item_name as item_name
       FROM work_orders wo JOIN items it ON it.item_code = wo.item_code
       WHERE wo.wo_no = ?`
    )
    .get(wo_no) as { detail: string | null } | undefined;

  return NextResponse.json(
    updated && { ...updated, detail: updated.detail ? JSON.parse(updated.detail) : null }
  );
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { wo_no } = await params;
  const db = getDb();
  const wo = db.prepare("SELECT wo_no FROM work_orders WHERE wo_no = ?").get(wo_no);
  if (!wo) {
    return NextResponse.json({ error: "작업지시를 찾을 수 없습니다." }, { status: 404 });
  }
  db.prepare("DELETE FROM work_orders WHERE wo_no = ?").run(wo_no);
  return NextResponse.json({ ok: true });
}
