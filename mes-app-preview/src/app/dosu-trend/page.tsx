"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type {
  DosuChangeListResponse,
  DosuChangeRow,
  DosuParetoResponse,
  DosuParetoRow,
  DosuTrendResponse,
} from "@/lib/types";
import {
  DOSU_CHANGE_COLS as DETAIL_COLS,
  DOSU_CHANGE_GUBUN_OPTIONS,
  DOSU_CHANGE_MOLD_CODES,
} from "@/lib/dosu-change-columns";

const PAGE_SIZE_OPTIONS = [50, 100, 200];

// 트렌드 차트/인사이트 바에서 쓰는 버킷 날짜 라벨 포맷. date 필드는 granularity에 따라
// day: "YYYY-MM-DD", week: 그 주 월요일 "YYYY-MM-DD", month: "YYYY-MM"로 서버가 내려준다.
function formatBucketLabel(date: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    const [y, m] = date.split("-");
    return `${y}.${m}`;
  }
  if (granularity === "week") {
    const monday = new Date(`${date}T00:00:00`);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    return `${fmt(monday)}~${fmt(sunday)}`;
  }
  return date.slice(5).replace("-", "/");
}

// 호버 툴팁 등 좀 더 풀어 쓰는 자리용.
function formatBucketFull(date: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    const [y, m] = date.split("-");
    return `${y}년 ${Number(m)}월`;
  }
  if (granularity === "week") {
    const monday = new Date(`${date}T00:00:00`);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${fmt(monday)} ~ ${fmt(sunday)}`;
  }
  return date;
}
// 형명별 랭킹(파레토 분석, 몰드별이 아닐 때) 막대 색 — 사용자 지정 하늘색. 몰드별일 땐
// MOLD_COLORS(몰드마다 고정색)를 따로 쓴다. 일별 추이 차트는 파스텔 연두/민트
// (#A8D5A8 계열)를 따로 쓴다 — 아래 COLOR_TREND_BAR. 변경율(선)은 두 차트 다 같은
// 파란색(#3a62c4)으로 막대와 대비시킨다.
const COLOR_CHANGE = "#8BC5FF";
const COLOR_TREND_BAR = "#A8D5A8";
// 파스텔 막대 위 숫자 레이블은 막대색 그대로 쓰면 흰 배경에서 대비가 약해(경량 팔레트
// 검증 결과 1.6:1) 잘 안 보인다 — 같은 초록 계열이되 더 진한 잉크색을 따로 쓴다.
const COLOR_TREND_TEXT_GREEN = "#3f7d3f";
const COLOR_RATE = "#3a62c4";
const COLOR_THRESHOLD = "#dc2626";
const PARETO_THRESHOLD = 80;

// 몰드품목별 랭킹의 각 몰드에 고정 배정한 색 — 사용자가 지정한 값 그대로(사내에서 이미
// 쓰는 몰드별 색상 코드로 추정). 값이 실제로는 항상 "코드+D"(예: "3860D")로 들어오는
// 조립투입품목 값이라 그 형태로 키를 잡는다. 색은 항상 이 몰드에 고정되고 순위(우선개선
// 대상 여부)에 따라 바뀌지 않는다 — 우선순위는 막대 불투명도로 따로 표시한다.
// 참고: 이 팔레트는 dataviz 스킬 검증기(scripts/validate_palette.js) 기준으로
// FAIL이다 — #FFFF00(4872D)은 흰 배경 대비 1.05:1로 거의 안 보이고, #FFC000(3862D)과
// #92D050(3860D)은 일반 색각도 구분이 어렵다(ΔE 14.6, 15 미만)/적록색맹은 사실상 구분
// 불가(ΔE 2.2). 막대 위 숫자·아래 몰드명 라벨은 색과 무관한 고정 잉크색이라 값 자체는
// 항상 읽히지만, 색만으로 몰드를 구분하긴 어려울 수 있다.
const MOLD_COLORS: Record<string, string> = {
  "3860D": "#92D050",
  "3862D": "#FFC000",
  "3875D": "#8DB4E2",
  "4372D": "#FF33CC",
  "4375D": "#C4BD97",
  "4872D": "#FFFF00",
  "5872D": "#B1A0C7",
};
const MOLD_ORDER: readonly string[] = DOSU_CHANGE_MOLD_CODES;
const MOLD_FALLBACK_COLOR = "#78716c";

// 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 자정 근처에 날짜가 밀릴 수 있음)
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
// 월별 토글 선택 시 조회 기간 자동 설정용 — 이번 달 포함 최근 (n+1)개월이 되도록
// "이번 달 1일 - n개월"의 1일로 시작한다(예: n=11, 이번 달이 2026-08이면 2025-09-01).
function monthsAgoFirstOfMonth(n: number): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth() - n, 1));
}
// 주별 토글 선택 시 조회 기간 자동 설정용 — 오늘로부터 n주(=n*7일) 전.
function weeksAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return toLocalDateStr(d);
}

export default function DosuTrendPage() {
  // 기본 조회 범위: 이번 달 1일 ~ 당일. 검사일자(외관검사 일자) 기준 — PROD-06 화면
  // 자체의 지시일자와는 다른 필드라 dosu-change-filters의 inspectDateFrom/inspectDateTo를 쓴다.
  const [inspectDateFrom, setInspectDateFrom] = useTabState("inspectDateFrom", firstDayOfMonth);
  const [inspectDateTo, setInspectDateTo] = useTabState("inspectDateTo", today);
  const [gubun, setGubun] = useTabState("gubun", "");
  const [mold, setMold] = useTabState("mold", "");
  const [model, setModel] = useTabState("model", "");
  const [moldOptions, setMoldOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useTabState("searchInput", "");
  const [search, setSearch] = useTabState("search", "");

  const [trend, setTrend] = useState<{ date: string; count: number; rate: number }[]>([]);
  const [trendTotal, setTrendTotal] = useState(0);
  const [trendLoading, setTrendLoading] = useState(true);
  const [granularity, setGranularity] = useTabState<"day" | "week" | "month">(
    "trendGranularity",
    "day"
  );

  const [paretoDim, setParetoDim] = useTabState<"mold" | "model">("paretoDim", "mold");
  const [pareto, setPareto] = useState<DosuParetoRow[]>([]);
  const [paretoLoading, setParetoLoading] = useState(true);

  const [rows, setRows] = useState<DosuChangeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(true);
  const [page, setPage] = useTabState("page", 1);
  const [pageSize, setPageSize] = useTabState("pageSize", 50);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setSearch, setPage]);

  function buildFilterParams() {
    const params = new URLSearchParams();
    if (inspectDateFrom) params.set("inspectDateFrom", inspectDateFrom);
    if (inspectDateTo) params.set("inspectDateTo", inspectDateTo);
    if (gubun) params.set("gubun", gubun);
    if (mold) params.set("mold", mold);
    if (model) params.set("model", model);
    if (search) params.set("search", search);
    return params;
  }

  // 몰드/형명 드롭다운 옵션 — 현재 조건에서 실제 존재하는 값만 서버에서 조회(faceted).
  // 이 화면은 항상 "변경건만" 기준이라(changedOnly) 옵션도 같은 조건으로 걸러야
  // 조합했을 때 0건이 나오는 옵션이 뜨지 않는다.
  useEffect(() => {
    let cancelled = false;
    const params = buildFilterParams();
    params.set("changedOnly", "1");
    fetch(`/api/dosu-change/filters?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { mold: string[]; model: string[] }) => {
        if (cancelled) return;
        setMoldOptions(data.mold ?? []);
        setModelOptions(data.model ?? []);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectDateFrom, inspectDateTo, gubun, mold, model, search]);

  useEffect(() => {
    let cancelled = false;
    setTrendLoading(true);
    const params = buildFilterParams();
    params.set("granularity", granularity);
    fetch(`/api/dosu-change/trend?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: DosuTrendResponse) => {
        if (cancelled) return;
        setTrend(data.trend);
        setTrendTotal(data.total);
        setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectDateFrom, inspectDateTo, gubun, mold, model, search, granularity]);

  useEffect(() => {
    let cancelled = false;
    setParetoLoading(true);
    const params = buildFilterParams();
    params.set("dim", paretoDim);
    fetch(`/api/dosu-change/pareto?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: DosuParetoResponse) => {
        if (cancelled) return;
        setPareto(data.rows);
        setParetoLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectDateFrom, inspectDateTo, gubun, mold, model, search, paretoDim]);

  useEffect(() => {
    let cancelled = false;
    setTableLoading(true);
    const params = buildFilterParams();
    params.set("changedOnly", "1");
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    fetch(`/api/dosu-change?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: DosuChangeListResponse) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setTableLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectDateFrom, inspectDateTo, gubun, mold, model, search, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  // 파레토 80% 기준선을 처음 넘는 지점(포함)까지가 "우선 개선 대상". 못 채우면(데이터가
  // 아예 없거나 80% 미만에서 끝나면) 전부를 대상으로 본다.
  const paretoCutoffIdx = pareto.findIndex((r) => r.cumRate >= PARETO_THRESHOLD);
  const paretoPriorityCount = paretoCutoffIdx === -1 ? pareto.length : paretoCutoffIdx + 1;
  const paretoGroupLabel = paretoDim === "mold" ? "몰드" : "형명";
  const paretoTotalSum = pareto.reduce((sum, r) => sum + r.total, 0);
  const paretoCountSum = pareto.reduce((sum, r) => sum + r.count, 0);
  const paretoRateSum =
    paretoTotalSum > 0 ? Math.round((paretoCountSum / paretoTotalSum) * 1000) / 10 : 0;

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">도수변경현황</h1>
          <p className="text-sm text-slate-500 mt-1">
            QC-01 · 도수변경등록(PROD-06) 데이터를 일별 변경건수로 재집계 · 조립 도수 이탈
            추이 모니터링
          </p>
        </div>
        <button
          onClick={() => {
            const params = buildFilterParams();
            params.set("changedOnly", "1");
            window.location.href = `/api/dosu-change/export?${params.toString()}`;
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
        >
          엑셀 다운로드
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">검사일자</label>
          <DateSegmentInput
            value={inspectDateFrom}
            onChange={(v) => {
              setInspectDateFrom(v);
              setPage(1);
            }}
          />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput
            value={inspectDateTo}
            onChange={(v) => {
              setInspectDateTo(v);
              setPage(1);
            }}
          />
        </div>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <select
          value={gubun}
          onChange={(e) => {
            setGubun(e.target.value);
            setPage(1);
          }}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            gubun ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">주야간 전체</option>
          {DOSU_CHANGE_GUBUN_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={mold}
          onChange={(e) => {
            setMold(e.target.value);
            setPage(1);
          }}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white max-w-32 truncate ${
            mold ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">몰드 전체</option>
          {moldOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setPage(1);
          }}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white max-w-32 truncate ${
            model ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">형명 전체</option>
          {modelOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="작업지시번호, 품목코드, 품목정보, LOT No 검색"
          className="border border-slate-300 rounded-md px-3 py-2 text-sm w-72"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
          <h3 className="text-lg font-bold text-slate-800">도수변경 현황</h3>
          <p className="text-xs text-slate-500">
            조회 기간 합계{" "}
            <span className="font-mono font-semibold text-navy">
              {trendTotal.toLocaleString()}
            </span>
            건 · {inspectDateFrom} ~ {inspectDateTo}
          </p>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-5 text-sm text-slate-600">
            <span className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm inline-block"
                style={{ background: COLOR_TREND_BAR }}
              />
              변경건수 (건)
            </span>
            <span className="flex items-center gap-2">
              <svg width="20" height="10" viewBox="0 0 20 10" aria-hidden>
                <line x1="0" y1="5" x2="20" y2="5" stroke={COLOR_RATE} strokeWidth={2} />
                <circle cx="10" cy="5" r="3" fill="#fff" stroke={COLOR_RATE} strokeWidth={2} />
              </svg>
              변경율 (%)
            </span>
          </div>
          <div className="flex items-center rounded-md border border-slate-300 overflow-hidden text-xs">
            {(
              [
                { v: "day", label: "일별" },
                { v: "week", label: "주별" },
                { v: "month", label: "월별" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.v}
                onClick={() => {
                  setGranularity(opt.v);
                  // 주별/월별을 고르면 그 단위에 맞는 조회 기간으로 자동 확장한다
                  // (주별: 최근 11주, 월별: 최근 11개월치 1일부터). 일별은 기존 범위 유지.
                  if (opt.v === "week") {
                    setInspectDateFrom(weeksAgo(11));
                    setInspectDateTo(today());
                  } else if (opt.v === "month") {
                    setInspectDateFrom(monthsAgoFirstOfMonth(11));
                    setInspectDateTo(today());
                  }
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  granularity === opt.v
                    ? "bg-navy text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {trendLoading ? (
          <p className="text-sm text-slate-400 py-10 text-center">불러오는 중...</p>
        ) : trend.length === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">조회 기간을 선택하세요.</p>
        ) : (
          <>
            <TrendChart rows={trend} granularity={granularity} />
            <TrendInsightBar rows={trend} granularity={granularity} />
          </>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-sm text-navy">
            {paretoGroupLabel}별 변경율{" "}
            <span className="font-normal text-xs text-slate-400 ml-1">
              파레토 분석 · 변경건수 내림차순, 누적비율 {PARETO_THRESHOLD}% 기준선까지 우선
              개선 대상(진한 막대)
            </span>
          </h3>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2.5 h-0.5 rounded-full inline-block" style={{ background: COLOR_RATE }} />
              누적비율(%)
            </span>
            <div className="flex items-center rounded-md border border-slate-300 overflow-hidden text-xs">
              {(
                [
                  { v: "mold", label: "몰드별" },
                  { v: "model", label: "형명별" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setParetoDim(opt.v)}
                  className={`px-3 py-1.5 font-medium transition-colors ${
                    paretoDim === opt.v
                      ? "bg-navy text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {paretoDim === "mold" && (
          <div className="flex items-center gap-3 flex-wrap mb-3 text-xs text-slate-500">
            {MOLD_ORDER.map((code) => (
              <span key={code} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm inline-block"
                  style={{ background: MOLD_COLORS[code] }}
                />
                {code}
              </span>
            ))}
          </div>
        )}
        {paretoLoading ? (
          <p className="text-sm text-slate-400 py-10 text-center">불러오는 중...</p>
        ) : pareto.length === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">조건에 맞는 변경건이 없습니다.</p>
        ) : (
          <>
            <ParetoChart rows={pareto} dim={paretoDim} />
            <div className="overflow-auto mt-4 border-t border-slate-100 pt-3">
              <table className="text-sm whitespace-nowrap w-full">
                <thead className="text-slate-500 text-xs">
                  <tr className="border-b border-slate-200">
                    <th className="text-center px-3 py-2 font-semibold">No.</th>
                    <th className="text-center px-3 py-2 font-semibold">{paretoGroupLabel}</th>
                    <th className="text-right px-3 py-2 font-semibold">전체건수</th>
                    <th className="text-right px-3 py-2 font-semibold">변경건수</th>
                    <th className="text-right px-3 py-2 font-semibold">변경율(%)</th>
                    <th className="text-right px-3 py-2 font-semibold">누적변경건수</th>
                    <th className="text-right px-3 py-2 font-semibold">누적변경율(%)</th>
                    <th className="text-center px-3 py-2 font-semibold">구분</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pareto.map((r, i) => {
                    const isPriority = i < paretoPriorityCount;
                    return (
                      <tr key={r.group} className={isPriority ? "bg-amber-50/50" : undefined}>
                        <td className="px-3 py-2 text-center text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 text-center font-medium text-slate-700">{r.group}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500">
                          {r.total.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">
                          {r.count.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">
                          {r.rate.toLocaleString()}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500">
                          {r.cumCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500">
                          {r.cumRate.toLocaleString()}%
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isPriority && (
                            <span className="inline-block text-[11px] font-medium border rounded px-1.5 py-0.5 bg-rose-50 text-rose-700 border-rose-200">
                              우선개선대상
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-semibold border-t border-slate-200">
                    <td className="px-3 py-2 text-center text-slate-700" colSpan={2}>
                      합계
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-navy">
                      {paretoTotalSum.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-navy">
                      {paretoCountSum.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-navy">
                      {paretoRateSum.toLocaleString()}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-navy">
                      {paretoCountSum.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-navy">100%</td>
                    <td className="px-3 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="px-4 pt-3 pb-1">
          <h3 className="font-semibold text-sm text-navy">
            변경건 상세{" "}
            <span className="font-normal text-xs text-slate-400 ml-1">
              같은 필터 기준 개별 조립 실적
            </span>
          </h3>
        </div>
        <div className="overflow-auto max-h-[calc(100vh-42rem)] min-h-[16rem]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-3 py-3 font-semibold sticky left-0 top-0 z-30 bg-[#D9E1F2] border-r border-slate-200 shadow-[inset_0_-1px_0_#e2e8f0] w-16">
                  No.
                </th>
                {DETAIL_COLS.map((col, i) => (
                  <th
                    key={`${col.key}-${i}`}
                    className="text-center px-3 py-3 font-semibold sticky top-0 z-20 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]"
                  >
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tableLoading && (
                <tr>
                  <td colSpan={DETAIL_COLS.length + 1} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!tableLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={DETAIL_COLS.length + 1} className="text-center py-10 text-slate-400">
                    조건에 맞는 도수변경 건이 없습니다.
                  </td>
                </tr>
              )}
              {!tableLoading &&
                rows.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50 group">
                    <td className="px-3 py-2.5 text-center text-slate-400 sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 w-16">
                      {(page - 1) * pageSize + idx + 1}
                    </td>
                    {DETAIL_COLS.map((col, i) => {
                      const v = row.detail?.[col.key];
                      return (
                        <td
                          key={`${col.key}-${i}`}
                          title={v == null ? undefined : String(v)}
                          className={`px-3 py-2.5 max-w-64 truncate ${
                            typeof v === "number"
                              ? "text-right text-slate-500 font-mono text-xs"
                              : "text-slate-500"
                          }`}
                        >
                          {v == null || v === "" ? "-" : typeof v === "number" ? v.toLocaleString() : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3">
            <p className="text-xs text-slate-500">
              전체 {total.toLocaleString()}건 중 {rangeStart.toLocaleString()}-
              {rangeEnd.toLocaleString()}건 표시
            </p>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="border border-slate-300 rounded-md px-2.5 py-1.5 text-xs bg-white text-slate-600"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}건씩
                </option>
              ))}
            </select>
          </div>
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

/* 일별 도수변경 건수(막대, 왼쪽 축)·변경율(선, 오른쪽 축) 콤보 차트 (인라인 SVG) —
   대시보드의 ProductionChart와 같은 손수 그린 SVG 패턴에 오른쪽 축 하나를 더한 것. */
function TrendChart({
  rows,
  granularity,
}: {
  rows: { date: string; count: number; rate: number }[];
  granularity: "day" | "week" | "month";
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 960;
  const H = 260;
  // 축 눈금·캡션 글자가 8px로 작아져 여백을 그만큼 줄여도 잘리지 않는다 — 좌우
  // 여백을 최대한 줄여 플롯 영역(막대·선)을 넓게 쓴다.
  const PAD_L = 28;
  const PAD_R = 30;
  const PAD_B = 32;
  // 막대·선 위에 데이터 레이블을 얹을 여유 공간이 필요해 위쪽 여백을 넉넉히 둔다.
  const PAD_T = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  // 날짜가 아주 많을 때는 숫자 레이블이 서로 겹쳐 읽기 어려워지므로 생략한다.
  const showDataLabels = rows.length <= 62;

  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const countStep = Math.pow(10, Math.floor(Math.log10(maxCount)));
  const yMax = Math.max(countStep, Math.ceil(maxCount / countStep) * countStep);
  // 왼쪽(건수)·오른쪽(변경율) 두 축을 5단계로 나눠 같은 높이에 눈금선이 나란히
  // 맞도록 한다(0/25/50/75/100%씩).
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);

  // 변경율 축은 10% 단위로 반올림 올림(최소 10%) — 대부분 %가 크지 않아 촘촘하게 보인다.
  const maxRate = Math.max(1, ...rows.map((r) => r.rate));
  const rateMax = Math.max(10, Math.ceil(maxRate / 10) * 10);
  const rateTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => rateMax * f);

  const slot = plotW / rows.length;
  const barW = Math.min(28, slot * 0.6);

  const rateY = (rate: number) => PAD_T + plotH - (rate / rateMax) * plotH;
  const linePoints = rows
    .map((r, i) => `${PAD_L + slot * i + slot / 2},${rateY(r.rate)}`)
    .join(" ");

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="일별 도수변경 건수·변경율 추이 차트"
      >
        <text x={0} y={14} textAnchor="start" fontSize={8} fill={COLOR_TREND_TEXT_GREEN} fontWeight={600}>
          변경건수 (건)
        </text>
        <text x={W} y={14} textAnchor="end" fontSize={8} fill={COLOR_RATE} fontWeight={600}>
          변경율 (%)
        </text>
        {ticks.map((t) => {
          const y = PAD_T + plotH - (t / yMax) * plotH;
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text
                x={PAD_L - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={8}
                fill="#94a3b8"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {t >= 1000 ? `${Math.round(t / 100) / 10}k` : Math.round(t * 10) / 10}
              </text>
            </g>
          );
        })}
        {rateTicks.map((t) => (
          <text
            key={t}
            x={W - PAD_R + 6}
            y={rateY(t) + 4}
            textAnchor="start"
            fontSize={8}
            fill={COLOR_RATE}
            fontFamily="var(--font-geist-mono), monospace"
          >
            {(Math.round(t * 10) / 10).toFixed(1)}%
          </text>
        ))}
        {rows.map((r, i) => {
          const x = PAD_L + slot * i + (slot - barW) / 2;
          const h = (r.count / yMax) * plotH;
          const y = PAD_T + plotH - h;
          const isHover = hover === i;
          const day = formatBucketLabel(r.date, granularity);
          // 변경율 선의 점(cy)이 건수 레이블과 같은 높이에 오면 점과 숫자가 겹친다 —
          // 그럴 땐 건수 레이블을 점에서 최소 간격만큼 더 떨어뜨린다.
          const rawCountLabelY = y - 5;
          const dotY = rateY(r.rate);
          const countLabelY =
            Math.abs(rawCountLabelY - dotY) < 10
              ? rawCountLabelY < dotY
                ? dotY - 10
                : dotY + 10
              : rawCountLabelY;
          return (
            <g
              key={r.date}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {h > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={COLOR_TREND_BAR}
                  opacity={hover === null || isHover ? 1 : 0.45}
                />
              ) : (
                // 0건인 날은 막대가 없어 "데이터 없음"처럼 보이므로, 기준선 위에 작은
                // 점을 찍어 "데이터가 빠진 게 아니라 진짜 0"임을 표시한다. 변경율도 항상
                // "0%" 글자를 보여주는데(기준선 바로 위, cy-8 부근) 그 자리와 겹치지
                // 않도록 더 위로 띄운다.
                <circle
                  cx={x + barW / 2}
                  cy={PAD_T + plotH - 22}
                  r={isHover ? 3 : 2.5}
                  fill={COLOR_TREND_BAR}
                  stroke="#fff"
                  strokeWidth={1}
                  opacity={hover === null || isHover ? 1 : 0.6}
                />
              )}
              {showDataLabels && r.count > 0 && (
                <text
                  x={x + barW / 2}
                  y={countLabelY}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={700}
                  fill={COLOR_TREND_TEXT_GREEN}
                >
                  {r.count.toLocaleString()}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={H - 10}
                textAnchor="middle"
                fontSize={8}
                fill={isHover ? "#334155" : "#94a3b8"}
              >
                {day}
              </text>
            </g>
          );
        })}
        <polyline
          points={linePoints}
          fill="none"
          stroke={COLOR_RATE}
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {rows.map((r, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          const cy = rateY(r.rate);
          const isHover = hover === i;
          // 막대 건수 레이블(있다면)과 겹치지 않는 y 위치를 계산한다: 기본은 점 바로
          // 위, 위쪽 끝에 너무 가까우면 아래로, 막대 건수 레이블과 높이가 겹치면 그
          // 위로 한 줄 더 띄운다(그마저 차트 위쪽을 벗어나면 아래로 fallback).
          const h = (r.count / yMax) * plotH;
          const barTopY = PAD_T + plotH - h;
          const rawCountLabelY = r.count > 0 ? barTopY - 5 : null;
          const countLabelY =
            rawCountLabelY !== null && Math.abs(rawCountLabelY - cy) < 10
              ? rawCountLabelY < cy
                ? cy - 10
                : cy + 10
              : rawCountLabelY;
          const nearTop = cy - 8 < PAD_T + 2;
          let rateLabelY: number;
          if (nearTop) {
            rateLabelY = cy + 15;
          } else if (countLabelY !== null && Math.abs(cy - 8 - countLabelY) < 12) {
            const stacked = countLabelY - 12;
            rateLabelY = stacked > PAD_T + 6 ? stacked : cy + 15;
          } else {
            rateLabelY = cy - 8;
          }
          return (
            <g key={`dot-${r.date}`}>
              <circle
                cx={cx}
                cy={cy}
                r={isHover ? 3.5 : 2.5}
                fill="#fff"
                stroke={COLOR_RATE}
                strokeWidth={2}
                opacity={hover === null || isHover ? 1 : 0.5}
              />
              {showDataLabels && (
                <text
                  x={cx}
                  y={rateLabelY}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={isHover ? 700 : 500}
                  fill={COLOR_RATE}
                >
                  {r.rate.toFixed(1)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div
          className="absolute top-1 bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs pointer-events-none"
          style={{
            left: `${((PAD_L + slot * hover + slot / 2) / W) * 100}%`,
            transform: hover > rows.length / 2 ? "translateX(-105%)" : "none",
          }}
        >
          <p className="font-semibold text-slate-700 mb-1">
            {formatBucketFull(rows[hover].date, granularity)}
          </p>
          <p className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: COLOR_TREND_BAR }} />
            변경건수{" "}
            <span className="font-mono ml-auto pl-3">{rows[hover].count.toLocaleString()}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: COLOR_RATE }} />
            변경율{" "}
            <span className="font-mono ml-auto pl-3">{rows[hover].rate.toFixed(1)}%</span>
          </p>
        </div>
      )}
    </div>
  );
}

/* 일별 추이 차트 바로 아래 요약 인사이트 바 — 화면에 표시된 trend 데이터에서 클라이언트
   단에서 바로 계산한다(별도 API 없음). 최대 변경일/최고 변경율일/Top3/평균 변경율 4개. */
function TrendInsightBar({
  rows,
  granularity,
}: {
  rows: { date: string; count: number; rate: number }[];
  granularity: "day" | "week" | "month";
}) {
  const fmtDay = (d: string) => formatBucketLabel(d, granularity);
  const unitLabel = granularity === "day" ? "일" : granularity === "week" ? "주" : "월";

  const maxCountDay = rows.reduce((best, r) => (r.count > best.count ? r : best), rows[0]);
  const maxRateDay = rows.reduce((best, r) => (r.rate > best.rate ? r : best), rows[0]);
  const top3 = [...rows].sort((a, b) => b.count - a.count).slice(0, 3);
  const avgRate = Math.round((rows.reduce((sum, r) => sum + r.rate, 0) / rows.length) * 10) / 10;

  const items: { label: string; value: string; color?: string }[] = [
    {
      label: `최대 변경${unitLabel}`,
      value: `${fmtDay(maxCountDay.date)} (${maxCountDay.count.toLocaleString()}건)`,
      color: COLOR_TREND_TEXT_GREEN,
    },
    {
      label: "최고 변경율",
      value: `${fmtDay(maxRateDay.date)} (${maxRateDay.rate.toFixed(1)}%)`,
      color: COLOR_RATE,
    },
    {
      label: "변경건수 Top 3",
      value: top3.map((r) => `${fmtDay(r.date)} (${r.count.toLocaleString()}건)`).join(" · "),
    },
    { label: "변경율 평균", value: `${avgRate.toFixed(1)}%` },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-100">
      {items.map((it) => (
        <div key={it.label} className="bg-white border border-slate-200 rounded-xl px-4 py-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">{it.label}</p>
          <p className="mt-1.5 text-sm font-bold" style={{ color: it.color ?? "#0b2a5b" }}>
            {it.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* {그룹}별 변경건수(막대, 왼쪽 축)·누적비율(선, 오른쪽 0~100% 축) 파레토 차트 (인라인
   SVG) — TrendChart와 같은 패턴. 이미 변경건수 내림차순으로 정렬된 데이터를 그대로
   그리고, 누적비율이 80%(PARETO_THRESHOLD)를 처음 넘는 지점까지 막대를 진하게(불투명도
   1, 그 외는 0.4) 표시해 "우선 개선 대상"을 나타낸다. 색은 순위가 아니라 정체성(몰드별일 때 몰드별
   고정색)을 나타내므로 우선순위 여부로 막대 색 자체를 바꾸지 않는다. */
function ParetoChart({ rows, dim }: { rows: DosuParetoRow[]; dim: "mold" | "model" }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 960;
  const H = 240;
  const PAD_L = 44;
  const PAD_R = 48;
  const PAD_B = 34;
  const PAD_T = 24;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const countStep = Math.pow(10, Math.floor(Math.log10(maxCount)));
  const yMax = Math.max(countStep, Math.ceil(maxCount / countStep) * countStep);
  const ticks = [0, yMax / 2, yMax];

  const slot = plotW / rows.length;
  const barW = Math.min(40, slot * 0.55);

  // 누적비율은 정의상 항상 0~100%라 축 스케일이 고정.
  const cumY = (rate: number) => PAD_T + plotH - (rate / 100) * plotH;
  const linePoints = rows
    .map((r, i) => `${PAD_L + slot * i + slot / 2},${cumY(r.cumRate)}`)
    .join(" ");

  const cutoffIdx = rows.findIndex((r) => r.cumRate >= PARETO_THRESHOLD);
  const priorityCount = cutoffIdx === -1 ? rows.length : cutoffIdx + 1;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="파레토 차트 — 변경건수 막대와 누적비율 선"
      >
        {ticks.map((t) => {
          const y = PAD_T + plotH - (t / yMax) * plotH;
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text
                x={PAD_L - 6}
                y={y + 3.5}
                textAnchor="end"
                fontSize={8}
                fill="#94a3b8"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {t >= 1000 ? `${t / 1000}k` : t}
              </text>
            </g>
          );
        })}
        {[0, 50, 100].map((t) => (
          <text
            key={t}
            x={W - PAD_R + 6}
            y={cumY(t) + 3.5}
            textAnchor="start"
            fontSize={8}
            fill={COLOR_RATE}
            fontFamily="var(--font-geist-mono), monospace"
          >
            {t}%
          </text>
        ))}
        {/* 80% 기준선 — 여기까지가 우선 개선 대상 */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={cumY(PARETO_THRESHOLD)}
          y2={cumY(PARETO_THRESHOLD)}
          stroke={COLOR_THRESHOLD}
          strokeWidth={1.5}
          strokeDasharray="5 3"
        />
        <text
          x={PAD_L + 4}
          y={cumY(PARETO_THRESHOLD) - 5}
          textAnchor="start"
          fontSize={8}
          fontWeight={700}
          fill={COLOR_THRESHOLD}
        >
          {PARETO_THRESHOLD}% 기준선
        </text>
        {rows.map((r, i) => {
          const x = PAD_L + slot * i + (slot - barW) / 2;
          const h = (r.count / yMax) * plotH;
          const y = PAD_T + plotH - h;
          const isHover = hover === i;
          const isPriority = i < priorityCount;
          // 색은 정체성만 나타낸다 — 몰드별일 땐 몰드 고정색, 형명별일 땐 단일 기본색.
          const barColor = dim === "mold" ? MOLD_COLORS[r.group] ?? MOLD_FALLBACK_COLOR : COLOR_CHANGE;
          // 누적비율 선의 점(cumDotY)이 건수 레이블과 같은 높이에 오면 점과 숫자가
          // 겹친다 — 그럴 땐 건수 레이블을 점에서 최소 간격만큼 더 떨어뜨린다.
          const rawCountLabelY = y - 4;
          const cumDotY = cumY(r.cumRate);
          const countLabelY =
            Math.abs(rawCountLabelY - cumDotY) < 10
              ? rawCountLabelY < cumDotY
                ? cumDotY - 10
                : cumDotY + 10
              : rawCountLabelY;
          return (
            <g
              key={r.group}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect x={PAD_L + slot * i} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={barColor}
                  opacity={isPriority ? 1 : 0.4}
                />
              )}
              {r.count > 0 && (
                <text
                  x={x + barW / 2}
                  y={countLabelY}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={isHover ? 700 : 500}
                  fill={isHover ? "#0f172a" : "#475569"}
                >
                  {r.count.toLocaleString()}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={H - PAD_B + 16}
                textAnchor="middle"
                fontSize={8}
                fill={isHover ? "#334155" : "#94a3b8"}
              >
                {r.group}
              </text>
            </g>
          );
        })}
        <polyline
          points={linePoints}
          fill="none"
          stroke={COLOR_RATE}
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {rows.map((r, i) => {
          const cx = PAD_L + slot * i + slot / 2;
          const cy = cumY(r.cumRate);
          const isHover = hover === i;
          // 막대 건수 레이블과 겹치지 않는 y 위치를 계산한다(TrendChart와 같은 방식).
          const h = (r.count / yMax) * plotH;
          const barTopY = PAD_T + plotH - h;
          const rawCountLabelY = r.count > 0 ? barTopY - 4 : null;
          const countLabelY =
            rawCountLabelY !== null && Math.abs(rawCountLabelY - cy) < 10
              ? rawCountLabelY < cy
                ? cy - 10
                : cy + 10
              : rawCountLabelY;
          const nearTop = cy - 7 < PAD_T + 2;
          let cumLabelY: number;
          if (nearTop) {
            cumLabelY = cy + 13;
          } else if (countLabelY !== null && Math.abs(cy - 7 - countLabelY) < 12) {
            const stacked = countLabelY - 12;
            cumLabelY = stacked > PAD_T + 6 ? stacked : cy + 13;
          } else {
            cumLabelY = cy - 7;
          }
          return (
            <g key={`dot-${r.group}`}>
              <circle
                cx={cx}
                cy={cy}
                r={isHover ? 3.5 : 2.5}
                fill="#fff"
                stroke={COLOR_RATE}
                strokeWidth={2}
                opacity={hover === null || isHover ? 1 : 0.5}
              />
              <text
                x={cx}
                y={cumLabelY}
                textAnchor="middle"
                fontSize={8}
                fontWeight={isHover ? 700 : 500}
                fill={COLOR_RATE}
              >
                {r.cumRate.toLocaleString()}%
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && rows[hover] && (
        <div
          className="absolute top-1 bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs pointer-events-none"
          style={{
            left: `${((PAD_L + slot * hover + slot / 2) / W) * 100}%`,
            transform: hover > rows.length / 2 ? "translateX(-105%)" : "none",
          }}
        >
          <p className="font-semibold text-slate-700 mb-1">{rows[hover].group}</p>
          <p className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm inline-block"
              style={{
                background:
                  dim === "mold" ? MOLD_COLORS[rows[hover].group] ?? MOLD_FALLBACK_COLOR : COLOR_CHANGE,
              }}
            />
            변경건수{" "}
            <span className="font-mono ml-auto pl-3">{rows[hover].count.toLocaleString()}</span>
          </p>
          <p className="flex items-center gap-1.5">
            변경율(자체){" "}
            <span className="font-mono ml-auto pl-3">{rows[hover].rate.toLocaleString()}%</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: COLOR_RATE }} />
            누적비율{" "}
            <span className="font-mono ml-auto pl-3">{rows[hover].cumRate.toLocaleString()}%</span>
          </p>
        </div>
      )}
    </div>
  );
}
