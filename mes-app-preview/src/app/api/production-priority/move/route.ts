import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PRIORITY_ORDER, buildPriorityWhere } from "@/lib/production-priority-query";

export const runtime = "nodejs";

interface MoveBody {
  so_no?: string;
  direction?: "up" | "down";
  dateFrom?: string;
  dateTo?: string;
  soNo?: string;
}

// 생산순위지정(PLAN-01) — 작업순서는 더 이상 숫자를 직접 입력하지 않고, 현재 조회 조건(필터)
// 기준 전체 목록에서 대상 행을 한 칸 위/아래로 옮긴 뒤 100, 200, 300...으로 다시 채번해 저장한다
// (원본 "생산순위지정.xlsx" 자료와 동일하게 100부터 100 단위로 증가 — 중간 삽입 여지를 남겨둔다).
// 기존 값이 비어있거나(NULL) 뒤섞여 있어도 항상 현재 정렬 순서를 기준으로 안전하게 재정렬된다.
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as MoveBody | null;
  const soNoTarget = body?.so_no;
  const direction = body?.direction;
  if (!soNoTarget || (direction !== "up" && direction !== "down")) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const db = getDb();
  const params = new URLSearchParams();
  if (body?.dateFrom) params.set("dateFrom", body.dateFrom);
  if (body?.dateTo) params.set("dateTo", body.dateTo);
  if (body?.soNo) params.set("soNo", body.soNo);
  const { where, args } = buildPriorityWhere(params);

  const list = db
    .prepare(
      `SELECT so.so_no, so.detail
       FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       JOIN items it ON it.item_code = so.item_code
       ${where} ${PRIORITY_ORDER}`
    )
    .all(...args) as { so_no: string; detail: string | null }[];

  const idx = list.findIndex((r) => r.so_no === soNoTarget);
  if (idx === -1) {
    return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
  }
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) {
    return NextResponse.json({ ok: true });
  }
  [list[idx], list[swapWith]] = [list[swapWith], list[idx]];

  const update = db.prepare("UPDATE sales_orders SET detail = ? WHERE so_no = ?");
  db.exec("BEGIN");
  try {
    list.forEach((r, i) => {
      const detail = r.detail ? (JSON.parse(r.detail) as Record<string, string | number | null>) : {};
      const next = (i + 1) * 100;
      if (detail["작업순서"] === next) return; // 이미 같은 값이면 쓰기 생략
      detail["작업순서"] = next;
      update.run(JSON.stringify(detail), r.so_no);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ ok: true });
}
