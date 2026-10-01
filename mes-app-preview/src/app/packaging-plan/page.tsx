"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import { addDays, PACKAGING_FIELDS, type PackagingField, type PackagingScheduleResult } from "@/lib/packaging-schedule";

// 계획정보(PLAN-03) "출하포장" — 포장 라인별·일자별 포장 계획표("2026년 포장_20261001.xlsx" 1번 시트)를
// 그대로 옮긴 화면(2026-10-01 사용자 요청). 라인(1~5 Line/기타/바이알) × 날짜 한 칸에 품명·계획(수량)·
// 개입수·고객사·납기일·수주번호를 적고, 수주번호를 넣으면 수주현황에서 나머지를 자동으로 채운다.
// 실적(일일작업현황 포장공정 양품수량)과 계획 팩수(계획 ÷ 개입수)는 읽기 전용으로 같이 보여준다.

const FIELD_LABEL: Record<PackagingField, string> = {
  product_name: "품목군",
  plan_qty: "계획",
  pack_size: "개입수",
  customer: "고객사",
  due_date: "납기일",
  so_no: "수주번호",
};
const FIELD_ORDER = PACKAGING_FIELDS as readonly PackagingField[];

// 표에 보이는 행 순서(2026-10-01 사용자 요청: 구분 → 고객사, 수주번호, 품명, 계획, 실적, 개입수, 납기일).
// 실적·계획 팩수는 읽기 전용 행이다. 엔터 이동은 이 순서의 입력 행만 따라간다.
type RowKind = { kind: "field"; field: PackagingField } | { kind: "actual" } | { kind: "packs" };
const ROW_LAYOUT: RowKind[] = [
  { kind: "field", field: "customer" },
  { kind: "field", field: "so_no" },
  { kind: "field", field: "product_name" },
  { kind: "field", field: "plan_qty" },
  { kind: "actual" },
  { kind: "field", field: "pack_size" },
  { kind: "field", field: "due_date" },
  { kind: "packs" },
];
// 행별 글자색(2026-10-01 사용자 요청) — 고객사 #002060, 품목군 #0070C0, 납기일 #FF0000. 나머지 행은 기본 색.
const FIELD_TEXT_COLOR: Partial<Record<PackagingField, string>> = {
  customer: "#002060",
  product_name: "#0070C0",
  due_date: "#FF0000",
};

// 입력할 수 있는 칸은 고객사·수주번호뿐이다(2026-10-01 사용자 요청). 품목군·계획·개입수·납기일은 수주번호로
// 수주등록(SALES-02)·제품정보(BASE-01)에서 불러온 값을 보여주기만 하고, 실적·계획 팩수도 계산 값이다.
const READONLY_FIELDS = new Set<PackagingField>(["product_name", "plan_qty", "pack_size", "due_date"]);
const INPUT_ORDER: PackagingField[] = ROW_LAYOUT.flatMap((r) =>
  r.kind === "field" && !READONLY_FIELDS.has(r.field) ? [r.field] : []
);
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}
// 주말 칸 채우기 색(2026-10-01 사용자 요청) — 토요일 #FFCCCC, 일요일 #FF9999. 평일은 채우지 않는다.
function dayFill(dateStr: string): React.CSSProperties | undefined {
  const wd = weekdayOf(dateStr);
  if (wd === 6) return { backgroundColor: "#FFCCCC" };
  if (wd === 0) return { backgroundColor: "#FF9999" };
  return undefined;
}
// 구획선(2026-10-01 사용자 요청) — 설비(라인) 블록 사이와 월~일 주 사이를 굵은 선으로 나눈다.
const DIVIDER = "2px solid #475569";
/** 월요일 열의 왼쪽 선 — 월요일~일요일을 한 주 구획으로 구분 */
function weekEdge(dateStr: string): React.CSSProperties {
  return weekdayOf(dateStr) === 1 ? { borderLeft: DIVIDER } : {};
}
function mmdd(dateStr: string): string {
  return `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}`;
}
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}
function formatThousands(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits === "" ? "" : Number(digits).toLocaleString("ko-KR");
}
/** 개입수 칸에서 팩당 입수를 읽는다 — "10" → 10, "1,2"(2종)처럼 여러 값이면 null */
function packNumber(s: string | null | undefined): number | null {
  const t = (s ?? "").trim();
  // 두 종 이상이 섞인 칸("1,2")은 종별 수량을 몰라 팩수로 환산하지 않는다
  if (!/^\d+$/.test(t)) return null;
  return Number(t) > 0 ? Number(t) : null;
}
/** 금~목 주차(주차 번호 = 그 구간 마지막 날(목요일)이 속한 ISO 주차) — PROD-11 주간업무보고와 같은 기준 */
function weekStartOf(dateStr: string): string {
  return addDays(dateStr, -((weekdayOf(dateStr) - 5 + 7) % 7));
}
function weekNoOf(weekStart: string): number {
  const thu = addDays(weekStart, 6);
  const [y, m, d] = thu.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dayNum = (new Date(t).getUTCDay() + 6) % 7; // 월=0
  const thuOfIsoWeek = t - dayNum * 86400000 + 3 * 86400000;
  const firstThu = new Date(Date.UTC(new Date(thuOfIsoWeek).getUTCFullYear(), 0, 4));
  const firstThuDay = (firstThu.getUTCDay() + 6) % 7;
  const week1Thursday = firstThu.getTime() - firstThuDay * 86400000 + 3 * 86400000;
  return Math.round((thuOfIsoWeek - week1Thursday) / (7 * 86400000)) + 1;
}

function normalizeDueDate(v: string): string | null {
  const s = v.trim();
  if (s === "") return "";
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

const key3 = (line: string, date: string, field: PackagingField) => `${line}|${date}|${field}`;
const inputId = (line: string, date: string, field: PackagingField) => `pk-${line}-${field}-${date}`;

export default function PackagingPlanPage() {
  const [from, setFrom] = useTabState("pkFrom", today);
  const [days, setDays] = useTabState("pkDays", 28);
  const [result, setResult] = useState<PackagingScheduleResult | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const savedRef = useRef<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);

  const load = useCallback(() => {
    if (!from) return;
    setLoading(true);
    fetch(`/api/packaging-schedule?from=${from}&days=${days}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: PackagingScheduleResult) => {
        const next: Record<string, string> = {};
        for (const c of data.cells) {
          for (const f of FIELD_ORDER) {
            const v = c[f];
            if (v == null) continue;
            next[key3(c.line_key, c.plan_date, f)] = f === "plan_qty" ? Number(v).toLocaleString("ko-KR") : String(v);
          }
        }
        savedRef.current = { ...next };
        setDrafts(next);
        setResult(data);
        setLoading(false);
      })
      .catch(() => {
        setToast("불러오기에 실패했습니다.");
        setLoading(false);
      });
  }, [from, days]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function setDraft(line: string, date: string, field: PackagingField, v: string) {
    setDrafts((prev) => ({ ...prev, [key3(line, date, field)]: field === "plan_qty" ? formatThousands(v) : v }));
  }

  // 칸을 벗어날 때(엔터 포함) 바뀐 값만 저장한다. 수주번호는 저장 뒤 수주현황에서 나머지 칸을 채운다.
  async function saveField(line: string, date: string, field: PackagingField) {
    const k = key3(line, date, field);
    let value = drafts[k] ?? "";
    if (value === (savedRef.current[k] ?? "")) return;
    if (field === "due_date") {
      const n = normalizeDueDate(value);
      if (n == null) {
        setToast("납기일은 YYYY-MM-DD 형식으로 입력해 주세요.");
        setDraft(line, date, field, savedRef.current[k] ?? "");
        return;
      }
      value = n;
      setDrafts((prev) => ({ ...prev, [k]: n }));
    }
    const fields: Partial<Record<PackagingField, string>> = { [field]: value };

    let filled = false;
    if (field === "so_no" && value.trim() === "") {
      // 수주번호를 지우면 그 번호에서 불러왔던 품목군·계획·개입수·납기일도 함께 지운다
      for (const f of READONLY_FIELDS) {
        if ((drafts[key3(line, date, f)] ?? "") !== "") {
          fields[f] = "";
          filled = true;
        }
      }
    }
    if (field === "so_no" && value.trim() !== "") {
      try {
        const res = await fetch(`/api/packaging-schedule/order-info?soNo=${encodeURIComponent(value.trim())}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const info = (await res.json()) as {
            customer: string | null;
            product_name: string | null;
            pack_size: string | null;
            due_date: string | null;
            order_qty: number | null;
            missing?: string[];
          };
          const auto: [PackagingField, string | null][] = [
            ["customer", info.customer],
            ["product_name", info.product_name],
            ["pack_size", info.pack_size],
            ["due_date", info.due_date],
            ["plan_qty", info.order_qty ? String(info.order_qty) : null],
          ];
          if (info.missing && info.missing.length > 0) {
            setToast(`수주등록에서 찾을 수 없는 번호: ${info.missing.join(", ")} (찾은 번호만 채웁니다)`);
          }
          for (const [f, v] of auto) {
            if (READONLY_FIELDS.has(f)) {
              // 읽기 전용 칸은 수주번호가 바뀔 때마다 수주 값으로 새로 채운다(값이 없으면 비운다)
              if ((v ?? "") !== (drafts[key3(line, date, f)] ?? "").replace(/,/g, "")) {
                fields[f] = v ?? "";
                filled = true;
              }
            } else if (v && !(drafts[key3(line, date, f)] ?? "").trim()) {
              // 고객사는 직접 고칠 수 있는 칸이라 비어 있을 때만 채운다
              fields[f] = v;
              filled = true;
            }
          }
        } else {
          setToast("수주등록(SALES-02)에서 찾을 수 없는 수주번호입니다(번호만 저장됩니다).");
        }
      } catch {
        /* 조회 실패는 번호 저장에 영향 없음 */
      }
    }

    const res = await fetch("/api/packaging-schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planDate: date, lineKey: line, fields }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setToast(data.error ?? "저장에 실패했습니다.");
      return;
    }
    const saved: Record<string, string> = {};
    for (const [f, v] of Object.entries(fields)) {
      const kk = key3(line, date, f as PackagingField);
      saved[kk] = f === "plan_qty" ? formatThousands(String(v)) : String(v);
    }
    savedRef.current = { ...savedRef.current, ...saved };
    if (filled) {
      setDrafts((prev) => ({ ...prev, ...saved }));
      setToast("수주등록·제품정보 값으로 채웠습니다.");
    }
  }

  // 엔터 → 같은 날짜 열의 아래 입력칸으로(라인의 마지막 항목이면 다음 라인의 첫 항목)
  function focusBelow(line: string, date: string, field: PackagingField) {
    const lines = result?.lines ?? [];
    const li = lines.findIndex((l) => l.key === line);
    const fi = INPUT_ORDER.indexOf(field);
    let target: string | null = null;
    if (fi < INPUT_ORDER.length - 1) target = inputId(line, date, INPUT_ORDER[fi + 1]);
    else if (li < lines.length - 1) target = inputId(lines[li + 1].key, date, INPUT_ORDER[0]);
    if (target) document.getElementById(target)?.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }

  // 표시 중인 기간의 계획 팩수(계획 ÷ 개입수)·계획 수량·실적을 주차(금~목)별로 모은다
  const weekly = useMemo(() => {
    if (!result) return [];
    const map = new Map<string, { plan: number; packs: number; actual: number; noPack: number }>();
    for (const date of dates) {
      const ws = weekStartOf(date);
      const w = map.get(ws) ?? { plan: 0, packs: 0, actual: 0, noPack: 0 };
      for (const line of result.lines) {
        const qty = Number((drafts[key3(line.key, date, "plan_qty")] ?? "").replace(/,/g, ""));
        if (Number.isFinite(qty) && qty > 0) {
          w.plan += qty;
          const pn = packNumber(drafts[key3(line.key, date, "pack_size")]);
          if (pn) w.packs += qty / pn;
          else w.noPack++;
        }
        w.actual += result.actuals[`${line.key}|${date}`] ?? 0;
      }
      map.set(ws, w);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ws, v]) => ({ ws, ...v }));
  }, [result, dates, drafts]);

  const thBase = "px-2 py-1.5 text-center font-semibold border border-slate-300 bg-[#D9E1F2] text-slate-600 text-xs";

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy">출하포장</h1>
        <p className="text-sm text-slate-500 mt-1">
          PLAN-03 · 포장 라인별·일자별 포장 계획입니다. 입력할 수 있는 칸은 고객사와 수주번호뿐이며(칸을 벗어나거나
          엔터를 치면 바로 저장되고, 엔터는 아래 칸으로 이동합니다) 나머지 칸은 보여주기만 합니다. 수주번호를 넣으면 수주등록(SALES-02)의 품목군·납기일·수량(계획)과 제품정보(BASE-01)의
          포장단위수량을 개입수로 불러와 채우며(수주번호를 바꾸면 다시 불러오고, 고객사는 비어 있을 때만 채웁니다) 실적은 일일작업현황의 포장 양품수량이며,
          계획 팩수는 계획 ÷ 개입수로 계산합니다.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-medium text-slate-500 shrink-0">시작일</label>
        <DateSegmentInput value={from} onChange={setFrom} />
        <button
          onClick={() => setFrom(addDays(from, -7))}
          className="px-2.5 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy"
        >
          ◀ 1주
        </button>
        <button
          onClick={() => setFrom(addDays(from, 7))}
          className="px-2.5 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy"
        >
          1주 ▶
        </button>
        <button
          onClick={() => setFrom(today())}
          className="px-2.5 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy"
        >
          오늘
        </button>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          {[14, 28, 42, 62].map((d) => (
            <option key={d} value={d}>
              {d}일 표시
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-17rem)]">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={`${thBase} sticky left-0 top-0 z-30 min-w-28`}>
                  설비
                </th>
                <th
                  rowSpan={2}
                  style={{ borderLeft: DIVIDER, borderRight: DIVIDER }}
                  className={`${thBase} sticky left-28 top-0 z-30 min-w-16`}
                >
                  구분
                </th>
                {dates.map((d) => {
                  const wd = weekdayOf(d);
                  const color = wd === 0 ? "text-rose-600" : wd === 6 ? "text-blue-600" : "";
                  return (
                    <th key={d} style={{ ...dayFill(d), ...weekEdge(d) }} className={`${thBase} sticky top-0 z-20 min-w-28 ${color}`}>
                      {DAY_NAMES[wd]}요일
                    </th>
                  );
                })}
              </tr>
              <tr>
                {dates.map((d) => {
                  const wd = weekdayOf(d);
                  const color = wd === 0 ? "text-rose-600" : wd === 6 ? "text-blue-600" : "";
                  return (
                    <th key={d} style={{ ...dayFill(d), ...weekEdge(d) }} className={`${thBase} sticky top-[1.9rem] z-20 ${color}`}>
                      {mmdd(d)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={2 + dates.length} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading &&
                result?.lines.map((line) => {
                  const rowCount = ROW_LAYOUT.length;
                  const labelCls =
                    "sticky left-28 z-10 bg-slate-50 border border-slate-300 px-2 py-1 text-center text-slate-500";
                  return (
                    <Fragment key={line.key}>
                      {ROW_LAYOUT.map((row, ri) => {
                        const rowKey = `${line.key}-${row.kind === "field" ? row.field : row.kind}`;
                        // 설비 블록의 첫 행 위/마지막 행 아래를 굵은 선으로 구분
                        const blockEdge: React.CSSProperties = {
                          ...(ri === 0 ? { borderTop: DIVIDER } : {}),
                          ...(ri === ROW_LAYOUT.length - 1 ? { borderBottom: DIVIDER } : {}),
                        };
                        const labelStyle: React.CSSProperties = { ...blockEdge, borderLeft: DIVIDER, borderRight: DIVIDER };
                        const lineCell =
                          ri === 0 ? (
                            <td
                              rowSpan={rowCount}
                              style={{ borderTop: DIVIDER, borderBottom: DIVIDER, borderLeft: DIVIDER }}
                              className="sticky left-0 z-10 bg-white border border-slate-300 px-2 text-center align-middle font-semibold text-slate-700"
                            >
                              {line.label}
                              {line.sub && <div className="text-[10px] font-normal text-slate-400">{line.sub}</div>}
                            </td>
                          ) : null;
                        if (row.kind === "actual") {
                          return (
                            <tr key={rowKey}>
                              <td style={labelStyle} className={labelCls}>실적</td>
                              {dates.map((d) => {
                                const a = result.actuals[`${line.key}|${d}`];
                                return (
                                  <td key={d} style={{ ...dayFill(d), ...weekEdge(d), ...blockEdge }} className="border border-slate-200 px-1.5 py-1 text-right font-mono text-emerald-700">
                                    {a ? fmtNum(a) : ""}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        }
                        if (row.kind === "packs") {
                          return (
                            <tr key={rowKey}>
                              <td style={labelStyle} className={labelCls}>계획 팩수</td>
                              {dates.map((d) => {
                                const qty = Number((drafts[key3(line.key, d, "plan_qty")] ?? "").replace(/,/g, ""));
                                const pn = packNumber(drafts[key3(line.key, d, "pack_size")]);
                                return (
                                  <td key={d} style={{ ...dayFill(d), ...weekEdge(d), ...blockEdge }} className="border border-slate-200 px-1.5 py-1 text-right font-mono text-slate-500">
                                    {qty > 0 && pn ? fmtNum(qty / pn) : ""}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        }
                        const f = row.field;
                        const readOnly = READONLY_FIELDS.has(f);
                        return (
                          <tr key={rowKey}>
                            {lineCell}
                            <td style={labelStyle} className={labelCls}>{FIELD_LABEL[f]}</td>
                            {dates.map((d) => {
                              if (readOnly) {
                                return (
                                  <td
                                    key={d}
                                    style={{ ...dayFill(d), ...weekEdge(d), ...blockEdge, color: FIELD_TEXT_COLOR[f] }}
                                    className={`border border-slate-200 px-1.5 py-1 text-xs text-slate-700 ${
                                      f === "plan_qty" ? "text-right font-mono" : "text-center"
                                    }`}
                                  >
                                    {drafts[key3(line.key, d, f)] ?? ""}
                                  </td>
                                );
                              }
                              return (
                                <td key={d} style={{ ...dayFill(d), ...weekEdge(d), ...blockEdge }} className="border border-slate-200 p-0">
                                  <input
                                    id={inputId(line.key, d, f)}
                                    value={drafts[key3(line.key, d, f)] ?? ""}
                                    onChange={(e) => setDraft(line.key, d, f, e.target.value)}
                                    onBlur={() => saveField(line.key, d, f)}
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter") return;
                                      e.preventDefault();
                                      focusBelow(line.key, d, f);
                                    }}
                                    style={{ color: FIELD_TEXT_COLOR[f] }}
                                    placeholder={f === "due_date" ? "YYYY-MM-DD" : ""}
                                    className={`w-full bg-transparent px-1.5 py-1 text-xs focus:bg-amber-50 focus:outline-none ${
                                      f === "plan_qty" ? "text-right font-mono" : "text-center"
                                    }`}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && weekly.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm max-w-3xl">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 text-sm font-semibold text-slate-600">
            주차별 합계 <span className="font-normal text-xs text-slate-400">(표시 중인 기간 기준 · 주차는 금~목)</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-center font-semibold">주차</th>
                <th className="px-3 py-2 text-center font-semibold">기간</th>
                <th className="px-3 py-2 text-center font-semibold">계획 팩수</th>
                <th className="px-3 py-2 text-center font-semibold">계획 수량</th>
                <th className="px-3 py-2 text-center font-semibold">실적 수량</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {weekly.map((w) => (
                <tr key={w.ws}>
                  <td className="px-3 py-2 text-center font-semibold text-slate-700">{weekNoOf(w.ws)} W</td>
                  <td className="px-3 py-2 text-center text-slate-500">
                    {mmdd(w.ws)}~{mmdd(addDays(w.ws, 6))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {w.packs > 0 ? fmtNum(w.packs) : ""}
                    {w.noPack > 0 && (
                      <span className="ml-1 text-[10px] text-amber-600" title="개입수가 없어 팩수로 환산하지 못한 칸 수">
                        ({w.noPack}칸 개입수 없음)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{w.plan > 0 ? fmtNum(w.plan) : ""}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{w.actual > 0 ? fmtNum(w.actual) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
