"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QcPhotoMeta, SupplyLot } from "@/lib/qc-incoming-shared";
import { n, shrinkImage } from "./qc-utils";

// 로트 사진 보기/올리기 — 대시보드의 로트 사진 창(openLot)과 같은 기능: 엑셀 사진 + 올린 사진을 넘겨 보고(←/→ 키, 썸네일),
// 메모와 함께 사진을 올리고(여러 장, 긴 변 1600px로 줄임), 올린 사진은 두 번 눌러 삭제한다.
export default function LotPhotoDialog({
  lot,
  onClose,
  onCountChange,
}: {
  lot: SupplyLot;
  onClose: () => void;
  onCountChange: (no: number, count: number) => void;
}) {
  const [photos, setPhotos] = useState<QcPhotoMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [delArmed, setDelArmed] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/qc-incoming/photos?no=${lot.no}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({ photos: [] }));
    const list = (d.photos ?? []) as QcPhotoMeta[];
    setPhotos(list);
    setLoading(false);
    onCountChange(lot.no, list.length);
    setIdx((i) => Math.min(i, Math.max(0, list.length - 1)));
  }, [lot.no, onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIdx((i) => (photos.length ? (i - 1 + photos.length) % photos.length : 0));
      else if (e.key === "ArrowRight") setIdx((i) => (photos.length ? (i + 1) % photos.length : 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, onClose]);

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      setMsg(`사진 올리는 중 (${i + 1}/${list.length})…`);
      try {
        const s = await shrinkImage(list[i]);
        const res = await fetch("/api/qc-incoming/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ no: lot.no, note: note.trim(), image: s.dataUrl, w: s.w, h: s.h }),
        });
        if (res.ok) ok++;
      } catch {
        /* 한 장 실패해도 다음 장 계속 */
      }
    }
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
    setBusy(false);
    setMsg(`${ok}장을 올렸습니다.${ok < list.length ? ` (${list.length - ok}장 실패)` : ""}`);
    await load();
    setIdx(0);
  }

  async function del(p: QcPhotoMeta) {
    if (delArmed !== p.id) {
      setDelArmed(p.id);
      setTimeout(() => setDelArmed((v) => (v === p.id ? null : v)), 3000);
      return;
    }
    const res = await fetch(`/api/qc-incoming/photos/${p.id}`, { method: "DELETE" });
    setDelArmed(null);
    setMsg(res.ok ? "사진을 삭제했습니다." : "삭제하지 못했습니다.");
    await load();
  }

  const cur = photos[idx];
  const fmtT = (t: string) => {
    try {
      return new Date(t).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <b className="text-navy">
            No.{lot.no} · {lot.name}
          </b>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            닫기
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Lot {lot.lot_no}</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{lot.supplier}</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{lot.mat_code}</span>
            {lot.item_code && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">품목 {lot.item_code}</span>}
            {lot.result === "부적합" ? (
              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">부적합 판정</span>
            ) : lot.bad_qty > 0 ? (
              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">부적합 {n(lot.bad_qty)}개</span>
            ) : null}
          </div>

          {loading ? (
            <div className="h-48 flex items-center justify-center text-slate-400 text-sm">불러오는 중...</div>
          ) : photos.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-sm border border-dashed border-slate-300 rounded-lg">
              <b className="text-slate-500">등록된 사진이 없습니다</b>
              <span>아래에서 첫 사진을 올려 보세요.</span>
            </div>
          ) : (
            <>
              <div className="relative bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center" style={{ minHeight: 240 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/qc-incoming/photos/${cur.id}`} alt="" className="max-h-[60vh] object-contain" />
                <span className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full bg-black/60 text-white">
                  {idx + 1} / {photos.length}
                </span>
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="이전 사진"
                      onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white text-xl"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      aria-label="다음 사진"
                      onClick={() => setIdx((i) => (i + 1) % photos.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white text-xl"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>
              {photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((p, j) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setIdx(j)}
                      aria-label={`사진 ${j + 1}`}
                      className={`shrink-0 w-16 h-16 rounded-md overflow-hidden border-2 ${j === idx ? "border-navy" : "border-transparent"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/qc-incoming/photos/${p.id}`} alt="" loading="lazy" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <div className="text-sm text-slate-600 space-y-0.5">
                <div className="flex items-center gap-2">
                  <b>{cur.source === "upload" ? "현장 업로드" : "엑셀 사진"}</b>
                  {cur.ts && <span className="text-slate-400 text-xs">{fmtT(cur.ts)}</span>}
                  {cur.source === "upload" && (
                    <button
                      type="button"
                      onClick={() => del(cur)}
                      className="ml-auto text-xs px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                    >
                      {delArmed === cur.id ? "정말 삭제" : "사진 삭제"}
                    </button>
                  )}
                </div>
                {cur.note && <p>{cur.note}</p>}
                {cur.caption && <p className="text-slate-500">{cur.caption}</p>}
              </div>
            </>
          )}

          <div className="border-t border-slate-200 pt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-48 text-xs text-slate-500">
              메모 (선택)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="예: 측면터짐 3개 확인"
                className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700"
              />
            </label>
            <label className={`px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
              이 로트 사진 촬영·선택
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
            </label>
          </div>
          {msg && <p className="text-xs text-slate-500">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
