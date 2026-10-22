import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { rangeDeleteGuard } from "@/lib/import-guard";
import { normalizeWorkDate } from "@/lib/daily-work-status-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// status 컬럼(내부 조회용 폴백)도 detail.상태와 동일한 값(수주/Packing/출고/완료/중단)을 그대로 쓴다.
const VALID_STATUS = new Set(["수주", "Packing", "출고", "완료", "중단"]);

// 화면 조회(api/sales-orders)와 같은 수주일자 식 — detail.수주일자("2026.10.20")를 "2026-10-20"으로 맞춘다.
const ORDER_DATE_EXPR = `replace(json_extract(detail, '$.수주일자'), '.', '-')`;
// 엑셀 업로드분만 구간 재동기화 대상이다 — 화면에서 수동/일괄 등록한 수주는 detail에 수주번호가 없어 지우지 않는다.
const UPLOADED_EXPR = `json_extract(detail, '$.수주번호') IS NOT NULL`;

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: string | number | null): number | null {
  return typeof v === "number" ? v : null;
}
// '2026.01.23' -> '2026-01-23'
function toIsoDate(v: string | number | null): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}
function toDateTime(v: string | number | null): string | null {
  const iso = toIsoDate(v);
  return iso ? `${iso} 00:00:00` : null;
}

// 엑셀 업로드 임포트: 원본 "수주현황" 양식을 파싱해 저장한다. so_no는 시트의 "수주번호"+"순번"
// (라인 일련번호)으로 고정된다. ERP에서 취소/삭제된 수주가 DB에 그대로 남지 않도록 PROD-10
// 일일작업현황과 같은 "구간 재동기화" 방식을 쓴다: 업로드 파일의 수주일자 최소~최대 구간을 구해
// 그 구간의 기존 엑셀 업로드분을 지운 뒤 파일 내용을 새로 입력한다(구간 밖 데이터와 수동 등록분은 유지).
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx/.xls 파일인지 확인하세요)" },
      { status: 400 }
    );
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (
    | string
    | number
    | null
  )[][];
  const header = (rows[0] ?? []).map((h) => (h == null ? "" : String(h).replace(/[▲▼]/g, "").trim()));
  const idx = (name: string) => header.indexOf(name);

  const iOrderDate = idx("수주일자");
  const iCustCode = idx("코드");
  const iItemCode = idx("품목코드");
  const iQty = idx("수량");
  const iUnitPrice = idx("단가");
  const iDueDate = idx("납기일자");
  const iStatus = idx("상태");
  const iRegDate = idx("등록일");
  const iOrderNo = idx("수주번호");
  // 헤더에 "순번"이 두 번 나온다 — 앞쪽은 항상 0인 상수, 실제 라인 일련번호는 뒤쪽 것.
  const iLineSeq = header.lastIndexOf("순번");

  const required: [string, number][] = [
    ["수주일자", iOrderDate],
    ["코드", iCustCode],
    ["품목코드", iItemCode],
    ["수량", iQty],
    ["수주번호", iOrderNo],
    ["순번", iLineSeq],
  ];
  const missing = required.filter(([, i]) => i === -1).map(([name]) => name);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const db = getDb();
  const custCodes = new Set(
    (db.prepare("SELECT customer_code FROM customers").all() as { customer_code: string }[]).map(
      (c) => c.customer_code
    )
  );
  const itemCodes = new Set(
    (db.prepare("SELECT item_code FROM items").all() as { item_code: string }[]).map(
      (i) => i.item_code
    )
  );

  // 1차: 행을 검사해 입력할 행과 수주일자 구간(최소~최대)을 구한다. 수주일자가 날짜가 아닌 행(합계 등)은
  // 구간 계산에서 빼야 한다 — 그대로 두면 그 값이 구간 끝이 되어 이후 데이터를 전부 지운다(PROD-10 사고).
  type Prepared = { so_no: string; orderDate: string; values: (string | number | null)[] };
  const prepared: Prepared[] = [];
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let skippedNoDate = 0;
  let skippedInvalid = 0;
  let skippedCustomerNotFound = 0;
  let skippedItemNotFound = 0;

  for (const r of rows.slice(1)) {
    const orderDate = normalizeWorkDate(r[iOrderDate] ?? null);
    if (!orderDate) {
      skippedNoDate++;
      continue;
    }
    const customerCode = str(r[iCustCode]);
    const itemCode = str(r[iItemCode]);
    const qty = num(r[iQty]);
    const orderNo = str(r[iOrderNo]);
    const lineSeq = r[iLineSeq];

    if (!customerCode || !itemCode || !qty || qty <= 0 || !orderNo || lineSeq == null) {
      skippedInvalid++;
      continue;
    }
    if (!custCodes.has(customerCode)) {
      skippedCustomerNotFound++;
      continue;
    }
    if (!itemCodes.has(itemCode)) {
      skippedItemNotFound++;
      continue;
    }

    const so_no = `${orderNo}-${lineSeq}`;
    const statusRaw = str(r[iStatus]);
    const status = statusRaw && VALID_STATUS.has(statusRaw) ? statusRaw : "수주";
    const createdAt =
      toDateTime(r[iRegDate]) ?? new Date().toISOString().slice(0, 19).replace("T", " ");

    // 원본 시트 전체 컬럼을 헤더명 기준으로 그대로 보존 (화면에서 그대로 표시).
    // "순번"처럼 헤더명이 중복되는 컬럼은 두 번째부터 "이름__2" 형식의 고유 키로 저장한다.
    const detail: Record<string, string | number | null> = {};
    const headerSeen: Record<string, number> = {};
    header.forEach((name, i) => {
      if (!name) return;
      const n = (headerSeen[name] = (headerSeen[name] ?? 0) + 1);
      const key = n === 1 ? name : `${name}__${n}`;
      detail[key] = r[i] == null ? null : r[i];
    });

    prepared.push({
      so_no,
      orderDate,
      values: [
        so_no,
        customerCode,
        itemCode,
        qty,
        num(r[iUnitPrice]),
        toIsoDate(r[iDueDate]),
        status,
        createdAt,
        JSON.stringify(detail),
      ],
    });
    if (!dateFrom || orderDate < dateFrom) dateFrom = orderDate;
    if (!dateTo || orderDate > dateTo) dateTo = orderDate;
  }

  if (!dateFrom || !dateTo || prepared.length === 0) {
    return NextResponse.json({ error: "입력할 수 있는 수주 데이터(수주일자)가 없습니다." }, { status: 400 });
  }

  // 같은 so_no가 구간 밖 수주일자로 남아있는 경우(수주일자가 바뀐 수주)까지 대비해 upsert로 넣는다.
  const upsert = db.prepare(
    `INSERT INTO sales_orders
       (so_no, customer_code, item_code, order_qty, unit_price, due_date, status, created_at, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(so_no) DO UPDATE SET
       customer_code = excluded.customer_code,
       item_code = excluded.item_code,
       order_qty = excluded.order_qty,
       unit_price = excluded.unit_price,
       due_date = excluded.due_date,
       status = excluded.status,
       created_at = excluded.created_at,
       detail = excluded.detail`
  );
  const rangeWhere = `${UPLOADED_EXPR} AND ${ORDER_DATE_EXPR} >= ? AND ${ORDER_DATE_EXPR} <= ?`;
  const countInRange = db.prepare(`SELECT COUNT(*) AS c FROM sales_orders WHERE ${rangeWhere}`);
  const deleteInRange = db.prepare(`DELETE FROM sales_orders WHERE ${rangeWhere}`);
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM sales_orders");

  // 지울 건수가 넣을 건수보다 훨씬 많으면 확인 없이 지우지 않는다(lib/import-guard.ts).
  {
    const existing = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    const warning = rangeDeleteGuard({
      existing,
      incoming: prepared.length,
      dateFrom,
      dateTo,
      force: form?.get("force") === "1",
    });
    if (warning) return NextResponse.json(warning, { status: 409 });
  }

  let deleted = 0;
  let inserted = 0;
  let finalTotal = 0;

  // 2차: 구간의 기존 업로드분을 지우고 파일 내용을 새로 입력한다(한 트랜잭션 — 중간에 실패하면 전부 되돌린다).
  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    for (const p of prepared) {
      upsert.run(...p.values);
      inserted++;
    }
    finalTotal = (countAll.get() as { c: number }).c;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({
    dateFrom,
    dateTo,
    deleted,
    inserted,
    skippedNoDate,
    skippedInvalid,
    skippedCustomerNotFound,
    skippedItemNotFound,
    finalTotal,
  });
}
