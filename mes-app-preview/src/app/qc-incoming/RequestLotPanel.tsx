"use client";

import { useMemo, useState } from "react";
import type { SupplyLot } from "@/lib/qc-incoming-shared";
import { DESIGN_OPTIONS, RECV_TYPE_OPTIONS, SUPPLY_PARTS } from "@/lib/qc-incoming-shared";
import { shrinkImage } from "./qc-utils";

// 의뢰서 사진으로 로트 추가 — 입고검사의뢰서 사진을 AI가 읽어 자재코드 줄마다 로트 후보를 만들고,
// 확인·수정한 뒤 체크한 줄만 한 번에 추가한다(대시보드의 "의뢰서 사진 읽기"와 같은 흐름). 의뢰서 사진은 추가한 로트마다 사진으로 붙는다.
// 읽기에는 서버의 ANTHROPIC_API_KEY가 필요하다(없으면 안내만 나오고 직접 입력해야 한다).
interface Cand {
  on: boolean;
  code: string;
  part: string;
  name: string;
  supplier: string;
  customer: string;
  recv_type: string;
  design: string;
  lot_qty: string;
  insp_qty: string;
  item_code: string;
  known: boolean;
  dup: boolean;
  hint: string;
}

const INP = "w-full border border-slate-300 rounded px-2 py-1 text-xs text-slate-700";

function ymd(v: unknown): string {
  const m = String(v ?? "").match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}
function partFrom(code: string, name: string): string {
  const x = ({ BIP: "단상자", BFS: "실링지", BIL: "라벨", BII: "설명서" } as Record<string, string>)[code.slice(0, 3)];
  if (x) return x;
  return /실링/.test(name) ? "실링지" : /단상자/.test(name) ? "단상자" : /라벨/.test(name) ? "라벨" : /설명서|IFU/i.test(name) ? "설명서" : "기타";
}

export default function RequestLotPanel({
  lots,
  onClose,
  onAdded,
}: {
  lots: SupplyLot[];
  onClose: () => void;
  onAdded: (msg: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [recvDate, setRecvDate] = useState("");
  const [headSup, setHeadSup] = useState("");
  const [cands, setCands] = useState<Cand[] | null>(null);

  const setCand = (i: number, patch: Partial<Cand>) => setCands((prev) => (prev ? prev.map((c, j) => (j === i ? { ...c, ...patch } : c)) : prev));

  async function read(f: File) {
    setFile(f);
    setCands(null);
    setBusy(true);
    setMsg("의뢰서를 읽는 중… (10~60초 걸릴 수 있습니다)");
    try {
      const sh = await shrinkImage(f, 2400, 0.9);
      const res = await fetch("/api/qc-incoming/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: sh.dataUrl }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg(d.error ?? "사진을 읽지 못했습니다.");
      const data = (d.data ?? {}) as Record<string, unknown>;
      const rd = ymd(data.receiptDate) || ymd(data.requestDate) || new Date().toISOString().slice(0, 10);
      const sup = String(data.supplier ?? "").trim();
      const rtRaw = String(data.receiptType ?? "");
      const rt = (RECV_TYPE_OPTIONS as readonly string[]).includes(rtRaw) ? rtRaw : "";
      const raw = (Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : []).filter((x) => String(x.code ?? "").trim());
      if (raw.length === 0) return setMsg("사진에서 자재코드가 있는 줄을 찾지 못했습니다. 의뢰서 전체가 밝고 선명하게 나오도록 다시 찍어 주세요.");
      setRecvDate(rd);
      setHeadSup(sup);
      const out: Cand[] = [];
      for (const x of raw) {
        const code = String(x.code ?? "").replace(/\s+/g, "").toUpperCase();
        const qty = Math.round(Number(String(x.qty ?? "").replace(/[^\d.]/g, ""))) || 0;
        const info = await fetch(`/api/qc-incoming/supply/lookup?code=${encodeURIComponent(code)}`).then((r) => r.json()).catch(() => ({ found: false }));
        const ocrName = [String(x.name ?? "").trim(), String(x.spec ?? "").trim()].filter(Boolean).join(" ");
        const part = info.found && info.part ? String(info.part) : partFrom(code, ocrName);
        const design = (DESIGN_OPTIONS as readonly string[]).includes(String(x.design ?? "").trim()) ? String(x.design).trim() : "";
        const dup = lots.some((l) => l.mat_code === code && l.recv_date === rd && l.lot_qty === qty);
        out.push({
          on: !dup,
          code,
          part,
          name: info.found && info.name ? String(info.name) : ocrName,
          supplier: sup || (info.found && info.supplier ? String(info.supplier) : ""),
          customer: String(x.customer ?? "").trim(),
          recv_type: rt,
          design,
          lot_qty: String(qty),
          insp_qty: String(info.insp_qty ?? 0),
          item_code: info.found && info.item ? String(info.item) : "",
          known: !!info.found,
          dup,
          hint: info.found ? "품명·품목코드를 기존 데이터에서 자동 입력했습니다." : "목록에 없는 자재코드입니다. 코드·품명을 사진과 비교해 확인하세요.",
        });
      }
      setCands(out);
      setMsg(`${out.length}건을 읽었습니다. 사진과 비교해 확인한 뒤 추가하세요.`);
    } catch {
      setMsg("사진을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const onCount = cands?.filter((c) => c.on).length ?? 0;

  async function addAll() {
    if (!cands || !file) return;
    if (!recvDate) return setMsg("입고일자를 입력해 주세요.");
    const sel = cands.filter((c) => c.on);
    const bad = sel.filter((c) => !c.code || !c.name || !c.supplier);
    if (bad.length) return setMsg(`자재코드·품명·납품업체가 비어 있는 줄이 ${bad.length}건 있습니다. 채우거나 체크를 해제해 주세요.`);
    setBusy(true);
    const lotSug = await fetch(`/api/qc-incoming/supply/lookup?recv=${recvDate}`).then((r) => r.json()).catch(() => ({ lot: "" }));
    const pre = recvDate.replace(/-/g, "");
    let seq = Number(String(lotSug.lot ?? "").slice(9)) || 1;
    const sh = await shrinkImage(file).catch(() => null);
    const added: number[] = [];
    let fail = 0;
    for (let i = 0; i < sel.length; i++) {
      const c = sel[i];
      setMsg(`추가 중… (${i + 1}/${sel.length})`);
      const lotNo = `${pre}-${seq < 10 ? "0" : ""}${seq}`;
      seq++;
      const res = await fetch("/api/qc-incoming/supply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part: c.part, recv_date: recvDate, lot_no: lotNo, mat_code: c.code, name: c.name, supplier: c.supplier,
          lot_qty: Number(c.lot_qty) || 0, insp_qty: Number(c.insp_qty) || 0, bad_qty: 0,
          item_code: c.item_code, customer: c.customer, design: c.design, recv_type: c.recv_type,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        fail++;
        continue;
      }
      added.push(d.lot.no);
      if (sh) {
        await fetch("/api/qc-incoming/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ no: d.lot.no, note: "입고검사의뢰서", image: sh.dataUrl, w: sh.w, h: sh.h }),
        }).catch(() => null);
      }
    }
    setBusy(false);
    const text = added.length
      ? `의뢰서 로트 ${added.length}건을 추가했습니다 (No.${added.join(", ")}).${fail ? ` ${fail}건은 저장하지 못했습니다. 다시 시도해 주세요.` : ""}`
      : "로트를 추가하지 못했습니다.";
    await onAdded(text);
    if (added.length && !fail) onClose();
    else setMsg(text);
  }

  const parts = SUPPLY_PARTS as readonly string[];
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        입고검사의뢰서 사진을 올리면 AI가 표를 읽어 자재코드 줄마다 로트를 만들어 줍니다. 읽은 값은 꼭 사진과 비교해 확인하세요. 사진 읽기에는 서버에 AI 키 설정이 필요하며, 사진은 읽는 동안 외부 AI 서버로 전송됩니다.
      </p>
      <label className={`inline-block px-3 py-1.5 rounded-md text-sm border border-slate-300 text-slate-700 cursor-pointer hover:border-navy ${busy ? "opacity-50 pointer-events-none" : ""}`}>
        의뢰서 사진 촬영·선택
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) read(f);
          }}
        />
      </label>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="의뢰서" className="max-h-40 rounded border border-slate-200" />
      )}
      {msg && <p className={`text-xs ${busy ? "text-indigo-600" : "text-slate-600"}`}>{msg}</p>}

      {cands && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500">
              입고일자 (의뢰서 기준)
              <input type="date" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700" />
            </label>
            <label className="text-xs text-slate-500">
              납품업체 (전체 적용)
              <input
                value={headSup}
                maxLength={40}
                onChange={(e) => {
                  setHeadSup(e.target.value);
                  setCands((prev) => (prev ? prev.map((c) => ({ ...c, supplier: e.target.value })) : prev));
                }}
                className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700"
              />
            </label>
          </div>
          <div className="space-y-3">
            {cands.map((c, i) => (
              <div key={i} className={`rounded-lg border p-3 space-y-2 ${c.dup ? "border-amber-300 bg-amber-50/50" : c.on ? "border-navy/40" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={c.on} onChange={(e) => setCand(i, { on: e.target.checked })} aria-label="추가" className="accent-navy" />
                  <b className="text-sm">{i + 1}</b>
                  <input value={c.code} maxLength={40} onChange={(e) => setCand(i, { code: e.target.value.replace(/\s+/g, "").toUpperCase() })} aria-label="자재코드" className={`${INP} w-36 font-mono`} />
                  <select value={c.part} onChange={(e) => setCand(i, { part: e.target.value })} aria-label="자재" className={`${INP} w-24`}>
                    {parts.map((p) => (<option key={p}>{p}</option>))}
                  </select>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <label className="col-span-2 text-xs text-slate-500">품명<input value={c.name} maxLength={120} onChange={(e) => setCand(i, { name: e.target.value })} className={INP} /></label>
                  <label className="text-xs text-slate-500">고객사<input value={c.customer} maxLength={40} onChange={(e) => setCand(i, { customer: e.target.value })} className={INP} /></label>
                  <label className="text-xs text-slate-500">납품업체<input value={c.supplier} maxLength={40} onChange={(e) => setCand(i, { supplier: e.target.value })} className={INP} /></label>
                  <label className="text-xs text-slate-500">입고 구분
                    <select value={c.recv_type} onChange={(e) => setCand(i, { recv_type: e.target.value })} className={INP}>
                      <option value=""></option>
                      {RECV_TYPE_OPTIONS.map((p) => (<option key={p}>{p}</option>))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">디자인 구분
                    <select value={c.design} onChange={(e) => setCand(i, { design: e.target.value })} className={INP}>
                      <option value=""></option>
                      {DESIGN_OPTIONS.map((p) => (<option key={p}>{p}</option>))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">Lot 수량<input type="number" min={0} value={c.lot_qty} onChange={(e) => setCand(i, { lot_qty: e.target.value })} className={INP} /></label>
                  <label className="text-xs text-slate-500">검사수량<input type="number" min={0} value={c.insp_qty} onChange={(e) => setCand(i, { insp_qty: e.target.value })} className={INP} /></label>
                  <label className="text-xs text-slate-500">품목코드<input value={c.item_code} maxLength={40} onChange={(e) => setCand(i, { item_code: e.target.value })} className={INP} /></label>
                </div>
                <p className={`text-xs ${c.known && !c.dup ? "text-slate-500" : "text-amber-700"}`}>
                  {c.dup ? "이미 같은 입고일·수량으로 등록된 로트입니다(기본 제외). " : ""}
                  {c.hint}
                </p>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 rounded-md text-sm border border-slate-300 text-slate-600 disabled:opacity-40">취소</button>
            <button type="button" onClick={addAll} disabled={busy || onCount === 0} className="px-4 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-50">
              {busy ? "추가 중…" : `${onCount}건 로트 추가`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
