"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { DefectMedia, DefectRow } from "@/lib/defect-history";

// 마킹(PROC-06-02) 불량이력관리 탭 — 작업이력은 일일작업현황(PROD-10) 마킹(P400) 실적을 그대로 읽고,
// 줄을 누르면 불량 내용·사진·동영상을 넣는 창이 열린다(2026-11-17). 기록은 실적 줄 키(record_key)에 붙어
// 일일작업현황을 다시 올려도 남는다. 스타일은 중간창고(PROC-06-01)와 같게.

const API = "/api/proc/marking-defects";

const CSS = `
.dh{--navy:#002060;--accent:#2457d6;--bg:#f3f5f9;--surface:#fff;--surface-2:#f7f9fc;--line:#dfe4ee;--line-2:#eef1f6;--fg:#16203a;--fg-2:#4a5672;--fg-3:#7c88a3;--red:#c62f2f;--red-bg:#fdecec;--green:#1d7a46;--green-bg:#e6f5ec;--blue-bg:#e9efff;--amber:#a86400;--amber-bg:#fff4e0;
 font-size:14px;line-height:1.45;color:var(--fg);background:var(--bg);display:flex;flex-direction:column;gap:14px;padding:16px 16px 40px;min-height:100%}
.dh *{box-sizing:border-box}
.dh .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.dh .kpi{--tone:#2f6df0;--tone-bg:#eef3ff;position:relative;overflow:hidden;background:linear-gradient(180deg,var(--tone-bg) 0,var(--surface) 46px);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center}
.dh .kpi::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--tone)}
.dh .kpi.k-red{--tone:#d64545;--tone-bg:#fdeeee}.dh .kpi.k-green{--tone:#1f9d62;--tone-bg:#eaf7f0}.dh .kpi.k-indigo{--tone:#5b5bd6;--tone-bg:#f1f0ff}
.dh .kpi .l{font-size:12px;font-weight:600;color:var(--fg-2)}
.dh .kpi .v{font-size:24px;font-weight:700;line-height:1.2}
.dh .kpi .v .u{font-size:13px;font-weight:600;color:var(--fg-3);margin-left:2px}
.dh .tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dh .tools input,.dh .tools select{font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--line);border-radius:5px;background:var(--surface);color:var(--fg);min-width:0}
.dh .tools input[type="search"]{width:240px;max-width:100%}
.dh .rng{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--fg-2)}
.dh .chip{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--surface);color:var(--fg-2);border-radius:999px;padding:5px 11px;cursor:pointer}
.dh .chip[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:#fff}
.dh .cnt{font-size:12px;color:var(--fg-3);margin-left:auto}
.dh .tbl-wrap{background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow:auto;max-height:calc(100vh - 330px)}
.dh table{border-collapse:collapse;width:100%;font-size:13px}
.dh th{position:sticky;top:0;z-index:2;background:var(--surface-2);color:var(--fg-2);font-weight:600;font-size:12px;text-align:center;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.dh td{padding:6px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap}
.dh td.r{text-align:right;font-variant-numeric:tabular-nums}.dh td.c{text-align:center}
.dh td.name{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.dh td.memo{max-width:320px;overflow:hidden;text-overflow:ellipsis;color:var(--fg-2)}
.dh tbody tr{cursor:pointer}
.dh tbody tr:hover td{background:#dce7ff}
.dh .bad{color:var(--red);font-weight:600}.dh .zero{color:var(--fg-3)}
.dh .pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:3px}
.dh .p-blu{background:var(--blue-bg);color:var(--accent)}.dh .p-grn{background:var(--green-bg);color:var(--green)}.dh .p-gry{background:var(--line-2);color:var(--fg-3)}
.dh .empty{padding:28px;text-align:center;color:var(--fg-3)}
.dh .more{padding:8px 12px;font-size:12px;color:var(--amber);background:var(--amber-bg);border-top:1px solid var(--line)}
.dhm{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px}
.dhm .box{background:#fff;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.25);width:100%;max-width:1000px;max-height:92vh;display:flex;flex-direction:column;font-size:13.5px;color:#16203a}
.dhm .hd{padding:12px 18px;border-bottom:1px solid #dfe4ee;display:flex;align-items:center;gap:10px}
.dhm .hd h3{margin:0;font-size:16px;font-weight:700;color:#002060}
.dhm .x{margin-left:auto;border:0;background:none;font-size:22px;line-height:1;color:#7c88a3;cursor:pointer}
.dhm .bd{overflow:auto;padding:14px 18px;display:flex;flex-direction:column;gap:14px}
.dhm .info{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 16px;background:#f7f9fc;border:1px solid #eef1f6;border-radius:6px;padding:10px 12px}
.dhm .info div{display:flex;gap:6px;min-width:0}
.dhm .info span{color:#7c88a3;font-size:12px;flex:none;width:58px}
.dhm .info b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dhm .sec{font-size:13px;font-weight:700;color:#4a5672;display:flex;align-items:center;gap:8px}
.dhm textarea{font:inherit;width:100%;min-height:110px;border:1px solid #dfe4ee;border-radius:6px;padding:8px 10px;resize:vertical}
.dhm .btn{font:inherit;font-size:13px;border:1px solid #dfe4ee;background:#fff;color:#16203a;border-radius:6px;padding:6px 12px;cursor:pointer}
.dhm .btn.pri{background:#2457d6;border-color:#2457d6;color:#fff}
.dhm .btn:disabled{opacity:.5;cursor:default}
.dhm .btn.danger{color:#c62f2f;border-color:#f3c2c2}
.dhm .btn.armed{background:#c62f2f;border-color:#c62f2f;color:#fff}
.dhm .msg{font-size:12.5px;color:#7c88a3}.dhm .msg.err{color:#c62f2f}
.dhm .viewer{background:#111;border-radius:8px;display:flex;align-items:center;justify-content:center;min-height:240px;max-height:52vh;overflow:hidden}
.dhm .viewer img,.dhm .viewer video{max-width:100%;max-height:52vh;display:block}
.dhm .thumbs{display:flex;gap:8px;flex-wrap:wrap}
.dhm .th{position:relative;width:92px;height:70px;border:2px solid #dfe4ee;border-radius:6px;overflow:hidden;cursor:pointer;background:#222;padding:0}
.dhm .th[aria-current="true"]{border-color:#2457d6}
.dhm .th img{width:100%;height:100%;object-fit:cover}
.dhm .th .vid{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;background:linear-gradient(135deg,#334,#112)}
.dhm .th .vid::before{content:"▶";font-size:18px;margin-right:4px}
.dhm .prog{height:6px;background:#eef1f6;border-radius:999px;overflow:hidden;flex:1;max-width:240px}
.dhm .prog i{display:block;height:100%;background:#2457d6}
`;

const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("ko-KR");
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

type ListResult = { from: string; to: string; latest: string | null; rows: DefectRow[]; truncated: boolean };

export default function DefectHistoryTab() {
  const [from, setFrom] = useTabState<string>("procMarkingDefFrom", () => daysAgo(6));
  const [to, setTo] = useTabState<string>("procMarkingDefTo", today);
  const [all, setAll] = useTabState<boolean>("procMarkingDefAll", false);
  const [line, setLine] = useTabState<string>("procMarkingDefLine", "");
  const [q, setQ] = useTabState<string>("procMarkingDefQ", "");
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<DefectRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`${API}?from=${from}&to=${to}${all ? "&all=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `오류 ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to, all]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음·조건 바뀔 때 목록 불러오기
    load();
  }, [load]);

  const lines = useMemo(() => Array.from(new Set((data?.rows ?? []).map((r) => r.line).filter(Boolean))).sort(), [data]);

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (data?.rows ?? []).filter((r) => {
      if (line && r.line !== line) return false;
      if (!words.length) return true;
      const hay = [r.item, r.itemName, r.model, r.wo, r.lot, r.so, r.worker, r.line, r.content].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [data, line, q]);

  const sum = useMemo(() => {
    let good = 0,
      bad = 0,
      rec = 0;
    for (const r of rows) {
      good += r.good;
      bad += r.bad;
      if (r.content || r.photos || r.videos) rec++;
    }
    return { good, bad, rec, rate: good + bad > 0 ? (bad / (good + bad)) * 100 : 0 };
  }, [rows]);

  // 창에서 저장·올리기하면 목록의 그 줄만 바꾼다(전체 다시 읽기 없이)
  const patchRow = useCallback((key: string, patch: Partial<DefectRow>) => {
    setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : d));
    setOpen((o) => (o && o.key === key ? { ...o, ...patch } : o));
  }, []);

  return (
    <div className="dh">
      <style>{CSS}</style>
      <div className="kpis">
        <div className="kpi">
          <span className="l">실적 줄</span>
          <span className="v">
            {fmt(rows.length)}
            <i className="u">건</i>
          </span>
        </div>
        <div className="kpi k-red">
          <span className="l">불량수량</span>
          <span className="v">
            {fmt(sum.bad)}
            <i className="u">개</i>
          </span>
        </div>
        <div className="kpi k-red">
          <span className="l">불량률(불량÷생산)</span>
          <span className="v">
            {sum.rate.toFixed(2)}
            <i className="u">%</i>
          </span>
        </div>
        <div className="kpi k-green">
          <span className="l">기록 있는 줄(내용·사진·동영상)</span>
          <span className="v">
            {fmt(sum.rec)}
            <i className="u">건</i>
          </span>
        </div>
      </div>

      <div className="tools">
        <span className="rng">
          작업일자 <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /> ~
          <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </span>
        <button type="button" className="chip" aria-pressed={!all} onClick={() => setAll(false)} title="불량수량이 있거나 기록을 넣은 줄만">
          불량 있는 줄
        </button>
        <button type="button" className="chip" aria-pressed={all} onClick={() => setAll(true)}>
          전체 실적
        </button>
        <select value={line} onChange={(e) => setLine(e.target.value)}>
          <option value="">라인 전체</option>
          {lines.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <input type="search" placeholder="품목코드·형명·LOT·작지·작업자·내용" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="cnt">
          {loading ? "불러오는 중…" : `일일작업현황 마킹(P400) · 최근 자료 ${data?.latest ?? "-"}`}
        </span>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              {["작업일자", "구분", "라인", "작업자", "품목코드", "품목정보", "형명", "작지번호", "LOT No", "양품", "불량", "불량률", "사진", "동영상", "불량 내용"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rate = r.good + r.bad > 0 ? (r.bad / (r.good + r.bad)) * 100 : 0;
              return (
                <tr key={r.key} onClick={() => setOpen(r)} title="누르면 불량 내용·사진·동영상 창이 열립니다">
                  <td className="c">{r.date}</td>
                  <td className="c">{r.shift}</td>
                  <td>{r.line}</td>
                  <td>{r.worker}</td>
                  <td>{r.item}</td>
                  <td className="name" title={r.itemName}>
                    {r.itemName}
                  </td>
                  <td>{r.model}</td>
                  <td>{r.wo}</td>
                  <td>{r.lot}</td>
                  <td className="r">{fmt(r.good)}</td>
                  <td className={`r ${r.bad > 0 ? "bad" : "zero"}`}>{fmt(r.bad)}</td>
                  <td className={`r ${r.bad > 0 ? "" : "zero"}`}>{rate.toFixed(1)}%</td>
                  <td className="c">{r.photos > 0 ? <span className="pill p-blu">{r.photos}</span> : <span className="zero">-</span>}</td>
                  <td className="c">{r.videos > 0 ? <span className="pill p-grn">{r.videos}</span> : <span className="zero">-</span>}</td>
                  <td className="memo" title={r.content}>
                    {r.content || <span className="pill p-gry">입력</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !err && rows.length === 0 && <div className="empty">해당 기간에 {all ? "마킹 실적이" : "불량이 있는 마킹 실적이"} 없습니다.</div>}
        {err && <div className="empty" style={{ color: "#c62f2f" }}>불러오지 못했습니다: {err}</div>}
        {data?.truncated && <div className="more">줄이 많아 앞 5,000줄만 보입니다. 기간을 줄여 주세요.</div>}
      </div>

      {open && <DefectDialog row={open} onClose={() => setOpen(null)} onPatch={patchRow} />}
    </div>
  );
}

/** 사진을 긴 변 1600px JPEG로 줄인다(QC-03 로트 사진과 같은 방식) */
function shrinkImage(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const draw = (src: CanvasImageSource, w: number, h: number) => {
      const s = Math.min(1, maxSide / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * s));
      c.height = Math.max(1, Math.round(h * s));
      c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("사진 변환 실패"))), "image/jpeg", quality);
    };
    const fallback = () => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        draw(im, im.naturalWidth, im.naturalHeight);
        URL.revokeObjectURL(url);
      };
      im.onerror = () => reject(new Error(`읽을 수 없는 사진입니다(${file.name})`));
      im.src = url;
    };
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file, { imageOrientation: "from-image" }).then((bm) => draw(bm, bm.width, bm.height), fallback);
    } else fallback();
  });
}

/** 진행률을 보이려고 fetch 대신 XHR로 올린다 */
function uploadRaw(url: string, body: Blob, type: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("Content-Type", type);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) resolve();
      else {
        let m = `오류 ${x.status}`;
        try {
          m = JSON.parse(x.responseText).error ?? m;
        } catch {}
        reject(new Error(m));
      }
    };
    x.onerror = () => reject(new Error("네트워크 오류로 올리지 못했습니다."));
    x.send(body);
  });
}

function DefectDialog({ row, onClose, onPatch }: { row: DefectRow; onClose: () => void; onPatch: (key: string, p: Partial<DefectRow>) => void }) {
  const [content, setContent] = useState(row.content);
  const [saved, setSaved] = useState(row.content);
  const [media, setMedia] = useState<DefectMedia[]>([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; p: number } | null>(null);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const [delArmed, setDelArmed] = useState<number | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const dirty = content !== saved;

  const loadMedia = useCallback(async () => {
    const res = await fetch(`${API}/media?key=${encodeURIComponent(row.key)}`, { cache: "no-store" });
    const d = await res.json().catch(() => ({ media: [] }));
    const list = (d.media ?? []) as DefectMedia[];
    setMedia(list);
    setIdx((i) => Math.min(i, Math.max(0, list.length - 1)));
    onPatch(row.key, { photos: list.filter((m) => m.kind === "photo").length, videos: list.filter((m) => m.kind === "video").length });
    return list;
  }, [row.key, onPatch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 창 열 때 사진·동영상 목록 불러오기
    loadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.key]);

  const tryClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm("저장하지 않은 불량 내용이 있습니다. 닫을까요?")) return;
    onClose();
  }, [busy, dirty, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape") tryClose();
      else if (tag === "TEXTAREA" || tag === "VIDEO") return;
      else if (e.key === "ArrowLeft") setIdx((i) => (media.length ? (i - 1 + media.length) % media.length : 0));
      else if (e.key === "ArrowRight") setIdx((i) => (media.length ? (i + 1) % media.length : 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media.length, tryClose]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: row.key, content }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `오류 ${res.status}`);
      setSaved(content);
      onPatch(row.key, { content: content.trim() });
      setMsg({ t: "저장했습니다." });
    } catch (e) {
      setMsg({ t: `저장하지 못했습니다: ${(e as Error).message}`, err: true });
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null, kind: "photo" | "video") {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg(null);
    const list = Array.from(files);
    let ok = 0;
    const fails: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const label = `${kind === "photo" ? "사진" : "동영상"} ${i + 1}/${list.length} 올리는 중`;
      setProgress({ label, p: 0 });
      try {
        let body: Blob = f;
        let type = f.type || "application/octet-stream";
        if (kind === "photo") {
          body = await shrinkImage(f);
          type = "image/jpeg";
        } else if (!type.startsWith("video/")) {
          throw new Error("동영상 파일이 아닙니다");
        }
        await uploadRaw(`${API}/media?key=${encodeURIComponent(row.key)}&name=${encodeURIComponent(f.name)}`, body, type, (p) => setProgress({ label, p }));
        ok++;
      } catch (e) {
        fails.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setProgress(null);
    const after = await loadMedia();
    if (ok) setIdx(Math.max(0, after.length - 1));
    setMsg(fails.length ? { t: `${ok}개 올림, ${fails.length}개 실패 — ${fails.join(" / ")}`, err: true } : { t: `${ok}개 올렸습니다.` });
    setBusy(false);
  }

  async function remove(id: number) {
    if (delArmed !== id) {
      setDelArmed(id);
      return;
    }
    setBusy(true);
    const res = await fetch(`${API}/media/${id}`, { method: "DELETE" });
    setDelArmed(null);
    if (!res.ok) setMsg({ t: (await res.json().catch(() => null))?.error ?? "지우지 못했습니다.", err: true });
    await loadMedia();
    setBusy(false);
  }

  const cur = media[idx];
  const rate = row.good + row.bad > 0 ? ((row.bad / (row.good + row.bad)) * 100).toFixed(1) : "0.0";

  return (
    <div className="dhm" onMouseDown={(e) => e.target === e.currentTarget && tryClose()}>
      <div className="box">
        <div className="hd">
          <h3>마킹 불량이력</h3>
          <span style={{ fontSize: 12.5, color: "#7c88a3" }}>
            {row.date} {row.shift} · {row.line} · {row.lot}
          </span>
          <button type="button" className="x" onClick={tryClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="bd">
          <div className="info">
            <div><span>작업일자</span><b>{row.date} {row.shift}</b></div>
            <div><span>라인</span><b>{row.line}</b></div>
            <div><span>작업자</span><b>{row.worker || "-"}</b></div>
            <div><span>품목코드</span><b>{row.item}</b></div>
            <div style={{ gridColumn: "span 2" }}><span>품목정보</span><b title={row.itemName}>{row.itemName}</b></div>
            <div><span>형명</span><b>{row.model || "-"}</b></div>
            <div><span>작지번호</span><b>{row.wo}</b></div>
            <div><span>LOT No</span><b>{row.lot}</b></div>
            <div><span>수주번호</span><b>{row.so || "-"}</b></div>
            <div><span>양품/불량</span><b>{fmt(row.good)} / <em style={{ color: "#c62f2f", fontStyle: "normal" }}>{fmt(row.bad)}</em> ({rate}%)</b></div>
            <div><span>등록시각</span><b>{row.regAt || "-"}</b></div>
          </div>

          <div>
            <div className="sec" style={{ marginBottom: 6 }}>
              불량 내용
              {row.updatedAt && !dirty && (
                <span className="msg" style={{ fontWeight: 400 }}>
                  마지막 저장 {row.updatedAt}
                  {row.updatedBy ? ` · ${row.updatedBy}` : ""}
                </span>
              )}
            </div>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="불량 현상, 원인, 조치 내용 등을 적어 주세요." maxLength={4000} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <button type="button" className="btn pri" onClick={save} disabled={busy || !dirty}>
                저장
              </button>
              {dirty && <span className="msg">저장하지 않은 내용이 있습니다.</span>}
            </div>
          </div>

          <div>
            <div className="sec" style={{ marginBottom: 8 }}>
              사진·동영상 <span className="msg" style={{ fontWeight: 400 }}>사진 {media.filter((m) => m.kind === "photo").length} · 동영상 {media.filter((m) => m.kind === "video").length}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button type="button" className="btn" disabled={busy} onClick={() => photoRef.current?.click()}>
                  사진 올리기
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => videoRef.current?.click()}>
                  동영상 올리기
                </button>
              </span>
              <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files, "photo"); e.target.value = ""; }} />
              <input ref={videoRef} type="file" accept="video/*" multiple hidden onChange={(e) => { upload(e.target.files, "video"); e.target.value = ""; }} />
            </div>
            {progress && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span className="msg">{progress.label}</span>
                <div className="prog"><i style={{ width: `${Math.round(progress.p * 100)}%` }} /></div>
                <span className="msg">{Math.round(progress.p * 100)}%</span>
              </div>
            )}
            {cur ? (
              <>
                <div className="viewer">
                  {cur.kind === "video" ? (
                    <video key={cur.id} src={`${API}/media/${cur.id}`} controls preload="metadata" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={cur.id} src={`${API}/media/${cur.id}`} alt={cur.name} />
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 10px", flexWrap: "wrap" }}>
                  <span className="msg">
                    {idx + 1}/{media.length} · {cur.name || (cur.kind === "video" ? "동영상" : "사진")} · {fmtSize(cur.size)} · {cur.createdAt}
                    {cur.createdBy ? ` · ${cur.createdBy}` : ""}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <a className="btn" href={`${API}/media/${cur.id}?download=1`}>내려받기</a>
                    <button type="button" className={`btn danger ${delArmed === cur.id ? "armed" : ""}`} disabled={busy} onClick={() => remove(cur.id)} onBlur={() => setDelArmed(null)}>
                      {delArmed === cur.id ? "한 번 더 누르면 삭제" : "삭제"}
                    </button>
                  </span>
                </div>
                <div className="thumbs">
                  {media.map((m, i) => (
                    <button key={m.id} type="button" className="th" aria-current={i === idx} onClick={() => setIdx(i)} title={m.name}>
                      {m.kind === "video" ? (
                        <span className="vid">동영상</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${API}/media/${m.id}`} alt="" loading="lazy" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="msg" style={{ padding: "18px 0", textAlign: "center", border: "1px dashed #dfe4ee", borderRadius: 6 }}>
                올린 사진·동영상이 없습니다. 위 단추로 올려 주세요(사진은 긴 변 1600px로 줄여 저장, 동영상은 190MB까지).
              </div>
            )}
          </div>
          {msg && <div className={`msg ${msg.err ? "err" : ""}`}>{msg.t}</div>}
        </div>
      </div>
    </div>
  );
}
