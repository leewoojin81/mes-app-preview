import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getMedia, mediaPath } from "@/lib/defect-history";

export const runtime = "nodejs";

// 마킹(PROC-06-02) 불량 사진·동영상 한 개 — GET 보기(동영상은 Range로 끊어 보내 앞뒤로 넘길 수 있게), DELETE 지우기
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new NextResponse("bad request", { status: 400 });
  const m = getMedia(getDb(), id);
  if (!m) return new NextResponse("not found", { status: 404 });
  const file = mediaPath(m.file_name);
  let total: number;
  try {
    total = fs.statSync(file).size;
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": m.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (req.nextUrl.searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(m.orig_name || m.file_name)}`;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start: number, end: number;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    } else {
      start = Math.max(0, total - Number(range[2]));
      end = total - 1;
    }
    if (start > end || start >= total) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, { headers: { ...headers, "Content-Length": String(total) } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const db = getDb();
  const m = getMedia(db, id);
  if (!m) return NextResponse.json({ error: "이미 지워졌습니다." }, { status: 404 });
  db.prepare("DELETE FROM defect_history_media WHERE id = ?").run(id);
  fs.rmSync(mediaPath(m.file_name), { force: true });
  return NextResponse.json({ ok: true });
}
