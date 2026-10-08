"use client";

import { useEffect, useMemo, useState } from "react";
import type { PpeItem, PpeStatusCell } from "@/lib/types";
import { todayStr } from "@/lib/ppe";
import { useDraggableModal } from "@/lib/use-draggable-modal";

type WorkerOption = { employee_no: string; worker_name: string; process_code: string | null };

type Profile = {
  employee_no: string;
  hire_date: string | null;
  dept: string | null;
  duty: string | null;
  cloth_size: string | null;
  shoe_size: string | null;
  remark: string | null;
  status: string | null;
  issue_dates: Record<string, string>;
};

// 엑셀 "보호구 지급" 시트 표기("2026년 06월")
function ym(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const [y, m] = dateStr.split("-");
  return `${y}년 ${m}월`;
}

// 깔창 사이즈 — 안전화 사이즈 구간(225~240 / 245~260 / 265~300)에서 결정, 사이즈 정보가 없으면 대상아님
function insoleSize(shoe: string | null): string {
  const n = Number(shoe);
  if (!shoe || !Number.isFinite(n) || n <= 0) return "대상아님";
  return n <= 240 ? "1" : n <= 260 ? "2" : "3";
}

const th =
  "text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]";

// 관리~깔창 열 머리글 색(채우기 #000066 / 글씨 #FFFFFF)
const NAVY_HEAD = { backgroundColor: "#000066", color: "#FFFFFF" };

// 1차/방진복 2차/방진화&안전화 2차 지급 열 머리글 색(채우기 #DDEBF7 / 글씨 #000000)
const BLUE_HEAD = { backgroundColor: "#DDEBF7", color: "#000000" };

// 깔창 1~3차 지급 열 머리글 색(채우기 #FFE699 / 글씨 #000000)
const YELLOW_HEAD = { backgroundColor: "#FFE699", color: "#000000" };

const COLS = [
  "사번", "성명", "입사일자", "공정", "직무", "방진복&조끼", "방진화&안전화", "깔창",
  "방진복&방진화&안전화 1차 지급", "방진복 2차 지급", "방진화&안전화 2차 지급",
  "깔창 1차 지급", "깔창 2차 지급", "깔창 3차 지급", "특이사항", "상태",
];

export default function PpeIssuancePage() {
  const [items, setItems] = useState<PpeItem[]>([]);
  const [cells, setCells] = useState<PpeStatusCell[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkerOption | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulk, setShowBulk] = useState(false);

  const removeAll = async (employeeNo: string) => {
    await fetch(`/api/ppe-issuances/worker/${encodeURIComponent(employeeNo)}`, { method: "DELETE" });
    setDeleteTarget(null);
    load();
  };

  const load = () => {
    setLoading(true);
    fetch("/api/ppe-status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { items: PpeItem[]; cells: PpeStatusCell[]; profiles: Profile[] }) => {
        setItems(data.items);
        setCells(data.cells);
        setProfiles(data.profiles);
        setLoading(false);
      });
  };
  useEffect(load, []);

  const workers = useMemo(() => {
    const map = new Map<string, WorkerOption>();
    for (const c of cells) {
      if (!map.has(c.employee_no)) {
        map.set(c.employee_no, {
          employee_no: c.employee_no,
          worker_name: c.worker_name,
          process_code: c.process_code,
        });
      }
    }
    return Array.from(map.values());
  }, [cells]);

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.employee_no, p])), [profiles]);

  const [q, setQ] = useState("");
  const [fProc, setFProc] = useState("");
  const [fCloth, setFCloth] = useState("");
  const [fShoe, setFShoe] = useState("");
  const [fInsole, setFInsole] = useState("");

  const uniq = (vals: (string | null | undefined)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v))).sort((a, b) =>
      a.localeCompare(b, "ko", { numeric: true })
    );
  const procOptions = useMemo(() => uniq(profiles.map((p) => p.dept)), [profiles]);
  const clothOptions = useMemo(() => uniq(profiles.map((p) => p.cloth_size)), [profiles]);
  const shoeOptions = useMemo(() => uniq(profiles.map((p) => p.shoe_size)), [profiles]);

  const visibleWorkers = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return workers.filter((w) => {
      const p = profileMap.get(w.employee_no);
      if (kw && !w.employee_no.toLowerCase().includes(kw) && !w.worker_name.toLowerCase().includes(kw)) {
        return false;
      }
      if (fProc && (p?.dept ?? "") !== fProc) return false;
      if (fCloth && (p?.cloth_size ?? "") !== fCloth) return false;
      if (fShoe && (p?.shoe_size ?? "") !== fShoe) return false;
      if (fInsole && insoleSize(p?.shoe_size ?? null) !== fInsole) return false;
      return true;
    });
  }, [workers, profileMap, q, fProc, fCloth, fShoe, fInsole]);

  // 선택은 사번 기준으로 유지(필터를 바꿔도 선택이 남는다). 전체 선택 체크박스는 지금 보이는 목록만 대상
  const allVisibleChecked =
    visibleWorkers.length > 0 && visibleWorkers.every((w) => selected.has(w.employee_no));
  const toggleOne = (no: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(no)) next.delete(no);
      else next.add(no);
      return next;
    });
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const w of visibleWorkers) {
        if (allVisibleChecked) next.delete(w.employee_no);
        else next.add(w.employee_no);
      }
      return next;
    });

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">보호구 지급관리</h1>
          <p className="text-sm text-slate-500 mt-1">
            PSN-03 · 작업자별 보호구(방진복&조끼, 방진화&안전화, 깔창) 지급이력 관리
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
              >
                선택 해제
              </button>
              <button
                onClick={() => setShowBulk(true)}
                className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-600 text-white hover:opacity-90 transition-opacity"
              >
                선택 {selected.size.toLocaleString()}명 일괄 입력
              </button>
            </>
          )}
          <button
            onClick={() => setShowUpload(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium border border-navy text-navy bg-white hover:bg-slate-50 transition-colors"
          >
            엑셀 업로드
          </button>
          <button
            onClick={() => setShowRegister(true)}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          지급등록
        </button>
        </div>
      </div>

          <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm text-sm text-slate-700 space-y-1">
            <p>
              ■ 방진복&방진화&안전화 : 2회차까지 무상지급 3회차부터 급여공제 (방진복 : 18,000원 / 방진화 :
              12,000원 / 안전화 : 25,000원)
            </p>
            <p>■ 깔창</p>
            <p className="pl-3">1) 입식근무자만 신청 가능</p>
            <p className="pl-3">2) 2차, 3차 신청은 직전 지급일 기준 1년이상 경과 후 신청 가능함</p>
            <p className="pl-3 text-xs text-slate-500">
              깔창 사이즈 : 1 = 225~240 / 2 = 245~260 / 3 = 265~300 (안전화 사이즈 기준)
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-500">
              검색 (사번, 성명)
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="사번 또는 성명"
                className="mt-1 block w-44 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white"
              />
            </label>
            <label className="text-xs text-slate-500">
              공정
              <select value={fProc} onChange={(e) => setFProc(e.target.value)} className="mt-1 block border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white">
                <option value="">전체</option>
                {procOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              방진복&조끼
              <select value={fCloth} onChange={(e) => setFCloth(e.target.value)} className="mt-1 block border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white">
                <option value="">전체</option>
                {clothOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              방진화&안전화
              <select value={fShoe} onChange={(e) => setFShoe(e.target.value)} className="mt-1 block border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white">
                <option value="">전체</option>
                {shoeOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              깔창
              <select value={fInsole} onChange={(e) => setFInsole(e.target.value)} className="mt-1 block border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white">
                <option value="">전체</option>
                {["1", "2", "3", "대상아님"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {(q || fProc || fCloth || fShoe || fInsole) && (
              <button
                onClick={() => {
                  setQ("");
                  setFProc("");
                  setFCloth("");
                  setFShoe("");
                  setFInsole("");
                }}
                className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
              >
                초기화
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full text-sm whitespace-nowrap border-collapse [&_th]:border [&_td]:border [&_th]:border-slate-300 [&_td]:border-slate-300">
                <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
                  <tr>
                    <th className={th} style={NAVY_HEAD}>
                      <input
                        type="checkbox"
                        checked={allVisibleChecked}
                        onChange={toggleAllVisible}
                        aria-label="보이는 작업자 전체 선택"
                      />
                    </th>
                    <th className={th} style={NAVY_HEAD}>관리</th>
                    {COLS.map((c, i) => (
                      <th key={c} className={th} style={i < 8 || i >= 14 ? NAVY_HEAD : i < 11 ? BLUE_HEAD : i < 14 ? YELLOW_HEAD : undefined}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && (
                    <tr>
                      <td colSpan={COLS.length + 2} className="text-center py-10 text-slate-400">
                        불러오는 중...
                      </td>
                    </tr>
                  )}
                  {!loading && visibleWorkers.length === 0 && (
                    <tr>
                      <td colSpan={COLS.length + 2} className="text-center py-10 text-slate-400">
                        조건에 맞는 작업자가 없습니다.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    visibleWorkers.map((w) => {
                      const p = profileMap.get(w.employee_no);
                      const d = p?.issue_dates ?? {};
                      const first = d["PPE-01|1"] ?? d["PPE-02|1"];
                      const insole = insoleSize(p?.shoe_size ?? null);
                      const td = "px-3 py-2.5 text-center";
                      return (
                        <tr
                          key={w.employee_no}
                          className={selected.has(w.employee_no) ? "bg-emerald-50 hover:bg-emerald-100" : "hover:bg-slate-50"}
                        >
                          <td className={td}>
                            <input
                              type="checkbox"
                              checked={selected.has(w.employee_no)}
                              onChange={() => toggleOne(w.employee_no)}
                              aria-label={`${w.worker_name} 선택`}
                            />
                          </td>
                          <td className={td}>
                            {deleteTarget === w.employee_no ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="text-xs text-slate-500">지급이력 전체 삭제?</span>
                                <button
                                  onClick={() => removeAll(w.employee_no)}
                                  className="text-xs font-medium text-rose-600 hover:underline"
                                >
                                  예
                                </button>
                                <button
                                  onClick={() => setDeleteTarget(null)}
                                  className="text-xs font-medium text-slate-500 hover:underline"
                                >
                                  아니오
                                </button>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => setEditTarget(w)}
                                  className="text-xs font-medium text-navy hover:underline"
                                >
                                  수정
                                </button>
                                <button
                                  onClick={() => setDeleteTarget(w.employee_no)}
                                  className="text-xs font-medium text-rose-600 hover:underline"
                                >
                                  삭제
                                </button>
                              </span>
                            )}
                          </td>
                          <td className={`${td} font-mono text-xs text-slate-500`}>{w.employee_no}</td>
                          <td className={`${td} font-medium`}>{w.worker_name}</td>
                          <td className={td}>{p?.hire_date ?? ""}</td>
                          <td className={td}>{p?.dept ?? ""}</td>
                          <td className={td}>{p?.duty ?? ""}</td>
                          <td className={td}>{p?.cloth_size ?? ""}</td>
                          <td className={td}>{p?.shoe_size ?? ""}</td>
                          <td className={`${td} ${insole === "대상아님" ? "text-slate-400" : ""}`}>{insole}</td>
                          <td className={td}>{ym(first)}</td>
                          <td className={td}>{ym(d["PPE-01|2"])}</td>
                          <td className={td}>{ym(d["PPE-02|2"])}</td>
                          <td className={td}>{ym(d["PPE-03|1"])}</td>
                          <td className={td}>{ym(d["PPE-03|2"])}</td>
                          <td className={td}>{ym(d["PPE-03|3"])}</td>
                          <td className={`${td} text-left text-slate-600`}>{p?.remark ?? ""}</td>
                          <td className={td}>{p?.status || "정상"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
              {visibleWorkers.length === workers.length
                ? `전체 ${workers.length.toLocaleString()}명`
                : `${visibleWorkers.length.toLocaleString()}명 / 전체 ${workers.length.toLocaleString()}명`}
              {selected.size > 0 && ` · 선택 ${selected.size.toLocaleString()}명`}
            </div>
          </div>

      {showRegister && (
        <RegisterModal
          workers={workers}
          items={items}
          onClose={() => setShowRegister(false)}
          onSaved={() => {
            setShowRegister(false);
            load();
          }}
        />
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onImported={load}
        />
      )}

      {showBulk && (
        <BulkEditModal
          employeeNos={Array.from(selected)}
          names={workers.filter((w) => selected.has(w.employee_no)).map((w) => w.worker_name)}
          onClose={() => setShowBulk(false)}
          onSaved={() => {
            setShowBulk(false);
            setSelected(new Set());
            load();
          }}
        />
      )}

      {editTarget && (
        <EditModal
          target={editTarget}
          profile={profileMap.get(editTarget.employee_no)}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

type ImportResult = {
  inserted: number;
  updated: number;
  unchanged: number;
  badValue: number;
  workerCount: number;
  unknownCount: number;
  unknownNos: string[];
};

function UploadModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const drag = useDraggableModal();

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/ppe-issuances/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "업로드에 실패했습니다.");
      return;
    }
    setResult(data);
    onImported();
  };

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">엑셀 업로드</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          {result ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                업로드 완료 — {result.workerCount.toLocaleString()}명 반영: 신규 {result.inserted.toLocaleString()}건,
                변경 {result.updated.toLocaleString()}건, 동일(변경 없음) {result.unchanged.toLocaleString()}건
              </p>
              {result.badValue > 0 && (
                <p className="text-xs text-amber-700">
                  날짜 형식을 읽을 수 없어 건너뛴 칸 {result.badValue.toLocaleString()}개
                </p>
              )}
              {result.unknownCount > 0 && (
                <p className="text-xs text-amber-700">
                  작업자등록에 없는 사번 {result.unknownCount.toLocaleString()}명 건너뜀
                  {` (${result.unknownNos.join(", ")}${result.unknownCount > result.unknownNos.length ? " …" : ""})`}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white"
                >
                  닫기
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                &quot;보호구 지급&quot; 시트(보호구지급관리 엑셀)를 읽습니다. 사번으로 작업자를 찾아
                &quot;방진복&amp;방진화&amp;안전화 1차 지급&quot;, &quot;방진복 2차 지급&quot;,
                &quot;방진화&amp;안전화 2차 지급&quot;, &quot;깔창 1~3차 지급&quot; 값(예: 2026년 06월)을
                지급이력에 반영합니다. 빈 칸은 기존 이력을 지우지 않고, 월 단위 값은 그 달 1일로
                저장하되 같은 달 이력이 이미 있으면 기존 일자를 유지합니다.
              </p>
              <label className="block text-sm">
                <span className="text-slate-600">엑셀 파일</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-sm"
                />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
                >
                  취소
                </button>
                <button
                  onClick={submit}
                  disabled={!file || busy}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
                >
                  {busy ? "업로드 중..." : "업로드"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const EDIT_SLOTS: { key: string; label: string }[] = [
  { key: "PPE-01|1", label: "방진복&방진화&안전화 1차 지급" },
  { key: "PPE-01|2", label: "방진복 2차 지급" },
  { key: "PPE-02|2", label: "방진화&안전화 2차 지급" },
  { key: "PPE-03|1", label: "깔창 1차 지급" },
  { key: "PPE-03|2", label: "깔창 2차 지급" },
  { key: "PPE-03|3", label: "깔창 3차 지급" },
];

function BulkEditModal({
  employeeNos,
  names,
  onClose,
  onSaved,
}: {
  employeeNos: string[];
  names: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [dates, setDates] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useDraggableModal();

  const canSave = EDIT_SLOTS.some((sl) => dates[sl.key]) || remark.trim() !== "";

  const submit = async () => {
    setSaving(true);
    setError(null);
    // 1차는 방진복·방진화 공통 입력 — 두 품목 1차 이력에 같은 날짜로 저장한다.
    const slots: Record<string, string> = { ...dates };
    if (dates["PPE-01|1"]) slots["PPE-02|1"] = dates["PPE-01|1"];
    const res = await fetch("/api/ppe-issuances/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_nos: employeeNos, slots, remark }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    onSaved();
  };

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";
  const preview = names.slice(0, 8).join(", ") + (names.length > 8 ? ` 외 ${names.length - 8}명` : "");

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">
            선택 일괄 입력 — {employeeNos.length.toLocaleString()}명
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-slate-500">{preview}</p>
          <div className="grid grid-cols-2 gap-3">
            {EDIT_SLOTS.map((sl) => (
              <label key={sl.key} className="block text-sm">
                <span className="text-slate-600">{sl.label}</span>
                <input
                  type="date"
                  value={dates[sl.key] ?? ""}
                  onChange={(e) => setDates((prev) => ({ ...prev, [sl.key]: e.target.value }))}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">특이사항</span>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} className={inputCls} />
          </label>
          <p className="text-[11px] text-slate-400">
            입력한 차수만 선택한 모든 작업자에게 반영됩니다(이미 지급일이 있으면 이 날짜로 바뀝니다). 비워 둔
            차수와 특이사항은 기존 값을 그대로 둡니다.
          </p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || !canSave}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "저장 중..." : `${employeeNos.length.toLocaleString()}명에 저장`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({
  target,
  profile,
  onClose,
  onSaved,
}: {
  target: WorkerOption;
  profile: Profile | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const d = profile?.issue_dates ?? {};
  const [dates, setDates] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const sl of EDIT_SLOTS) init[sl.key] = d[sl.key] ?? "";
    if (!init["PPE-01|1"]) init["PPE-01|1"] = d["PPE-02|1"] ?? "";
    return init;
  });
  const [remark, setRemark] = useState(profile?.remark ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useDraggableModal();

  const submit = async () => {
    setSaving(true);
    setError(null);
    // 1차는 방진복·방진화 공통 입력 — 두 품목 1차 이력에 같은 날짜로 저장한다.
    const slots: Record<string, string> = { ...dates };
    slots["PPE-02|1"] = dates["PPE-01|1"] ?? "";
    const res = await fetch(`/api/ppe-issuances/worker/${encodeURIComponent(target.employee_no)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots, remark }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    onSaved();
  };

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">
            지급 수정 — <span className="font-mono text-sm text-slate-500">{target.employee_no}</span>{" "}
            {target.worker_name}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            {EDIT_SLOTS.map((sl) => (
              <label key={sl.key} className="block text-sm">
                <span className="text-slate-600">{sl.label}</span>
                <input
                  type="date"
                  value={dates[sl.key] ?? ""}
                  onChange={(e) => setDates((prev) => ({ ...prev, [sl.key]: e.target.value }))}
                  className={inputCls}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">날짜를 비우면 해당 차수 지급이력이 삭제됩니다.</p>
          <label className="block text-sm">
            <span className="text-slate-600">특이사항</span>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} className={inputCls} />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RegisterModal({
  workers,
  items,
  onClose,
  onSaved,
}: {
  workers: WorkerOption[];
  items: PpeItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeNo, setEmployeeNo] = useState("");
  const [itemCode, setItemCode] = useState(items[0]?.item_code ?? "");
  const [issueDate, setIssueDate] = useState(todayStr());
  const [receivedYn, setReceivedYn] = useState<"Y" | "N">("Y");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useDraggableModal();

  const submit = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/ppe-issuances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_no: employeeNo,
        item_code: itemCode,
        issue_date: issueDate,
        received_yn: receivedYn,
        note: note.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    onSaved();
  };

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">지급등록</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <label className="block text-sm">
            <span className="text-slate-600">
              작업자 <span className="text-rose-600">*</span>
            </span>
            <select
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              <option value="">선택</option>
              {workers.map((w) => (
                <option key={w.employee_no} value={w.employee_no}>
                  {w.employee_no} · {w.worker_name}
                  {w.process_code ? ` · ${w.process_code}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">
              보호구품목 <span className="text-rose-600">*</span>
            </span>
            <select
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              {items.map((item) => (
                <option key={item.item_code} value={item.item_code}>
                  {item.item_name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                지급일자 <span className="text-rose-600">*</span>
              </span>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">수령여부</span>
              <select
                value={receivedYn}
                onChange={(e) => setReceivedYn(e.target.value as "Y" | "N")}
                className={`${inputCls} bg-white`}
              >
                <option value="Y">Y (수령)</option>
                <option value="N">N (미수령)</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">비고</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={saving || !employeeNo || !itemCode || !issueDate}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
