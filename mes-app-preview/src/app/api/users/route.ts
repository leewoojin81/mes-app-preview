import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, hashPassword, verifySession } from "@/lib/auth";
import { strOrNull, strVal } from "@/lib/item-fields";
import { parseOrgFields } from "@/lib/org";

export const runtime = "nodejs";

// 사용자계정관리(SYS-01)는 관리자 전용 — proxy.ts가 "조장"의 /api/users 접근은 이미
// 403으로 막지만, 라우트 자체도 role을 다시 확인한다(방어적 이중 체크).
function requireAdmin(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session || session.r !== "admin") {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.username, u.display_name, u.role, u.use_yn, u.team, u.employment_type, u.position,
              u.created_at,
              (SELECT COUNT(*) FROM user_permissions p WHERE p.username = u.username) AS override_count
       FROM users u ORDER BY u.created_at`
    )
    .all() as { username: string }[];
  const procRows = db.prepare("SELECT username, process_code FROM user_processes").all() as {
    username: string;
    process_code: string;
  }[];
  const procsByUser = new Map<string, string[]>();
  for (const r of procRows) {
    if (!procsByUser.has(r.username)) procsByUser.set(r.username, []);
    procsByUser.get(r.username)!.push(r.process_code);
  }
  return NextResponse.json(
    rows.map((r) => ({ ...r, process_codes: procsByUser.get(r.username) ?? [] }))
  );
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const username = strVal(body.username);
  const password = strVal(body.password);
  if (!username) {
    return NextResponse.json({ error: "계정명은 필수입니다." }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "비밀번호는 필수입니다." }, { status: 400 });
  }
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
    return NextResponse.json({ error: `이미 존재하는 계정명입니다: ${username}` }, { status: 409 });
  }

  const role = body.role === "admin" ? "admin" : "leader";
  const displayName = strOrNull(body.display_name);
  const processCodes: string[] = Array.isArray(body.process_codes)
    ? Array.from(
        new Set(body.process_codes.filter((c: unknown): c is string => typeof c === "string" && c.length > 0))
      )
    : [];
  const useYn = body.use_yn === "N" ? "N" : "Y";
  const org = parseOrgFields(body);
  if ("error" in org) {
    return NextResponse.json({ error: org.error }, { status: 400 });
  }
  const { hash, salt } = hashPassword(password);

  db.prepare(
    `INSERT INTO users (username, password_hash, password_salt, display_name, role, use_yn, team, employment_type, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(username, hash, salt, displayName, role, useYn, org.team, org.employment_type, org.position);
  const insertProc = db.prepare(
    "INSERT INTO user_processes (username, process_code) VALUES (?, ?)"
  );
  for (const code of processCodes) insertProc.run(username, code);

  return NextResponse.json({ ok: true, username }, { status: 201 });
}
