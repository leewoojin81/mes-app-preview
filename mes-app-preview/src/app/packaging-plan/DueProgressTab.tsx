"use client";

import { useEffect, useMemo, useState } from "react";
import { useTabState } from "@/lib/use-tab-state";
import { sumTotals, type DueProgressResult, type DueProgressRow } from "@/lib/packaging-due-progress";

// 계획정보(PLAN-03) "납기진행" 탭 — 출하계획.xlsx "종합_Order 공정별 진행사항" 형식: 진행 중인 수주를 납기일 순으로 세우고
// 주문량 대비 중간창고·완검(마킹)·출하 부족분과 진행율을 보여준다. 계산 기준은 lib/packaging-due-progress.ts 머리 주석 참고.

const th = "px-2 py-2 border border-slate-300 bg-[#B4C6E7] text-xs font-semibold text-slate-800 text-center whitespace-nowrap";
const td = "px-2 py-1.5 border border-slate-200 text-xs text-slate-700 whitespace-nowrap";
const num = `${td} text-right tabular-nums`;

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}
function dash(n: number): string {
  return n > 0 ? fmt(n) : "-";
}
function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 진행율 칸 — 막대와 퍼센트를 같이 보여준다(완료 100%는 초록) */
function RateCell({ rate }: { rate: number }) {
  return (
    <td className={`${td} min-w-[84px]`}>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${rate >= 1 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${rate * 100}%` }} />
        </div>
        <span className="w-11 text-right tabular-nums">{pct(rate)}</span>
      </div>
    </td>
  );
}

export default function DueProgressTab() {
  const [data, setData] = useState<DueProgressResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useTabState("pkDueSearch", "");
  // 출하까지 끝난(출하 100%) 수주는 기본으로 숨긴다
  const [hideDone, setHideDone] = useTabState("pkDueHideDone", true);

  useEffect(() => {
    let alive = true;
    fetch("/api/packaging-schedule/due-progress", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DueProgressResult) => {
        if (alive) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setError("납기진행 데이터를 불러오지 못했습니다.");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (hideDone && r.ship_rate >= 1) return false;
      if (!kw) return true;
      return [r.so_no, r.mo_no, r.customer, r.brand].some((v) => (v ?? "").toLowerCase().includes(kw));
    });
  }, [data, search, hideDone]);
  const totals = useMemo(() => sumTotals(rows), [rows]);
  const todayStr = today();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="수주번호·MO·고객·브랜드 검색"
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-md w-64"
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          출하 완료 수주 숨기기
        </label>
        <span className="text-xs text-slate-400 ml-auto">{rows.length.toLocaleString("ko-KR")}건 · 납기 지난 수주는 납기일을 빨간색으로 표시</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-auto max-h-[calc(100vh-230px)]">
        {loading ? (
          <div className="p-6 text-sm text-slate-400">불러오는 중… (처음 열 때는 몇 초 걸릴 수 있습니다)</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={th}>순위</th>
                <th className={th}>수주번호</th>
                <th className={th}>MO번호</th>
                <th className={th}>고객</th>
                <th className={th}>브랜드</th>
                <th className={th}>납기일</th>
                <th className={th}>포장유형</th>
                <th className={th}>개입</th>
                <th className={th}>주문량</th>
                <th className={th}>Pack 수</th>
                <th className={th}>중간창고<br />부족분</th>
                <th className={th}>중간<br />진행율</th>
                <th className={th}>완검<br />부족분</th>
                <th className={th}>마킹<br />진행율</th>
                <th className={th}>출하<br />부족</th>
                <th className={th}>출하<br />진행율</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: DueProgressRow) => {
                const late = !!r.due_date && r.due_date < todayStr && r.ship_rate < 1;
                return (
                  <tr key={r.so_no} className="hover:bg-slate-50">
                    <td className={`${td} text-center bg-[#FFFFCC]`}>{r.rank}</td>
                    <td className={td}>{r.so_no}</td>
                    <td className={td}>{r.mo_no ?? ""}</td>
                    <td className={`${td} text-[#002060]`}>{r.customer ?? ""}</td>
                    <td className={`${td} text-[#0070C0]`}>{r.brand ?? ""}</td>
                    <td className={`${td} text-center ${late ? "text-red-600 font-semibold" : ""}`}>{r.due_date ?? ""}</td>
                    <td className={`${td} text-center`}>{r.pack_method ?? ""}</td>
                    <td className={num}>{r.pack_size ?? ""}</td>
                    <td className={num}>{fmt(r.order_qty)}</td>
                    <td className={num}>{r.packs != null ? fmt(r.packs) : ""}</td>
                    <td className={num}>{dash(r.mid_short)}</td>
                    <RateCell rate={r.mid_rate} />
                    <td className={num}>{dash(r.mark_short)}</td>
                    <RateCell rate={r.mark_rate} />
                    <td className={num}>{dash(r.ship_short)}</td>
                    <RateCell rate={r.ship_rate} />
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={16} className="p-6 text-center text-sm text-slate-400">
                    표시할 수주가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="bg-[#B4C6E7] font-semibold">
                  <td colSpan={8} className={`${td} text-center bg-[#B4C6E7]`}>생산계획 및 납기 진행현황 (합계)</td>
                  <td className={`${num} bg-[#B4C6E7]`}>{fmt(totals.order_qty)}</td>
                  <td className={`${td} bg-[#B4C6E7]`} />
                  <td className={`${num} bg-[#B4C6E7]`}>{fmt(totals.mid_short)}</td>
                  <td className={`${num} bg-[#B4C6E7]`}>{pct(totals.mid_rate)}</td>
                  <td className={`${num} bg-[#B4C6E7]`}>{fmt(totals.mark_short)}</td>
                  <td className={`${num} bg-[#B4C6E7]`}>{pct(totals.mark_rate)}</td>
                  <td className={`${num} bg-[#B4C6E7]`}>{fmt(totals.ship_short)}</td>
                  <td className={`${num} bg-[#B4C6E7]`}>{pct(totals.ship_rate)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        주문량·납기일은 수주등록(SALES-02), 중간창고·완검(마킹) 실적은 일일작업현황(PROD-10) 중간창고·마킹 공정 양품수량, 출하는 제품출고등록(SALES-03) 출고수량 기준입니다.
        부족분 = 주문량 − 실적, 진행율 = 실적 ÷ 주문량(최대 100%). 순위는 납기일 → 생산순위지정(PLAN-01) 작업순서 순입니다.
      </p>
    </div>
  );
}
