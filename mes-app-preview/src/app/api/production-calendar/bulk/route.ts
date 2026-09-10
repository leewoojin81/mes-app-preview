import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { strOrNull } from "@/lib/item-fields";

export const runtime = "nodejs";

function upsert(
  db: DatabaseSync,
  cal_date: string,
  day_type: string,
  work_yn: string,
  note: string | null
) {
  db.prepare(
    `INSERT INTO production_calendar (cal_date, day_type, work_yn, note, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(cal_date) DO UPDATE SET
       day_type=excluded.day_type, work_yn=excluded.work_yn, note=excluded.note,
       updated_at=datetime('now','localtime')`
  ).run(cal_date, day_type, work_yn, note);
}

// 연도 전체의 토/일요일을 휴일로 일괄 등록. 이미 비고가 있는 날짜는 비고를 보존한다.
function applyWeekendOff(db: DatabaseSync, year: number): number {
  let count = 0;
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    const weekday = d.getUTCDay(); // 0=일, 6=토
    if (weekday === 0 || weekday === 6) {
      const dateStr = d.toISOString().slice(0, 10);
      const existing = db
        .prepare("SELECT note FROM production_calendar WHERE cal_date = ?")
        .get(dateStr) as { note: string | null } | undefined;
      upsert(db, dateStr, "휴일", "N", existing?.note ?? "주말");
      count++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

// 공휴일 등 지정 날짜들을 휴일로 일괄 등록. 넘어온 note로 덮어쓴다.
function applyHolidays(db: DatabaseSync, dates: string[], note: string | null): number {
  let count = 0;
  for (const dateStr of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    upsert(db, dateStr, "휴일", "N", note);
    count++;
  }
  return count;
}

// 연도 전체의 평일(월~금) 중 아직 등록되지 않은 날짜만 평일 근무(가동 Y)로 채운다.
// 공휴일 등으로 이미 등록된 날짜는 절대 덮어쓰지 않는다(weekend_off/holidays와의
// 실행 순서와 무관하게 안전).
function applyWeekdayDefault(db: DatabaseSync, year: number): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO production_calendar (cal_date, day_type, work_yn, note, updated_at)
     VALUES (?, '평일', 'Y', NULL, datetime('now','localtime'))`
  );
  let count = 0;
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    const weekday = d.getUTCDay(); // 0=일, 6=토
    if (weekday !== 0 && weekday !== 6) {
      const dateStr = d.toISOString().slice(0, 10);
      const result = insert.run(dateStr);
      if (result.changes > 0) count++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (body.action === "weekend_off") {
    const year = Number(body.year);
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: "year는 필수입니다." }, { status: 400 });
    }
    const count = applyWeekendOff(db, year);
    return NextResponse.json({ ok: true, count });
  }

  if (body.action === "holidays") {
    if (!Array.isArray(body.dates) || body.dates.length === 0) {
      return NextResponse.json({ error: "dates는 필수입니다." }, { status: 400 });
    }
    const dates = body.dates.map((d: unknown) => String(d).trim());
    const count = applyHolidays(db, dates, strOrNull(body.note));
    return NextResponse.json({ ok: true, count });
  }

  if (body.action === "weekday_work") {
    const year = Number(body.year);
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: "year는 필수입니다." }, { status: 400 });
    }
    const count = applyWeekdayDefault(db, year);
    return NextResponse.json({ ok: true, count });
  }

  return NextResponse.json({ error: "알 수 없는 action입니다." }, { status: 400 });
}
