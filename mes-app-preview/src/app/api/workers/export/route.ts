import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { formatBizName } from "@/lib/biz-import";
import * as XLSX from "xlsx";
import type { Worker } from "@/lib/types";

export const runtime = "nodejs";

// 작업자등록(BASE-09) 전체(또는 사용/중단 필터) 목록을 내려준다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const use = req.nextUrl.searchParams.get("use");

  const rows = (
    use === "Y" || use === "N"
      ? db.prepare("SELECT * FROM workers WHERE use_yn = ? ORDER BY seq, employee_no").all(use)
      : db.prepare("SELECT * FROM workers ORDER BY seq, employee_no").all()
  ) as unknown as Worker[];

  const data = rows.map((r) => ({
    사번: r.employee_no,
    // 비즈 연동으로 등록한 경우만 값이 있다(2026-09-08 사용자 요청) — 비즈이름은
    // 별도 저장값이 아니라 성명+도급사에서 매번 복원한 표시용 컬럼이라, 업로드 시엔
    // 다시 읽지 않는다(성명/도급사 컬럼이 그대로 원본 소스).
    비즈사번: r.biz_employee_no,
    비즈부서: r.biz_dept,
    비즈이름: r.biz_employee_no ? formatBizName(r.worker_name, r.contractor) : null,
    ERP코드: r.erp_code,
    사번QR: r.employee_qr,
    성명: r.worker_name,
    도급사: r.contractor,
    공정: r.process_code,
    소속: r.work_group,
    직무: r.duty,
    조: r.team,
    연락처: r.phone,
    입사일자: r.hire_date,
    버스: r.bus_route,
    정류장: r.bus_stop,
    방진복사이즈: r.uniform_size,
    방진화사이즈: r.shoe_size,
    조끼사이즈: r.vest_size,
    안전화사이즈: r.safety_shoe_size,
    상태: r.status,
    퇴사일자: r.resign_date,
    퇴사사유: r.resign_reason,
    특이사항: r.remark,
    사용여부: r.use_yn,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "작업자등록");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `작업자등록_${use === "Y" ? "사용" : use === "N" ? "중단" : "전체"}_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
