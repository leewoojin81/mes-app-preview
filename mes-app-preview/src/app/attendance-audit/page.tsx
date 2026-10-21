"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import BizAuditTab from "@/components/BizAuditTab";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import { formatHoursClock } from "@/lib/format-hours";
import { LEAVE_TYPE_OPTIONS } from "@/lib/work-hours-leave";
import type {
  AttendanceAuditItem,
  AttendanceAuditResult,
  AttendanceAuditRow,
  AttendanceAuditRowStatus,
  CardEditCount,
} from "@/lib/attendance-audit";

// No.·사번·성명·공정·근무조·휴가·일자·출근시간·퇴근시간·저장상태(10) + 대사항목6×3(18) +
// 참고항목3×1(3) + 종합상태(1)
const TABLE_COL_COUNT = 32;

const NO_LEAVE = "__none__";

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
// 가능했던(matchStatus === "matched") 행 + "카드누락 의심"으로 status가 "불일치"로 올라간
// 행(matchStatus는 여전히 "no_card"지만 attendance-audit.ts가 근무일·비휴가·카드광범위
// 업로드 조건으로 실제 문제일 가능성이 높다고 판단한 것)을 센다. 순수 "카드없음"(대조 자체가
// 불가능한 정상 상황 — 오늘처럼 업로드 전이거나 휴일이라 원래 카드가 없음)과 "매칭오류"만
// "일치·불일치를 판정할 수 없는 데이터 문제"로 분모에서 뺀다(2026-09-11 사용자 요청).
// 이렇게 해야 상단 "조회기간 불일치 건수"(status==="불일치" 전체 카운트)와 이 표의 불일치
// 합계가 서로 어긋나지 않는다(2026-09-29 사용자 지적 — 카드누락 의심 도입 후 두 숫자가
// 안 맞았던 문제). 대상 행이 하나도 없는 공정은 목록에서 아예 뺀다(0%가 아니라
// "판단 불가"이므로).
function computeProcessStats(rows: AttendanceAuditRow[]): ProcessStat[] {
  const buckets = new Map<
    string,
    { total: number; ok: number; mismatch: number; itemMismatch: Partial<Record<keyof AttendanceAuditRow["items"], number>> }
  >();
  for (const r of rows) {
    if (r.matchStatus !== "matched" && r.status !== "불일치") continue;
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

// 소수 시간(0.5) 대신 "시:분"(0:30)으로 보여준다(2026-09-24 사용자 요청). 0/null은
// 기존 관례(빈 대사 대상은 "-", 실제 0시간은 "0") 그대로 유지한다.
function fmtHours(v: number | null): string {
  if (v == null) return "-";
  if (v === 0) return "0";
  return formatHoursClock(v);
}

function fmtDiff(v: number | null): string {
  if (v == null) return "-";
  if (v === 0) return "0";
  return (v > 0 ? "+" : "-") + formatHoursClock(Math.abs(v));
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
      <td className="px-2 py-2 text-right font-mono text-slate-600 border-l-2 border-slate-200">
        {fmtHours(item.psn01)}
      </td>
      <td className="px-2 py-2 text-right font-mono text-slate-600">{fmtHours(item.psn02)}</td>
      <td
        className={`px-2 py-2 text-right font-mono ${mismatch ? "text-rose-600 font-semibold" : "text-slate-400"}`}
      >
        {fmtDiff(item.diff)}
      </td>
    </>
  );
}

// 참고 표시 전용 항목(중교/외출/지원시간) — 세콤 근거가 없어 PSN-01 값만 보여주고
// 일치/불일치 판정 없이 "참고"로만 표시한다. 외출/지원시간은 0보다 크면(실제로 발생한
// 날) 파란색으로 강조한다(2026-09-11 사용자 요청 — 중교는 제외). 중교만
// 0.51시간을 초과하면(attendance-audit.ts의 buildLunchShiftItem) 불일치와 같은
// 빨간색으로 표기한다(2026-09-24 사용자 요청).
function ReferenceCell({
  psn01,
  highlightPositive,
  mismatch,
}: {
  psn01: number;
  highlightPositive?: boolean;
  mismatch?: boolean;
}) {
  const emphasize = highlightPositive && psn01 > 0;
  return (
    <td className="px-2 py-2 text-right border-l-2 border-slate-200">
      <span
        className={`font-mono ${
          mismatch ? "text-rose-600 font-semibold" : emphasize ? "text-blue-600 font-semibold" : "text-slate-600"
        }`}
      >
        {fmtHours(psn01)}
      </span>
      <span className="ml-1.5 inline-block px-1 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-400 align-middle">
        참고
      </span>
    </td>
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

function ProcessMatchRateSection({
  stats,
  cardEdits,
  allWorkGroups,
}: {
  stats: ProcessStat[];
  cardEdits: CardEditCount[];
  allWorkGroups: string[];
}) {
  // 수정이 없는 공정도 0건으로 보이도록 조회 대상 공정 전체로 먼저 채운다. 수정 많은 순.
  const editRows = useMemo(() => {
    const byGroup = new Map<string, CardEditCount>();
    for (const wg of allWorkGroups) byGroup.set(wg, { workGroup: wg, total: 0, edited: 0 });
    for (const e of cardEdits) byGroup.set(e.workGroup, e);
    return Array.from(byGroup.values()).sort(
      (a, b) => b.edited - a.edited || a.workGroup.localeCompare(b.workGroup, "ko")
    );
  }, [cardEdits, allWorkGroups]);
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-bold text-navy">공정별 일치율</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          조회기간·필터 조건 기준, 대사 가능한(카드 매칭 성공) 건 중 일치 비율 — 낮은 순 정렬
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <StatCard title="공정별 출퇴근카드(PSN-02) 수정 건수">
          {editRows.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">조회된 공정이 없습니다.</p>
          ) : (
            <div className="overflow-auto border border-slate-100 rounded-md">
              <table className="text-xs w-full whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">공정</th>
                    <th className="text-right px-3 py-2 font-semibold">전체</th>
                    <th className="text-right px-3 py-2 font-semibold">수정</th>
                    <th className="text-right px-3 py-2 font-semibold">원본유지율</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editRows.map((g) => (
                    <tr key={g.workGroup}>
                      <td className="px-3 py-1.5 text-slate-700">{g.workGroup}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                        {g.total.toLocaleString()}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-mono ${
                          g.edited > 0 ? "text-rose-600 font-semibold" : "text-slate-300"
                        }`}
                      >
                        {g.edited.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-700">
                        {g.total > 0 ? `${(((g.total - g.edited) / g.total) * 100).toFixed(1)}%` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
  // "" = 전체, NO_LEAVE = 휴가 없음(정상 출근), 그 외 = LEAVE_TYPE_OPTIONS 값
  const [leaveFilter, setLeaveFilter] = useTabState("aaLeaveFilter", "");
  // 근태대사(PSN-01 ↔ 세콤 카드) / 비즈 대사(PSN-01 ↔ 비즈 업로드) 탭(2026-10-01 사용자 요청)
  const [activeTab, setActiveTab] = useTabState<"audit" | "biz">("aaActiveTab", "audit");

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
  const allWorkGroups = useMemo(
    () => Array.from(new Set((result?.rows ?? []).map((r) => r.work_group ?? "미지정"))),
    [result]
  );
  const search = searchText.trim().toLowerCase();
  const visibleRows = allRows.filter((r) => {
    if (mismatchOnly && r.status !== "불일치") return false;
    if (nameErrorOnly && r.status !== "매칭오류") return false;
    if (leaveFilter === NO_LEAVE && r.leave_type) return false;
    if (leaveFilter && leaveFilter !== NO_LEAVE && r.leave_type !== leaveFilter) return false;
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

      <div className="flex items-center gap-1 border-b border-slate-200">
        {(
          [
            { key: "audit", label: "근태대사" },
            { key: "biz", label: "비즈 대사" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 -mb-px text-sm font-semibold border-b-2 transition-colors ${
              activeTab === t.key
                ? "text-navy border-navy"
                : "text-slate-400 border-transparent hover:text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "biz" && <BizAuditTab me={me} />}

      {activeTab === "audit" && (
      <>
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
        <select
          value={leaveFilter}
          onChange={(e) => setLeaveFilter(e.target.value)}
          className={`border rounded-md px-2.5 py-2 text-sm bg-white ${
            leaveFilter ? "border-navy text-navy font-medium" : "border-slate-300 text-slate-600"
          }`}
        >
          <option value="">전체 휴가</option>
          <option value={NO_LEAVE}>휴가 없음</option>
          {LEAVE_TYPE_OPTIONS.map((v) => (
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

      {canQuery && !loading && result && <ProcessMatchRateSection
          stats={processStats}
          cardEdits={result.cardEdits ?? []}
          allWorkGroups={allWorkGroups}
        />}

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
                    className="text-center px-2 py-1.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l-2 border-slate-300"
                  >
                    {it.label}
                  </th>
                ))}
                <th
                  rowSpan={2}
                  className="text-center px-3 py-2 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] align-middle border-l-2 border-slate-300"
                >
                  종합상태
                </th>
              </tr>
              <tr>
                {ITEM_DEFS.map((it) =>
                  it.kind === "compare" ? (
                    <Fragment key={it.key}>
                      <th className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l-2 border-slate-300">
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
                      className="text-center px-2 py-1.5 font-medium sticky top-[29px] z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] border-l-2 border-slate-300"
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
                          mismatch={it.key === "lunch_shift" ? r.items[it.key].mismatch : undefined}
                        />
                      )
                    )}
                    <td className="px-3 py-2 text-center border-l-2 border-slate-200">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
