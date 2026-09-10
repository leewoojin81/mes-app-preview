import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { ALL_SCREEN_CODES, roleDefaultAllowed, type PermissionOverride } from "@/lib/permissions";
import { NAV_GROUPS } from "@/lib/nav-groups";

export const runtime = "nodejs";

// 사용자계정관리(SYS-01) 개별 화면권한 설정 — 관리자 전용(계정 자체 CRUD와 같은 보호 수준).
function requireAdmin(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session || session.r !== "admin") {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  }
  return null;
}

interface UserRow {
  username: string;
  role: "leader" | "admin";
}

// 화면 목록 + 이 사용자의 현재 허용 여부(role 기본값에 예외 반영된 최종값)를 그룹별로 반환.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { username } = await params;
  const db = getDb();
  const user = db.prepare("SELECT username, role FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
  if (!user) {
    return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }

  const overrides = db
    .prepare("SELECT screen_code, allowed FROM user_permissions WHERE username = ?")
    .all(username) as PermissionOverride[];
  const overrideMap = new Map(overrides.map((o) => [o.screen_code, o.allowed]));

  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    screens: g.children.map((c) => ({
      code: c.code,
      label: c.label,
      allowed: overrideMap.has(c.code)
        ? overrideMap.get(c.code) === "Y"
        : roleDefaultAllowed(user.role, c.code),
      isDefault: !overrideMap.has(c.code),
    })),
  }));

  return NextResponse.json({ role: user.role, groups });
}

// 체크박스 최종 상태(codes = 체크된 화면코드 전체)를 받아, role 기본값과 다른 것만
// 예외로 저장한다 — 기본값과 같은 화면은 굳이 행을 만들지 않는다(예외 테이블을
// "역할 기본값 + 진짜 다른 것만"으로 깔끔하게 유지).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { username } = await params;
  const db = getDb();
  const user = db.prepare("SELECT username, role FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
  if (!user) {
    return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.codes)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const checked = new Set((body.codes as unknown[]).filter((c): c is string => typeof c === "string"));

  const del = db.prepare("DELETE FROM user_permissions WHERE username = ?");
  const insert = db.prepare(
    "INSERT INTO user_permissions (username, screen_code, allowed) VALUES (?, ?, ?)"
  );
  db.exec("BEGIN");
  try {
    del.run(username);
    for (const code of ALL_SCREEN_CODES) {
      const isChecked = checked.has(code);
      if (isChecked !== roleDefaultAllowed(user.role, code)) {
        insert.run(username, code, isChecked ? "Y" : "N");
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return NextResponse.json({ ok: true });
}
