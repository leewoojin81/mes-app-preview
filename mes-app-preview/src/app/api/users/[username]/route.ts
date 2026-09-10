import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, hashPassword, verifySession, type SessionPayload } from "@/lib/auth";
import { strOrNull, strVal } from "@/lib/item-fields";
import { parseOrgFields } from "@/lib/org";

export const runtime = "nodejs";

function requireAdmin(req: NextRequest): { session: SessionPayload | null; denied: NextResponse | null } {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session || session.r !== "admin") {
    return {
      session: null,
      denied: NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 }),
    };
  }
  return { session, denied: null };
}

interface UserRow {
  username: string;
  role: "leader" | "admin";
  use_yn: string;
}

// 활성 관리자 계정이 0명이 되는 변경(마지막 관리자를 조장으로 강등/중단/삭제)은 막는다 —
// 로그인할 방법이 전부 사라지는 잠금을 방지.
function wouldRemoveLastAdmin(db: ReturnType<typeof getDb>, excludeUsername: string): boolean {
  const otherActiveAdmins = db
    .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND use_yn = 'Y' AND username != ?")
    .get(excludeUsername) as { c: number };
  return otherActiveAdmins.c === 0;
}

// 계정 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { denied } = requireAdmin(req);
  if (denied) return denied;
  const { username } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const role = body.role === "admin" ? "admin" : "leader";
  const useYn = body.use_yn === "N" ? "N" : "Y";
  const displayName = strOrNull(body.display_name);
  const processCodes: string[] = Array.isArray(body.process_codes)
    ? Array.from(
        new Set(body.process_codes.filter((c: unknown): c is string => typeof c === "string" && c.length > 0))
      )
    : [];
  const org = parseOrgFields(body);
  if ("error" in org) {
    return NextResponse.json({ error: org.error }, { status: 400 });
  }

  if (existing.role === "admin" && (role !== "admin" || useYn !== "Y") && wouldRemoveLastAdmin(db, username)) {
    return NextResponse.json(
      { error: "마지막 관리자 계정은 권한을 낮추거나 중단할 수 없습니다." },
      { status: 409 }
    );
  }

  const password = strVal(body.password);
  if (password) {
    const { hash, salt } = hashPassword(password);
    db.prepare(
      `UPDATE users SET password_hash=?, password_salt=?, display_name=?, role=?, use_yn=?,
              team=?, employment_type=?, position=?
       WHERE username=?`
    ).run(hash, salt, displayName, role, useYn, org.team, org.employment_type, org.position, username);
  } else {
    db.prepare(
      `UPDATE users SET display_name=?, role=?, use_yn=?, team=?, employment_type=?, position=?
       WHERE username=?`
    ).run(displayName, role, useYn, org.team, org.employment_type, org.position, username);
  }
  db.prepare("DELETE FROM user_processes WHERE username = ?").run(username);
  const insertProc = db.prepare(
    "INSERT INTO user_processes (username, process_code) VALUES (?, ?)"
  );
  for (const code of processCodes) insertProc.run(username, code);

  return NextResponse.json({ ok: true });
}

// 계정 삭제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { session, denied } = requireAdmin(req);
  if (denied) return denied;
  const { username } = await params;

  if (session!.u === username) {
    return NextResponse.json({ error: "로그인 중인 자기 자신의 계정은 삭제할 수 없습니다." }, { status: 409 });
  }

  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }
  if (existing.role === "admin" && wouldRemoveLastAdmin(db, username)) {
    return NextResponse.json({ error: "마지막 관리자 계정은 삭제할 수 없습니다." }, { status: 409 });
  }

  db.prepare("DELETE FROM users WHERE username = ?").run(username);
  return NextResponse.json({ ok: true });
}
