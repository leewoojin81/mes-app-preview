"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import type {
  AttendanceAuditItem,
  AttendanceAuditResult,
  AttendanceAuditRow,
  AttendanceAuditRowStatus,
} from "@/lib/attendance-audit";

// No.·사번·성명·공정·근무조·휴가·일자·출근시간·퇴근시간·저장상태(10) + 대사항목6×3(18) +
// 참고항목3×1(3) + 종합상태(1)
const TABLE_COL_COUNT = 32;

interface Me {
  role: string;
  processCodes: string[];
}

// PSN-01과 동일한 9개 항목·순서. kind="compare"는 PSN-01/PSN-02/차이 3열로 일치·불일치를
// 판정하고, kind="reference"는 세콤 근거 자체가 없어 PSN-01 값만 1열로 보여주고
// "참고"로만 표시한다(2026-09-10 사용자 요청 — 일치/불일치 판정 안 함).
const ITEM_DEFS: { key: keyof AttendanceAuditRow["items"]; label: string; kind: "compare" | "reference" }[] = [
  { key: "total", label: "근로시간", kind: "compare" },
  { key: "normal", label: "정상", kind: "compare" },
  { key: "overtime", label: "잔업", kind: "compare" },
  { key: "early_start", label: "조출", kind: "compare" },
  { key: "lunch_shift", label: "중교", kind: "reference" },
  { key: "late", label: "지각", kind: "compare" },
  { key: "early_leave", label: "조퇴", kind: "compare" },
  { key: "outing", label: "외출", kind: "reference" },
  { key: "support", label: "지원시간", kind: "reference" },
];

/** 종합상태 판정과 동일하게, "일치율" 집계에도 실제 대사(비교) 대상 항목만 쓴다. */
const COMPARABLE_ITEM_DEFS = ITEM_DEFS.filter((it) => it.kind === "compare");

interface ProcessStat {
  workGroup: string;
  total: number;
  ok: number;
  mismatch: number;
  rate: number; // 0~100
  itemMismatch: Partial<Record<keyof AttendanceAuditRow["items"], number>>;
}

// 공정별 일치율 = 일치건수 / 대사건수 × 100. "대사건수"는 실제로 세콤 카드와 비교가
// 가능했던(matchStatus === "matched") 행만 센다 — 카드없음/매칭오류는 애초에 일치·
// 불일치를 판정할 수 없는 "데이터 문제"라 분모에 넣으면(둘 다 사실상 "대사 실패"인데)
// 일치율이 실제보다 낮아 보이게 왜곡된다(2026-09-11 사용자 요청, PSN-06 필터 아래
// "공정별 일치율" 시각화). 대상 행이 하나도 없는 공정은 목록에서 아예 뺀다(0%가 아니라
// "판단 불가"이므로).
function computeProcessStats(rows: AttendanceAuditRow[]): ProcessStat[] {
  const buckets = new Map<
    string,
    { total: number; ok: number; mismatch: number; itemMismatch: Partial<Record<keyof AttendanceAuditRow["items"], number>> }
  >();
  for (const r of rows) {
    if (r.matchStatus !== "matched") continue;
    const key = r.work_group ?? "미지정";
    let b = buckets.get(key);
    if (!b) {
      b = { total: 0, ok: 0, mismatch: 0, itemMismatch: {} };
      buckets.set(key, b);
    }
    b.total++;
    if (r.status === "정상") {
      b.ok++;
    } else {
      b.mismatch++;
    }
    for (const def of COMPARABLE_ITEM_DEFS) {
      if (r.items[def.key].mismatch) {
        b.itemMismatch[def.key] = (b.itemMismatch[def.key] ?? 0) + 1;
      }
    }
  }
  const list: ProcessStat[] = Array.from(buckets.entries()).map(([workGroup, b]) => ({
    workGroup,
    total: b.total,
    ok: b.ok,
    mismatch: b.mismatch,
    rate: (b.ok / b.total) * 100,
    itemMismatch: b.itemMismatch,
  }));
  list.sort((a, b) => a.rate - b.rate);
  return list;
}

function rateColor(rate: number): string {
  if (rate >= 90) return "bg-emerald-500";
  if (rate >= 70) return "bg-amber-500";
  return "bg-rose-500";
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

function fmtHours(v: number | null): string {
  if (v == null) return "-";
  if (v === 0) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtDiff(v: number | null): string {
  if (v == null) return "-";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  const s = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return (v > 0 ? "+" : "-") + s;
}

function rowClass(status: AttendanceAuditRowStatus): string {
  if (status === "매칭오류") return "bg-orange-50 hover:bg-orange-100/70";
  if (status === "불일치") return "bg-rose-50 hover:bg-rose-100/70";
  if (status === "카드없음") return "bg-slate-50/60 text-slate-400 hover:bg-slate-100/60";
  return "hover:bg-slate-50";
}

function StatusBadge({ status }: { status: AttendanceAuditRowStatus }) {
  const cls =
    status === "매칭오류"
      ? "bg-orange-100 text-orange-700"
      : status === "불일치"
        ? "bg-rose-100 text-rose-700"
        : status === "카드없음"
          ? "bg-slate-100 text-slate-400"
          : "bg-emerald-50 text-emerald-700";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>;
}

function ItemCells({ item, mismatch }: { item: AttendanceAuditItem; mismatch: boolean }) {
  return (
    <>
      <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtHours(item.psn01)}</td>
      <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtHours(item.psn02)}</td>
      <td
        className={`px-2 py-2 text-right font-mono border-r border-slate-100 ${
          mismatch ? "text-rose-600 font-semibold" : "text-slate-400"
        }`}
      >
        {fmtDiff(item.diff)}
      </td>
    </>
  );
}

// 참고 표시 전용 항목(중교/외출/지원시간) — 세콤 근거가 없어 PSN-01 값만 보여주고
// 일치/불일치 판정 없이 "참고"로만 표시한다. 외출/지원시간은 0보다 크면(실제로 발생한
// 날) 파란색으로 강조한다(2026-09-11 사용자 요청 — 중교는 제외).
function ReferenceCell({ psn01, highlightPositive }: { psn01: number; highlightPositive?: boolean }) {
  const emphasize = highlightPositive && psn01 > 0;
  return (
    <td className="px-2 py-2 text-right border-r border-slate-100">
      <span className={`font-mono ${emphasize ? "text-blue-600 font-semibold" : "text-slate-600"}`}>
        {fmtHours(psn01)}
      </span>
      <span className="ml-1.5 inline-block px-1 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400 align-middle">
        참고
      </span>
    </td>
  );
}

const CHART_LABEL_W = "6rem";
const CHART_VALUE_W = "3.25rem";
const MATCH_RATE_THRESHOLD = 90;

// 공정별 일치율 막대그래프 — 낮은 순(가장 문제 있는 공정 먼저) 정렬해서 받는다(호출부).
// 라벨/막대/수치 3열짜리 CSS grid로 짜서, 90% 기준선 하나를 트랙(가운데) 열에만 걸치는
// 별도 grid item으로 모든 행에 겹쳐 그린다 — 각 막대 트랙 너비가 같은 열이라 기준선
// 위치(left: 90%)가 모든 행에서 정확히 같은 x좌표로 맞아떨어진다.
function ProcessMatchRateChart({ stats }: { stats: ProcessStat[] }) {
  const [hover, setHover] = useState<string | null>(null);
  if (stats.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">대사 가능한 데이터가 없습니다.</p>;
  }
  return (
    <div
      className="grid gap-y-2 gap-x-2"
      style={{ gridTemplateColumns: `${CHART_LABEL_W} 1fr ${CHART_VALUE_W}` }}
    >
      {stats.map((s) => (
        <Fragment key={s.workGroup}>
          <div
            className="text-xs text-slate-600 text-right self-center truncate"
            title={s.workGroup}
          >
            {s.workGroup}
          </div>
          <div
            className="relative h-5 self-center rounded-[4px] bg-slate-100"
            onMouseEnter={() => setHover(s.workGroup)}
            onMouseLeave={() => setHover((h) => (h === s.workGroup ? null : h))}
          >
            <div
              className={`h-5 rounded-r-[4px] ${rateColor(s.rate)}`}
              style={{ width: `${Math.min(100, s.rate)}%` }}
            />
            {hover === s.workGroup && (
              <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1.5 rounded bg-slate-800 px-2.5 py-1.5 text-xs text-white shadow-lg whitespace-nowrap pointer-events-none">
                <p className="font-semibold">{s.workGroup}</p>
                <p>
                  대상 {s.total.toLocaleString()}건 · 일치 {s.ok.toLocaleString()}건 · 불일치{" "}
                  {s.mismatch.toLocaleString()}건
                </p>
                <p>일치율 {s.rate.toFixed(1)}%</p>
              </div>
            )}
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-600 text-right self-center">
            {s.rate.toFixed(1)}%
          </div>
        </Fragment>
      ))}
      <div
        className="relative pointer-events-none"
        style={{ gridColumn: 2, gridRow: `1 / ${stats.length + 1}` }}
      >
        <div
          className="absolute top-0 bottom-0 border-l-2 border-dashed border-slate-400"
          style={{ left: `${MATCH_RATE_THRESHOLD}%` }}
        />
      </div>
    </div>
  );
}

// 세 패널(그래프/요약표/항목별 표) 공통 카드 뼈대 — 제목만 다르게 받는다.
function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-3 min-w-0">
      <p className="text-xs font-semibold text-slate-600">{title}</p>
      {children}
    </div>
  );
}

function NoStatsMessage() {
  return <p className="text-sm text-slate-400 py-6 text-center">대사 가능한 데이터가 없습니다.</p>;
}

function ProcessMatchRateSection({ stats }: { stats: ProcessStat[] }) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-bold text-navy">공정별 일치율</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          조회기간·필터 조건 기준, 대사 가능한(카드 매칭 성공) 건 중 일치 비율 — 낮은 순 정렬
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <StatCard title="공정별 일치율">
          <ProcessMatchRateChart stats={stats} />
          <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap pt-2 border-t border-slate-100">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" /> 90% 이상
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" /> 70~90%
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-500" /> 70% 미만
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t-2 border-dashed border-slate-400" /> 90% 기준선
            </span>
          </div>
        </StatCard>

        <StatCard title="공정별 대상/일치/불일치">
          {stats.length === 0 ? (
            <NoStatsMessage />
          ) : (
            <div className="overflow-auto border border-slate-100 rounded-md">
              <table className="text-xs w-full whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">공정</th>
                    <th className="text-right px-3 py-2 font-semibold">대상건수</th>
                    <th className="text-right px-3 py-2 font-semibold">일치건수</th>
                    <th className="text-right px-3 py-2 font-semibold">불일치건수</th>
                    <th className="text-right px-3 py-2 font-semibold">일치율</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.map((s) => (
                    <tr key={s.workGroup}>
                      <td className="px-3 py-1.5 text-slate-700">{s.workGroup}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                        {s.total.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                        {s.ok.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                        {s.mismatch.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-700">
                        {s.rate.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </StatCard>

        <StatCard title="항목별 불일치 건수">
          {stats.length === 0 ? (
            <NoStatsMessage />
          ) : (
            <div className="overflow-auto border border-slate-100 rounded-md">
              <table className="text-xs w-full whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">공정</th>
                    {COMPARABLE_ITEM_DEFS.map((def) => (
                      <th key={def.key} className="text-right px-3 py-2 font-semibold">
                        {def.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.map((s) => (
                    <tr key={s.workGroup}>
                      <td className="px-3 py-1.5 text-slate-700">{s.workGroup}</td>
                      {COMPARABLE_ITEM_DEFS.map((def) => {
                        const count = s.itemMismatch[def.key] ?? 0;
                        return (
                          <td
                            key={def.key}
                            className={`px-3 py-1.5 text-right font-mono ${
                              count > 0 ? "text-rose-600 font-semibold" : "text-slate-300"
                            }`}
                          >
                            {count.toLocaleString()}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </StatCard>
      </div>
    </div>
  );
}

export default function AttendanceAuditPage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Me) => setMe(data));
  }, []);

  const [dateFrom, setDateFrom] = useTabState("aaDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("aaDateTo", today);
  const [workGroup, setWorkGroup] = useTabState("aaWorkGroup", "");
  const [mismatchOnly, setMismatchOnly] = useTabState("aaMismatchOnly", false);
  const [nameErrorOnly, setNameErrorOnly] = useTabState("aaNameErrorOnly", false);
  const [searchText, setSearchText] = useTabState("aaSearchText", "");

  // 조장 세션이면(그리고 아직 공정을 안 골랐으면) 본인 소속공정을 기본값으로 채운다
  // (PSN-05 근무시간조회와 동일한 관례).
  useEffect(() => {
    if (!me || me.role !== "leader") return;
    if (workGroup) return;
    if (me.processCodes.length === 1) setWorkGroup(me.processCodes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const [result, setResult] = useState<AttendanceAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canQuery = me != null;

  useEffect(() => {
    if (!canQuery || !dateFrom || !dateTo) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ dateFrom, dateTo });
    if (workGroup) qs.set("workGroup", workGroup);
    fetch(`/api/attendance-audit?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "조회에 실패했습니다.");
          setResult(null);
          return;
        }
        setResult(data as AttendanceAuditResult);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canQuery, dateFrom, dateTo, workGroup]);

  const allRows = result?.rows ?? [];
  // 공정별 일치율은 상세 목록의 "불일치만 보기"/"매칭오류만 보기"/검색어 같은 표시용
  // 토글에 영향받지 않고 조회기간·공정 필터만 반영한다(allRows 기준) — 그 토글까지
  // 반영하면 예를 들어 "불일치만 보기"를 켠 순간 일치율이 항상 0%로 왜곡된다.
  const processStats = useMemo(() => computeProcessStats(result?.rows ?? []), [result]);
  const search = searchText.trim().toLowerCase();
  const visibleRows = allRows.filter((r) => {
    if (mismatchOnly && r.status !== "불일치") return false;
    if (nameErrorOnly && r.status !== "매칭오류") return false;
    if (
      search &&
      !r.employee_no.toLowerCase().includes(search) &&
      !r.worker_name.toLowerCase().includes(search)
    )
      return false;
    return true;
  });

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">근태대사</h1>
        <p className="text-sm text-slate-500 mt-1">
          PSN-06 · 일일근태입력(PSN-01)에 저장된 근태기록과 출퇴근카드등록(PSN-02, 세콤
          카드 원본)을 사번 변환 + 이름 교차검증으로 대조해 보여주는 조회 전용
          화면입니다(별도 업로드 없음). 공정은 세콤 근무조를 참고용으로 나란히 보여줄 뿐
          자동으로 맞춰보지 않습니다.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">조회기간 불일치 건수</p>
          <p className="text-2xl font-bold text-rose-600 mt-1">
            {result ? result.summary.periodMismatchCount.toLocaleString() : "-"}
            <span className="text-sm font-normal text-slate-400 ml-1">건</span>
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">조회기간 매칭오류 건수</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">
            {result ? result.summary.nameMismatchCount.toLocaleString() : "-"}
            <span className="text-sm font-normal text-slate-400 ml-1">건</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-500 shrink-0">조회기간</label>
          <DateSegmentInput value={dateFrom} onChange={setDateFrom} />
          <span className="text-slate-400 text-sm">~</span>
          <DateSegmentInput value={dateTo} onChange={setDateTo} />
        </div>
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <select
          value={workGroup}
          onChange={(e) => setWorkGroup(e.target.value)}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            workGroup ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">전체 공정</option>
          {WORK_GROUP_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="사번 · 성명 검색"
          className="border border-slate-300 rounded-md px-2.5 py-2 text-sm w-44"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
          <input
            type="checkbox"
            checked={mismatchOnly}
            onChange={(e) => setMismatchOnly(e.target.checked)}
            className="accent-rose-600"
          />
          불일치만 보기
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
          <input
            type="checkbox"
            checked={nameErrorOnly}
            onChange={(e) => setNameErrorOnly(e.target.checked)}
            className="accent-orange-600"
          />
          매칭오류만 보기
        </label>
      </div>

      {canQuery && !loading && result && <ProcessMatchRateSection stats={processStats} />}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-22rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["No.", "사번", "성명", "공정", "근무조", "휴가", "일자", "출근시간", "퇴근시간", "저장상태"].map((label) => (
                  <th
                    key={label}
                    rowSpan={2}
                    className="text-center px-3 py-2 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] align-middle"
                  >
                    {label}
                    {(label === "출근시간" || label === "퇴근시간") && (
                      <span className="block text-[10px] font-normal text-slate-400">(세콤 PSN-02)</span>
                    )}
                  </th>
                ))}
                {ITEM_DEFS.map((it) => (
                  <th
                    key={it.key}
                    colSpan={it.kind === "compare" ? 3 : 1}
                    className="text-center px-2 py-1.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l border-slate-300/60"
                  >
                    {it.label}
                  </th>
                ))}
                <th
                  rowSpan={2}
                  className="text-center px-3 py-2 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] align-middle border-l border-slate-300/60"
                >
                  종합상태
                </th>
              </tr>
              <tr>
                {ITEM_DEFS.map((it) =>
                  it.kind === "compare" ? (
                    <Fragment key={it.key}>
                      <th className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l border-slate-300/60">
                        PSN-01
                      </th>
                      <th className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                        PSN-02
                      </th>
                      <th className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]">
                        차이
                      </th>
                    </Fragment>
                  ) : (
                    <th
                      key={it.key}
                      className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l border-slate-300/60"
                    >
                      PSN-01
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!canQuery && (
                <tr>
                  <td colSpan={TABLE_COL_COUNT} className="text-center py-10 text-slate-400">
                    사용자 정보를 불러오는 중...
                  </td>
                </tr>
              )}
              {canQuery && loading && (
                <tr>
                  <td colSpan={TABLE_COL_COUNT} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {canQuery && !loading && result && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={TABLE_COL_COUNT} className="text-center py-10 text-slate-400">
                    조건에 맞는 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {canQuery &&
                !loading &&
                result &&
                visibleRows.map((r, idx) => (
                  <tr key={`${r.employee_no}-${r.work_date}`} className={rowClass(r.status)}>
                    <td className="px-3 py-2 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{r.employee_no}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{r.worker_name}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.work_group ?? "-"}
                      {r.card_team && r.card_team !== r.work_group && (
                        <span className="text-slate-400 text-xs ml-1">(세콤: {r.card_team})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.team ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-500">{r.leave_type ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-600">{r.work_date}</td>
                    <td className="px-3 py-2 text-center font-mono text-slate-500">{r.card_punch_in ?? "-"}</td>
                    <td className="px-3 py-2 text-center font-mono text-slate-500">{r.card_punch_out ?? "-"}</td>
                    <td className="px-3 py-2 text-center">
                      {r.has_record ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                          저장됨
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-400">
                          미저장
                        </span>
                      )}
                    </td>
                    {ITEM_DEFS.map((it) =>
                      it.kind === "compare" ? (
                        <ItemCells key={it.key} item={r.items[it.key]} mismatch={r.items[it.key].mismatch} />
                      ) : (
                        <ReferenceCell
                          key={it.key}
                          psn01={r.items[it.key].psn01}
                          highlightPositive={it.key === "outing" || it.key === "support"}
                        />
                      )
                    )}
                    <td className="px-3 py-2 text-center border-l border-slate-100">
                      <StatusBadge status={r.status} />
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
