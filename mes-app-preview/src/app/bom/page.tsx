"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import ItemSearchSelect from "@/components/ItemSearchSelect";
import { useTabState } from "@/lib/use-tab-state";
import { useDraggableModal } from "@/lib/use-draggable-modal";
import type { BomModelLog, BomRow, Item, ItemCategory } from "@/lib/types";

const CATEGORY_BADGE: Record<ItemCategory, string> = {
  완제품: "bg-blue-50 text-blue-700 border-blue-200",
  반제품: "bg-amber-50 text-amber-700 border-amber-200",
  원자재: "bg-slate-100 text-slate-600 border-slate-200",
};

function TreeRows({
  rows,
  depth,
  path,
  collapsed,
  toggle,
}: {
  rows: BomRow[];
  depth: number;
  path: string;
  collapsed: Set<string>;
  toggle: (key: string) => void;
}) {
  return (
    <>
      {rows.map((r) => {
        const key = `${path}>${r.child_item_code}`;
        const hasChildren = r.children.length > 0;
        const isCollapsed = collapsed.has(key);
        return (
          <Fragment key={key}>
            <tr className="hover:bg-slate-50">
              <td className="px-4 py-2 font-mono text-xs text-slate-500">
                <div
                  style={{ paddingLeft: `${depth * 1.25}rem` }}
                  className="flex items-center gap-1.5"
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0"
                    >
                      {isCollapsed ? "+" : "−"}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  {r.child_item_code}
                </div>
              </td>
              <td className="px-4 py-2">
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${CATEGORY_BADGE[r.category]}`}
                >
                  {r.category}
                </span>
              </td>
              <td className="px-4 py-2 font-medium">{r.item_name}</td>
              <td className="px-4 py-2 text-slate-500">{r.spec ?? "-"}</td>
              <td className="px-4 py-2 text-right">
                {r.qty_per.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </td>
              <td className="px-4 py-2 text-slate-400">{r.unit}</td>
            </tr>
            {hasChildren && !isCollapsed && (
              <TreeRows
                rows={r.children}
                depth={depth + 1}
                path={key}
                collapsed={collapsed}
                toggle={toggle}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

export default function BomPage() {
  const [items, setItems] = useState<Item[]>([]);
  // 탭을 전환했다 돌아와도 조회 중이던 품목은 유지되도록 세션 단위로 저장한다.
  const [draftCode, setDraftCode] = useTabState("draftCode", "");
  const [itemCode, setItemCode] = useTabState("itemCode", "");
  const [parent, setParent] = useState<Item | null>(null);
  const [rows, setRows] = useState<BomRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [history, setHistory] = useState<BomModelLog[]>([]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    fetch("/api/items?category=완제품", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Item[]) => setItems(data));
  }, [reloadTick]);

  useEffect(() => {
    fetch("/api/bom/history?limit=10", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: BomModelLog[]) => setHistory(data));
  }, [reloadTick]);

  useEffect(() => {
    if (!itemCode) {
      setParent(null);
      setRows([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/bom?item_code=${encodeURIComponent(itemCode)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { parent: Item | null; rows: BomRow[] }) => {
        if (cancelled) return;
        setParent(data.parent);
        setRows(data.rows);
        setCollapsed(new Set());
        setLoading(false);
        setSearched(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemCode, reloadTick]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function search() {
    if (!draftCode) return;
    setItemCode(draftCode);
  }

  function loadItem(code: string) {
    setDraftCode(code);
    setItemCode(code);
  }

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">BOM정보</h1>
          <p className="text-sm text-slate-500 mt-1">
            BASE-03 · 완제품코드로 다단계 BOM 구조(반제품·원자재)·소요량 조회
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const params = itemCode ? `?item_code=${encodeURIComponent(itemCode)}` : "";
              window.location.href = `/api/bom/export${params}`;
            }}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            엑셀 다운로드
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            엑셀 업로드
          </button>
          <button
            onClick={() => setShowRegister(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
          >
            신규 모델 추가
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2 max-w-md">
        <div
          className="flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
        >
          <ItemSearchSelect
            items={items}
            value={draftCode}
            onChange={setDraftCode}
            placeholder="완제품 코드 또는 품목명 검색"
          />
        </div>
        <button
          onClick={search}
          disabled={!draftCode}
          className="shrink-0 px-4 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          조회
        </button>
      </div>

      {parent && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center gap-3 flex-wrap">
          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border bg-blue-50 text-blue-700 border-blue-200">
            완제품
          </span>
          <span className="font-mono text-xs text-slate-500">{parent.item_code}</span>
          <span className="font-medium">{parent.item_name}</span>
          {parent.spec && <span className="text-sm text-slate-400">{parent.spec}</span>}
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-medium text-slate-600">
            신규 모델 추가 이력
          </div>
          <div className="overflow-x-auto max-h-56 overflow-y-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-[#D9D9D9] text-slate-500 text-xs sticky top-0">
                <tr>
                  <th className="text-center px-3 py-2 font-semibold">일시</th>
                  <th className="text-center px-3 py-2 font-semibold">완제품코드</th>
                  <th className="text-center px-3 py-2 font-semibold">품목명</th>
                  <th className="text-center px-3 py-2 font-semibold">등록방식</th>
                  <th className="text-center px-3 py-2 font-semibold">구성품수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr
                    key={h.id}
                    onClick={() => loadItem(h.item_code)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 text-slate-400">{h.created_at}</td>
                    <td className="px-3 py-2 font-mono text-xs text-navy">{h.item_code}</td>
                    <td className="px-3 py-2 font-medium">{h.item_name}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          h.source === "직접등록"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {h.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{h.child_count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-center px-4 py-3 font-semibold">품목코드</th>
                <th className="text-center px-4 py-3 font-semibold">구분</th>
                <th className="text-center px-4 py-3 font-semibold">품목명</th>
                <th className="text-center px-4 py-3 font-semibold">규격</th>
                <th className="text-center px-4 py-3 font-semibold">소요량</th>
                <th className="text-center px-4 py-3 font-semibold">단위</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!itemCode && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    완제품을 검색해 선택한 뒤 조회 버튼을 눌러주세요.
                  </td>
                </tr>
              )}
              {itemCode && loading && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {itemCode && !loading && searched && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    데이터 없음
                  </td>
                </tr>
              )}
              {!loading && itemCode && (
                <TreeRows
                  rows={rows}
                  depth={0}
                  path={itemCode}
                  collapsed={collapsed}
                  toggle={toggle}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showUpload && (
        <BomUploadModal
          onClose={() => setShowUpload(false)}
          onImported={(msg) => {
            setShowUpload(false);
            setToast(msg);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {showRegister && (
        <BomRegisterModal
          parentItems={items}
          onClose={() => setShowRegister(false)}
          onSaved={(code, msg) => {
            setShowRegister(false);
            setToast(msg);
            setDraftCode(code);
            setItemCode(code);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function BomUploadModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (msg: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useDraggableModal();

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/bom/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "업로드에 실패했습니다.");
      return;
    }
    onImported(
      `업로드 완료 — 신규 ${data.inserted.toLocaleString()}건, 갱신 ${data.updated.toLocaleString()}건` +
        (data.registeredItems > 0 ? `, 신규 품목 등록 ${data.registeredItems.toLocaleString()}건` : "") +
        (data.skipped > 0 ? `, 건너뜀 ${data.skipped.toLocaleString()}건` : "")
    );
  };

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 cursor-move"
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
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-500">
            &quot;엑셀 다운로드&quot;와 같은 형식(상위품목코드/상위품목명/하위품목코드/하위품목명/
            하위구분/규격/소요량/단위)의 첫 시트를 읽습니다. 상위품목코드는 필수이며 없는
            품목은 완제품으로, 하위품목코드가 없으면 하위구분 기준(반제품/그 외 원자재)으로
            자동 등록됩니다. 같은 상위·하위 조합은 소요량을 덮어씁니다.
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
              disabled={busy}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={busy || !file}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {busy ? "업로드 중..." : "업로드"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type ChildRow = {
  key: number;
  code: string;
  name: string;
  category: ItemCategory | null;
  qty: string;
  unit: string;
  query: string;
  results: Item[];
  showResults: boolean;
};

let childRowSeq = 0;
function emptyChildRow(): ChildRow {
  childRowSeq += 1;
  return {
    key: childRowSeq,
    code: "",
    name: "",
    category: null,
    qty: "",
    unit: "",
    query: "",
    results: [],
    showResults: false,
  };
}

function BomRegisterModal({
  parentItems,
  onClose,
  onSaved,
}: {
  parentItems: Item[];
  onClose: () => void;
  onSaved: (parentCode: string, msg: string) => void;
}) {
  const [parentCode, setParentCode] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentSpec, setParentSpec] = useState("");
  const [parentUnit, setParentUnit] = useState("EA");
  const [childRows, setChildRows] = useState<ChildRow[]>([emptyChildRow(), emptyChildRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useDraggableModal();

  const matchedParent = useMemo(
    () => parentItems.find((i) => i.item_code === parentCode.trim()),
    [parentItems, parentCode]
  );
  const isNewParent = parentCode.trim().length > 0 && !matchedParent;

  useEffect(() => {
    if (matchedParent) {
      setParentName(matchedParent.item_name);
      setParentSpec(matchedParent.spec ?? "");
      setParentUnit(matchedParent.unit);
    }
  }, [matchedParent]);

  function updateRow(key: number, patch: Partial<ChildRow>) {
    setChildRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function searchChild(key: number, query: string) {
    updateRow(key, { query, showResults: true });
    if (!query.trim()) {
      updateRow(key, { results: [] });
      return;
    }
    const params = new URLSearchParams({
      page: "1",
      pageSize: "20",
      search: query.trim(),
      cats: "반제품,원자재",
    });
    fetch(`/api/items?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { rows: Item[] }) => updateRow(key, { results: data.rows }));
  }

  function pickChild(key: number, item: Item) {
    updateRow(key, {
      code: item.item_code,
      name: item.item_name,
      category: item.category,
      unit: item.unit,
      query: "",
      results: [],
      showResults: false,
    });
  }

  async function save() {
    setError(null);
    const parentCodeTrim = parentCode.trim();
    if (!parentCodeTrim) {
      setError("완제품코드는 필수입니다.");
      return;
    }
    if (isNewParent && !parentName.trim()) {
      setError("신규 완제품은 품목명이 필수입니다.");
      return;
    }
    const rows = childRows
      .filter((r) => r.code)
      .map((r) => ({ child_item_code: r.code, qty_per: r.qty, unit: r.unit || null }));
    if (rows.length === 0) {
      setError("구성품을 1건 이상 입력해주세요.");
      return;
    }
    for (const r of rows) {
      if (!r.qty_per || Number(r.qty_per) <= 0) {
        setError(`${r.child_item_code}의 소요량을 입력해주세요.`);
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/bom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent: {
            item_code: parentCodeTrim,
            item_name: parentName.trim(),
            spec: parentSpec || null,
            unit: parentUnit || "EA",
          },
          rows,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      onSaved(
        parentCodeTrim,
        `${parentCodeTrim} 저장 완료 — 구성품 신규 ${data.inserted}건, 갱신 ${data.updated}건`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={drag.style}>
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move"
          onMouseDown={drag.onMouseDown}
        >
          <h2 className="text-base font-bold text-navy">신규 모델 추가</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">완제품</p>
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="block text-sm flex-1 min-w-[10rem]">
                  <span className="text-slate-600">
                    완제품코드 <span className="text-rose-600">*</span>
                  </span>
                  <input
                    value={parentCode}
                    onChange={(e) => setParentCode(e.target.value)}
                    placeholder="기존 코드면 자동으로 정보를 채웁니다"
                    className={`${inputCls} font-mono`}
                  />
                </label>
                {parentCode.trim() && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border font-medium mt-5 ${
                      matchedParent
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {matchedParent ? "기존 완제품" : "신규 등록"}
                  </span>
                )}
              </div>
              <label className="block text-sm">
                <span className="text-slate-600">
                  품목명 {isNewParent && <span className="text-rose-600">*</span>}
                </span>
                <input
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  disabled={!!matchedParent}
                  className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-400`}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-600">규격</span>
                  <input
                    value={parentSpec}
                    onChange={(e) => setParentSpec(e.target.value)}
                    disabled={!!matchedParent}
                    className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-400`}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">단위</span>
                  <input
                    value={parentUnit}
                    onChange={(e) => setParentUnit(e.target.value)}
                    disabled={!!matchedParent}
                    className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-400`}
                  />
                </label>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700">구성품(BOM)</p>
              <button
                type="button"
                onClick={() => setChildRows((prev) => [...prev, emptyChildRow()])}
                className="text-xs font-medium text-navy hover:underline"
              >
                + 행 추가
              </button>
            </div>
            <div className="space-y-2">
              {childRows.map((row) => (
                <div key={row.key} className="flex items-start gap-2">
                  <div className="relative flex-1">
                    <input
                      value={row.code ? `${row.code} · ${row.name}` : row.query}
                      onChange={(e) => {
                        if (row.code) updateRow(row.key, { code: "", name: "", category: null });
                        searchChild(row.key, e.target.value);
                      }}
                      onFocus={() => updateRow(row.key, { showResults: true })}
                      onBlur={() => setTimeout(() => updateRow(row.key, { showResults: false }), 150)}
                      placeholder="반제품/원자재 코드 또는 품명 검색"
                      className={`${inputCls} mt-0`}
                    />
                    {row.showResults && row.query.trim() && (
                      <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
                        {row.results.length === 0 && (
                          <li className="px-3 py-2 text-sm text-slate-400">검색 결과가 없습니다.</li>
                        )}
                        {row.results.map((it) => (
                          <li
                            key={it.item_code}
                            className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                            onMouseDown={() => pickChild(row.key, it)}
                          >
                            <div className="font-medium">
                              {it.item_name}{" "}
                              <span className="text-xs text-slate-400">({it.category})</span>
                            </div>
                            <div className="text-xs text-slate-400 font-mono">{it.item_code}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <input
                    value={row.qty}
                    onChange={(e) =>
                      updateRow(row.key, { qty: e.target.value.replace(/[^0-9.]/g, "") })
                    }
                    placeholder="소요량"
                    className="w-24 border border-slate-300 rounded-md px-2.5 py-2 text-sm text-right"
                  />
                  <input
                    value={row.unit}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                    placeholder="단위"
                    className="w-16 border border-slate-300 rounded-md px-2.5 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setChildRows((prev) => prev.filter((r) => r.key !== row.key))}
                    disabled={childRows.length <= 1}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md border border-slate-300 text-slate-400 hover:text-rose-600 hover:border-rose-300 disabled:opacity-30"
                    aria-label="행 삭제"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              구성품은 기존에 등록된 품목만 선택할 수 있습니다. 아직 없는 자재/반제품은
              자재등록(BASE-02)·제품등록(BASE-01)에서 먼저 등록해주세요.
            </p>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
            >
              취소
            </button>
            <button
              onClick={save}
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
