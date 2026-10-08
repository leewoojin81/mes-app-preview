import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { PpeItem, PpeStatusCell } from "@/lib/types";
import { firstDueDate } from "@/lib/ppe";

export const runtime = "nodejs";

interface WorkerRow {
  employee_no: string;
  worker_name: string;
  process_code: string | null;
  hire_date: string | null;
  use_yn: "Y" | "N";
}

interface LatestIssuanceRow {
  employee_no: string;
  item_code: string;
  last_issue_date: string;
  issue_seq: number;
  next_due_date: string | null;
  received_yn: "Y" | "N";
}

// 인원관리(PSN-03) 지급현황 — 재직 중인 작업자 × 활성 보호구품목 조합마다 다음지급
// 예정일을 계산해 내려준다. 지급이력이 있으면 그 이력의 저장값을 그대로 쓰고, 없으면
// firstDueDate로 가상 예정일(또는 null=미지급)을 그 자리에서 계산한다. 화면에 보여주는
// "소속공정"은 workers.work_group(작업자등록의 "공정")에서 온다(2026-09-04 — 원래
// process_code를 봤는데 BASE-09가 work_group 기반으로 바뀌며 전환, PpeStatusCell 타입의
// process_code 필드명은 그대로 두고 값의 출처만 바뀜).
export async function GET() {
  const db = getDb();
  const items = db
    .prepare("SELECT * FROM ppe_items WHERE use_yn = 'Y' ORDER BY seq")
    .all() as unknown as PpeItem[];
  const workers = db
    .prepare(
      "SELECT employee_no, worker_name, work_group AS process_code, hire_date, use_yn FROM workers WHERE use_yn = 'Y' ORDER BY seq, employee_no"
    )
    .all() as unknown as WorkerRow[];
  const latestRows = db
    .prepare(
      `SELECT i.employee_no, i.item_code, i.issue_date AS last_issue_date, i.issue_seq,
              i.next_due_date, i.received_yn
       FROM ppe_issuances i
       JOIN (
         SELECT employee_no, item_code, MAX(issue_seq) AS max_seq
         FROM ppe_issuances GROUP BY employee_no, item_code
       ) latest ON latest.employee_no = i.employee_no AND latest.item_code = i.item_code
               AND latest.max_seq = i.issue_seq`
    )
    .all() as unknown as LatestIssuanceRow[];
  const latestByKey = new Map(latestRows.map((r) => [`${r.employee_no}|${r.item_code}`, r]));

  const cells: PpeStatusCell[] = [];
  for (const w of workers) {
    for (const item of items) {
      const latest = latestByKey.get(`${w.employee_no}|${item.item_code}`);
      cells.push({
        employee_no: w.employee_no,
        worker_name: w.worker_name,
        process_code: w.process_code,
        use_yn: w.use_yn,
        item_code: item.item_code,
        last_issue_date: latest?.last_issue_date ?? null,
        issue_seq: latest?.issue_seq ?? null,
        next_due_date: latest?.next_due_date ?? firstDueDate(item, w.hire_date),
        received_yn: latest?.received_yn ?? null,
      });
    }
  }

  // 엑셀 "보호구 지급" 시트 형태의 작업자 1행 — 사이즈/입사일/부서/직무/특이사항과 품목×차수별
  // 지급일(issueDates["PPE-01|1"] = 해당 품목 1차 지급일)을 함께 내려준다.
  const profiles = db
    .prepare(
      `SELECT employee_no, hire_date, work_group AS dept, duty,
              COALESCE(uniform_size, vest_size) AS cloth_size,
              COALESCE(shoe_size, safety_shoe_size) AS shoe_size, remark, status
       FROM workers WHERE use_yn = 'Y'`
    )
    .all() as unknown as {
    employee_no: string;
    hire_date: string | null;
    dept: string | null;
    duty: string | null;
    cloth_size: string | null;
    shoe_size: string | null;
    remark: string | null;
    status: string | null;
  }[];
  const issueRows = db
    .prepare("SELECT employee_no, item_code, issue_seq, issue_date FROM ppe_issuances")
    .all() as unknown as { employee_no: string; item_code: string; issue_seq: number; issue_date: string }[];
  const issueDatesByWorker = new Map<string, Record<string, string>>();
  for (const r of issueRows) {
    const m = issueDatesByWorker.get(r.employee_no) ?? {};
    m[`${r.item_code}|${r.issue_seq}`] = r.issue_date;
    issueDatesByWorker.set(r.employee_no, m);
  }
  const profileRows = profiles.map((p) => ({
    ...p,
    issue_dates: issueDatesByWorker.get(p.employee_no) ?? {},
  }));

  return NextResponse.json({ items, cells, profiles: profileRows });
}
