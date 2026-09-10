"use client";

import { useEffect, useState } from "react";
import type { StockCheckRow } from "@/lib/types";

// 반제품 중 품목군이 "착색"인 것만 대상이며(다른 반제품군은 API에서 이미 제외됨),
// 재고는 LOT별로 펼쳐서 보여준다. 체크한 LOT을 "확인"으로 넘기면 PROD-04 목록
// 화면에서 지시수량 입력에 맞춰 줄어드는 잔량 시뮬레이션에 쓰이고, 최종 "저장" 시점에
// 실제로 소진된 만큼 이 LOT들의 현재고현황(INV-02) 재고수량이 차감된다 — LOT 자체를
// 여기서 바로 차감하지는 않는다(투입 확정은 PROD-04 저장 단계).
export default function StockCheckModal({
  repItemCode,
  itemCode,
  planQty,
  onClose,
  onConfirm,
}: {
  repItemCode: string;
  itemCode: string;
  planQty: number;
  onClose: () => void;
  onConfirm: (payload: {
    totalQty: number;
    unit: string;
    lots: { id: number; qty: number }[];
  }) => void;
}) {
  const [rows, setRows] = useState<StockCheckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedLots, setCheckedLots] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ itemCode: repItemCode, planQty: String(planQty) });
    fetch(`/api/process-schedule/stock-check?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setRows([]);
        } else {
          setRows(data.rows);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("재고 조회에 실패했습니다.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repItemCode, planQty]);

  function toggleLot(id: number) {
    setCheckedLots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    let total = 0;
    let unit = "EA";
    const lots: { id: number; qty: number }[] = [];
    for (const r of rows) {
      for (const lot of r.lots) {
        if (checkedLots.has(lot.id)) {
          total += lot.qty;
          unit = r.unit;
          lots.push({ id: lot.id, qty: lot.qty });
        }
      }
    }
    onConfirm({ totalQty: total, unit, lots });
  }

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-bold text-navy">반제품 재고 확인</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {itemCode} (대표코드 {repItemCode}) · 계획수량{" "}
              <span className="font-semibold">{planQty.toLocaleString()}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {loading && <p className="text-center py-10 text-slate-400 text-sm">조회 중...</p>}
          {!loading && error && (
            <p className="text-center py-10 text-rose-600 text-sm">{error}</p>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-center py-10 text-slate-400 text-sm">
              품목군 &apos;착색&apos;에 해당하는 반제품 BOM 구성이 없습니다.
            </p>
          )}
          {!loading &&
            !error &&
            rows.map((r) => (
              <div
                key={r.child_item_code}
                className="border border-slate-200 rounded-md overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-50 flex-wrap">
                  <div>
                    <p className="text-xs text-slate-400">품목코드</p>
                    <p className="text-sm font-medium text-navy font-mono">{r.child_item_code}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      BOM 소요량 {r.qty_per.toLocaleString()}
                      {r.unit} · 필요수량{" "}
                      <span className="font-mono">
                        {r.required_qty.toLocaleString()} {r.unit}
                      </span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">
                      현재고 합계{" "}
                      <span className="font-mono text-slate-700">
                        {r.stock_qty.toLocaleString()} {r.unit}
                      </span>
                    </p>
                    {r.sufficient ? (
                      <span className="text-emerald-600 font-semibold text-xs">충분</span>
                    ) : (
                      <span className="text-rose-600 font-semibold text-xs">
                        부족: {r.shortage_qty.toLocaleString()} {r.unit}
                      </span>
                    )}
                  </div>
                </div>

                {r.lots.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-slate-400">재고 LOT이 없습니다.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="w-8 px-3 py-1.5" />
                        <th className="text-left px-3 py-1.5 font-medium">창고</th>
                        <th className="text-left px-3 py-1.5 font-medium">구분</th>
                        <th className="text-left px-3 py-1.5 font-medium">LOT번호</th>
                        <th className="text-right px-3 py-1.5 font-medium">수량</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.lots.map((lot) => {
                        const checked = checkedLots.has(lot.id);
                        return (
                          <tr key={lot.id} className={checked ? "bg-navy/5" : undefined}>
                            <td className="px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLot(lot.id)}
                              />
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">{lot.warehouse ?? "-"}</td>
                            <td className="px-3 py-1.5">
                              {lot.division === "자동" ? (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                                  자동
                                </span>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">{lot.lot_no}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                              {lot.qty.toLocaleString()} {r.unit}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 shrink-0">
          <p className="text-xs text-slate-500">
            {checkedLots.size > 0 ? `${checkedLots.size.toLocaleString()}개 LOT 선택됨` : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 hover:border-navy"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={checkedLots.size === 0}
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:bg-navy-light transition-colors disabled:opacity-40"
            >
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
