"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { ItemProcessRoutingRow, LineCapaResult } from "@/lib/types";

interface ItemHit {
  item_code: string;
  item_name: string;
}

type Draft = { daily_capa: string; yield_rate: string; lot_size: string };

// 입력칸에서 엔터를 치면 같은 열의 다음 행으로 포커스를 옮긴다(엑셀 느낌의 연속 입력,
// 2026-09-13 사용자 요청) — 포커스가 옮겨가며 발생하는 blur가 그대로 저장을 트리거한다.
function focusId(id: string) {
  document.getElementById(id)?.focus();
}

function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// "공정별 계획" DAY 입력칸에 천단위 쉼표를 붙여 보여준다(2026-09-13 사용자 요청) — 저장
// 시에는 stripThousands로 쉼표를 떼고 숫자로 바꾼다.
function formatThousandsDraft(raw: string): string {
  let clean = raw.replace(/[^0-9.]/g, "");
  const firstDot = clean.indexOf(".");
  if (firstDot !== -1) {
    clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, "");
  }
  if (clean === "" || clean === ".") return clean;
  const [intPart, decPart] = clean.split(".");
  const formattedInt = intPart === "" ? "" : Number(intPart).toLocaleString("ko-KR");
  return decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
}

function stripThousands(s: string): string {
  return s.replace(/,/g, "");
}

function draftOf(r: ItemProcessRoutingRow): Draft {
  return {
    daily_capa: r.daily_capa != null ? String(r.daily_capa) : "",
    yield_rate: r.yield_rate != null ? String(r.yield_rate) : "",
    lot_size: r.lot_size != null ? String(r.lot_size) : "",
  };
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function currentYearMonth(): string {
  return toLocalDateStr(new Date());
}

type Tab = "item" | "line-capa";

export default function PlanInfoPage() {
  const [tab, setTab] = useTabState<Tab>("planInfoTab", "item");

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">계획정보</h1>
        <p className="text-sm text-slate-500 mt-1">PLAN-02</p>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab("item")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "item" ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          품목×공정 계획정보
        </button>
        <button
          onClick={() => setTab("line-capa")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "line-capa" ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          공정별 월 CAPA 및 근무계획
        </button>
      </div>

      {tab === "item" ? <ItemProcessPlanTab /> : <LineCapaPlanTab />}
    </div>
  );
}

function ItemProcessPlanTab() {
  // 탭을 전환했다 돌아와도 보고 있던 품목/검색어는 유지되도록 세션 단위로 저장한다.
  const [searchInput, setSearchInput] = useTabState("searchInput", "");
  const [search, setSearch] = useTabState("search", "");
  const [searchResults, setSearchResults] = useState<ItemHit[]>([]);
  const [showResults, setShowResults] = useState(false);

  const [selectedItem, setSelectedItem] = useTabState<ItemHit | null>("selectedItem", null);
  const [rows, setRows] = useState<ItemProcessRoutingRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 품목 검색어는 300ms 디바운스 후 서버 검색 — 품목이 7만 건대라 전체를 내려받지 않는다.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch]);

  useEffect(() => {
    if (!search) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ page: "1", pageSize: "20", search });
    fetch(`/api/items?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { rows: ItemHit[] }) => {
        if (cancelled) return;
        setSearchResults(data.rows);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // 탭을 닫았다가(=재마운트) 돌아왔을 때, 저장돼있던 선택 품목의 공정 목록을 다시 불러온다.
  useEffect(() => {
    if (selectedItem) loadRows(selectedItem.item_code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadRows(item_code: string) {
    setLoadingRows(true);
    fetch(`/api/item-process-routing?item_code=${encodeURIComponent(item_code)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data: ItemProcessRoutingRow[]) => {
        setRows(data);
        setDrafts(Object.fromEntries(data.map((r) => [r.process_code, draftOf(r)])));
        setLoadingRows(false);
      });
  }

  function selectItem(item: ItemHit) {
    setSelectedItem(item);
    setSearchInput("");
    setSearch("");
    setSearchResults([]);
    setShowResults(false);
    loadRows(item.item_code);
  }

  const EMPTY_DRAFT: Draft = { daily_capa: "", yield_rate: "", lot_size: "" };

  function setDraft(process_code: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [process_code]: { ...(prev[process_code] ?? EMPTY_DRAFT), [field]: value },
    }));
  }

  async function saveRow(process_code: string) {
    if (!selectedItem) return;
    const d = drafts[process_code];
    if (!d) return;
    setSavingCode(process_code);
    try {
      const res = await fetch("/api/item-process-routing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_code: selectedItem.item_code,
          process_code,
          daily_capa: toNum(d.daily_capa),
          yield_rate: toNum(d.yield_rate),
          lot_size: toNum(d.lot_size),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      loadRows(selectedItem.item_code);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSavingCode(null);
    }
  }

  // 행마다 blur/엔터로도 바로 저장되지만, 여러 칸을 한 번에 입력한 뒤 눌러서 화면에
  // 남아있는 입력값을 통째로 저장 확인할 수 있는 버튼도 따로 둔다(2026-09-13 사용자 요청).
  async function saveAllRows() {
    if (!selectedItem || rows.length === 0) return;
    setSavingAll(true);
    try {
      const results = await Promise.all(
        rows.map(async (r) => {
          const d = drafts[r.process_code] ?? draftOf(r);
          const res = await fetch("/api/item-process-routing", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item_code: selectedItem.item_code,
              process_code: r.process_code,
              daily_capa: toNum(d.daily_capa),
              yield_rate: toNum(d.yield_rate),
              lot_size: toNum(d.lot_size),
            }),
          });
          return res.ok;
        })
      );
      loadRows(selectedItem.item_code);
      setToast(results.every(Boolean) ? "저장했습니다." : "일부 저장에 실패했습니다.");
    } catch {
      setToast("저장에 실패했습니다.");
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        품목×공정별 일CAPA·생산수율·Lot Size 관리 — 값을 비워두면 공정등록(BASE-04)의
        기본값을 그대로 따릅니다.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4 flex-wrap shadow-sm">
        <div className="relative">
          <label className="text-xs font-medium text-slate-500 block mb-1">품목 선택</label>
          <input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setShowResults(true);
            }}
            onFocus={() => setShowResults(true)}
            placeholder="품목코드 또는 품목명 검색"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-72"
          />
          {showResults && searchResults.length > 0 && (
            <ul className="absolute z-10 mt-1 w-96 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
              {searchResults.map((item) => (
                <li
                  key={item.item_code}
                  className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                  onMouseDown={() => selectItem(item)}
                >
                  <div className="font-medium">{item.item_name}</div>
                  <div className="text-xs text-slate-400 font-mono">{item.item_code}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selectedItem && (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            <span className="font-mono text-xs text-navy">{selectedItem.item_code}</span>
            <span className="text-sm font-medium">{selectedItem.item_name}</span>
            <button
              onClick={() => {
                setSelectedItem(null);
                setRows([]);
                setDrafts({});
              }}
              className="text-xs text-slate-400 hover:text-slate-600 ml-1"
            >
              변경
            </button>
          </div>
        )}
      </div>

      {!selectedItem && (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400 shadow-sm">
          품목을 선택하면 공정별 계획정보를 입력할 수 있습니다.
        </div>
      )}

      {selectedItem && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-auto max-h-[calc(100vh-19rem)]">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
                <tr>
                  <th className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    순서
                  </th>
                  <th className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    공정코드
                  </th>
                  <th className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    공정명
                  </th>
                  <th className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    일CAPA
                  </th>
                  <th className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    생산수율(%)
                  </th>
                  <th className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                    Lot Size
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingRows && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-slate-400">
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!loadingRows &&
                  rows.map((r, i) => {
                    const d = drafts[r.process_code] ?? draftOf(r);
                    const saving = savingCode === r.process_code;
                    const nextCode = rows[i + 1]?.process_code;
                    return (
                      <tr key={r.process_code} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-center text-slate-400">{r.seq}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-navy">
                          {r.process_code}
                        </td>
                        <td className="px-3 py-2.5">{r.process_name}</td>
                        <td className="px-2 py-1.5">
                          <input
                            id={`ip-daily_capa-${r.process_code}`}
                            value={d.daily_capa}
                            onChange={(e) =>
                              setDraft(r.process_code, "daily_capa", e.target.value.replace(/[^0-9.]/g, ""))
                            }
                            onBlur={() => saveRow(r.process_code)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              if (nextCode) focusId(`ip-daily_capa-${nextCode}`);
                            }}
                            disabled={saving}
                            placeholder={
                              r.default_daily_capa != null ? `${r.default_daily_capa} (기본값)` : "-"
                            }
                            className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right font-mono placeholder:text-slate-400 placeholder:italic disabled:opacity-50"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            id={`ip-yield_rate-${r.process_code}`}
                            value={d.yield_rate}
                            onChange={(e) =>
                              setDraft(r.process_code, "yield_rate", e.target.value.replace(/[^0-9.]/g, ""))
                            }
                            onBlur={() => saveRow(r.process_code)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              if (nextCode) focusId(`ip-yield_rate-${nextCode}`);
                            }}
                            disabled={saving}
                            placeholder={
                              r.default_yield_rate != null ? `${r.default_yield_rate} (기본값)` : "-"
                            }
                            className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right font-mono placeholder:text-slate-400 placeholder:italic disabled:opacity-50"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            id={`ip-lot_size-${r.process_code}`}
                            value={d.lot_size}
                            onChange={(e) =>
                              setDraft(r.process_code, "lot_size", e.target.value.replace(/[^0-9.]/g, ""))
                            }
                            onBlur={() => saveRow(r.process_code)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              if (nextCode) focusId(`ip-lot_size-${nextCode}`);
                            }}
                            disabled={saving}
                            placeholder={
                              r.default_lot_size != null ? `${r.default_lot_size} (기본값)` : "-"
                            }
                            className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right font-mono placeholder:text-slate-400 placeholder:italic disabled:opacity-50"
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-xs text-slate-500">
              칸을 비우고 저장하면 공정 기본값을 따릅니다 · 전체 {rows.length.toLocaleString()}개 공정
            </p>
            <button
              onClick={saveAllRows}
              disabled={savingAll || loadingRows}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:bg-navy/90 transition-colors disabled:opacity-40"
            >
              {savingAll ? "저장 중..." : "저장"}
            </button>
          </div>
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

function fmtNum(n: number | null, digits = 0): string {
  if (n == null) return "-";
  return Number(n.toFixed(digits)).toLocaleString("ko-KR");
}

function LineCapaPlanTab() {
  const [yearMonth, setYearMonth] = useTabState("lineCapaYearMonth", currentYearMonth);
  const [result, setResult] = useState<LineCapaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/line-capa-plan?yearMonth=${yearMonth}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: LineCapaResult) => {
        setResult(data);
        setDrafts(
          Object.fromEntries(
            data.rows.map((r) => [r.key, r.dailyCapa != null ? r.dailyCapa.toLocaleString("ko-KR") : ""])
          )
        );
        setRemarkDrafts(Object.fromEntries(data.rows.map((r) => [r.key, r.remark ?? ""])));
        setLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [yearMonth]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  async function saveCapa(lineKey: string) {
    const raw = stripThousands(drafts[lineKey] ?? "");
    const dailyCapa = raw.trim() === "" ? null : Number(raw);
    if (dailyCapa != null && !Number.isFinite(dailyCapa)) {
      setToast("공정별 계획은 숫자여야 합니다.");
      return;
    }
    setSavingKey(`${lineKey}:capa`);
    try {
      const res = await fetch("/api/line-capa-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, lineKey, dailyCapa }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveRemark(lineKey: string) {
    const remark = remarkDrafts[lineKey] ?? "";
    setSavingKey(`${lineKey}:remark`);
    try {
      const res = await fetch("/api/line-capa-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, lineKey, remark }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      load();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  // 칸마다 blur/엔터로도 바로 저장되지만, 여러 칸을 한 번에 입력한 뒤 눌러서 화면에
  // 남아있는 입력값을 통째로 저장 확인할 수 있는 버튼도 따로 둔다(2026-09-13 사용자 요청).
  async function saveAllLineCapa() {
    if (!result) return;
    setSavingAll(true);
    try {
      const results = await Promise.all(
        result.rows.flatMap((r) => {
          const tasks: Promise<boolean>[] = [];
          if (!r.isIndirect) {
            const raw = stripThousands(drafts[r.key] ?? "");
            const dailyCapa = raw.trim() === "" ? null : Number(raw);
            if (dailyCapa == null || Number.isFinite(dailyCapa)) {
              tasks.push(
                fetch("/api/line-capa-plan", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ yearMonth, lineKey: r.key, dailyCapa }),
                }).then((res) => res.ok)
              );
            }
          }
          tasks.push(
            fetch("/api/line-capa-plan", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ yearMonth, lineKey: r.key, remark: remarkDrafts[r.key] ?? "" }),
            }).then((res) => res.ok)
          );
          return tasks;
        })
      );
      load();
      setToast(results.every(Boolean) ? "저장했습니다." : "일부 저장에 실패했습니다.");
    } catch {
      setToast("저장에 실패했습니다.");
    } finally {
      setSavingAll(false);
    }
  }

  const thCls = "text-center px-3 py-2.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]";

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        라인별(BASE-04 세부공정 묶음) 인원(BASE-09 자동 집계)·근무시간(8시간 고정)·근무일수
        (BASE-08 생산캘린더 자동 계산)·생산성(UPH)·운영계획을 조회합니다. &quot;공정별
        계획&quot;(라인별 일CAPA)과 &quot;비고&quot;만 매달 직접 입력하는 값이며, 값을 비운
        채 저장하면 지워집니다. 간접직은 CAPA 개념이 없어 입력할 수 없고, 비고를 비워두면
        소속 인원 자동 집계 텍스트를 대신 보여줍니다.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-medium text-slate-500">조회 기준월</label>
        <input
          type="month"
          value={yearMonth}
          onChange={(e) => e.target.value && setYearMonth(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white"
        />
        <button
          onClick={() => {
            window.location.href = `/api/line-capa-plan/export?yearMonth=${yearMonth}`;
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
        >
          엑셀 다운로드
        </button>
        <button
          onClick={saveAllLineCapa}
          disabled={savingAll || loading}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:bg-navy/90 transition-colors disabled:opacity-40"
        >
          {savingAll ? "저장 중..." : "저장"}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-19rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th rowSpan={2} className={thCls}>
                  라인별
                </th>
                <th rowSpan={2} className={thCls}>
                  인원
                </th>
                <th rowSpan={2} className={thCls}>
                  근무시간
                  <span className="block text-[10px] font-normal text-slate-400">(Day)</span>
                </th>
                <th rowSpan={2} className={thCls}>
                  근무일수
                  <span className="block text-[10px] font-normal text-slate-400">(Month)</span>
                </th>
                <th colSpan={2} className={thCls}>
                  공정별 계획
                </th>
                <th rowSpan={2} className={thCls}>
                  생산성
                  <span className="block text-[10px] font-normal text-slate-400">(UPH)</span>
                </th>
                <th rowSpan={2} className={thCls}>
                  비고
                </th>
              </tr>
              <tr>
                <th className={thCls}>Day</th>
                <th className={thCls}>Month</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading &&
                result?.rows.map((r, i) => {
                  // 사출_상/사출_하는 실제로는 같은 사출(P100) 인원이 담당하는 한 라인이라
                  // 인원·근무시간·근무일수가 항상 동일하다(2026-09-13 사용자 요청) — 사출_상
                  // 행에서 두 행에 걸쳐 병합해 보여주고, 사출_하 행에서는 그 칸들을 생략한다.
                  // "공정별 계획"(일CAPA)은 라인마다 다를 수 있어 병합하지 않고 그대로 둔다.
                  // "생산성(UPH)"도 같은 이유로 병합하되, 두 라인의 일CAPA를 합쳐서 같은
                  // 인원 기준으로 다시 계산한다(2026-09-13 사용자 요청 — 한쪽만 보면 실제
                  // 그 인원이 뽑아내는 총생산성을 알 수 없어서).
                  const mergeStatsDown = r.key === "injection_upper";
                  const skipStatsCells = r.key === "injection_lower";
                  const nextCapaRow = result.rows.slice(i + 1).find((x) => !x.isIndirect);
                  const nextRemarkKey = result.rows[i + 1]?.key;
                  const injectionLowerRow = mergeStatsDown
                    ? result.rows.find((x) => x.key === "injection_lower")
                    : undefined;
                  const mergedInjectionUph = mergeStatsDown
                    ? (() => {
                        const combinedCapa = (r.dailyCapa ?? 0) + (injectionLowerRow?.dailyCapa ?? 0);
                        if (r.dailyCapa == null && injectionLowerRow?.dailyCapa == null) return null;
                        return r.headcount > 0 ? combinedCapa / (r.headcount * r.hoursPerDay) : null;
                      })()
                    : null;
                  return (
                  <tr key={r.key} className="hover:bg-slate-50 border-b border-slate-200">
                    <td className="px-3 py-2.5 font-medium text-slate-700">{r.label}</td>
                    {!skipStatsCells && (
                      <>
                        <td
                          className="px-3 py-2.5 text-right font-mono"
                          rowSpan={mergeStatsDown ? 2 : undefined}
                        >
                          {r.headcount.toLocaleString()} 명
                        </td>
                        <td
                          className="px-3 py-2.5 text-right font-mono"
                          rowSpan={mergeStatsDown ? 2 : undefined}
                        >
                          {r.hoursPerDay.toFixed(2)} hr
                        </td>
                        <td
                          className="px-3 py-2.5 text-right font-mono"
                          rowSpan={mergeStatsDown ? 2 : undefined}
                        >
                          {r.workDays.toLocaleString()} 일
                        </td>
                      </>
                    )}
                    <td className="px-2 py-1.5">
                      {r.isIndirect ? (
                        <span className="block text-right text-slate-300 px-2">-</span>
                      ) : (
                        <input
                          id={`lc-capa-${r.key}`}
                          value={drafts[r.key] ?? ""}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [r.key]: formatThousandsDraft(e.target.value) }))
                          }
                          onBlur={() => saveCapa(r.key)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            if (nextCapaRow) focusId(`lc-capa-${nextCapaRow.key}`);
                          }}
                          disabled={savingKey === `${r.key}:capa`}
                          placeholder="-"
                          className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right font-mono disabled:opacity-50"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-500">{fmtNum(r.monthlyCapa)}</td>
                    {!skipStatsCells && (
                      <td
                        className="px-3 py-2.5 text-right font-mono text-slate-500"
                        rowSpan={mergeStatsDown ? 2 : undefined}
                      >
                        {mergeStatsDown
                          ? mergedInjectionUph == null
                            ? "-"
                            : fmtNum(mergedInjectionUph, 1)
                          : r.uph == null
                            ? "-"
                            : fmtNum(r.uph, 1)}
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <input
                        id={`lc-remark-${r.key}`}
                        value={remarkDrafts[r.key] ?? ""}
                        onChange={(e) =>
                          setRemarkDrafts((prev) => ({ ...prev, [r.key]: e.target.value }))
                        }
                        onBlur={() => saveRemark(r.key)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          if (nextRemarkKey) focusId(`lc-remark-${nextRemarkKey}`);
                        }}
                        disabled={savingKey === `${r.key}:remark`}
                        placeholder={r.defaultRemark ?? "-"}
                        className="w-64 border border-slate-300 rounded-md px-2 py-1.5 text-sm placeholder:text-slate-400 placeholder:italic disabled:opacity-50"
                      />
                    </td>
                  </tr>
                  );
                })}
              {!loading && result && (
                <tr className="bg-slate-50 font-semibold text-navy">
                  <td className="px-3 py-2.5">합계</td>
                  <td className="px-3 py-2.5 text-right font-mono">{result.totals.headcount.toLocaleString()} 명</td>
                  <td className="px-3 py-2.5 text-right font-mono">{(result.rows[0]?.hoursPerDay ?? 8).toFixed(2)} hr</td>
                  <td className="px-3 py-2.5 text-right font-mono">{(result.rows[0]?.workDays ?? 0).toLocaleString()} 일</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtNum(result.totals.dailyCapa)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtNum(result.totals.monthlyCapa)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {result.totals.uph == null ? "-" : fmtNum(result.totals.uph, 2)}
                  </td>
                  <td className="px-3 py-2.5" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
