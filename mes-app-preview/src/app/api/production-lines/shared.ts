import type { DatabaseSync } from "node:sqlite";
import { strOrNull, strVal } from "@/lib/item-fields";

export interface LineBody {
  line_name: string;
  status_name: string | null;
  result_process_code: string | null;
  is_indirect: "Y" | "N";
  use_yn: "Y" | "N";
}

// 라인 추가/수정 공통 입력 검사 — 실적 공정은 BASE-04에 있는 공정이어야 한다
export function readLineBody(db: DatabaseSync, body: Record<string, unknown>): LineBody | { error: string } {
  const lineName = strVal(body.line_name);
  if (!lineName) return { error: "라인명은 필수입니다." };
  const isIndirect = body.is_indirect === "Y" ? "Y" : "N";
  const resultCode = isIndirect === "Y" ? null : strOrNull(body.result_process_code);
  if (resultCode && !db.prepare("SELECT 1 FROM processes WHERE process_code = ?").get(resultCode)) {
    return { error: `없는 공정코드입니다: ${resultCode}` };
  }
  return {
    line_name: lineName,
    status_name: strOrNull(body.status_name),
    result_process_code: resultCode,
    is_indirect: isIndirect,
    use_yn: body.use_yn === "N" ? "N" : "Y",
  };
}
