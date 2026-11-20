import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import {
  ensureDefectHistoryTables,
  ensureMediaDir,
  listMedia,
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  mediaPath,
  workRowExists,
} from "@/lib/defect-history";

export const runtime = "nodejs";

// 마킹(PROC-06-02) 불량 사진·동영상
//  GET  ?key=record_key                  → 목록
//  POST ?key=&name=파일이름 (본문 = 파일 그대로, Content-Type = image/* | video/*) → 올리기
//       사진은 화면에서 긴 변 1600px JPEG로 줄여 보낸다. 동영상은 그대로(190MB까지) 디스크에 흘려 쓴다.
const PROCESS = "P400";
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/3gpp": "3gp",
};

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key) return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });
  return NextResponse.json({ media: listMedia(getDb(), key) });
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const name = (req.nextUrl.searchParams.get("name") ?? "").slice(0, 200);
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXT[mime];
  if (!key) return NextResponse.json({ error: "실적 줄이 없습니다." }, { status: 400 });
  if (!ext) return NextResponse.json({ error: `올릴 수 없는 파일 형식입니다(${mime || "알 수 없음"}). 사진(JPG·PNG) 또는 동영상(MP4·MOV·WEBM)만 됩니다.` }, { status: 415 });
  const kind = mime.startsWith("video/") ? "video" : "photo";
  const max = kind === "video" ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) return NextResponse.json({ error: `파일이 너무 큽니다(${Math.round(max / 1048576)}MB 이하).` }, { status: 413 });

  const db = getDb();
  ensureDefectHistoryTables(db);
  if (!workRowExists(db, key, PROCESS)) return NextResponse.json({ error: "일일작업현황에서 이 실적을 찾을 수 없습니다." }, { status: 404 });
  if (!req.body) return NextResponse.json({ error: "파일 내용이 없습니다." }, { status: 400 });

  ensureMediaDir();
  const fileName = `${randomUUID()}.${ext}`;
  const dest = mediaPath(fileName);
  const tmp = dest + ".part";
  let size = 0;
  const out = fs.createWriteStream(tmp);
  try {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error("too-big");
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    if (size === 0) throw new Error("empty");
    fs.renameSync(tmp, dest);
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    const msg = (e as Error).message;
    if (msg === "too-big") return NextResponse.json({ error: `파일이 너무 큽니다(${Math.round(max / 1048576)}MB 이하).` }, { status: 413 });
    if (msg === "empty") return NextResponse.json({ error: "파일 내용이 없습니다." }, { status: 400 });
    return NextResponse.json({ error: "파일을 저장하지 못했습니다." }, { status: 500 });
  }

  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  const r = db
    .prepare("INSERT INTO defect_history_media (record_key, kind, file_name, orig_name, mime, size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(key, kind, fileName, name, mime, size, user);
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) }, { status: 201 });
}
