"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import {
  BIZ_AUDIT_ITEM_KEYS,
  BIZ_AUDIT_ITEM_LABELS,
  type BizAuditResult,
  type BizAuditRow,
  type BizAuditStatus,
} from "@/lib/biz-audit-shared";

// 인원관리(PSN-06) "비즈 대사" 탭 — PSN-05 비즈 탭에 올려 둔 비즈 근무관리 값과 MES(PSN-01) 저장값을
// 사번+일자로 대조한다(2026-10-01 사용자 요청). 특근/지원시간처럼 두 시스템이 같은 시간을 다른 칸에
// 적는 구조 차이는 미리 합쳐서 비교하고, 남은 차이는 사유를 붙여 보여준다.

interface Me {
  role: string;
  processCodes: string[];
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}
function firstDayOfMonth(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

function fmtMin(min: number): string {
  if (min === 0) return "";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}
function fmtDiff(min: number): string {
  if (min === 0) return "";
  return `${min < 0 ? "-" : "+"}${Math.floor(Math.abs(min) / 60)}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
}

function rowClass(status: BizAuditStatus): string {
  if (status === "불일치") return "bg-rose-50/60 hover:bg-rose-50";
  if (status === "비즈만" || status === "MES만") return "bg-amber-50/70 hover:bg-amber-50";
  return "hover:bg-slate-50";
}

function StatusBadge({ status }: { status: BizAuditStatus }) {
  const cls =
    status === "일치"
      ? "bg-emerald-50 text-emerald-700"
      : status === "불일치"
        ? "bg-rose-100 text-rose-700"
        : "bg-amber-100 text-amber-700";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>;
}

function StatCard({ title, value, unit, tone }: { title: string; value: string; unit?: string; tone: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 shadow-sm">
      <p className="text-xs text-slate-500">{title}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>
        {value}
        {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

const thBase =
  "text-center px-2 py-2 font-semibold sticky z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0] align-middle";

export default function BizAuditTab({ me }: { me: Me | null }) {
  const [dateFrom, setDateFrom] = useTabState("bzaDateFrom", firstDayOfMonth);
  const [dateTo, setDateTo] = useTabState("bzaDateTo", today);
  const [workGroup, setWorkGroup] = useTabState("bzaWorkGroup", "");
  const [searchText, setSearchText] = useTabState("bzaSearchText", "");
  const [diffOnly, setDiffOnly] = useTabState("bzaDiffOnly", true);
  const [causeFilter, setCauseFilter] = useTabState("bzaCause", "");
  const [showUnmatched, setShowUnmatched] = useState(false);

  useEffect(() => {
    if (!me || me.role !== "leader") return;
    if (workGroup) return;
    if (me.processCodes.length === 1) setWorkGroup(me.processCodes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const [result, setResult] = useState<BizAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canQuery = me != null;

  useEffect(() => {
    if (!canQuery || !dateFrom || !dateTo) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ dateFrom, dateTo });
    if (workGroup) qs.set("workGroup", workGroup);
    fetch(`/api/attendance-audit/biz?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "조회에 실패했습니다.");
          setResult(null);
          return;
        }
        setResult(data as BizAuditResult);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canQuery, dateFrom, dateTo, workGroup]);

  const search = searchText.trim().toLowerCase();
  const visibleRows: BizAuditRow[] = useMemo(() => {
    return (result?.rows ?? []).filter((r) => {
      if (diffOnly && r.status === "일치") return false;
      if (causeFilter && !r.causes.includes(causeFilter)) return false;
      if (
        search &&
        !r.employee_no.toLowerCase().includes(search) &&
        !r.biz_no.includes(search) &&
        !r.worker_name.toLowerCase().includes(search)
      )
        return false;
      return true;
    });
  }, [result, diffOnly, causeFilter, search]);

  function downloadExcel() {
    const qs = new URLSearchParams({ dateFrom, dateTo, onlyDiff: diffOnly ? "1" : "0" });
    if (workGroup) qs.set("workGroup", workGroup);
    if (search) qs.set("q", searchText.trim());
    if (causeFilter) qs.set("cause", causeFilter);
    window.location.href = `/api/attendance-audit/biz/export?${qs.toString()}`;
  }

  const s = result?.summary;
  const noBizData = result != null && s != null && s.bizFrom == null;
  const outsideBizRange = result != null && s != null && s.bizFrom != null && s.comparedRows === 0 && !workGroup;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        PSN-05 비즈 탭에 올려 둔 비즈 "기간별 근무관리" 값과 MES(일일근태입력 PSN-01) 저장값을 사번+일자로
        대조합니다. 비즈 사번은 작업자등록의 비즈 사번으로 연결하며, 같은 시간을 두 시스템이 다른 칸에 적는 경우는
        합쳐서 비교합니다 — 정근은 비즈 정근+특근 ↔ MES 정상+지원(8시간 한도), 연장은 비즈 연장+특연 ↔ MES
        잔업+조출+중교(+8시간 초과 지원). 10분 이하 차이는 같은 값으로 봅니다.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          title="일치율"
          value={s?.matchRate != null ? `${(s.matchRate * 100).toFixed(1)}` : "-"}
          unit={s?.matchRate != null ? "%" : undefined}
          tone="text-navy"
        />
        <StatCard title="비교 행(인원×일자)" value={s ? s.comparedRows.toLocaleString() : "-"} unit="건" tone="text-slate-700" />
        <StatCard title="불일치" value={s ? s.mismatchRows.toLocaleString() : "-"} unit="건" tone="text-rose-600" />
        <StatCard title="비즈에만 근무" value={s ? s.bizOnlyRows.toLocaleString() : "-"} unit="건" tone="text-amber-600" />
        <StatCard title="MES에만 근무" value={s ? s.mesOnlyRows.toLocaleString() : "-"} unit="건" tone="text-amber-600" />
      </div>

      {s && s.excludedDates.length > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          비즈에 아직 반영되지 않은 일자는 비교에서 뺐습니다 —{" "}
          {s.excludedDates.map((d) => `${d.date}(비즈 ${d.bizRows}건 / MES ${d.mesRows}건)`).join(", ")}. 비즈 엑셀을
          최신으로 다시 업로드하면 포함됩니다.
        </p>
      )}

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
            checked={diffOnly}
            onChange={(e) => setDiffOnly(e.target.checked)}
            className="accent-rose-600"
          />
          차이만 보기
        </label>
        <button
          onClick={downloadExcel}
          disabled={visibleRows.length === 0}
          className="ml-auto px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 transition-colors"
        >
          엑셀 다운로드
        </button>
      </div>

      {s && s.byCause.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 mb-2">
            차이 사유 <span className="font-normal text-slate-400">(눌러서 해당 사유만 보기)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {s.byCause.map((c) => (
              <button
                key={c.cause}
                onClick={() => setCauseFilter(causeFilter === c.cause ? "" : c.cause)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  causeFilter === c.cause
                    ? "bg-navy text-white border-navy"
                    : "bg-white text-slate-600 border-slate-300 hover:border-navy"
                }`}
              >
                {c.cause} <span className="font-semibold">{c.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            항목별 불일치 —{" "}
            {BIZ_AUDIT_ITEM_KEYS.map((k) => `${BIZ_AUDIT_ITEM_LABELS[k]} ${s.byItem[k].toLocaleString()}건`).join(" · ")}
          </p>
        </div>
      )}

      {s && s.unmatchedPersons.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-sm">
          <button onClick={() => setShowUnmatched((v) => !v)} className="text-xs text-slate-600 hover:text-navy">
            {showUnmatched ? "▼" : "▶"} 작업자등록에 비즈 사번이 없어 대사하지 못한 비즈 인원 {s.unmatchedPersons.length}명
            (사무직 등)
          </button>
          {showUnmatched && (
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {s.unmatchedPersons.map((p) => `${p.dept ?? "-"}/${p.name ?? p.biz_no}`).join(" · ")}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-24rem)]">
          <table className="text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                {["No.", "사번", "성명", "공정", "비즈부서", "일자", "타임", "출근", "퇴근"].map((l) => (
                  <th key={l} rowSpan={2} className={`${thBase} top-0`}>
                    {l}
                    {(l === "출근" || l === "퇴근") && <span className="block text-[10px] font-normal text-slate-400">(비즈)</span>}
                  </th>
                ))}
                {BIZ_AUDIT_ITEM_KEYS.map((k) => (
                  <th key={k} colSpan={3} className={`${thBase} top-0 border-l-2 border-slate-300`}>
                    {BIZ_AUDIT_ITEM_LABELS[k]}
                  </th>
                ))}
                <th rowSpan={2} className={`${thBase} top-0 border-l-2 border-slate-300`}>
                  상태
                </th>
                <th rowSpan={2} className={`${thBase} top-0`}>
                  사유
                </th>
              </tr>
              <tr>
                {BIZ_AUDIT_ITEM_KEYS.map((k) => (
                  <Fragment key={k}>
                    <th className={`${thBase} top-[2.1rem] border-l-2 border-slate-300 text-[11px]`}>비즈</th>
                    <th className={`${thBase} top-[2.1rem] text-[11px]`}>MES</th>
                    <th className={`${thBase} top-[2.1rem] text-[11px]`}>차이</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={24} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && result && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={24} className="text-center py-10 text-slate-400">
                    {noBizData
                      ? "업로드된 비즈 데이터가 없습니다. PSN-05 비즈 탭에서 비즈 엑셀을 업로드해 주세요."
                      : outsideBizRange
                        ? `이 기간에는 비교할 데이터가 없습니다. 비즈 업로드 기간: ${s?.bizFrom} ~ ${s?.bizTo}`
                        : diffOnly && (s?.comparedRows ?? 0) > 0
                          ? "차이가 있는 항목이 없습니다."
                          : "조건에 맞는 데이터가 없습니다."}
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, i) => (
                  <tr key={`${r.employee_no}-${r.work_date}`} className={rowClass(r.status)}>
                    <td className="px-2 py-1.5 text-center text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500">{r.employee_no}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-700">{r.worker_name}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.work_group ?? "-"}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.dept ?? ""}</td>
                    <td className="px-2 py-1.5 text-slate-600">{r.work_date}</td>
                    <td className="px-2 py-1.5 text-center text-slate-500">{r.shift ?? ""}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500">{r.in_time ?? ""}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500">{r.out_time ?? ""}</td>
                    {BIZ_AUDIT_ITEM_KEYS.map((k) => {
                      const it = r.items[k];
                      return (
                        <Fragment key={k}>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-600 border-l-2 border-slate-200">{fmtMin(it.biz)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-600">{fmtMin(it.mes)}</td>
                          <td
                            className={`px-2 py-1.5 text-right font-mono ${
                              it.mismatch ? "text-rose-600 font-semibold" : "text-slate-300"
                            }`}
                          >
                            {it.mismatch ? fmtDiff(it.diff) : ""}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center border-l-2 border-slate-200">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-2 py-1.5 text-xs text-slate-500">
                      {r.causes.join(", ")}
                      {r.note ? <span className="text-slate-400"> · 비즈 비고: {r.note}</span> : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!loading && result && (
          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
            표시 {visibleRows.length.toLocaleString()}건 / 비교 {s?.comparedRows.toLocaleString()}건 · 차이 = MES − 비즈
          </div>
        )}
      </div>
    </div>
  );
}
