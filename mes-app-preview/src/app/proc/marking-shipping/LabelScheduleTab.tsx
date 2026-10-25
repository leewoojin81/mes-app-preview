"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import {
  DONE_PROGRESS,
  expiryDate,
  filterLabelRows,
  LABEL_COLS,
  PROGRESS_OPTIONS,
  type LabelColKey,
  type LabelInputField,
  type ProgressFilter,
  type LabelScheduleRow,
} from "@/lib/label-schedule-shared";

// 마킹출하공정(PROC-06) 라벨일정 — 엑셀 라벨진행현황 시트처럼 MO×대표품목 한 줄씩.
// 회색 칸은 수주현황·품목정보·BOM에서 자동으로 채우고, 흰 칸(작업일자~비고)만 직접 입력한다(칸을 벗어나면 저장).

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 날짜 칸 빠른 입력 — 2026-10-23 / 20261023 / 10-23 / 10/23 / 1023 (연도 생략 시 올해)
function parseDateInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "";
  let y: number, m: number, d: number;
  let mt: RegExpMatchArray | null;
  if ((mt = t.match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/)) && (t.length === 8 || /[-./]/.test(t))) {
    [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  } else if ((mt = t.match(/^(\d{1,2})[-./](\d{1,2})$/)) || (mt = t.match(/^(\d{2})(\d{2})$/))) {
    [y, m, d] = [new Date().getFullYear(), Number(mt[1]), Number(mt[2])];
  } else return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const fmt = (n: number | null, digits = 0) =>
  n == null ? "" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });

function TextCell({
  value,
  onSave,
  kind = "text",
  width,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  kind?: "text" | "date";
  width: string;
}) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(value), [value]);
  async function commit() {
    let v = draft.trim();
    if (kind === "date") {
      const p = parseDateInput(v);
      if (p == null) {
        setBad(true);
        return;
      }
      v = p;
      setDraft(p);
    }
    setBad(false);
    if (v === value) return;
    if (!(await onSave(v))) setDraft(value);
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          setBad(false);
        }
      }}
      placeholder={kind === "date" ? "MM-DD" : ""}
      title={kind === "date" ? "10-23, 1023, 2026-10-23 형식으로 입력" : undefined}
      className={`${width} border rounded px-1.5 py-0.5 text-xs bg-white focus:outline-none focus:border-navy ${
        bad ? "border-rose-400 bg-rose-50" : "border-slate-200"
      }`}
    />
  );
}

// 드롭다운·체크 칸은 바꾸는 즉시 저장하지 않는다 — 실수로 고르는 걸 막으려고(2026-10-23 사용자 요청),
// 바뀐 값은 주황 테두리로 보여주고 옆의 ✓(저장)를 눌러야 저장, ✕ 또는 Esc면 원래 값으로 되돌린다.
function usePending(value: string, onSave: (v: string) => Promise<boolean>) {
  const [pending, setPending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPending(null), [value]);
  const change = (v: string) => setPending(v === value ? null : v);
  const cancel = () => setPending(null);
  const confirm = async () => {
    if (pending == null) return;
    setSaving(true);
    const ok = await onSave(pending);
    setSaving(false);
    if (!ok) setPending(null);
  };
  return { shown: pending ?? value, dirty: pending != null, saving, change, cancel, confirm };
}

function ConfirmButtons({ p }: { p: ReturnType<typeof usePending> }) {
  if (!p.dirty) return null;
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
      <button
        type="button"
        disabled={p.saving}
        onClick={() => void p.confirm()}
        title="저장"
        className="w-5 h-5 rounded bg-navy text-white text-[11px] leading-none hover:opacity-90 disabled:opacity-40"
      >
        ✓
      </button>
      <button
        type="button"
        disabled={p.saving}
        onClick={p.cancel}
        title="취소(원래 값으로)"
        className="w-5 h-5 rounded border border-slate-300 bg-white text-slate-500 text-[11px] leading-none hover:border-rose-400 hover:text-rose-600"
      >
        ✕
      </button>
    </span>
  );
}

const PENDING_CLS = "border-amber-500 ring-2 ring-amber-300 bg-amber-50 text-amber-900";

function PendingSelect({
  value,
  onSave,
  className,
  title,
  children,
}: {
  value: string;
  onSave: (v: string) => Promise<boolean>;
  className: string;
  title?: string;
  children: React.ReactNode;
}) {
  const p = usePending(value, onSave);
  return (
    <span className="whitespace-nowrap">
      <select
        value={p.shown}
        onChange={(e) => p.change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") p.cancel();
          if (e.key === "Enter" && p.dirty) void p.confirm();
        }}
        title={p.dirty ? "✓를 눌러야 저장됩니다" : title}
        className={`border rounded px-1 py-0.5 text-xs focus:outline-none ${p.dirty ? PENDING_CLS : `${className} focus:border-navy`}`}
      >
        {children}
      </select>
      <ConfirmButtons p={p} />
    </span>
  );
}

function PendingCheck({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
  const p = usePending(value, onSave);
  return (
    <span className={`whitespace-nowrap inline-flex items-center rounded ${p.dirty ? "ring-2 ring-amber-300 bg-amber-50 px-1" : ""}`}>
      <input
        type="checkbox"
        checked={p.shown === "O"}
        onChange={(e) => p.change(e.target.checked ? "O" : "")}
        title={p.dirty ? "✓를 눌러야 저장됩니다" : undefined}
        className="accent-navy"
      />
      <ConfirmButtons p={p} />
    </span>
  );
}

// 작업자 — 진행사항처럼 드롭다운에서 1명을 고른다. 선택지 = 작업자정보(BASE-09) 직무 "라벨" 명단.
// 명단에 없는 기존 값(엑셀에서 넘어온 "전수연,오현애" 등)은 다른 사람으로 바꾸기 전까지 "(기존)" 선택지로 그대로 둔다.
function WorkerCell({ value, options, onSave }: { value: string; options: string[]; onSave: (v: string) => Promise<boolean> }) {
  const legacy = value && !options.includes(value) ? value : "";
  return (
    <PendingSelect
      value={value}
      onSave={onSave}
      title={legacy ? "BASE-09 직무 라벨 명단에 없는 기존 값입니다" : undefined}
      className={`w-28 ${legacy ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white"}`}
    >
      <option value="">선택</option>
      {legacy && <option value={legacy}>{legacy} (기존)</option>}
      {options.map((w) => (
        <option key={w} value={w}>
          {w}
        </option>
      ))}
    </PendingSelect>
  );
}

function SelectCell({
  value,
  options,
  placeholder,
  onSave,
  tone,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onSave: (v: string) => Promise<boolean>;
  tone?: "done" | "doing";
}) {
  const toneCls =
    tone === "done"
      ? "border-emerald-500 bg-emerald-600 text-white font-semibold"
      : tone === "doing"
        ? "border-blue-300 bg-blue-50 text-blue-700"
        : "border-slate-200 bg-white";
  return (
    <PendingSelect value={value} onSave={onSave} className={toneCls}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </PendingSelect>
  );
}

function ShelfLifeModal({ initialName, onClose }: { initialName: string; onClose: (changed: boolean) => void }) {
  const [items, setItems] = useState<{ model_name: string; years: number }[]>([]);
  const [name, setName] = useState(initialName);
  const [years, setYears] = useState("");
  const [msg, setMsg] = useState("");
  const [changed, setChanged] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/proc/label-schedule/shelf-life", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setItems(data.items ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(modelName: string, y: string) {
    setMsg("");
    const res = await fetch("/api/proc/label-schedule/shelf-life", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_name: modelName, years: y === "" ? null : y }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error ?? "저장하지 못했습니다.");
      return;
    }
    setChanged(true);
    setName("");
    setYears("");
    await load();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => onClose(changed)}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-navy">형명별 유효기간</h3>
          <button type="button" onClick={() => onClose(changed)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">
            ×
          </button>
        </div>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 text-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="형명 (예: OLP-48)"
            className="border border-slate-300 rounded-md px-2.5 py-1.5 w-36"
          />
          <input
            value={years}
            onChange={(e) => setYears(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="년"
            className="border border-slate-300 rounded-md px-2.5 py-1.5 w-16 text-right"
          />
          <span className="text-slate-500">년</span>
          <button
            type="button"
            disabled={!name.trim() || !years}
            onClick={() => void save(name.trim(), years)}
            className="ml-auto px-3 py-1.5 rounded-md bg-navy text-white text-sm disabled:opacity-40"
          >
            저장
          </button>
        </div>
        {msg && <p className="px-5 pt-2 text-xs text-rose-600">{msg}</p>}
        <div className="overflow-auto px-5 py-2">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.model_name}>
                  <td className="py-1.5 font-mono text-xs">{it.model_name}</td>
                  <td className="py-1.5 text-right">{it.years}년</td>
                  <td className="py-1.5 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => {
                        setName(it.model_name);
                        setYears(String(it.years));
                      }}
                      className="text-xs text-navy underline underline-offset-2"
                    >
                      수정
                    </button>
                    <button type="button" onClick={() => void save(it.model_name, "")} className="text-xs text-rose-600 underline underline-offset-2">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 열 정의(LABEL_COLS) — 표시 항목(숨김)과 순서는 PLAN-04처럼 계정별로 저장된다(user_ui_prefs "label-schedule-grid")
type ColKey = LabelColKey;
const COLS = LABEL_COLS;
const COL_KEYS = new Set<string>(COLS.map((c) => c.key));
const COL_BY_KEY = Object.fromEntries(COLS.map((c) => [c.key, c])) as Record<ColKey, (typeof COLS)[number]>;

type Layout = { order: ColKey[]; hidden: ColKey[] };
const PREF_KEY = "label-schedule-grid";
const DEFAULT_LAYOUT: Layout = { order: COLS.map((c) => c.key), hidden: [] };

function sanitizeLayout(v: unknown): Layout {
  const o = (v ?? {}) as Partial<Layout>;
  const isKey = (k: unknown): k is ColKey => typeof k === "string" && COL_KEYS.has(k);
  const order = [...new Set((Array.isArray(o.order) ? o.order : []).filter(isKey))];
  const hidden = (Array.isArray(o.hidden) ? o.hidden : []).filter(isKey);
  // 저장 이후 새로 생긴 열은 기본 순서상 바로 앞 열 뒤에 끼운다(없으면 맨 뒤)
  COLS.forEach((c, i) => {
    if (order.includes(c.key)) return;
    const prev = i > 0 ? order.indexOf(COLS[i - 1].key) : -1;
    order.splice(prev >= 0 ? prev + 1 : order.length, 0, c.key);
  });
  return { order, hidden: hidden.length >= order.length ? [] : hidden };
}

const chipCls = "px-2 py-0.5 rounded border border-slate-300 text-xs text-slate-600 hover:border-navy";

export default function LabelScheduleTab() {
  const [from, setFrom] = useTabState("labelFrom", () => isoDaysAgo(90));
  const [to, setTo] = useTabState("labelTo", () => isoDaysAgo(0));
  const [pf, setPf] = useTabState<ProgressFilter>("labelProgress", "all");
  const [q, setQ] = useTabState("labelQ", "");
  const [rows, setRows] = useState<LabelScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [shelfFor, setShelfFor] = useState<string | null>(null);

  const [layout, setLayoutState] = useState<Layout>(DEFAULT_LAYOUT);
  const [layoutReady, setLayoutReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragKey, setDragKey] = useState<ColKey | null>(null);
  const [overKey, setOverKey] = useState<ColKey | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/user-prefs?key=${PREF_KEY}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { value: unknown } | null) => {
        if (alive && d?.value) setLayoutState(sanitizeLayout(d.value));
      })
      .catch(() => {})
      .finally(() => alive && setLayoutReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // 바꿀 때마다 잠깐(0.4초) 모았다가 내 계정에 저장한다
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    if (!layoutReady) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/user-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: PREF_KEY, value: next }),
      }).catch(() => {});
    }, 400);
  };
  const resetLayout = () => {
    setLayoutState(DEFAULT_LAYOUT);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    fetch(`/api/user-prefs?key=${PREF_KEY}`, { method: "DELETE" }).catch(() => {});
  };

  const on = (k: ColKey) => !layout.hidden.includes(k);
  const cols = layout.order.filter(on).map((k) => COL_BY_KEY[k]);
  // 최소 1개 열은 남긴다
  const toggleCol = (k: ColKey) => {
    if (on(k) && cols.length <= 1) return;
    setLayout({ ...layout, hidden: on(k) ? [...layout.hidden, k] : layout.hidden.filter((c) => c !== k) });
  };
  const moveBy = (k: ColKey, d: -1 | 1) => {
    const i = layout.order.indexOf(k);
    const j = i + d;
    if (i < 0 || j < 0 || j >= layout.order.length) return;
    const order = [...layout.order];
    [order[i], order[j]] = [order[j], order[i]];
    setLayout({ ...layout, order });
  };
  const dropOn = (src: ColKey, dst: ColKey) => {
    if (src === dst) return;
    const order = layout.order.filter((k) => k !== src);
    const toIdx = order.indexOf(dst);
    // 오른쪽으로 끌어다 놓으면 대상 열 뒤로, 왼쪽이면 앞으로
    const after = layout.order.indexOf(src) < layout.order.indexOf(dst);
    order.splice(after ? toIdx + 1 : toIdx, 0, src);
    setLayout({ ...layout, order });
  };

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/api/proc/label-schedule?from=${from}&to=${to}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "불러오지 못했습니다.");
        setRows([]);
      } else setRows(data.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (r: LabelScheduleRow, field: LabelInputField, value: string) => {
    setMsg("");
    const res = await fetch("/api/proc/label-schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mo_no: r.mo_no, rep_item: r.rep_item, [field]: value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMsg(data.error ?? "저장하지 못했습니다.");
      return false;
    }
    setRows((prev) =>
      prev.map((x) => {
        if (x.mo_no !== r.mo_no || x.rep_item !== r.rep_item) return x;
        const next = { ...x, [field]: value };
        if (field === "prod_date") next.expiry_date = expiryDate(value, x.shelf_years);
        return next;
      })
    );
    return true;
  }, []);

  const visible = useMemo(() => filterLabelRows(rows, pf, q), [rows, pf, q]);

  const counts = useMemo(() => {
    let done = 0,
      doing = 0;
    for (const r of rows) {
      if (DONE_PROGRESS.has(r.progress)) done++;
      else if (r.progress) doing++;
    }
    return { all: rows.length, done, doing, todo: rows.length - done - doing };
  }, [rows]);

  // 작업자 선택지 = 작업자정보(BASE-09) 직무 "라벨"
  const [labelWorkers, setLabelWorkers] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/proc/label-schedule/workers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { workers?: { worker_name: string }[] } | null) => setLabelWorkers((d?.workers ?? []).map((w) => w.worker_name)))
      .catch(() => {});
  }, []);

  // MO가 바뀔 때마다 배경을 번갈아 칠해 같은 주문끼리 묶여 보이게 한다
  const moShade = useMemo(() => {
    const m = new Map<string, boolean>();
    let shade = false,
      prev = "";
    for (const r of visible) {
      if (r.mo_no !== prev) {
        shade = !shade;
        prev = r.mo_no;
      }
      m.set(`${r.mo_no}|${r.rep_item}`, shade);
    }
    return m;
  }, [visible]);

  function cell(k: ColKey, r: LabelScheduleRow) {
    const sv = (f: LabelInputField) => (v: string) => save(r, f, v);
    switch (k) {
      case "rank":
        return <td key={k} className="px-2.5 py-1.5 text-center text-xs">{r.rank ?? "-"}</td>;
      case "so_no":
        return <td key={k} className="px-2.5 py-1.5 font-mono text-xs">{r.so_no}</td>;
      case "mo_no":
        return <td key={k} className="px-2.5 py-1.5 font-mono text-xs">{r.mo_no}</td>;
      case "customer":
        return (
          <td key={k} className="px-2.5 py-1.5">
            {r.customer || (
              <span className="text-slate-400 italic" title="BASE-06 거래처정보에 약칭이 없어 거래처명을 표시합니다">
                {r.customer_name}
              </span>
            )}
          </td>
        );
      case "brand":
        return (
          <td key={k} className="px-2.5 py-1.5 max-w-40 truncate" title={r.brand}>
            {r.brand}
          </td>
        );
      case "rep_item":
        return <td key={k} className="px-2.5 py-1.5 font-mono text-xs">{r.rep_item}</td>;
      case "model":
        return <td key={k} className="px-2.5 py-1.5 font-mono text-xs">{r.model}</td>;
      case "cycle":
        return <td key={k} className="px-2.5 py-1.5 text-xs">{r.cycle}</td>;
      case "order_qty":
        return <td key={k} className="px-2.5 py-1.5 text-right">{fmt(r.order_qty)}</td>;
      case "pack_unit":
        return <td key={k} className="px-2.5 py-1.5 text-right">{fmt(r.pack_unit)}</td>;
      case "label_qty":
        return <td key={k} className="px-2.5 py-1.5 text-right font-semibold">{fmt(r.label_qty, 1)}</td>;
      case "model_name":
        return <td key={k} className="px-2.5 py-1.5 font-mono text-xs">{r.model_name}</td>;
      case "shelf":
        return (
          <td key={k} className="px-2.5 py-1.5 text-center text-xs">
            {r.shelf_years != null ? (
              `${r.shelf_years}년`
            ) : r.model_name ? (
              <button type="button" onClick={() => setShelfFor(r.model_name)} className="text-amber-700 underline underline-offset-2">
                설정
              </button>
            ) : (
              ""
            )}
          </td>
        );
      case "work_date":
        return (
          <td key={k} className="px-1.5 py-1">
            <TextCell value={r.work_date} kind="date" width="w-24" onSave={sv("work_date")} />
          </td>
        );
      case "worker":
        return (
          <td key={k} className="px-1.5 py-1">
            <WorkerCell value={r.worker} options={labelWorkers} onSave={sv("worker")} />
          </td>
        );
      case "ship_lot":
        return (
          <td key={k} className="px-1.5 py-1">
            <TextCell value={r.ship_lot} width="w-16" onSave={sv("ship_lot")} />
          </td>
        );
      case "prod_date":
        return (
          <td key={k} className="px-1.5 py-1">
            <TextCell value={r.prod_date} kind="date" width="w-24" onSave={sv("prod_date")} />
          </td>
        );
      case "expiry":
        return <td key={k} className="px-2.5 py-1.5 text-xs">{r.expiry_date}</td>;
      case "label_type":
        return (
          <td key={k} className={`px-2.5 py-1.5 text-xs ${r.bom_label === "없음" ? "text-slate-400" : ""}`} title="BOM정보(BASE-03)의 라벨 자재">
            {r.bom_label}
          </td>
        );
      case "progress":
        return (
          <td key={k} className="px-1.5 py-1">
            <SelectCell
              value={r.progress}
              options={PROGRESS_OPTIONS}
              placeholder="미진행"
              onSave={sv("progress")}
              tone={DONE_PROGRESS.has(r.progress) ? "done" : r.progress ? "doing" : undefined}
            />
          </td>
        );
      case "packing":
        return (
          <td key={k} className="px-1.5 py-1 text-center">
            <PendingCheck value={r.packing} onSave={sv("packing")} />
          </td>
        );
      case "note":
        return (
          <td key={k} className="px-1.5 py-1">
            <TextCell value={r.note} width="w-44" onSave={sv("note")} />
          </td>
        );
    }
  }

  const card = (label: string, value: number, color: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border px-4 py-3 bg-white transition-colors ${active ? "border-navy ring-1 ring-navy/30" : "border-slate-200 hover:border-slate-400"}`}
    >
      <div className="text-2xl font-bold" style={{ color }}>
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </button>
  );

  return (
    <div className="w-full px-4 sm:px-6 py-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">라벨 진행현황</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            수주현황의 MO번호×대표품목별로 한 줄씩, 생산순위지정(PLAN-01) 작업순서대로 보여줍니다. 회색 칸은 수주·품목정보·BOM에서 자동으로 채우고, 흰 칸만 입력하면 칸을 벗어날 때 저장됩니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!from || !to || visible.length === 0}
            onClick={() => {
              const params = new URLSearchParams({ from, to, pf, q, cols: cols.map((c) => c.key).join(",") });
              window.location.href = `/api/proc/label-schedule/export?${params.toString()}`;
            }}
            title="지금 화면의 기간·필터·검색과 표시 중인 열(순서 그대로)로 내려받습니다"
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors disabled:opacity-40"
          >
            엑셀 다운로드
          </button>
          <button
            type="button"
            onClick={() => setShelfFor("")}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            형명별 유효기간
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card("전체", counts.all, "#1e3a5f", pf === "all", () => setPf("all"))}
        {card("미진행", counts.todo, "#b45309", pf === "open", () => setPf("open"))}
        {card("진행중", counts.doing, "#2563eb", pf === "open", () => setPf("open"))}
        {card("완료", counts.done, "#047857", pf === "done", () => setPf("done"))}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="text-slate-500">수주일자</span>
        <DateSegmentInput value={from} onChange={setFrom} />
        <span className="text-slate-400">~</span>
        <DateSegmentInput value={to} onChange={setTo} />
        {/* PLAN-04 "출하 완료 숨기기"처럼 켜고 끄는 버튼 — 켜면 미완료(미진행·진행중)만, 끄면 전체. 완료만은 위 완료 카드로 */}
        <button
          type="button"
          aria-pressed={pf === "open"}
          onClick={() => setPf(pf === "open" ? "all" : "open")}
          className={`px-[11px] py-[5px] rounded-full border text-[12.5px] cursor-pointer ${
            pf === "open" ? "border-navy bg-navy text-white" : "border-[#dfe4ee] bg-white text-[#4a5672]"
          }`}
        >
          완료 숨기기
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="수주번호·MO번호·고객사·브랜드·품목·작업자 검색"
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72"
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen(!pickerOpen)}
            className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
              pickerOpen ? "border-navy bg-navy/5 text-navy" : "border-slate-300 bg-white text-slate-600 hover:border-navy"
            }`}
          >
            표시 항목 {cols.length}/{COLS.length} ▾
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-40 w-64 max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg p-2 text-sm">
                <div className="flex gap-1 mb-1.5">
                  <button type="button" onClick={() => setLayout({ ...layout, hidden: [] })} className={chipCls}>
                    전체 선택
                  </button>
                  <button type="button" onClick={() => setLayout({ ...layout, hidden: layout.order.filter((k) => k !== "mo_no") })} className={chipCls}>
                    전체 해제
                  </button>
                  <button type="button" onClick={resetLayout} className={chipCls}>
                    기본값
                  </button>
                </div>
                {layout.order.map((k, i) => (
                  <label key={k} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={on(k)} onChange={() => toggleCol(k)} className="accent-navy" />
                    <span className={`flex-1 ${COL_BY_KEY[k].input ? "text-amber-800" : "text-slate-700"}`}>{COL_BY_KEY[k].label}</span>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={(e) => {
                        e.preventDefault();
                        moveBy(k, -1);
                      }}
                      aria-label="위로"
                      className="px-1 text-slate-400 hover:text-navy disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === layout.order.length - 1}
                      onClick={(e) => {
                        e.preventDefault();
                        moveBy(k, 1);
                      }}
                      aria-label="아래로"
                      className="px-1 text-slate-400 hover:text-navy disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </label>
                ))}
                <p className="mt-1.5 px-1 text-[11px] text-slate-400 leading-snug">
                  머리글을 끌어서 순서를 바꿀 수 있고, 바꾼 구성은 내 계정에 자동 저장돼 다음에도 그대로 나옵니다.
                </p>
              </div>
            </>
          )}
        </div>
        <span className="text-xs text-slate-500">{visible.length.toLocaleString()}건</span>
        {msg && <span className="text-xs text-rose-600">{msg}</span>}
      </div>


      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-22rem)]">
          <table className="text-sm whitespace-nowrap w-full">
            <thead className="text-slate-500 text-xs">
              <tr>
                {cols.map((h) => (
                  <th
                    key={h.key}
                    draggable
                    onDragStart={(e) => {
                      setDragKey(h.key);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", h.key);
                    }}
                    onDragOver={(e) => {
                      if (dragKey && dragKey !== h.key) {
                        e.preventDefault();
                        setOverKey(h.key);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey) dropOn(dragKey, h.key);
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    title="끌어서 열 순서를 바꿀 수 있습니다"
                    className={`px-2.5 py-2.5 font-semibold sticky top-0 z-10 shadow-[inset_0_-1px_0_#e2e8f0] text-center cursor-grab select-none ${
                      h.input ? "bg-[#FFF2CC] text-slate-700" : "bg-[#D9E1F2]"
                    } ${dragKey === h.key ? "opacity-50" : ""} ${overKey === h.key ? "outline outline-2 -outline-offset-2 outline-navy" : ""}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={cols.length} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={cols.length} className="text-center py-10 text-slate-400">
                    조건에 맞는 주문이 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map((r) => {
                  const key = `${r.mo_no}|${r.rep_item}`;
                  const done = DONE_PROGRESS.has(r.progress);
                  return (
                    <tr
                      key={key}
                      className={`${done ? "bg-emerald-50 text-emerald-900" : moShade.get(key) ? "bg-slate-50/70" : ""} hover:bg-[#dce7ff]`}
                    >
                      {cols.map((c) => cell(c.key, r))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {shelfFor != null && (
        <ShelfLifeModal
          initialName={shelfFor}
          onClose={(changed) => {
            setShelfFor(null);
            if (changed) void load();
          }}
        />
      )}
    </div>
  );
}
