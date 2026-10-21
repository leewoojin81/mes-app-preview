"use client";

import { useEffect, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import { effectiveHeadcount } from "@/lib/plan-headcount";
import type { LineCapaResult } from "@/lib/types";

// 입력칸에서 엔터를 치면 같은 열의 다음 행으로 포커스를 옮긴다(엑셀 느낌의 연속 입력,
// 2026-09-13 사용자 요청) — 포커스가 옮겨가며 발생하는 blur가 그대로 저장을 트리거한다.
function focusId(id: string) {
  document.getElementById(id)?.focus();
}

// "공정별 계획" DAY 입력칸에 천단위 쉼표를 붙여 보여준다(2026-09-13 사용자 요청) — 저장
// 시에는 stripThousands로 쉼표를 떼고 숫자로 바꾼다.
function formatThousandsDraft(raw: string): string {
  let clean = raw.replace(/[^0-9.]/g, "");
  const firstDot = clean.indexOf(".");
  if (firstDot !== -1) {
    clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, "");
  }
  if (clean === "" || clean === ".") return clean;
  const [intPart, decPart] = clean.split(".");
  const formattedInt = intPart === "" ? "" : Number(intPart).toLocaleString("ko-KR");
  return decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
}

function stripThousands(s: string): string {
  return s.replace(/,/g, "");
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function currentYearMonth(): string {
  return toLocalDateStr(new Date());
}

export default function PlanInfoPage() {
  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy">계획정보</h1>
        <p className="text-sm text-slate-500 mt-1">PLAN-02</p>
      </div>

      <LineCapaPlanTab />
    </div>
  );
}

function fmtNum(n: number | null, digits = 0): string {
  if (n == null) return "-";
  return Number(n.toFixed(digits)).toLocaleString("ko-KR");
}

function LineCapaPlanTab() {
  const [yearMonth, setYearMonth] = useTabState("lineCapaYearMonth", currentYearMonth);
  const [result, setResult] = useState<LineCapaResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [remarkDrafts, setRemarkDrafts] = useState<Record<string, string>>({});
  // 인원 칸은 직접 입력하는 텍스트(2026-10-01 사용자 요청) — 비워두면 자동 집계 인원을 안내문으로 보여준다.
  const [headDrafts, setHeadDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // silent=true는 칸 저장 직후 재조회용 — 표를 "불러오는 중..."으로 바꾸면 입력칸이 전부 사라져
  // 엔터로 아래 칸에 옮겨 둔 커서(포커스)가 날아가므로(2026-10-01 사용자 요청: Day/비고 입력 후
  // 엔터 시 아래로 이동) 표를 그대로 둔 채 계산 값(월CAPA·UPH 등)만 갱신하고, 지금 입력 중인
  // 다른 칸의 입력값은 덮어쓰지 않는다.
  function load(silent = false) {
    if (!silent) setLoading(true);
    fetch(`/api/line-capa-plan?yearMonth=${yearMonth}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: LineCapaResult) => {
        setResult(data);
        if (silent) return;
        setDrafts(
          Object.fromEntries(
            data.rows.map((r) => [r.key, r.dailyCapa != null ? r.dailyCapa.toLocaleString("ko-KR") : ""])
          )
        );
        setRemarkDrafts(Object.fromEntries(data.rows.map((r) => [r.key, r.remark ?? ""])));
        setHeadDrafts(Object.fromEntries(data.rows.map((r) => [r.key, r.headcountText ?? ""])));
        setLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [yearMonth]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  async function saveCapa(lineKey: string) {
    const raw = stripThousands(drafts[lineKey] ?? "");
    const dailyCapa = raw.trim() === "" ? null : Number(raw);
    if (dailyCapa != null && !Number.isFinite(dailyCapa)) {
      setToast("공정별 계획은 숫자여야 합니다.");
      return;
    }
    setSavingKey(`${lineKey}:capa`);
    try {
      const res = await fetch("/api/line-capa-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, lineKey, dailyCapa }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      load(true);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveHeadcountText(lineKey: string) {
    const headcountText = headDrafts[lineKey] ?? "";
    setSavingKey(`${lineKey}:head`);
    try {
      const res = await fetch("/api/line-capa-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, lineKey, headcountText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      load(true);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveRemark(lineKey: string) {
    const remark = remarkDrafts[lineKey] ?? "";
    setSavingKey(`${lineKey}:remark`);
    try {
      const res = await fetch("/api/line-capa-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, lineKey, remark }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다.");
      load(true);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSavingKey(null);
    }
  }

  // 칸마다 blur/엔터로도 바로 저장되지만, 여러 칸을 한 번에 입력한 뒤 눌러서 화면에
  // 남아있는 입력값을 통째로 저장 확인할 수 있는 버튼도 따로 둔다(2026-09-13 사용자 요청).
  async function saveAllLineCapa() {
    if (!result) return;
    setSavingAll(true);
    try {
      const results = await Promise.all(
        result.rows.flatMap((r) => {
          const tasks: Promise<boolean>[] = [];
          if (!r.isIndirect) {
            const raw = stripThousands(drafts[r.key] ?? "");
            const dailyCapa = raw.trim() === "" ? null : Number(raw);
            if (dailyCapa == null || Number.isFinite(dailyCapa)) {
              tasks.push(
                fetch("/api/line-capa-plan", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ yearMonth, lineKey: r.key, dailyCapa }),
                }).then((res) => res.ok)
              );
            }
          }
          tasks.push(
            fetch("/api/line-capa-plan", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ yearMonth, lineKey: r.key, remark: remarkDrafts[r.key] ?? "" }),
            }).then((res) => res.ok)
          );
          // 사출_하는 사출_상 인원 칸에 병합돼 있어 따로 저장하지 않는다
          if (r.key !== "injection_lower") {
            tasks.push(
              fetch("/api/line-capa-plan", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ yearMonth, lineKey: r.key, headcountText: headDrafts[r.key] ?? "" }),
              }).then((res) => res.ok)
            );
          }
          return tasks;
        })
      );
      load();
      setToast(results.every(Boolean) ? "저장했습니다." : "일부 저장에 실패했습니다.");
    } catch {
      setToast("저장에 실패했습니다.");
    } finally {
      setSavingAll(false);
    }
  }

  const thCls = "text-center px-3 py-2.5 font-semibold sticky top-0 z-10 bg-[#D9E1F2] shadow-[inset_0_-1px_0_#e2e8f0]";

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        라인별(BASE-04 세부공정 묶음) 인원(BASE-09 자동 집계)·근무시간(8시간 고정)·근무일수
        (BASE-08 생산캘린더 자동 계산)·생산성(UPH)·운영계획을 조회합니다. &quot;공정별
        계획&quot;(라인별 일CAPA)과 &quot;비고&quot;만 매달 직접 입력하는 값이며, 값을 비운
        채 저장하면 지워집니다. 간접직은 CAPA 개념이 없어 입력할 수 없고, 비고를 비워두면
        소속 인원 자동 집계 텍스트를 대신 보여줍니다.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-medium text-slate-500">조회 기준월</label>
        <input
          type="month"
          value={yearMonth}
          onChange={(e) => e.target.value && setYearMonth(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white"
        />
        <button
          onClick={() => {
            window.location.href = `/api/line-capa-plan/export?yearMonth=${yearMonth}`;
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
        >
          엑셀 다운로드
        </button>
        <button
          onClick={saveAllLineCapa}
          disabled={savingAll || loading}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:bg-navy/90 transition-colors disabled:opacity-40"
        >
          {savingAll ? "저장 중..." : "저장"}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-19rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9E1F2] text-slate-500 text-xs">
              <tr>
                <th rowSpan={2} className={thCls}>
                  라인별
                </th>
                <th rowSpan={2} className={thCls}>
                  인원
                </th>
                <th rowSpan={2} className={thCls}>
                  근무시간
                  <span className="block text-[10px] font-normal text-slate-400">(Day)</span>
                </th>
                <th rowSpan={2} className={thCls}>
                  근무일수
                  <span className="block text-[10px] font-normal text-slate-400">(Month)</span>
                </th>
                <th colSpan={2} className={thCls}>
                  공정별 계획
                </th>
                <th rowSpan={2} className={thCls}>
                  생산성
                  <span className="block text-[10px] font-normal text-slate-400">(UPH)</span>
                </th>
                <th rowSpan={2} className={thCls}>
                  비고
                </th>
              </tr>
              <tr>
                <th className={thCls}>Day</th>
                <th className={thCls}>Month</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading &&
                result?.rows.map((r, i) => {
                  // 사출_상/사출_하는 실제로는 같은 사출(P100) 인원이 담당하는 한 라인이라
                  // 인원·근무시간·근무일수가 항상 동일하다(2026-09-13 사용자 요청) — 사출_상
                  // 행에서 두 행에 걸쳐 병합해 보여주고, 사출_하 행에서는 그 칸들을 생략한다.
                  // "공정별 계획"(일CAPA)은 라인마다 다를 수 있어 병합하지 않고 그대로 둔다.
                  // "생산성(UPH)"도 같은 이유로 병합하되, 두 라인의 일CAPA를 합쳐서 같은
                  // 인원 기준으로 다시 계산한다(2026-09-13 사용자 요청 — 한쪽만 보면 실제
                  // 그 인원이 뽑아내는 총생산성을 알 수 없어서).
                  const mergeStatsDown = r.key === "injection_upper";
                  const skipStatsCells = r.key === "injection_lower";
                  const nextCapaRow = result.rows.slice(i + 1).find((x) => !x.isIndirect);
                  const nextRemarkKey = result.rows[i + 1]?.key;
                  const nextHeadRow = result.rows.slice(i + 1).find((x) => x.key !== "injection_lower");
                  const injectionLowerRow = mergeStatsDown
                    ? result.rows.find((x) => x.key === "injection_lower")
                    : undefined;
                  const mergedInjectionUph = mergeStatsDown
                    ? (() => {
                        const combinedCapa = (r.dailyCapa ?? 0) + (injectionLowerRow?.dailyCapa ?? 0);
                        if (r.dailyCapa == null && injectionLowerRow?.dailyCapa == null) return null;
                        return r.headcountEffective > 0 ? combinedCapa / (r.headcountEffective * r.hoursPerDay) : null;
                      })()
                    : null;
                  return (
                  <tr key={r.key} className="hover:bg-slate-50 border-b border-slate-200">
                    <td className="px-3 py-2.5 font-medium text-slate-700 text-center">{r.label}</td>
                    {!skipStatsCells && (
                      <>
                        <td className="px-2 py-1.5 text-center" rowSpan={mergeStatsDown ? 2 : undefined}>
                          <input
                            id={`lc-head-${r.key}`}
                            value={headDrafts[r.key] ?? ""}
                            onChange={(e) => setHeadDrafts((prev) => ({ ...prev, [r.key]: e.target.value }))}
                            onBlur={() => saveHeadcountText(r.key)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              if (nextHeadRow) focusId(`lc-head-${nextHeadRow.key}`);
                            }}
                            placeholder={`${r.headcount.toLocaleString()} 명`}
                            className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-center font-mono placeholder:text-slate-500 placeholder:not-italic"
                          />
                        </td>
                        <td
                          className="px-3 py-2.5 text-center font-mono"
                          rowSpan={mergeStatsDown ? 2 : undefined}
                        >
                          {r.hoursPerDay.toFixed(2)} hr
                        </td>
                        <td
                          className="px-3 py-2.5 text-center font-mono"
                          rowSpan={mergeStatsDown ? 2 : undefined}
                        >
                          {r.workDays.toLocaleString()} 일
                        </td>
                      </>
                    )}
                    <td className="px-2 py-1.5 text-center">
                      {r.isIndirect ? (
                        <span className="block text-center text-slate-300 px-2">-</span>
                      ) : (
                        <input
                          id={`lc-capa-${r.key}`}
                          value={drafts[r.key] ?? ""}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [r.key]: formatThousandsDraft(e.target.value) }))
                          }
                          onBlur={() => saveCapa(r.key)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            if (nextCapaRow) focusId(`lc-capa-${nextCapaRow.key}`);
                          }}
                          placeholder="-"
                          className="w-28 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-center font-mono disabled:opacity-50"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-slate-500">{fmtNum(r.monthlyCapa)}</td>
                    {!skipStatsCells && (
                      <td
                        className="px-3 py-2.5 text-center font-mono text-slate-500"
                        rowSpan={mergeStatsDown ? 2 : undefined}
                      >
                        {mergeStatsDown
                          ? mergedInjectionUph == null
                            ? "-"
                            : fmtNum(mergedInjectionUph, 1)
                          : r.uph == null
                            ? "-"
                            : fmtNum(r.uph, 1)}
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <input
                        id={`lc-remark-${r.key}`}
                        value={remarkDrafts[r.key] ?? ""}
                        onChange={(e) =>
                          setRemarkDrafts((prev) => ({ ...prev, [r.key]: e.target.value }))
                        }
                        onBlur={() => saveRemark(r.key)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          if (nextRemarkKey) focusId(`lc-remark-${nextRemarkKey}`);
                        }}
                        placeholder={r.defaultRemark ?? "-"}
                        className="w-64 border border-slate-300 rounded-md px-2 py-1.5 text-sm placeholder:text-slate-400 placeholder:italic disabled:opacity-50"
                      />
                    </td>
                  </tr>
                  );
                })}
              {!loading && result && (
                <tr className="bg-slate-50 font-semibold text-navy">
                  <td className="px-3 py-2.5 text-center">합계</td>
                  <td className="px-3 py-2.5 text-center font-mono">{result.rows
                      .reduce((sum, r) => sum + effectiveHeadcount(headDrafts[r.key] ?? r.headcountText, r.headcount), 0)
                      .toLocaleString()}{" "}
                    명
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono">{(result.rows[0]?.hoursPerDay ?? 8).toFixed(2)} hr</td>
                  <td className="px-3 py-2.5 text-center font-mono">{(result.rows[0]?.workDays ?? 0).toLocaleString()} 일</td>
                  <td className="px-3 py-2.5 text-center font-mono">{fmtNum(result.totals.dailyCapa)}</td>
                  <td className="px-3 py-2.5 text-center font-mono">{fmtNum(result.totals.monthlyCapa)}</td>
                  <td className="px-3 py-2.5 text-center font-mono">
                    {result.totals.uph == null ? "-" : fmtNum(result.totals.uph, 2)}
                  </td>
                  <td className="px-3 py-2.5" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
