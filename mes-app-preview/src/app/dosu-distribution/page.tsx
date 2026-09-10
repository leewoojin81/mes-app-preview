"use client";

import { useEffect, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import type {
  DosuDistributionFiltersResponse,
  DosuDistributionGroup,
  DosuDistributionResponse,
} from "@/lib/types";

// 몰드코드 그룹 헤더 셀 배경 — B.C/직경 분포 분석(QC-02/03)과 같은 연두색을 재사용한다.
const MOLD_HEADER_BG = "#C6E0B4";
// 히트맵 채움색(파란 계열, 단일 hue) — 값이 클수록 진하게.
const HEAT_RGB = "37, 99, 235";
// 지시도수(기준값)가 속한 구간을 강조하는 테두리색 — B.C/직경 분포 분석(QC-02/03)과 동일.
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

// 도수(다이옵터)는 부호를 항상 명시하는 표기 관례를 따른다 — 0은 "0.00", 양수는
// "+1.75"처럼 플러스를 붙이고, 음수는 toFixed(2)가 이미 붙이는 마이너스를 그대로 쓴다
// (참고 엑셀 도수분포분석.xlsx의 표기와 동일).
function formatSignedDosu(v: number): string {
  if (Math.abs(v) < 1e-9) return "0.00";
  return (v > 0 ? "+" : "") + v.toFixed(2);
}

type Mode = "summary" | "hema";

export default function DosuDistributionPage() {
  const [model, setModel] = useTabState("doModel", "");
  const [mold, setMold] = useTabState("doMold", "");
  // 지시도수 필터 — 값은 문자열로 들고 있다가(select value) 쿼리 파라미터로 그대로
  // 보낸다. 몰드코드/형명이 바뀌면 그 아래 축인 도수 옵션도 달라지므로 함께 초기화한다.
  const [dosu, setDosu] = useTabState("doDosu", "");
  const [dateFrom, setDateFrom] = useTabState("doDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("doDateTo", today);
  // 형명·몰드 요약(=몰드 전체 가능, work_date를 월 단위로 잘라 행을 만든다) / HEMA No
  // 상세(=몰드 하나를 골라 HEMA No별로 쪼갬) 2단 토글 — B.C/직경 분포 분석과 동일.
  const [mode, setMode] = useTabState<Mode>("doMode", "summary");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [moldOptions, setMoldOptions] = useState<string[]>([]);
  const [dosuOptions, setDosuOptions] = useState<number[]>([]);
  const [groups, setGroups] = useState<DosuDistributionGroup[]>([]);
  const [loading, setLoading] = useState(false);

  function buildParams() {
    const params = new URLSearchParams();
    if (model) params.set("model", model);
    if (mold) params.set("mold", mold);
    if (dosu) params.set("dosu", dosu);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }

  // 몰드코드/형명 드롭다운 옵션 — "몰드코드 우선" 필터(B.C/직경 분포 분석과 동일). 몰드
  // 코드는 항상 날짜 범위 전체 기준으로 보여주고, 형명은 선택된 몰드코드(+기간) 안에서
  // 실제 존재하는 품목코드를 dosu_change_status 조립투입품목으로 매핑해 좁힌다.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dosu-distribution/filters?${buildParams().toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: DosuDistributionFiltersResponse) => {
        if (cancelled) return;
        setModelOptions(data.models ?? []);
        setMoldOptions(data.molds ?? []);
        setDosuOptions(data.dosuOptions ?? []);
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
    fetch(`/api/dosu-distribution?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: DosuDistributionResponse) => {
        if (cancelled) return;
        setGroups(data.groups ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, mold, dosu, dateFrom, dateTo, mode]);

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">형명별/몰드별/지시도수별 도수 분포 분석</h1>
        <p className="text-sm text-slate-500 mt-1">
          QC-04 · 일일작업현황(PROD-10) 데이터를 도수1/도수2/도수3 샘플 단위로 재집계 ·
          형명+몰드코드+지시도수 조합마다 별도 표(지시도수 내림차순 나열) · 지시도수를
          정중앙에 둔 1/8D 간격 11칸 분포 히트맵 · 형명·몰드 요약(작업월별) 또는
          HEMA No별 상세는 우측 토글에서 전환
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
            setDosu("");
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
          onChange={(e) => {
            setModel(e.target.value);
            setDosu("");
          }}
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
        <select
          value={dosu}
          onChange={(e) => setDosu(e.target.value)}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white font-mono ${
            dosu ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">도수 전체</option>
          {dosuOptions.map((d) => (
            <option key={d} value={String(d)}>
              {formatSignedDosu(d)}
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
          {!model ? "형명을 선택하세요." : "몰드코드를 선택하면 HEMA No별 도수 분포가 표시됩니다."}
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
            <DosuHeatmapTable
              key={`${g.model}-${g.mold}-${g.targetDosu}`}
              group={g}
              rowLabel={mode === "hema" ? "HEMA No" : "작업월"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 형명+몰드코드+지시도수 조합 하나 = 표 하나(2026-08-26 사용자 요청, 참고 엑셀
// 도수분포분석.xlsx 구조 — B.C/직경 분포 분석은 형명+몰드 두 축이었지만, 도수는 같은
// 형명·몰드코드 안에도 서로 다른 목표 파워가 섞여 있어 지시도수까지 축에 넣어 표를
// 더 잘게 쪼갠다). 표 안 구간(bins)은 그 표의 지시도수를 정중앙에 두고 좌우 5칸씩
// 고정이라 그룹마다 창 위치만 다를 뿐 폭은 항상 같다. 몰드코드/형명/도수 셀은 그
// 표의 행(HEMA No 상세는 HEMA No별, 요약은 작업월별 한 줄씩) 전체에 걸쳐 rowSpan으로
// 병합한다.
function DosuHeatmapTable({
  group,
  rowLabel,
}: {
  group: DosuDistributionGroup;
  rowLabel: string;
}) {
  const { model, mold, targetDosu, bins, rows } = group;
  // 표 구간(bins)은 항상 지시도수를 정중앙(가운데 칸)에 두고 만들어지므로, 가운데
  // 인덱스가 곧 이 표의 기준(지시도수) 칸이다 — B.C/직경 분포 분석의 specBinIdx와
  // 같은 역할을 하는 강조 표시.
  const specBinIdx = Math.floor(bins.length / 2);
  const maxPct = Math.max(0, ...rows.flatMap((l) => l.values));
  const totalSamples = rows.reduce((s, l) => s + l.sampleCount, 0);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="font-semibold text-sm text-navy">
          {model} <span className="text-slate-400 font-normal mx-1">·</span> {mold}
          <span className="text-slate-400 font-normal mx-1">·</span> 지시도수{" "}
          {formatSignedDosu(targetDosu)}
        </h3>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ boxShadow: `inset 0 0 0 2px ${SPEC_BORDER}` }}
            />
            기준 지시도수 {formatSignedDosu(targetDosu)}
          </span>
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
              <th className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold text-slate-600 text-center whitespace-nowrap w-20">
                도수
              </th>
              <th className="border border-slate-300 bg-slate-50 px-3 py-2 font-semibold text-slate-600 text-center whitespace-nowrap w-24">
                {rowLabel}
              </th>
              {bins.map((b, i) => (
                <th
                  key={i}
                  className="border border-slate-300 bg-slate-50 px-2 py-2 font-mono font-semibold text-slate-600 text-center whitespace-nowrap w-20"
                  style={i === specBinIdx ? { boxShadow: `inset 0 0 0 2px ${SPEC_BORDER}` } : undefined}
                >
                  {formatSignedDosu(b)}
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
                {li === 0 && (
                  <td
                    className="border border-slate-300 px-3 py-1.5 text-center font-mono font-medium text-slate-700 align-middle truncate w-20"
                    rowSpan={rows.length}
                  >
                    {formatSignedDosu(targetDosu)}
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
                  // bins가 내림차순(왼쪽=큰 값, 오른쪽=작은 값)이라, 맨 왼쪽 칸(ci===0)은
                  // 지시도수+0.625D보다 높은 값(upperOverflow)을, 맨 오른쪽 칸은
                  // 지시도수-0.625D보다 낮은 값(lowerOverflow)을 몰아 넣는다 — 그 칸에
                  // 실제로 범위 밖 값이 섞였을 때만 "&"를 붙여 구분한다.
                  const isOverflowCell =
                    (ci === 0 && row.upperOverflow) || (ci === bins.length - 1 && row.lowerOverflow);
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
