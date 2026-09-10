"use client";

import { useEffect, useRef, useState } from "react";
import type { Item, ItemCategory, ItemListResponse } from "@/lib/types";
import { useTabState } from "@/lib/use-tab-state";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

// 사용여부(use_yn) 필터: 화면 라벨 → API use 파라미터 값
const USE_TABS = [
  { label: "전체", value: "" },
  { label: "사용", value: "Y" },
  { label: "중단", value: "N" },
] as const;

// 원본 엑셀 컬럼(detail JSON) 기반 필터 — param은 /api/items 쿼리 파라미터명
const DETAIL_FILTERS = [
  { param: "acct", label: "품목계정" },
  { param: "cat1", label: "대분류" },
  { param: "cat2", label: "중분류" },
  { param: "cat3", label: "소분류" },
] as const;
type FilterParam = (typeof DETAIL_FILTERS)[number]["param"];
type FilterState = Record<FilterParam, string>;
const EMPTY_FILTERS: FilterState = { acct: "", cat1: "", cat2: "", cat3: "" };

// "품목 추가" 모달의 입력 필드 정의. key는 원본 엑셀 컬럼명(detail JSON 키)과 동일.
type ItemFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  section: string;
  placeholder?: string;
  /** 기존 데이터에 있는 값을 자동완성 제안으로 보여줄 필터 파라미터(acct/cat1/cat2/cat3) */
  autocomplete?: FilterParam;
};

// 자재등록(원자재) 기본 폼.
// 분류(category)는 화면 탭 기준으로 항상 "원자재"지만, 원본 엑셀의 품목계정은
// 그 안에서도 부자재(98.8%)/원자재(1.2%)로 나뉘어 있어 별도 입력이 필요하다.
const BASIC_ITEM_FIELDS: ItemFieldDef[] = [
  {
    key: "품목계정",
    label: "품목계정",
    type: "select",
    options: ["부자재", "원자재"],
    section: "기본정보",
  },
  { key: "규격", label: "규격", type: "text", section: "기본정보" },
  { key: "단위", label: "단위", type: "text", section: "기본정보" },
  { key: "입고창고", label: "입고창고", type: "text", section: "기본정보" },
  { key: "안전재고", label: "안전재고", type: "number", section: "기본정보" },
  {
    key: "사용여부",
    label: "사용여부",
    type: "select",
    options: ["Y", "N"],
    section: "기본정보",
  },
];

// 완제품 도수(diopter) 접미사 — 실제 데이터에 존재하는 "대표코드-도수" 4자리 값 전체.
// 표준 세트는 그중 가장 흔한 조합(구면 렌즈 0.00~8.00D)으로, 팝업에서 기본 추천으로 쓴다.
const ALL_DIOPTERS = [
  "0000", "0025", "0050", "0075", "0100", "0125", "0150", "0175",
  "0200", "0225", "0250", "0275", "0300", "0325", "0350", "0375",
  "0400", "0425", "0450", "0475", "0500", "0525", "0550", "0575",
  "0600", "0650", "0700", "0750", "0800", "0850", "0900", "0950",
  "1000", "1100", "1150", "1200",
];
const STANDARD_DIOPTERS = [
  "0000", "0100", "0125", "0150", "0175", "0200", "0225", "0250",
  "0275", "0300", "0325", "0350", "0375", "0400", "0425", "0450",
  "0475", "0500", "0550", "0600", "0650", "0700", "0750", "0800",
];

// 제품등록(완제품/반제품) 전체 폼 — 원본 엑셀 62컬럼 중 No.(자동)·품목코드·품명을
// 제외한 나머지 61개 항목 전부 입력 가능하게 구성.
const FULL_ITEM_FIELDS: ItemFieldDef[] = [
  // 분류체계
  { key: "품목군", label: "품목군", type: "text", section: "분류체계" },
  {
    key: "품목계정",
    label: "품목계정",
    type: "text",
    section: "분류체계",
    autocomplete: "acct",
  },
  {
    key: "대분류",
    label: "대분류",
    type: "text",
    section: "분류체계",
    autocomplete: "cat1",
  },
  {
    key: "중분류",
    label: "중분류",
    type: "text",
    section: "분류체계",
    autocomplete: "cat2",
  },
  {
    key: "소분류",
    label: "소분류",
    type: "text",
    section: "분류체계",
    autocomplete: "cat3",
  },
  // 기본정보
  { key: "규격", label: "규격", type: "text", section: "기본정보" },
  { key: "단위", label: "단위", type: "text", section: "기본정보" },
  {
    key: "사용여부",
    label: "사용여부",
    type: "select",
    options: ["Y", "N"],
    section: "기본정보",
  },
  {
    key: "등록일자",
    label: "등록일자",
    type: "text",
    section: "기본정보",
    placeholder: "예: 2026.08.12 (비우면 오늘 날짜)",
  },
  // 창고/보관
  { key: "입고창고", label: "입고창고", type: "text", section: "창고/보관" },
  { key: "불출창고", label: "불출창고", type: "text", section: "창고/보관" },
  { key: "보관위치", label: "보관위치", type: "text", section: "창고/보관" },
  // 조달/구매
  { key: "조달구분", label: "조달구분", type: "text", section: "조달/구매" },
  { key: "코드", label: "코드", type: "text", section: "조달/구매" },
  { key: "거래처명", label: "거래처명", type: "text", section: "조달/구매" },
  { key: "매입구분", label: "매입구분", type: "text", section: "조달/구매" },
  { key: "발주담당자", label: "발주담당자", type: "text", section: "조달/구매" },
  { key: "입고담당자", label: "입고담당자", type: "text", section: "조달/구매" },
  { key: "출고담당자", label: "출고담당자", type: "text", section: "조달/구매" },
  // 포장
  { key: "포장단위", label: "포장단위", type: "text", section: "포장" },
  { key: "포장단위수량", label: "포장단위수량", type: "number", section: "포장" },
  { key: "단중", label: "단중", type: "number", section: "포장" },
  { key: "포장방법", label: "포장방법", type: "text", section: "포장" },
  { key: "1 Box 수량", label: "1 Box 수량", type: "number", section: "포장" },
  { key: "2 Box 수량", label: "2 Box 수량", type: "number", section: "포장" },
  { key: "실링단위수량", label: "실링단위수량", type: "number", section: "포장" },
  { key: "포장액", label: "포장액", type: "text", section: "포장" },
  // 생산/작업장
  { key: "작업장구분", label: "작업장구분", type: "text", section: "생산/작업장" },
  { key: "라인/설비", label: "라인/설비", type: "text", section: "생산/작업장" },
  { key: "T/T", label: "T/T", type: "number", section: "생산/작업장" },
  { key: "표준시간", label: "표준시간", type: "number", section: "생산/작업장" },
  { key: "금형코드", label: "금형코드", type: "text", section: "생산/작업장" },
  // 재고/발주정책
  { key: "안전재고", label: "안전재고", type: "number", section: "재고/발주정책" },
  { key: "안전재고일수", label: "안전재고일수", type: "number", section: "재고/발주정책" },
  { key: "발주정책", label: "발주정책", type: "text", section: "재고/발주정책" },
  { key: "발주정책값", label: "발주정책값", type: "number", section: "재고/발주정책" },
  { key: "제조L/T", label: "제조L/T", type: "number", section: "재고/발주정책" },
  { key: "최소생산량", label: "최소생산량", type: "number", section: "재고/발주정책" },
  { key: "최소발주량", label: "최소발주량", type: "number", section: "재고/발주정책" },
  { key: "오더생성방법", label: "오더생성방법", type: "text", section: "재고/발주정책" },
  { key: "출고방침", label: "출고방침", type: "text", section: "재고/발주정책" },
  // 검사/품질
  { key: "검사수준", label: "검사수준", type: "text", section: "검사/품질" },
  { key: "검사방법", label: "검사방법", type: "text", section: "검사/품질" },
  { key: "품질담당자", label: "품질담당자", type: "text", section: "검사/품질" },
  {
    key: "Bom구성",
    label: "Bom구성",
    type: "select",
    options: ["Y", "N"],
    section: "검사/품질",
  },
  // 렌즈 속성
  { key: "DIA(직경)", label: "DIA(직경)", type: "number", section: "렌즈 속성" },
  { key: "캡(실링지)", label: "캡(실링지)", type: "text", section: "렌즈 속성" },
  { key: "tone", label: "tone", type: "text", section: "렌즈 속성" },
  { key: "B.C", label: "B.C", type: "number", section: "렌즈 속성" },
  { key: "형명", label: "형명", type: "text", section: "렌즈 속성" },
  { key: "고객사", label: "고객사", type: "text", section: "렌즈 속성" },
  { key: "고객사명", label: "고객사명", type: "text", section: "렌즈 속성" },
  { key: "렌즈구분", label: "렌즈구분", type: "text", section: "렌즈 속성" },
  { key: "주기", label: "주기", type: "text", section: "렌즈 속성" },
  { key: "Radius", label: "Radius", type: "number", section: "렌즈 속성" },
  { key: "고객사품목코드", label: "고객사품목코드", type: "text", section: "렌즈 속성" },
  { key: "UDI 품목코드", label: "UDI 품목코드", type: "text", section: "렌즈 속성" },
  { key: "JAN 코드", label: "JAN 코드", type: "text", section: "렌즈 속성" },
  {
    key: "G.DIA(그래픽직경)",
    label: "G.DIA(그래픽직경)",
    type: "number",
    section: "렌즈 속성",
  },
];

// 제품등록(완제품/반제품)과 자재등록(원자재)이 공유하는 기준정보 마스터 화면.
// categories 로 화면이 다루는 분류 범위를 제한한다.
export default function ItemMasterView({
  title,
  code,
  categories,
  showRepFilter = false,
  fullItemForm = false,
  defaultPageSize = 50,
}: {
  title: string;
  code: string;
  categories: ItemCategory[];
  /** "대표품목" 체크박스(품목코드 "00000-000" 형태) 노출 여부 */
  showRepFilter?: boolean;
  /** "품목 추가" 모달에서 원본 엑셀 61개 컬럼을 전부 입력받을지 여부 */
  fullItemForm?: boolean;
  /** 목록 페이지당 건수 초기값 (PAGE_SIZE_OPTIONS 중 하나) */
  defaultPageSize?: number;
}) {
  // 탭을 전환했다 돌아와도 검색어/페이지/필터는 유지되도록 세션 단위로 저장한다
  // (조회 결과 자체는 항상 새로 받아오므로 rows/total/loading은 대상에서 제외).
  const [searchInput, setSearchInput] = useTabState("searchInput", "");
  const [search, setSearch] = useTabState("search", "");
  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", defaultPageSize);
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [useFilter, setUseFilter] = useTabState<"" | "Y" | "N">("useFilter", "");
  const [repOnly, setRepOnly] = useTabState("repOnly", false);
  const [filters, setFilters] = useTabState<FilterState>("filters", EMPTY_FILTERS);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  // 등록/업로드 후 목록·필터 옵션 재조회 트리거
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterOptions, setFilterOptions] = useState<Record<FilterParam, string[]>>({
    acct: [],
    cat1: [],
    cat2: [],
    cat3: [],
  });

  // 화면 범위(categories)를 쿼리 파라미터로 변환 — 상단 탭에서 분류 선택은
  // 없애고 품목계정 드롭다운으로 대체했으므로 화면은 항상 categories 전체를 조회
  const applyScope = (params: URLSearchParams) => {
    params.set("cats", categories.join(","));
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch, setPage]);

  // 드롭다운 옵션: 현재 조건에서 실제 존재하는 값만 서버에서 조회 (faceted)
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    applyScope(params);
    if (search) params.set("search", search);
    if (useFilter) params.set("use", useFilter);
    if (repOnly) params.set("rep", "1");
    for (const f of DETAIL_FILTERS) {
      if (filters[f.param]) params.set(f.param, filters[f.param]);
    }
    fetch(`/api/items/filters?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Record<FilterParam, string[]>) => {
        if (!cancelled) setFilterOptions(data);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, useFilter, repOnly, filters, refreshKey]);

  const onFilterChange = (param: FilterParam, value: string) => {
    setFilters((prev) => {
      const next = { ...prev, [param]: value };
      // 상위 분류를 바꾸면 하위 분류 선택은 초기화
      if (param === "cat1") {
        next.cat2 = "";
        next.cat3 = "";
      } else if (param === "cat2") {
        next.cat3 = "";
      }
      return next;
    });
    setPage(1);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    applyScope(params);
    if (search) params.set("search", search);
    if (useFilter) params.set("use", useFilter);
    if (repOnly) params.set("rep", "1");
    for (const f of DETAIL_FILTERS) {
      if (filters[f.param]) params.set(f.param, filters[f.param]);
    }

    fetch(`/api/items?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ItemListResponse) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page, pageSize, useFilter, repOnly, filters, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  // 원본 엑셀 컬럼(완제품/반제품 62개, 원부자재 38개)을 첫 등장 순서대로 합집합
  const detailCols: string[] = [];
  for (const r of rows) {
    if (!r.detail) continue;
    for (const key of Object.keys(r.detail)) {
      if (!detailCols.includes(key)) detailCols.push(key);
    }
  }

  const defaultModalCategory = categories[0];

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-navy">{title}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {code} · {categories.join("/")} 기준정보 조회 · 원본 엑셀 전체 컬럼 표시
        </p>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {/* 사용여부 필터 — 분류 구분은 품목계정 드롭다운으로 대체 */}
          {USE_TABS.map((tab) => (
            <button
              key={tab.label}
              onClick={() => {
                setUseFilter(tab.value);
                setPage(1);
              }}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                useFilter === tab.value
                  ? tab.value === "N"
                    ? "bg-rose-700 text-white border-rose-700"
                    : "bg-navy text-white border-navy"
                  : "bg-white text-slate-600 border-slate-300 hover:border-navy"
              }`}
            >
              {tab.label}
            </button>
          ))}
          {showRepFilter && (
            <>
              <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border border-slate-300 bg-white text-slate-600 cursor-pointer select-none has-[:checked]:bg-navy has-[:checked]:text-white has-[:checked]:border-navy">
                <input
                  type="checkbox"
                  checked={repOnly}
                  onChange={(e) => {
                    setRepOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="accent-navy"
                />
                대표품목
              </label>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {DETAIL_FILTERS.map((f) => (
            <select
              key={f.param}
              value={filters[f.param]}
              onChange={(e) => onFilterChange(f.param, e.target.value)}
              className={`border rounded-md px-2.5 py-2 text-sm bg-white max-w-44 truncate ${
                filters[f.param]
                  ? "border-navy text-navy font-medium"
                  : "border-slate-300 text-slate-600"
              }`}
            >
              <option value="">{f.label} 전체</option>
              {filterOptions[f.param].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ))}
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="품목코드 · 품목명 · 품목군 검색"
            className="border border-slate-300 rounded-md px-3 py-2 text-sm w-64"
          />
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white text-slate-600"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}건씩
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              applyScope(params);
              if (search) params.set("search", search);
              if (useFilter) params.set("use", useFilter);
              if (repOnly) params.set("rep", "1");
              for (const f of DETAIL_FILTERS) {
                if (filters[f.param]) params.set(f.param, filters[f.param]);
              }
              window.location.href = `/api/items/export?${params.toString()}`;
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
            onClick={() => setShowAdd(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
          >
            품목 추가
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        {/* 엑셀 틀 고정: 세로 스크롤을 이 컨테이너 안으로 한정해야 sticky 헤더가 동작 */}
        <div className="overflow-auto max-h-[calc(100vh-13.5rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-3 py-3 font-semibold sticky left-0 top-0 z-30 bg-[#D9D9D9] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0]">
                  분류
                </th>
                {detailCols.map((col) => (
                  <th
                    key={col}
                    className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td
                    colSpan={detailCols.length + 1}
                    className="text-center py-10 text-slate-400"
                  >
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={detailCols.length + 1}
                    className="text-center py-10 text-slate-400"
                  >
                    조회된 품목이 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, rowIdx) => {
                  // 분류 배지: 원자재는 category가 항상 "원자재"라 정보가 없으므로
                  // 실제 세분류인 품목계정(부자재/원자재)을 대신 표시한다.
                  // 완제품/반제품은 품목계정이 category와 항상 일치해 결과가 같다.
                  const badge = String(r.detail?.["품목계정"] ?? r.category);
                  return (
                  <tr key={r.item_code} className="hover:bg-slate-50 group">
                    <td className="px-3 py-2.5 sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          badge === "완제품"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : badge === "반제품"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : badge === "부자재"
                                ? "bg-violet-50 text-violet-700 border-violet-200"
                                : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {badge}
                      </span>
                    </td>
                    {detailCols.map((col) => {
                      // 정렬은 원본 엑셀 순서(seq_no)를 따르되, No.는 현재 조회
                      // 결과(필터/검색 반영) 기준 1부터 다시 매긴 표시 순번을 보여준다.
                      const v = col === "No." ? rangeStart + rowIdx : r.detail?.[col];
                      const isCode = col === "품목코드";
                      const isName = col === "품명";
                      return (
                        <td
                          key={col}
                          title={v == null ? undefined : String(v)}
                          className={`px-3 py-2.5 max-w-64 truncate ${
                            isCode
                              ? "font-mono text-xs text-slate-500"
                              : isName
                                ? "font-medium"
                                : typeof v === "number"
                                  ? "text-right text-slate-500 font-mono text-xs"
                                  : "text-slate-500"
                          }`}
                        >
                          {v == null || v === ""
                            ? "-"
                            : typeof v === "number"
                              ? v.toLocaleString()
                              : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
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

      {showUpload && (
        <UploadModal
          categories={categories}
          onClose={() => setShowUpload(false)}
          onImported={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {showAdd && (
        <AddItemModal
          categories={categories}
          defaultCategory={defaultModalCategory}
          fields={fullItemForm ? FULL_ITEM_FIELDS : BASIC_ITEM_FIELDS}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

// 모달 제목줄을 마우스로 눌러 끄는 동안 이동시키는 드래그 훅.
// 위치는 화면 중앙 기준 오프셋(translate)으로 관리해 최초 위치는 항상 중앙에서 시작한다.
function useDraggable() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );

  const onHandleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      setPos({
        x: drag.current.origX + (ev.clientX - drag.current.startX),
        y: drag.current.origY + (ev.clientY - drag.current.startY),
      });
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return { pos, onHandleMouseDown };
}

function ModalShell({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 필드가 많은 폼(품목 추가 전체 항목 등)용 넓은 레이아웃 */
  wide?: boolean;
}) {
  const { pos, onHandleMouseDown } = useDraggable();
  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div
        className={`bg-white rounded-lg shadow-xl w-full flex flex-col ${
          wide ? "max-w-3xl max-h-[90vh]" : "max-w-md"
        }`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <div
          onMouseDown={onHandleMouseDown}
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move select-none"
        >
          <h2 className="text-base font-bold text-navy">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className={`px-5 py-4 ${wide ? "overflow-y-auto" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

function UploadModal({
  categories,
  onClose,
  onImported,
}: {
  categories: ItemCategory[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inserted: number;
    updated: number;
    skippedNoCode: number;
    skippedCategory: number;
  } | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("cats", categories.join(","));
    const res = await fetch("/api/items/import", { method: "POST", body: fd });
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
    <ModalShell title="엑셀 업로드" onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            업로드 완료 — 신규 {result.inserted.toLocaleString()}건, 갱신{" "}
            {result.updated.toLocaleString()}건
            {result.skippedNoCode > 0 &&
              `, 건너뜀(품목코드 없음) ${result.skippedNoCode.toLocaleString()}건`}
            {result.skippedCategory > 0 &&
              `, 건너뜀(분류 범위 밖) ${result.skippedCategory.toLocaleString()}건`}
          </p>
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
            기준정보 양식(.xlsx) 첫 시트를 읽습니다. 1행은 컬럼 제목이어야 하며
            &quot;품목코드&quot; 컬럼은 필수입니다. 이미 있는 품목코드는 덮어씁니다.
            {categories.length > 1 &&
              ` 분류는 엑셀의 "품목계정" 컬럼 값으로 자동 구분됩니다(${categories.join("/")}).`}
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
    </ModalShell>
  );
}

function AddItemModal({
  categories,
  defaultCategory,
  fields,
  onClose,
  onSaved,
}: {
  categories: ItemCategory[];
  defaultCategory: ItemCategory;
  fields: ItemFieldDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState<ItemCategory>(defaultCategory);
  const [itemCode, setItemCode] = useState("");
  const [itemName, setItemName] = useState("");
  const initialValues = Object.fromEntries(
    fields.map((f) => {
      if (f.key === "단위") return [f.key, "EA"];
      if (f.key === "사용여부") return [f.key, "Y"];
      // 자재등록 기본 폼의 품목계정: 실제 데이터 대부분(98.8%)이 "부자재"
      if (f.key === "품목계정" && f.options?.includes("부자재")) return [f.key, "부자재"];
      return [f.key, ""];
    })
  );
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 완제품 전용: 대표코드 + 도수 체크로 여러 품목을 한 번에 생성
  const [diopterMode, setDiopterMode] = useState(false);
  const [selectedDiopters, setSelectedDiopters] = useState<string[]>([]);
  const [showDiopterPicker, setShowDiopterPicker] = useState(false);

  // 품목계정/대분류/중분류/소분류 자동완성 후보 — 기존 데이터에 실제 존재하는 값
  const [acOptions, setAcOptions] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!fields.some((f) => f.autocomplete)) return;
    const params = new URLSearchParams({ cats: categories.join(",") });
    fetch(`/api/items/filters?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Record<string, string[]>) => setAcOptions(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const buildDetail = (): Record<string, string | number | null> => {
    const detail: Record<string, string | number | null> = {
      품목코드: itemCode.trim(),
      품명: itemName.trim(),
    };
    for (const f of fields) {
      const raw = (values[f.key] ?? "").trim();
      if (f.type === "number") {
        detail[f.key] = raw === "" ? null : Number(raw);
      } else {
        detail[f.key] = raw === "" ? null : raw;
      }
    }
    return detail;
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    const useVariants = category === "완제품" && diopterMode;
    const url = useVariants ? "/api/items/variants" : "/api/items";
    const body = useVariants
      ? { category, detail: buildDetail(), diopters: selectedDiopters }
      : { category, detail: buildDetail() };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "등록에 실패했습니다.");
      return;
    }
    onSaved();
  };

  const inputCls =
    "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";
  // 필수 입력 표시 — 라벨 뒤에 빨간 "*"
  const req = <span className="text-rose-600"> *</span>;

  const sections: string[] = [];
  for (const f of fields) {
    if (!sections.includes(f.section)) sections.push(f.section);
  }
  const wide = fields.length > 5;

  return (
    <ModalShell title="품목 추가" onClose={onClose} wide={wide}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-100">
          <label className="block text-sm">
            <span className="text-slate-600">
              분류
              {req}
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ItemCategory)}
              className={`${inputCls} bg-white`}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                {diopterMode && category === "완제품" ? "대표코드" : "품목코드"}
                {req}
              </span>
              <input
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                className={`${inputCls} font-mono`}
                placeholder={
                  diopterMode && category === "완제품"
                    ? "예: 72A11-001 (도수 접미사 제외)"
                    : "예: 72A11-001"
                }
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                품명
                {req}
              </span>
              <input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
        </div>

        {category === "완제품" && (
          <div className="flex items-center justify-between gap-3 -mt-1 pb-3 border-b border-slate-100">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={diopterMode}
                onChange={(e) => {
                  setDiopterMode(e.target.checked);
                  if (!e.target.checked) setSelectedDiopters([]);
                }}
                className="accent-navy"
              />
              대표코드 + 도수로 여러 품목 한 번에 만들기
            </label>
            {diopterMode && (
              <button
                type="button"
                onClick={() => setShowDiopterPicker(true)}
                className="px-3 py-1.5 rounded-md text-sm font-medium border border-navy text-navy bg-white hover:bg-navy/5"
              >
                도수 선택 ({selectedDiopters.length}개)
              </button>
            )}
          </div>
        )}

        {sections.map((section) => (
          <div key={section}>
            <p className="text-xs font-semibold text-slate-400 mb-2">{section}</p>
            <div className={`grid gap-3 ${wide ? "grid-cols-3" : "grid-cols-2"}`}>
              {fields
                .filter((f) => f.section === section)
                .map((f) => (
                  <label key={f.key} className="block text-sm">
                    <span className="text-slate-600">{f.label}</span>
                    {f.type === "select" ? (
                      <select
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValue(f.key, e.target.value)}
                        className={`${inputCls} bg-white`}
                      >
                        {f.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <input
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValue(f.key, e.target.value)}
                          className={inputCls}
                          inputMode={f.type === "number" ? "decimal" : undefined}
                          placeholder={f.placeholder}
                          list={f.autocomplete ? `ac-${f.key}` : undefined}
                          autoComplete="off"
                        />
                        {f.autocomplete && (
                          <datalist id={`ac-${f.key}`}>
                            {(acOptions[f.autocomplete] ?? []).map((v) => (
                              <option key={v} value={v} />
                            ))}
                          </datalist>
                        )}
                      </>
                    )}
                  </label>
                ))}
            </div>
          </div>
        ))}

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {diopterMode && category === "완제품" && (
          <p className="text-xs text-slate-500">
            {selectedDiopters.length > 0
              ? `대표코드 1개 + 도수 ${selectedDiopters.length}개 = 총 ${selectedDiopters.length + 1}개 품목이 생성됩니다.`
              : "도수를 1개 이상 선택하세요."}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={
              saving ||
              !itemCode.trim() ||
              !itemName.trim() ||
              (diopterMode && category === "완제품" && selectedDiopters.length === 0)
            }
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
          >
            {saving ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
      {showDiopterPicker && (
        <DiopterPickerModal
          initialSelected={selectedDiopters}
          onClose={() => setShowDiopterPicker(false)}
          onConfirm={(selected) => {
            setSelectedDiopters(selected);
            setShowDiopterPicker(false);
          }}
        />
      )}
    </ModalShell>
  );
}

function DiopterPickerModal({
  initialSelected,
  onClose,
  onConfirm,
}: {
  initialSelected: string[];
  onClose: () => void;
  onConfirm: (selected: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const { pos, onHandleMouseDown } = useDraggable();

  const toggle = (d: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[60] modal-overlay-bg flex items-center justify-center p-4">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <div
          onMouseDown={onHandleMouseDown}
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0 cursor-move select-none"
        >
          <h2 className="text-base font-bold text-navy">도수 선택</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setSelected(new Set(STANDARD_DIOPTERS))}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-navy text-navy bg-white hover:bg-navy/5"
            >
              표준 세트 ({STANDARD_DIOPTERS.length}개)
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set(ALL_DIOPTERS))}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-slate-300 text-slate-600 bg-white hover:border-navy"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-slate-300 text-slate-600 bg-white hover:border-navy"
            >
              전체 해제
            </button>
            <span className="text-xs text-slate-500 ml-auto">{selected.size}개 선택됨</span>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {ALL_DIOPTERS.map((d) => (
              <label
                key={d}
                className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border text-sm font-mono cursor-pointer select-none ${
                  selected.has(d)
                    ? "bg-navy text-white border-navy"
                    : "bg-white text-slate-600 border-slate-300 hover:border-navy"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(d)}
                  onChange={() => toggle(d)}
                  className="sr-only"
                />
                {d}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm([...selected])}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white"
          >
            적용 ({selected.size}개)
          </button>
        </div>
      </div>
    </div>
  );
}
