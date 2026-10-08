import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { PpeItem } from "@/lib/types";
import { nextDueDateAfterIssuance } from "@/lib/ppe";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 헤더 → [품목코드, 차수]. 엑셀 헤더의 줄바꿈/공백은 모두 제거한 뒤 비교한다.
// "방진복&방진화&안전화 1차 지급"은 두 품목(PPE-01, PPE-02)의 1차에 같은 날짜로 넣는다.
const SLOT_HEADERS: { header: string; slots: [string, number][] }[] = [
  { header: "방진복&방진화&안전화1차지급", slots: [["PPE-01", 1], ["PPE-02", 1]] },
  { header: "방진복2차지급", slots: [["PPE-01", 2]] },
  { header: "방진화&안전화2차지급", slots: [["PPE-02", 2]] },
  { header: "깔창1차지급", slots: [["PPE-03", 1]] },
  { header: "깔창2차지급", slots: [["PPE-03", 2]] },
  { header: "깔창3차지급", slots: [["PPE-03", 3]] },
];

const norm = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, ""));

// "2026년 06월" / "2025년10월" / "2026-06" / "2026-06-15" / 엑셀 날짜 → { ym, full }
// 월 단위 값은 그 달 1일로 저장한다(full=null → 기존 같은 달 이력이 있으면 그 일자를 유지).
function parseMonth(v: unknown): { ym: string; full: string | null } | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    const full = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    return { ym: full.slice(0, 7), full };
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월$/);
  if (m) return { ym: `${m[1]}-${m[2].padStart(2, "0")}`, full: null };
  m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) {
    const ym = `${m[1]}-${m[2].padStart(2, "0")}`;
    return { ym, full: `${ym}-${m[3].padStart(2, "0")}` };
  }
  m = s.match(/^(\d{4})[-./](\d{1,2})$/);
  if (m) return { ym: `${m[1]}-${m[2].padStart(2, "0")}`, full: null };
  return null;
}

// 엑셀 업로드: "보호구 지급" 시트(사번 열이 있는 헤더 행)의 차수별 지급월을 작업자 지급이력에
// 반영한다. 사번으로 작업자를 찾고, 빈 칸은 건드리지 않으며(삭제하지 않음) 값이 있는 칸만
// 신규 등록 또는 지급일 갱신한다. 시스템에 없는 사번은 건너뛰고 목록으로 돌려준다.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { cellDates: true });
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx/.xls 파일인지 확인하세요)" },
      { status: 400 }
    );
  }

  // 사번 + 지급 헤더가 있는 시트/행을 찾는다(지급기준 같은 다른 시트는 건너뜀).
  let rows: unknown[][] = [];
  let headerIdx = -1;
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true }) as unknown[][];
    const hi = r.findIndex((row) => row.some((c) => norm(c) === "사번") && row.some((c) => norm(c).includes("지급")));
    if (hi !== -1) {
      rows = r;
      headerIdx = hi;
      break;
    }
  }
  if (headerIdx === -1) {
    return NextResponse.json(
      { error: "\"사번\"과 \"~지급\" 컬럼이 있는 시트를 찾을 수 없습니다." },
      { status: 400 }
    );
  }
  const header = rows[headerIdx].map(norm);
  const iNo = header.indexOf("사번");
  const cols = SLOT_HEADERS.map((s) => ({ ...s, idx: header.indexOf(s.header) })).filter((c) => c.idx !== -1);
  if (cols.length === 0) {
    return NextResponse.json({ error: "차수별 지급 컬럼을 찾을 수 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const items = new Map(
    (db.prepare("SELECT * FROM ppe_items").all() as unknown as PpeItem[]).map((i) => [i.item_code, i])
  );
  const known = new Set(
    (db.prepare("SELECT employee_no FROM workers").all() as { employee_no: string }[]).map((w) => w.employee_no)
  );

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let badValue = 0;
  let workerCount = 0;
  const unknownNos: string[] = [];

  const sel = db.prepare(
    "SELECT issue_date FROM ppe_issuances WHERE employee_no = ? AND item_code = ? AND issue_seq = ?"
  );
  const upd = db.prepare(
    "UPDATE ppe_issuances SET issue_date = ?, next_due_date = ? WHERE employee_no = ? AND item_code = ? AND issue_seq = ?"
  );
  const ins = db.prepare(
    "INSERT INTO ppe_issuances (employee_no, item_code, issue_date, issue_seq, next_due_date, received_yn) VALUES (?, ?, ?, ?, ?, 'Y')"
  );

  db.exec("BEGIN");
  try {
    for (const row of rows.slice(headerIdx + 1)) {
      const no = row[iNo] == null ? "" : String(row[iNo]).trim();
      if (!no) continue;
      if (!known.has(no)) {
        if (!unknownNos.includes(no)) unknownNos.push(no);
        continue;
      }
      let touched = false;
      for (const c of cols) {
        const pm = parseMonth(row[c.idx]);
        if (!pm) {
          if (row[c.idx] != null && row[c.idx] !== "") badValue++;
          continue;
        }
        for (const [code, seq] of c.slots) {
          const item = items.get(code);
          if (!item) continue;
          const cur = sel.get(no, code, seq) as { issue_date: string } | undefined;
          // 같은 달이면 기존 일자 유지(월 단위 값으로 일자를 1일로 덮어쓰지 않음)
          if (cur && cur.issue_date.slice(0, 7) === pm.ym && (pm.full == null || pm.full === cur.issue_date)) {
            unchanged++;
            continue;
          }
          const date = pm.full ?? `${pm.ym}-01`;
          const due = nextDueDateAfterIssuance(item, date);
          if (cur) {
            upd.run(date, due, no, code, seq);
            updated++;
          } else {
            ins.run(no, code, date, seq, due);
            inserted++;
          }
          touched = true;
        }
      }
      if (touched) workerCount++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return NextResponse.json({
    inserted,
    updated,
    unchanged,
    badValue,
    workerCount,
    unknownCount: unknownNos.length,
    unknownNos: unknownNos.slice(0, 20),
  });
}
