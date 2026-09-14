"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type { MasterDataChangeHistoryRow } from "@/lib/types";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

interface HistoryResponse {
  rows: MasterDataChangeHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  entityTypes: readonly string[];
  fields: { key: string; label: string }[];
  changedByOptions: { value: string; label: string }[];
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}
function firstDayOfMonth(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

// 사용여부(use_yn)는 원본이 "Y"/"N"이라 그대로 노출하면 못 알아보므로 표시할 때만
// "사용"/"중단"으로 바꾼다(저장값 자체는 안 바꿈, 다른 화면의 use_yn 배지와 동일한 관례).
function fmtValue(field: string, v: string | null): string {
  if (v == null || v === "") return "-";
  if (field === "use_yn") return v === "Y" ? "사용" : v === "N" ? "중단" : v;
  return v;
}

export default function MasterDataChangeHistoryPage() {
  const [rows, setRows] = useState<MasterDataChangeHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [entityTypes, setEntityTypes] = useState<readonly string[]>([]);
  const [fields, setFields] = useState<{ key: string; label: string }[]>([]);
  const [changedByOptions, setChangedByOptions] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [page, setPage] = useTabState("mdchPage", 1);
  const [pageSize, setPageSize] = useTabState("mdchPageSize", 50);

  const [entityType, setEntityType] = useTabState("mdchEntityType", "");
  const [entityId, setEntityId] = useTabState("mdchEntityId", "");
  const [entityName, setEntityName] = useTabState("mdchEntityName", "");
  const [field, setField] = useTabState("mdchField", "");
  const [oldValue, setOldValue] = useTabState("mdchOldValue", "");
  const [newValue, setNewValue] = useTabState("mdchNewValue", "");
  const [dateFrom, setDateFrom] = useTabState("mdchDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("mdchDateTo", today);
  const [changedBy, setChangedBy] = useTabState("mdchChangedBy", "");

  function buildParams() {
    const params = new URLSearchParams();
    if (entityType) params.set("entityType", entityType);
    if (entityId.trim()) params.set("entityId", entityId.trim());
    if (entityName.trim()) params.set("entityName", entityName.trim());
    if (field) params.set("field", field);
    if (oldValue.trim()) params.set("oldValue", oldValue.trim());
    if (newValue.trim()) params.set("newValue", newValue.trim());
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (changedBy) params.set("changedBy", changedBy);
    return params;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = buildParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    fetch(`/api/master-data-change-history?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: HistoryResponse) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setEntityTypes(data.entityTypes);
        setFields(data.fields);
        setChangedByOptions(data.changedByOptions);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, entityType, entityId, entityName, field, oldValue, newValue, dateFrom, dateTo, changedBy]);

  // 대상유형을 바꾸면 그 유형에 없는 변경항목이 선택된 채로 남을 수 있어 같이 비운다.
  function changeEntityType(v: string) {
    setEntityType(v);
    setField("");
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  const hasFilter =
    entityType ||
    entityId ||
    entityName ||
    field ||
    oldValue ||
    newValue ||
    changedBy ||
    dateFrom !== firstDayOfMonth() ||
    dateTo !== today();

  function resetFilters() {
    setEntityType("");
    setEntityId("");
    setEntityName("");
    setField("");
    setOldValue("");
    setNewValue("");
    setDateFrom(firstDayOfMonth());
    setDateTo(today());
    setChangedBy("");
    setPage(1);
  }

  const selectCls = "border rounded-md px-2.5 py-2 text-sm bg-white border-slate-300 text-slate-600";

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">기준정보 변경이력</h1>
        <p className="text-sm text-slate-500 mt-1">
          BASE-10 · 작업자정보(BASE-09)를 비롯한 기준정보 화면들의 필드 변경 이력을 한
          화면에서 조회합니다(조회 전용, 직접 입력하지 않습니다). 지금은
          작업자정보(공정/근무조/교대조/직무/도급사/사용여부)만 연결돼 있고, 품목·자재·BOM
          등 다른 기준정보는 순차적으로 추가될 예정입니다.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={entityType}
          onChange={(e) => changeEntityType(e.target.value)}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            entityType ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">대상유형 전체</option>
          {entityTypes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <input
          value={entityId}
          onChange={(e) => {
            setEntityId(e.target.value);
            setPage(1);
          }}
          placeholder="대상ID (사번 등)"
          className="border border-slate-300 rounded-md px-2.5 py-2 text-sm w-32"
        />
        <input
          value={entityName}
          onChange={(e) => {
            setEntityName(e.target.value);
            setPage(1);
          }}
          placeholder="대상명 (성명 등)"
          className="border border-slate-300 rounded-md px-2.5 py-2 text-sm w-28"
        />
        <select
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setPage(1);
          }}
          className={selectCls}
        >
          <option value="">변경항목 전체</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          value={oldValue}
          onChange={(e) => {
            setOldValue(e.target.value);
            setPage(1);
          }}
          placeholder="기존값"
          className="border border-slate-300 rounded-md px-2.5 py-2 text-sm w-24"
        />
        <input
          value={newValue}
          onChange={(e) => {
            setNewValue(e.target.value);
            setPage(1);
          }}
          placeholder="신규값"
          className="border border-slate-300 rounded-md px-2.5 py-2 text-sm w-24"
        />
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">변경일자</label>
          <DateSegmentInput
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v);
              setPage(1);
            }}
          />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput
            value={dateTo}
            onChange={(v) => {
              setDateTo(v);
              setPage(1);
            }}
          />
        </div>
        <select
          value={changedBy}
          onChange={(e) => {
            setChangedBy(e.target.value);
            setPage(1);
          }}
          className={selectCls}
        >
          <option value="">변경자 전체</option>
          {changedByOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={resetFilters}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            필터 초기화
          </button>
        )}
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className={selectCls}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}건씩
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-19rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["대상유형", "대상ID", "대상명", "변경항목", "기존값", "신규값", "변경일자", "변경자", "등록일시"].map(
                  (label) => (
                    <th
                      key={label}
                      className="text-center px-3 py-3 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]"
                    >
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    조건에 맞는 변경이력이 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-navy/10 text-navy">
                        {r.entity_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500">{r.entity_id}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{r.entity_name ?? "-"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                        {r.field_label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{fmtValue(r.field, r.old_value)}</td>
                    <td className="px-3 py-2 font-semibold text-navy">{fmtValue(r.field, r.new_value)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.change_date}</td>
                    <td className="px-3 py-2 text-slate-500">{r.changed_by_name ?? r.changed_by ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{r.created_at}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500">
            전체 {total.toLocaleString()}건 중 {rangeStart.toLocaleString()}-
            {rangeEnd.toLocaleString()}건 표시
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300"
            >
              이전
            </button>
            <span className="text-sm text-slate-600">
              {page.toLocaleString()} / {totalPages.toLocaleString()}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-md text-sm border border-slate-300 bg-white hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300"
            >
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
