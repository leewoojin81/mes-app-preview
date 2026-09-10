"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import type { ItemProcessRoutingRow } from "@/lib/types";

interface ItemHit {
  item_code: string;
  item_name: string;
}

type Draft = { daily_capa: string; yield_rate: string; lot_size: string };

function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function draftOf(r: ItemProcessRoutingRow): Draft {
  return {
    daily_capa: r.daily_capa != null ? String(r.daily_capa) : "",
    yield_rate: r.yield_rate != null ? String(r.yield_rate) : "",
    lot_size: r.lot_size != null ? String(r.lot_size) : "",
  };
}

export default function PlanInfoPage() {
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

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">계획정보</h1>
        <p className="text-sm text-slate-500 mt-1">
          PLAN-02 · 품목×공정별 일CAPA·생산수율·Lot Size 관리 — 값을 비워두면 공정등록(BASE-04)의
          기본값을 그대로 따릅니다.
        </p>
      </div>

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
                  rows.map((r) => {
                    const d = drafts[r.process_code] ?? draftOf(r);
                    const saving = savingCode === r.process_code;
                    return (
                      <tr key={r.process_code} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-center text-slate-400">{r.seq}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-navy">
                          {r.process_code}
                        </td>
                        <td className="px-3 py-2.5">{r.process_name}</td>
                        <td className="px-2 py-1.5">
                          <input
                            value={d.daily_capa}
                            onChange={(e) =>
                              setDraft(r.process_code, "daily_capa", e.target.value.replace(/[^0-9.]/g, ""))
                            }
                            onBlur={() => saveRow(r.process_code)}
                            disabled={saving}
                            placeholder={
                              r.default_daily_capa != null ? `${r.default_daily_capa} (기본값)` : "-"
                            }
                            className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right font-mono placeholder:text-slate-400 placeholder:italic disabled:opacity-50"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={d.yield_rate}
                            onChange={(e) =>
                              setDraft(r.process_code, "yield_rate", e.target.value.replace(/[^0-9.]/g, ""))
                            }
                            onBlur={() => saveRow(r.process_code)}
                            disabled={saving}
                            placeholder={
                              r.default_yield_rate != null ? `${r.default_yield_rate} (기본값)` : "-"
                            }
                            className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right font-mono placeholder:text-slate-400 placeholder:italic disabled:opacity-50"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={d.lot_size}
                            onChange={(e) =>
                              setDraft(r.process_code, "lot_size", e.target.value.replace(/[^0-9.]/g, ""))
                            }
                            onBlur={() => saveRow(r.process_code)}
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
