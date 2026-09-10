import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildItemWhere } from "@/lib/item-filters";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 현재 조회 조건(분류/검색어/품목계정/대·중·소분류)에 해당하는 품목 전체를
// 원본 엑셀 컬럼 그대로 xlsx로 내려준다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const category = params.get("category");
  const { where, args } = buildItemWhere(params);

  const rows = db
    .prepare(
      // 화면 목록과 동일하게 원본 엑셀 순서(파일 순서 → 파일 내 No. 순)
      `SELECT detail FROM items ${where}
       ORDER BY CASE category WHEN '완제품' THEN 0 WHEN '반제품' THEN 1 ELSE 2 END, seq_no, item_code`
    )
    .all(...args) as { detail: string | null }[];

  // 컬럼 헤더: detail 키를 첫 등장 순서대로 합집합 (완제품/반제품 62개, 원자재 38개)
  const header: string[] = [];
  const seen = new Set<string>(header);
  const data = rows.map((r) => {
    const d = r.detail
      ? (JSON.parse(r.detail) as Record<string, string | number | null>)
      : {};
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k);
        header.push(k);
      }
    }
    // No.는 원본 엑셀 값 그대로 유지
    return d;
  });

  const ws = XLSX.utils.json_to_sheet(data, { header });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "품목");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `items_${category && category !== "전체" ? category : "all"}_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
