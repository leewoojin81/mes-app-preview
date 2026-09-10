import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";
import type { Process } from "@/lib/types";

export const runtime = "nodejs";

// 공정등록(BASE-04) 전체(또는 사용/중단 필터) 목록을 원본 엑셀과 동일한 컬럼 구성으로 내려준다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const use = req.nextUrl.searchParams.get("use");

  const rows = (
    use === "Y" || use === "N"
      ? db.prepare("SELECT * FROM processes WHERE use_yn = ? ORDER BY seq, process_code").all(use)
      : db.prepare("SELECT * FROM processes ORDER BY seq, process_code").all()
  ) as unknown as Process[];

  const data = rows.map((r) => ({
    공정코드: r.process_code,
    공정명: r.process_name,
    순서: r.seq,
    조달구분: r.procure_type,
    생산성구분: r.productivity_type,
    공정그룹: r.process_group,
    공정그룹2: r.process_group2,
    단공정: r.single_process,
    사용여부: r.use_yn,
    "기본 일CAPA": r.default_daily_capa,
    "기본 생산수율": r.default_yield_rate,
    "기본 Lot Size": r.default_lot_size,
    "1조 사용여부": r.shift1_active_yn,
    "1조 시작시각": r.shift1_start,
    "1조 종료시각": r.shift1_end,
    "1조 기본작업시간(분)": r.shift1_base_minutes,
    "2조 사용여부": r.shift2_active_yn,
    "2조 시작시각": r.shift2_start,
    "2조 종료시각": r.shift2_end,
    "2조 기본작업시간(분)": r.shift2_base_minutes,
    "근무패턴 적용여부": r.apply_work_pattern_yn,
    등록일자: r.reg_date,
    등록자: r.reg_by,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "공정등록");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `공정등록_${use === "Y" ? "사용" : use === "N" ? "중단" : "전체"}_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
