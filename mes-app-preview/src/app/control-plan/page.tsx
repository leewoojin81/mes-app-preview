"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseControlPlanFileName, type ControlPlanFile } from "@/lib/control-plan";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

// 품질관리 Control Plan(QC-00) — 관리계획서 PDF를 개정판별로 올리고, 고른 판을 오른쪽에서 바로 본다(lib/control-plan.ts).
// 문서명마다 개정일자가 가장 늦은 판에 "최신" 표시. 처음 열면 맨 위 문서의 최신판을 보여준다.
export default function ControlPlanPage() {
  const [files, setFiles] = useState<ControlPlanFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const [pick, setPick] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [revNo, setRevNo] = useState("");
  const [revDate, setRevDate] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [delArmed, setDelArmed] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (selectId?: number) => {
    const res = await fetch("/api/control-plan", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { files?: ControlPlanFile[] };
    const list = data.files ?? [];
    setFiles(list);
    setLoading(false);
    setSelected((cur) => {
      if (selectId != null) return selectId;
      if (cur != null && list.some((f) => f.id === cur)) return cur;
      return list[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function onPick(f: File | null) {
    setPick(f);
    setMsg("");
    if (!f) return;
    const p = parseControlPlanFileName(f.name);
    setTitle(p.title);
    setRevNo(p.rev_no);
    setRevDate(p.rev_date);
  }

  function resetForm() {
    setPick(null);
    setTitle("");
    setRevNo("");
    setRevDate("");
    setNote("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function upload() {
    if (!pick) return;
    setUploading(true);
    setMsg("");
    const fd = new FormData();
    fd.append("file", pick);
    fd.append("title", title);
    fd.append("rev_no", revNo);
    fd.append("rev_date", revDate);
    fd.append("note", note);
    const res = await fetch("/api/control-plan", { method: "POST", body: fd });
    const data = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
    setUploading(false);
    if (!res.ok) {
      setMsg(data.error ?? "올리지 못했습니다.");
      return;
    }
    setMsg(`"${pick.name}"을(를) 올렸습니다.`);
    resetForm();
    await load(data.id);
  }

  async function remove(f: ControlPlanFile) {
    if (delArmed !== f.id) {
      setDelArmed(f.id);
      setTimeout(() => setDelArmed((v) => (v === f.id ? null : v)), 3000);
      return;
    }
    const res = await fetch(`/api/control-plan/${f.id}`, { method: "DELETE" });
    setDelArmed(null);
    setMsg(res.ok ? `"${f.file_name}"을(를) 삭제했습니다.` : "삭제하지 못했습니다.");
    if (selected === f.id) setSelected(null);
    await load();
  }

  // 문서명별 최신판(개정일자 → 개정번호 → 나중에 올린 것) — 목록이 그 순서로 정렬돼 오므로 문서명마다 첫 행
  const latestIds = new Set<number>();
  const seenTitles = new Set<string>();
  for (const f of files) {
    if (!seenTitles.has(f.title)) {
      seenTitles.add(f.title);
      latestIds.add(f.id);
    }
  }
  const cur = files.find((f) => f.id === selected) ?? null;

  return (
    <div className="w-full px-4 sm:px-6 py-6">
      <h1 className="text-xl font-bold text-navy">Control Plan</h1>
      <p className="text-sm text-slate-500 mt-1">QC-00 · 공정별 관리계획서(Control Plan) PDF 개정판 보관·보기</p>

      <div className="mt-4 bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-600">
            PDF 파일
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              className="mt-1 block text-sm text-slate-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
            />
          </label>
          <label className="text-sm text-slate-600 flex-1 min-w-[220px]">
            문서명
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: (사출제외) Control Plan"
              className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700"
            />
          </label>
          <label className="text-sm text-slate-600 w-24">
            개정번호
            <input
              value={revNo}
              onChange={(e) => setRevNo(e.target.value)}
              placeholder="09"
              className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700"
            />
          </label>
          <label className="text-sm text-slate-600">
            개정일자
            <input
              type="date"
              value={revDate}
              onChange={(e) => setRevDate(e.target.value)}
              className="mt-1 block border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700"
            />
          </label>
          <label className="text-sm text-slate-600 flex-1 min-w-[200px]">
            비고
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="개정 내용 요약 등"
              className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm text-slate-700"
            />
          </label>
          <button
            type="button"
            onClick={upload}
            disabled={!pick || !title.trim() || uploading}
            className="px-4 py-1.5 rounded-md bg-navy text-white text-sm font-medium disabled:opacity-40"
          >
            {uploading ? "올리는 중…" : "올리기"}
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden self-start">
          <div className="px-3 py-2 border-b border-slate-200 text-sm font-semibold text-slate-700">개정판 목록 ({files.length})</div>
          {loading ? (
            <p className="p-4 text-sm text-slate-400">불러오는 중…</p>
          ) : files.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">올린 Control Plan이 없습니다. 위에서 PDF를 올리세요.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {files.map((f) => (
                <li
                  key={f.id}
                  onClick={() => setSelected(f.id)}
                  className={`px-3 py-2 cursor-pointer text-sm ${f.id === selected ? "bg-blue-50" : "hover:bg-blue-50/60"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 truncate">{f.title}</span>
                    {f.rev_no && <span className="shrink-0 text-xs text-slate-600">Rev.{f.rev_no}</span>}
                    {latestIds.has(f.id) && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs">최신</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span>{f.rev_date ?? "개정일자 없음"}</span>
                    <span>· {fmtSize(f.size)}</span>
                    <span className="truncate">
                      · {f.uploaded_at.slice(0, 16)} {f.uploaded_by ?? ""}
                    </span>
                  </div>
                  {f.note && <div className="mt-0.5 text-xs text-slate-600">{f.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col min-h-[70vh]">
          {cur ? (
            <>
              <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2 text-sm">
                <span className="font-semibold text-slate-700 truncate">{cur.file_name}</span>
                <a
                  href={`/api/control-plan/${cur.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto shrink-0 text-xs px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  새 창
                </a>
                <a
                  href={`/api/control-plan/${cur.id}?download=1`}
                  className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  내려받기
                </a>
                <button
                  type="button"
                  onClick={() => remove(cur)}
                  className="shrink-0 text-xs px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  {delArmed === cur.id ? "한 번 더 누르면 삭제" : "삭제"}
                </button>
              </div>
              <iframe key={cur.id} src={`/api/control-plan/${cur.id}`} title={cur.file_name} className="flex-1 w-full min-h-[70vh]" />
            </>
          ) : (
            <p className="m-auto text-sm text-slate-400">왼쪽 목록에서 파일을 고르세요.</p>
          )}
        </div>
      </div>
    </div>
  );
}
