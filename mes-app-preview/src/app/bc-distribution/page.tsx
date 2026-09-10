"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type {
  BcDistributionFiltersResponse,
  BcDistributionGroup,
  BcDistributionResponse,
} from "@/lib/types";

// 몰드코드 그룹 헤더 셀 배경 — 참고 캡쳐(직경추이현황.PNG)의 연두색 그대로. 몰드코드마다
// 다른 색을 배정하는 게 아니라 "이건 그룹 헤더다"를 나타내는 구조색이라 전 그룹에 같은
// 색을 쓴다(정체성 인코딩이 아님).
const MOLD_HEADER_BG = "#C6E0B4";
// 히트맵 채움색(파란 계열, 단일 hue) — 값이 클수록 진하게.
const HEAT_RGB = "37, 99, 235";
// 규격 B.C(품목B.C)가 속한 구간을 강조하는 테두리색.
const SPEC_BORDER = "#dc2626";

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

type Mode = "summary" | "hema";

export default function BcDistributionPage() {
  const [model, setModel] = useTabState("bcModel", "");
  const [mold, setMold] = useTabState("bcMold", "");
  const [dateFrom, setDateFrom] = useTabState("bcDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("bcDateTo", today);
  // 형명·몰드 요약(=몰드 전체 가능, work_date를 월 단위로 잘라 행을 만든다 — 작업일자를
  // 한 달 안으로 좁히면 자연히 한 행만 남고, 여러 달을 고르면 자동으로 월별 추이가
  // 되므로 별도 "월별" 토글은 두지 않는다) / HEMA No 상세(=몰드 하나를 골라 HEMA No별로
  // 쪼갬) 2단 토글(직경 분포 분석/QC-03과 2026-08-26 동일하게 통일).
  const [mode, setMode] = useTabState<Mode>("bcMode", "summary");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [moldOptions, setMoldOptions] = useState<string[]>([]);
  const [groups, setGroups] = useState<BcDistributionGroup[]>([]);
  const [loading, setLoading] = useState(false);

  function buildParams() {
    const params = new URLSearchParams();
    if (model) params.set("model", model);
    if (mold) params.set("mold", mold);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }

  // 몰드코드/형명 드롭다운 옵션 — "몰드코드 우선" 필터(2026-08-26 사용자 요청)라 몰드
  // 코드는 항상 날짜 범위 전체 기준으로 보여주고, 형명은 선택된 몰드코드(+기간) 안에서
  // 실제 존재하는 품목코드를 dosu_change_status 조립투입품목으로 매핑해 좁힌다.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bc-distribution/filters?${buildParams().toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: BcDistributionFiltersResponse) => {
        if (cancelled) return;
        setModelOptions(data.models ?? []);
        setMoldOptions(data.molds ?? []);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, mold, dateFrom, dateTo]);

  // 요약 모드는 형명만 있으면 조회한다(몰드 미선택 = 그 형명의 모든 몰드코드를 각각
  // 한 줄짜리 표로). HEMA No 상세 모드만 몰드를 하나로 좁혀야 한다.
  const blocked = mode === "hema" && (!model || !mold);
  useEffect(() => {
    if (blocked) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = buildParams();
    params.set("mode", mode);
    fetch(`/api/bc-distribution?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: BcDistributionResponse) => {
        if (cancelled) return;
        setGroups(data.groups ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, mold, dateFrom, dateTo, mode]);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">형명별/몰드별/원료LOT별 B.C 분포 분석</h1>
        <p className="text-sm text-slate-500 mt-1">
          QC-02 · 일일작업현황(PROD-10) 데이터를 B.C1/B.C2/B.C3 샘플 단위로 재집계 ·
          형명·몰드 요약(작업월별) 또는 HEMA No별 상세(우측 토글에서 전환) 0.05 구간
          분포 히트맵
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">작업일자</label>
          <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput value={dateTo} onChange={setDateTo} />
        </div>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <select
          value={mold}
          onChange={(e) => {
            setMold(e.target.value);
            setModel("");
          }}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            mold ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">몰드코드 {mode === "hema" ? "선택" : "전체"}</option>
          {moldOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            model ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">형명 {mode === "hema" ? "선택" : "전체"}</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <div className="flex items-center rounded-md border border-slate-300 overflow-hidden text-xs">
          {(
            [
              { v: "summary", label: "형명·몰드 요약" },
              { v: "hema", label: "HEMA No 상세" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setMode(opt.v)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                mode === opt.v ? "bg-navy text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {blocked ? (
        <p className="text-sm text-slate-400 py-16 text-center bg-white border border-slate-200 rounded-lg">
          {!model ? "형명을 선택하세요." : "몰드코드를 선택하면 HEMA No별 B.C 분포가 표시됩니다."}
        </p>
      ) : loading ? (
        <p className="text-sm text-slate-400 py-16 text-center">불러오는 중...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-400 py-16 text-center bg-white border border-slate-200 rounded-lg">
          조건에 맞는 데이터가 없습니다.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <BcHeatmapTable
              key={`${g.model}-${g.mold}`}
              group={g}
              rowLabel={mode === "hema" ? "HEMA No" : "작업월"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 형명+몰드코드 조합 하나 = 표 하나(참고 캡쳐와 같은 레이아웃). 몰드코드별로 B.C 실측값
// 범위가 다르므로(품목마다 규격이 다름) 구간(bins) 자체가 그룹마다 다르다 — 그래서 여러
// 몰드코드를 한 표에 합치지 않고 몰드코드 그룹마다 표를 따로 그린다. 형명/몰드코드 셀은
// 그 표의 행(HEMA No 상세는 HEMA No별, 요약은 작업월별 한 줄씩) 전체에 걸쳐 rowSpan으로
// 병합한다.
function BcHeatmapTable({ group, rowLabel }: { group: BcDistributionGroup; rowLabel: string }) {
  const { model, mold, specBc, bins, rows } = group;
  const specBinIdx =
    specBc == null ? -1 : bins.findIndex((b) => specBc >= b - 1e-9 && specBc < b + 0.05 - 1e-9);
  const maxPct = Math.max(0, ...rows.flatMap((l) => l.values));
  const totalSamples = rows.reduce((s, l) => s + l.sampleCount, 0);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="font-semibold text-sm text-navy">
          {model} <span className="text-slate-400 font-normal mx-1">·</span> {mold}
        </h3>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          {specBc != null && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ boxShadow: `inset 0 0 0 2px ${SPEC_BORDER}` }}
              />
              규격 B.C {specBc}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            낮음
            <span
              className="inline-block w-16 h-2.5 rounded-sm"
              style={{
                background: `linear-gradient(to right, rgba(${HEAT_RGB},0.08), rgba(${HEAT_RGB},1))`,
              }}
            />
            높음
          </span>
          <span>
            {rowLabel} {rows.length}건 · 샘플 {totalSamples.toLocaleString()}건
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse table-fixed w-full">
          <thead>
            <tr>
              <th className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold text-slate-600 text-center whitespace-nowrap w-24">
                몰드코드
              </th>
              <th className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold text-slate-600 text-center whitespace-nowrap w-24">
                형명
              </th>
              <th className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold text-slate-600 text-center whitespace-nowrap w-24">
                {rowLabel}
              </th>
              {bins.map((b, i) => (
                <th
                  key={b}
                  className="border border-slate-300 bg-slate-50 px-2 py-2 font-mono font-semibold text-slate-600 text-center whitespace-nowrap w-20"
                  style={i === specBinIdx ? { boxShadow: `inset 0 0 0 2px ${SPEC_BORDER}` } : undefined}
                >
                  {b.toFixed(2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, li) => (
              <tr key={row.rowKey}>
                {li === 0 && (
                  <td
                    className="border border-slate-300 px-3 py-1.5 text-center font-semibold text-slate-800 align-middle truncate w-24"
                    rowSpan={rows.length}
                    title={mold ?? undefined}
                    style={{ background: MOLD_HEADER_BG }}
                  >
                    {mold}
                  </td>
                )}
                {li === 0 && (
                  <td
                    className="border border-slate-300 px-3 py-1.5 text-center font-medium text-slate-700 align-middle truncate w-24"
                    rowSpan={rows.length}
                    title={model ?? undefined}
                  >
                    {model}
                  </td>
                )}
                <td
                  className="border border-slate-300 px-3 py-1.5 text-center font-mono text-slate-600 truncate w-24"
                  title={row.rowKey ?? undefined}
                >
                  {row.rowKey}
                </td>
                {row.values.map((pct, ci) => {
                  const intensity = maxPct > 0 ? Math.min(1, pct / maxPct) : 0;
                  // 표시 범위(규격 B.C ± 0.25) 밖 실측값은 맨 앞/뒤 칸에 몰아 넣었으므로,
                  // 그 칸에 실제로 범위 밖 값이 섞였을 때만 "&"를 붙여 구분한다.
                  const isOverflowCell =
                    (ci === 0 && row.lowerOverflow) || (ci === bins.length - 1 && row.upperOverflow);
                  const count = row.counts[ci];
                  const cellText =
                    pct > 0 ? `${count.toLocaleString()}(${pct.toFixed(1)}%${isOverflowCell ? "&" : ""})` : "";
                  return (
                    <td
                      key={ci}
                      className="border border-slate-200 px-2 py-1.5 text-center font-mono truncate w-20"
                      title={cellText || undefined}
                      style={{
                        background: pct > 0 ? `rgba(${HEAT_RGB}, ${intensity.toFixed(2)})` : undefined,
                        color: intensity > 0.55 ? "#fff" : "#334155",
                        fontWeight: intensity > 0.55 ? 700 : 500,
                        boxShadow: ci === specBinIdx ? `inset 0 0 0 2px ${SPEC_BORDER}` : undefined,
                      }}
                    >
                      {cellText}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
