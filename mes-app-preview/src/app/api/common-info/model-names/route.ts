import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { ensureMasterHistoryTriggers, setHistoryActor } from "@/lib/master-history-triggers";
import { deleteModelName, ensureModelNameTables, listModelNames, saveModelName, type ModelNameInput } from "@/lib/model-names";

export const runtime = "nodejs";

// 공통정보(BASE-10) 형명 탭 — 규칙은 lib/model-names.ts
//  GET    /api/common-info/model-names          → 형명 목록(원료로트 짝·사용 품목 수 포함)
//  POST   /api/common-info/model-names { ...형명 } → 등록
//  PUT    /api/common-info/model-names { ...형명 } → 수정(lots를 보내면 원료로트 짝도 맞춘다)
//  DELETE /api/common-info/model-names?name=형명  → 삭제(품목이 쓰는 형명은 거부)
const userOf = (req: NextRequest) => verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : "처리하지 못했습니다." }, { status: 400 });

export async function GET() {
  return NextResponse.json({ rows: listModelNames(getDb()) });
}

async function write(req: NextRequest, create: boolean) {
  const b = (await req.json().catch(() => null)) as ModelNameInput | null;
  if (!b || typeof b.model_name !== "string") return NextResponse.json({ error: "형명이 필요합니다." }, { status: 400 });
  const db = getDb();
  const user = userOf(req);
  try {
    ensureModelNameTables(db); // 트리거보다 먼저 표가 있어야 한다
    ensureMasterHistoryTriggers(db); // 서버를 다시 켜기 전에도 형명 변경이력 트리거가 걸리도록(버전이 같으면 바로 끝남)
    setHistoryActor(db, user);
    saveModelName(db, b, create, user);
    return NextResponse.json({ rows: listModelNames(db) });
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: NextRequest) => write(req, true);
export const PUT = (req: NextRequest) => write(req, false);

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "형명이 필요합니다." }, { status: 400 });
  const db = getDb();
  try {
    ensureModelNameTables(db);
    ensureMasterHistoryTriggers(db);
    setHistoryActor(db, userOf(req));
    deleteModelName(db, name);
    return NextResponse.json({ rows: listModelNames(db) });
  } catch (e) {
    return fail(e);
  }
}
