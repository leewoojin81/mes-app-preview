import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 라벨일정 작업자 선택지 — 작업자정보(BASE-09)에서 직무가 "라벨"이고 사용 중인 작업자.
// /api/workers는 BASE-09 화면 권한으로 막혀 있어 PROC-06 권한으로 쓰는 별도 조회를 둔다.
export async function GET() {
  const workers = getDb()
    .prepare(
      `SELECT employee_no, worker_name, team FROM workers
        WHERE TRIM(COALESCE(duty, '')) = '라벨' AND use_yn = 'Y'
        ORDER BY COALESCE(seq, 999999), worker_name`
    )
    .all() as { employee_no: string; worker_name: string; team: string | null }[];
  return NextResponse.json({ workers });
}
