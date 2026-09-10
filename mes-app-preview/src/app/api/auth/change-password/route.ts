import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, hashPassword, verifyPassword, verifySession } from "@/lib/auth";
import { strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

interface UserRow {
  username: string;
  password_hash: string;
  password_salt: string;
}

// 로그인한 본인이 스스로 비밀번호를 바꾸는 API — /api/auth/*는 proxy.ts에서 항상
// 통과시키므로(로그인 자체가 그래야 하니까), 여기서 세션 검증을 직접 한다.
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const currentPassword = strVal(body?.currentPassword);
  const newPassword = strVal(body?.newPassword);
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "현재 비밀번호와 새 비밀번호를 입력해 주세요." }, { status: 400 });
  }
  if (newPassword.length < 4) {
    return NextResponse.json({ error: "새 비밀번호는 4자 이상이어야 합니다." }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(session.u) as
    | UserRow
    | undefined;
  if (!user || !verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
    return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const { hash, salt } = hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE username = ?").run(
    hash,
    salt,
    session.u
  );

  return NextResponse.json({ ok: true });
}
