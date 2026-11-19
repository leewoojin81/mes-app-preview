"use client";
/* eslint-disable @next/next/no-img-element -- 촬영 직후 blob: 미리보기·로그인 필요한 사진 API라 next/image를 쓰지 않는다 */

// 모바일 불량입력(/m/defect) — 공정이동표 QR(작업지시번호) 촬영 → 자동 조회 → 불량유형·수량·사진 입력 → 저장.
// 휴대폰 세로 390px 기준, 주요 버튼은 화면 아래(sticky — fixed는 일부 휴대폰 브라우저에서 스크롤 컨테이너 안에서 사라져 2026-11-20 교체).
// 저장 버튼은 하단 바와 메모 아래 두 곳에 둔다. 루트 레이아웃의 사이드바·탭바는 고정 오버레이로 덮는다
// (기존 공용 파일을 고치지 않기 위해 — src/lib/mobile-defect.ts 머리 주석 참고).
//
// 1단계(http): <input capture>로 사진을 찍어 브라우저에서 판독(jsQR, public/vendor).
// 2단계(https): 실시간 카메라 스캔은 decodeQrFromImage 대신 다른 스캐너를 붙이면 되도록 판독부를 분리해 두었다.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const PROCESSES = ["조립", "분리3", "습윤", "외관검사", "이재기", "실링", "멸균", "입고대기", "중간창고", "마킹", "출하포장"];
const LS_PROC = "m-defect:process";

type Wo = { wo_no: string; item_code: string | null; item_info: string | null; lot_no: string | null; order_qty: number | null; so_no: string | null; status: string | null; source: string };
type DType = { type_code: string; type_name: string; process_name: string | null };
type Entry = { id: number; wo_no: string; process_name: string; defect_type_name: string; qty: number; memo: string | null; photo1: string | null; photo2: string | null; photo3: string | null; input_method: string; created_at: string };
type Photo = { blob: Blob; url: string; kb: number; note: string };
type View = "scan" | "manual" | "input" | "done";

type JsQR = (d: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: string }) => { data: string } | null;

// ── QR 판독(사진 1장) ─────────────────────────────────────────────────────
function loadJsQR(): Promise<JsQR> {
  const w = window as unknown as { jsQR?: JsQR };
  if (w.jsQR) return Promise.resolve(w.jsQR);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/jsqr-1.4.0.js";
    s.onload = () => (w.jsQR ? resolve(w.jsQR) : reject(new Error("jsQR")));
    s.onerror = () => reject(new Error("jsQR"));
    document.head.appendChild(s);
  });
}

function loadImage(file: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

// 전체 → 중앙 70% → 중앙 45% … 순서로 해상도를 바꿔 가며 시도(멀리서 찍어 QR이 작게 나온 경우 대비)
function decodeQrFromImage(jsQR: JsQR, img: HTMLImageElement): string | null {
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return null;
  const plans: [number, number][] = [[1, 1000], [1, 1600], [0.7, 1400], [0.45, 1200], [1, 2400], [0.3, 1000]];
  for (const [f, max] of plans) {
    const sw = W * f, sh = H * f, sx = (W - sw) / 2, sy = (H - sh) / 2;
    const sc = Math.min(1.5, max / Math.max(sw, sh));
    c.width = Math.round(sw * sc);
    c.height = Math.round(sh * sc);
    x.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, c.width, c.height, { inversionAttempts: "attemptBoth" });
    if (r?.data) return r.data;
  }
  return null;
}

// ── 불량 사진: 긴 변 1600px JPG로 변환 ─────────────────────────────────────
async function toJpeg(file: File): Promise<Photo> {
  const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    throw new Error(heic ? "HEIC 사진을 열 수 없습니다. 갤럭시는 카메라 설정에서 '고효율 사진'을 끄고 다시 찍어 주세요." : "사진을 열 수 없습니다. 다시 찍어 주세요.");
  }
  const { img, url } = loaded;
  const W = img.naturalWidth, H = img.naturalHeight, sc = Math.min(1, 1600 / Math.max(W, H));
  const c = document.createElement("canvas");
  c.width = Math.round(W * sc);
  c.height = Math.round(H * sc);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  if (!blob) throw new Error("사진 변환에 실패했습니다. 다시 찍어 주세요.");
  return {
    blob,
    url: URL.createObjectURL(blob),
    kb: Math.round(blob.size / 1024),
    note: `원본 ${Math.round(file.size / 1024)}KB → JPG ${Math.round(blob.size / 1024)}KB (${c.width}×${c.height})`,
  };
}

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 브라우저 */ } };

// ── 화면 ───────────────────────────────────────────────────────────────────
const card = "bg-white rounded-2xl border border-slate-200 p-4 flex flex-col gap-2.5";
const lbl = "text-[13px] text-slate-500 flex justify-between items-center gap-2";
const btn = "min-h-14 w-full rounded-xl font-bold text-lg flex items-center justify-center gap-2 select-none disabled:opacity-45";
const vh = "absolute w-px h-px opacity-0 overflow-hidden pointer-events-none";

export default function MobileDefectPage() {
  const [view, setView] = useState<View>("scan");
  const [userName, setUserName] = useState("");
  const [proc, setProc] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ kind: "info" | "err"; text: string; raw?: string; thumb?: string } | null>(null);
  const [digits, setDigits] = useState("");
  const [wo, setWo] = useState<Wo | null>(null);
  const [method, setMethod] = useState<"QR" | "수동">("QR");
  const [qrRaw, setQrRaw] = useState("");
  const [types, setTypes] = useState<DType[]>([]);
  const [typeCode, setTypeCode] = useState("");
  const [qty, setQty] = useState("1");
  const [memo, setMemo] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoMsg, setPhotoMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [saved, setSaved] = useState<{ wo_no: string; type_name: string; qty: number; photos: number } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const thumbRef = useRef<string | null>(null);

  const loadEntries = useCallback(async () => {
    const r = await fetch("/api/m-defect/entries", { cache: "no-store" });
    if (r.status === 401) { location.href = "/login?redirect=/m/defect"; return; }
    const j = await r.json();
    setEntries(j.entries ?? []);
    setUserName(j.user ?? "");
  }, []);

  // 처음: 로그인 사용자·오늘 내역, 공정 기본값(마지막 선택 → 소속공정)
  useEffect(() => {
    fetch("/api/m-defect/entries", { cache: "no-store" })
      .then((r) => {
        if (r.status === 401) { location.href = "/login?redirect=/m/defect"; return null; }
        return r.json();
      })
      .then((j) => {
        if (!j) return;
        setEntries(j.entries ?? []);
        setUserName(j.user ?? "");
        const last = lsGet(LS_PROC);
        const mine = String(j.processes ?? "").split(",").find((p) => PROCESSES.includes(p));
        setProc(last && PROCESSES.includes(last) ? last : mine ?? "");
      })
      .catch(() => {});
    loadJsQR().catch(() => {});
  }, []);

  // 공정이 바뀌면 그 공정의 불량유형
  useEffect(() => {
    fetch(`/api/m-defect/types?process=${encodeURIComponent(proc)}`).then((r) => r.json()).then((j) => setTypes(j.types ?? []));
  }, [proc]);

  const go = (v: View) => { setView(v); window.scrollTo(0, 0); document.getElementById("md-root")?.scrollTo(0, 0); };

  const resetInput = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]); setTypeCode(""); setQty("1"); setMemo(""); setPhotoMsg(""); setSaveErr("");
  };

  async function lookup(raw: string, m: "QR" | "수동") {
    setBusy(true);
    try {
      const r = await fetch(`/api/m-defect/lookup?q=${encodeURIComponent(raw)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setScanMsg({ kind: "err", text: j.error ?? "조회에 실패했습니다.", raw: m === "QR" ? raw : undefined, thumb: thumbRef.current ?? undefined }); if (m === "수동") go("scan"); return; }
      resetInput(); setWo(j); setMethod(m); setQrRaw(m === "QR" ? raw : ""); setScanMsg(null); go("input");
    } catch {
      setScanMsg({ kind: "err", text: "서버에 연결하지 못했습니다. Wi-Fi를 확인하고 다시 시도하세요." });
    } finally { setBusy(false); }
  }

  async function onQrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
    thumbRef.current = null;
    setScanMsg({ kind: "info", text: "판독 중…" });
    setBusy(true);
    let loaded;
    try { loaded = await loadImage(f); } catch { setBusy(false); setScanMsg({ kind: "err", text: "사진을 열 수 없습니다. 다시 찍어 주세요." }); return; }
    thumbRef.current = loaded.url;
    let raw: string | null = null;
    try { raw = decodeQrFromImage(await loadJsQR(), loaded.img); } catch { raw = null; }
    setBusy(false);
    if (!raw) { setScanMsg({ kind: "err", text: "QR을 읽지 못했습니다. QR에 더 가까이(20~30cm) 다시 찍거나, 번호를 직접 입력하세요.", thumb: loaded.url }); return; }
    await lookup(raw, "QR");
  }

  async function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || photos.length >= 3) return;
    setPhotoMsg("변환 중…");
    try { const p = await toJpeg(f); setPhotos((ps) => [...ps, p]); setPhotoMsg(p.note); }
    catch (err) { setPhotoMsg((err as Error).message); }
  }

  const qtyNum = parseInt(qty, 10) || 0;
  const typeName = types.find((t) => t.type_code === typeCode)?.type_name ?? "";
  const canSave = !!wo && !!proc && !!typeCode && qtyNum >= 1 && !busy;
  const need = !proc ? "공정을 선택하세요" : !typeCode ? "불량 유형을 선택하세요" : qtyNum < 1 ? "수량을 입력하세요" : "";
  const saveLabel = busy ? "저장 중…" : need ? `저장 — ${need}` : `저장 (${typeName} ${qtyNum}개 · 사진 ${photos.length}장)`;

  async function save() {
    if (!canSave || !wo) return;
    setBusy(true); setSaveErr("");
    const fd = new FormData();
    fd.set("wo_no", wo.wo_no); fd.set("process", proc); fd.set("type_code", typeCode); fd.set("qty", String(qtyNum));
    fd.set("memo", memo); fd.set("method", method); fd.set("qr_raw", qrRaw);
    photos.forEach((p, i) => fd.set(`photo${i + 1}`, p.blob, `photo${i + 1}.jpg`));
    try {
      const r = await fetch("/api/m-defect/entries", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setSaveErr(j.error ?? "저장하지 못했습니다."); return; }
      setSaved(j); resetInput(); await loadEntries(); go("done");
    } catch {
      setSaveErr("서버에 연결하지 못해 저장하지 않았습니다. Wi-Fi를 확인하고 다시 [저장]을 누르세요.");
    } finally { setBusy(false); }
  }

  async function cancelEntry(id: number) {
    if (!confirm("이 입력을 취소할까요?")) return;
    const r = await fetch(`/api/m-defect/entries/${id}`, { method: "DELETE" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error ?? "취소하지 못했습니다."); return; }
    await loadEntries();
  }

  const todayQty = entries.reduce((a, e) => a + e.qty, 0);
  const title = view === "manual" ? "작업지시번호 입력" : view === "done" ? "오늘 내 입력 내역" : "불량 입력";

  return (
    <div id="md-root" className="fixed inset-0 z-[200] overflow-y-auto bg-slate-100 text-slate-800" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="max-w-[430px] mx-auto min-h-full flex flex-col">
        <header className="sticky top-0 z-10 bg-navy text-white px-4 py-3 flex justify-between items-center gap-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <div>
            <h1 className="text-lg font-bold leading-tight">{title}</h1>
            <p className="text-[12.5px] opacity-85">{proc || "공정 미선택"} · {userName || "…"}</p>
          </div>
          {view !== "done" ? (
            <button type="button" className="min-h-10 px-3 rounded-lg bg-white/15 text-sm" onClick={() => { setSaved(null); go("done"); }}>오늘 내역 {entries.length}</button>
          ) : (
            <Link href="/" className="min-h-10 px-3 rounded-lg bg-white/15 text-sm flex items-center">PC 화면</Link>
          )}
        </header>

        <main className="flex-1 px-4 pt-3.5 pb-6 flex flex-col gap-3">
          {view === "scan" && (
            <>
              <div className={card}>
                <div className={lbl}>공정 (먼저 확인)</div>
                <div className="flex flex-wrap gap-2">
                  {PROCESSES.map((p) => (
                    <button key={p} type="button" aria-pressed={proc === p} onClick={() => { setProc(p); lsSet(LS_PROC, p); }}
                      className={`min-h-12 px-4 rounded-full border text-[15px] ${proc === p ? "bg-navy border-navy text-white font-bold" : "bg-white border-slate-300"}`}>{p}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2.5">
                공정표 전체를 한 장에 찍으면 판독되지 않습니다. 라벨 QR(작업지시번호)에 <b>20~30cm</b>까지 가까이 대고 찍으세요.
              </div>
              {scanMsg && (
                <div className={card}>
                  <div className="flex gap-3 items-center">
                    {scanMsg.thumb && <img src={scanMsg.thumb} alt="찍은 사진" className="w-20 h-20 object-cover rounded-lg border border-slate-200" />}
                    <div className={`text-sm ${scanMsg.kind === "err" ? "text-red-600" : "text-slate-600"}`}>{scanMsg.text}
                      {scanMsg.raw && <div className="mt-1 font-mono text-xs text-slate-500 break-all">판독값: {scanMsg.raw}</div>}
                    </div>
                  </div>
                </div>
              )}
              <label htmlFor="md-qr-album" className="text-center text-sm text-navy underline min-h-10 leading-10">카메라가 안 열리면: 앨범에서 QR 사진 고르기</label>
            </>
          )}

          {view === "manual" && (
            <div className={card}>
              <div className={lbl}>작업지시번호 (PR 뒤 숫자 12자리)</div>
              <div className="h-14 border border-slate-300 rounded-xl px-3.5 flex items-center text-[22px] font-bold tracking-wide tabular-nums">
                <span className="text-slate-400 mr-1.5">PR</span>{digits.padEnd(12, "_").replace(/(.{4})(.{4})(.{4})/, "$1 $2 $3")}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "조회"].map((k) => (
                  <button key={k} type="button" disabled={k === "조회" && (digits.length !== 12 || busy)}
                    className={`min-h-14 rounded-xl border text-[22px] font-bold disabled:opacity-40 ${k === "조회" ? "bg-navy text-white text-base border-navy" : k === "지움" ? "bg-white text-base border-slate-300" : "bg-white border-slate-300"}`}
                    onClick={() => { if (k === "지움") setDigits((d) => d.slice(0, -1)); else if (k === "조회") lookup("PR" + digits, "수동"); else setDigits((d) => (d.length < 12 ? d + k : d)); }}>{k}</button>
                ))}
              </div>
              <button type="button" className={`${btn} bg-white text-navy border-2 border-navy`} onClick={() => go("scan")}>QR 스캔으로 돌아가기</button>
            </div>
          )}

          {view === "input" && wo && (
            <>
              <div className={card}>
                <div className={lbl}>작업지시 정보 <span className="text-[11.5px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">수정 불가</span></div>
                <dl className="grid grid-cols-[76px_1fr] gap-y-1.5 text-[15px]">
                  {([["작업지시", wo.wo_no], ["품목", wo.item_code], ["품목정보", wo.item_info], ["LOT", wo.lot_no], ["지시수량", wo.order_qty?.toLocaleString()], ["수주번호", wo.so_no]] as [string, string | null | undefined][]).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="font-bold break-all">{v || "-"}</dd></div>
                  ))}
                </dl>
                <p className="text-xs text-slate-400">{method === "QR" ? "QR 판독" : "직접 입력"} · 조회: {wo.source}</p>
              </div>
              <div className={`${card} ${proc ? "" : "!border-red-500 !border-2"}`}>
                <div className={lbl}>공정{!proc && <span className="text-red-600 font-bold">먼저 선택하세요</span>}</div>
                <div className="flex flex-wrap gap-2">
                  {PROCESSES.map((p) => (
                    <button key={p} type="button" aria-pressed={proc === p} onClick={() => { setProc(p); setTypeCode(""); lsSet(LS_PROC, p); }}
                      className={`min-h-12 px-4 rounded-full border text-[15px] ${proc === p ? "bg-navy border-navy text-white font-bold" : "bg-white border-slate-300"}`}>{p}</button>
                  ))}
                </div>
              </div>
              <div className={card}>
                <div className={lbl}>불량 유형 (1개 선택)</div>
                <div className="grid grid-cols-3 gap-2">
                  {types.map((t) => (
                    <button key={t.type_code} type="button" aria-pressed={typeCode === t.type_code} onClick={() => setTypeCode(t.type_code)}
                      className={`min-h-[54px] rounded-xl text-[14.5px] leading-tight flex flex-col items-center justify-center px-1 ${typeCode === t.type_code ? "bg-red-50 border-[2.5px] border-red-500 text-red-600 font-bold" : "bg-white border border-slate-300"}`}>
                      {t.type_name}<span className="text-[11px] opacity-60">{t.type_code}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className={card}>
                <div className={lbl}>불량 수량</div>
                <div className="flex gap-2.5 items-center">
                  <button type="button" aria-label="수량 줄이기" className="w-14 h-14 rounded-xl bg-slate-100 text-navy text-3xl font-bold" onClick={() => setQty(String(Math.max(1, qtyNum - 1)))}>−</button>
                  <input inputMode="numeric" pattern="[0-9]*" aria-label="불량 수량" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    className="flex-1 min-w-0 h-14 border-2 border-navy rounded-xl text-center text-[26px] font-bold bg-white" />
                  <button type="button" aria-label="수량 늘리기" className="w-14 h-14 rounded-xl bg-slate-100 text-navy text-3xl font-bold" onClick={() => setQty(String(qtyNum + 1))}>+</button>
                </div>
              </div>
              <div className={card}>
                <div className={lbl}>불량 사진 (최대 3장 · 긴 변 1600px JPG로 자동 변환)</div>
                <div className="grid grid-cols-3 gap-2.5">
                  {photos.map((p, i) => (
                    <div key={p.url} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200">
                      <img src={p.url} alt={`불량 사진 ${i + 1}`} className="w-full h-full object-cover" />
                      <button type="button" aria-label="사진 삭제" className="absolute right-1 top-1 w-8 h-8 rounded-full bg-black/60 text-white" onClick={() => { URL.revokeObjectURL(p.url); setPhotos((ps) => ps.filter((x) => x !== p)); }}>✕</button>
                      <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[11px] text-center">{p.kb}KB</span>
                    </div>
                  ))}
                  {photos.length < 3 && (
                    <label htmlFor="md-photo" className="aspect-square rounded-xl border-2 border-dashed border-navy text-navy flex flex-col items-center justify-center text-sm bg-white">
                      <b className="text-3xl leading-none">＋</b>촬영
                    </label>
                  )}
                </div>
                {photos.length < 3 && <label htmlFor="md-photo-album" className="text-center text-sm text-navy underline min-h-10 leading-10">앨범에서 사진 고르기</label>}
                {photoMsg && <p className="text-xs text-slate-500">{photoMsg}</p>}
              </div>
              <div className={card}>
                <div className={lbl}>메모 (선택)</div>
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} placeholder="예: 렌즈 접힘, 블리스터 보관"
                  className="min-h-[72px] border border-slate-300 rounded-xl px-3 py-2.5 text-[15px] bg-white" />
              </div>
              {saveErr && <div className="rounded-xl bg-red-50 text-red-600 text-sm px-3 py-2.5">{saveErr}</div>}
              <button type="button" disabled={!canSave} onClick={save} className={`${btn} ${canSave ? "bg-red-600 text-white" : "bg-slate-200 text-red-600 disabled:opacity-100 text-base"}`}>
                {saveLabel}
              </button>
            </>
          )}

          {view === "done" && (
            <>
              {saved && (
                <div className="rounded-xl bg-green-600 text-white p-4 font-bold">
                  ✔ 저장되었습니다
                  <span className="block font-normal text-sm">{saved.wo_no} · {saved.type_name} {saved.qty}개 · 사진 {saved.photos}장</span>
                </div>
              )}
              <div className={card}>
                <div className="flex justify-between text-sm text-slate-500"><span>오늘 내가 입력한 내역</span><span><b className="text-slate-800">{entries.length}</b>건 · 불량 <b className="text-slate-800">{todayQty}</b>개</span></div>
                {entries.length === 0 && <p className="text-sm text-slate-400 py-2">오늘 입력한 내역이 없습니다. 공정표 QR을 스캔해 첫 건을 입력하세요.</p>}
                {entries.map((e) => {
                  const ps = [e.photo1, e.photo2, e.photo3].map((p, i) => (p ? i + 1 : 0)).filter(Boolean);
                  return (
                    <div key={e.id} className="grid grid-cols-[46px_1fr_auto] gap-2 items-center py-2.5 border-b last:border-b-0 border-slate-100 text-sm">
                      <span className="text-slate-500 text-[13px] tabular-nums">{e.created_at.slice(11, 16)}</span>
                      <span className="min-w-0">
                        <b>{e.wo_no}</b><br />{e.process_name} · {e.defect_type_name} {e.qty}{e.input_method === "수동" ? " · 직접입력" : ""}
                        {e.memo && <span className="block text-slate-500 text-[13px] break-all">{e.memo}</span>}
                        {ps.length > 0 && (
                          <span className="flex gap-1.5 mt-1">
                            {ps.map((n) => (
                              <button key={n} type="button" onClick={() => setViewPhoto(`/api/m-defect/photo/${e.id}/${n}`)} className="w-11 h-11 rounded-md overflow-hidden border border-slate-200">
                                <img src={`/api/m-defect/photo/${e.id}/${n}`} alt={`사진 ${n}`} className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </span>
                        )}
                      </span>
                      <button type="button" className="min-h-9 px-2.5 rounded-lg bg-red-50 text-red-600 text-[13px]" onClick={() => cancelEntry(e.id)}>취소</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>

        <div className="sticky bottom-0 z-10 bg-white border-t border-slate-200 px-4 pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]" style={{ paddingBottom: "calc(14px + env(safe-area-inset-bottom))" }}>
          <div className="max-w-[398px] mx-auto flex flex-col gap-2.5">
            {view === "scan" && (
              <>
                <label htmlFor="md-qr" aria-disabled={busy} className={`${btn} min-h-16 text-xl bg-navy text-white ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                  {busy ? "판독·조회 중…" : "📷 공정표 QR 스캔"}
                </label>
                <button type="button" className={`${btn} min-h-12 text-base bg-slate-100 text-navy`} onClick={() => { setDigits(""); go("manual"); }}>⌨ 작업지시번호 직접 입력</button>
              </>
            )}
            {view === "input" && (
              <button type="button" disabled={!canSave} onClick={save} className={`${btn} ${canSave ? "bg-red-600 text-white" : "bg-slate-200 text-red-600 disabled:opacity-100 text-base"}`}>
                {saveLabel}
              </button>
            )}
            {view === "input" && <button type="button" className={`${btn} min-h-12 text-base bg-slate-100 text-navy`} onClick={() => { resetInput(); go("scan"); }}>취소하고 다시 스캔</button>}
            {view === "done" && (
              <button type="button" className={`${btn} bg-navy text-white`} onClick={() => { setSaved(null); setScanMsg(null); go("scan"); }}>📷 다음 공정표 스캔</button>
            )}
          </div>
        </div>
      </div>

      {viewPhoto && (
        <button type="button" className="fixed inset-0 z-20 bg-black/85 flex items-center justify-center p-4" onClick={() => setViewPhoto(null)} aria-label="사진 닫기">
          <img src={viewPhoto} alt="불량 사진" className="max-w-full max-h-full rounded-lg" />
        </button>
      )}

      <input id="md-qr" type="file" accept="image/*" capture="environment" className={vh} tabIndex={-1} onChange={onQrFile} />
      <input id="md-qr-album" type="file" accept="image/*" className={vh} tabIndex={-1} onChange={onQrFile} />
      <input id="md-photo" type="file" accept="image/*" capture="environment" className={vh} tabIndex={-1} onChange={onPhotoFile} />
      <input id="md-photo-album" type="file" accept="image/*" className={vh} tabIndex={-1} onChange={onPhotoFile} />
    </div>
  );
}
