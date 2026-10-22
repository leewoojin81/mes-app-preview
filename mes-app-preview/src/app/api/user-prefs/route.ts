import { NextRequest, NextResponse } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

export const runtime = "nodejs";

// 사용자별 화면 설정(열 순서·숨김 등) 저장소 — 로그인한 계정 기준으로 키(pref_key)마다 JSON 하나를 저장한다.
// 서버에 저장하므로 PC·브라우저를 바꿔도 같은 화면 구성이 나온다. 화면코드에 매핑되지 않는 API라
// 로그인만 하면 쓸 수 있고(permissions.ts), 자기 계정 값만 읽고 쓴다.
function ensureTable(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS user_ui_prefs (
       username TEXT NOT NULL,
       pref_key TEXT NOT NULL,
       value TEXT NOT NULL,
       updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
       PRIMARY KEY (username, pref_key)
     )`
  );
}

const KEY_RE = /^[a-z0-9-]{1,64}$/;
const MAX_VALUE_LEN = 20000;

export async function GET(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "key가 올바르지 않습니다." }, { status: 400 });

  const db = getDb();
  ensureTable(db);
  const row = db.prepare("SELECT value FROM user_ui_prefs WHERE username = ? AND pref_key = ?").get(session.u, key) as
    | { value: string }
    | undefined;
  let value: unknown = null;
  if (row) {
    try {
      value = JSON.parse(row.value);
    } catch {
      value = null;
    }
  }
  return NextResponse.json({ value });
}

export async function PUT(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : "";
  if (!KEY_RE.test(key) || body?.value === undefined) {
    return NextResponse.json({ error: "key와 value가 필요합니다." }, { status: 400 });
  }
  const text = JSON.stringify(body.value);
  if (text.length > MAX_VALUE_LEN) return NextResponse.json({ error: "값이 너무 큽니다." }, { status: 413 });

  const db = getDb();
  ensureTable(db);
  db.prepare(
    `INSERT INTO user_ui_prefs (username, pref_key, value, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(username, pref_key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')`
  ).run(session.u, key, text);
  return NextResponse.json({ ok: true });
}

// 저장한 구성을 지우고 기본 화면으로 되돌린다.
export async function DELETE(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "key가 올바르지 않습니다." }, { status: 400 });
  const db = getDb();
  ensureTable(db);
  db.prepare("DELETE FROM user_ui_prefs WHERE username = ? AND pref_key = ?").run(session.u, key);
  return NextResponse.json({ ok: true });
}
