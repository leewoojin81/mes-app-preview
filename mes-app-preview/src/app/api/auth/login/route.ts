import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, SESSION_TTL_SEC, newSessionPayload, signSession, verifyPassword } from "@/lib/auth";
import { strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

interface UserRow {
  username: string;
  password_hash: string;
  password_salt: string;
  display_name: string | null;
  role: "leader" | "admin";
  use_yn: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const username = strVal(body?.username);
  const password = strVal(body?.password);
  if (!username || !password) {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해 주세요." }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | UserRow
    | undefined;
  if (!user || user.use_yn !== "Y" || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const processCodes = (
    db.prepare("SELECT process_code FROM user_processes WHERE username = ?").all(user.username) as {
      process_code: string;
    }[]
  ).map((r) => r.process_code);

  const payload = newSessionPayload({ ...user, process_codes: processCodes });
  const res = NextResponse.json({
    ok: true,
    username: user.username,
    role: user.role,
    processCodes,
    displayName: payload.n,
  });
  res.cookies.set(COOKIE_NAME, signSession(payload), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
