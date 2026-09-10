"use client";

import { useEffect, useMemo, useState } from "react";
import NumPad from "@/components/NumPad";
import StatusBadge from "@/components/StatusBadge";
import { useTabState } from "@/lib/use-tab-state";
import type {
  Defect,
  Equipment,
  MaterialInput,
  MaterialLot,
  ProductionResult,
  WorkOrder,
} from "@/lib/types";

const DEFECT_TYPES = ["기포", "스크래치", "치수불량", "이물", "기타"];
type Tab = "실적" | "불량" | "자재";

type WoDetail = {
  workOrder: WorkOrder;
  results: ProductionResult[];
  defects: Defect[];
  materialInputs: MaterialInput[];
};

export default function PopPage() {
  const [openOrders, setOpenOrders] = useState<WorkOrder[]>([]);
  const [detail, setDetail] = useState<WoDetail | null>(null);
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [materialLots, setMaterialLots] = useState<MaterialLot[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 탭을 전환했다 돌아와도 어떤 작업지시를 보고 있었는지, 입력 중이던
  // 실적/불량/자재 값은 그대로 남도록 세션 단위로 저장한다.
  const [selectedWoNo, setSelectedWoNo] = useTabState<string | null>("selectedWoNo", null);
  const [tab, setTab] = useTabState<Tab>("tab", "실적");
  const [qty, setQty] = useTabState("qty", "");
  const [equipmentId, setEquipmentId] = useTabState("equipmentId", "");
  const [defectType, setDefectType] = useTabState("defectType", "");
  const [defectQty, setDefectQty] = useTabState("defectQty", "");
  const [materialLotNo, setMaterialLotNo] = useTabState("materialLotNo", "");
  const [materialQty, setMaterialQty] = useTabState("materialQty", "");

  async function loadOpenOrders() {
    const res = await fetch("/api/work-orders?status=발행,진행", {
      cache: "no-store",
    });
    setOpenOrders(await res.json());
  }

  async function loadDetail(wo_no: string) {
    const res = await fetch(`/api/work-orders/${wo_no}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }

  async function loadMaterialLots() {
    const res = await fetch("/api/material-lots", { cache: "no-store" });
    setMaterialLots(await res.json());
  }

  useEffect(() => {
    loadOpenOrders();
    loadMaterialLots();
    fetch("/api/equipments")
      .then((r) => r.json())
      .then(setEquipments);
  }, []);

  useEffect(() => {
    if (!selectedWoNo) return;
    loadDetail(selectedWoNo);
  }, [selectedWoNo]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  function selectWorkOrder(wo_no: string) {
    setSelectedWoNo(wo_no);
    setTab("실적");
    setQty("");
    setDefectType("");
    setDefectQty("");
    setMaterialLotNo("");
    setMaterialQty("");
    setError(null);
  }

  async function refreshAll() {
    loadOpenOrders();
    loadMaterialLots();
    if (selectedWoNo) loadDetail(selectedWoNo);
  }

  async function submitResult() {
    if (!selectedWoNo || !qty) {
      setError("생산수량을 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/production-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wo_no: selectedWoNo,
          qty: Number(qty),
          equipment_id: equipmentId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToast(`실적 ${qty}개 등록 완료`);
      setQty("");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDefect() {
    if (!selectedWoNo || !defectType || !defectQty) {
      setError("불량유형과 수량을 선택해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/defects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wo_no: selectedWoNo,
          defect_type: defectType,
          qty: Number(defectQty),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToast(`불량(${defectType}) ${defectQty}개 등록 완료`);
      setDefectType("");
      setDefectQty("");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMaterial() {
    if (!selectedWoNo || !materialLotNo || !materialQty) {
      setError("원자재 LOT와 수량을 확인해 주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/material-inputs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wo_no: selectedWoNo,
          material_lot_no: materialLotNo,
          qty: Number(materialQty),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setToast(`자재투입 ${materialQty} 등록 완료`);
      setMaterialQty("");
      setMaterialLotNo("");
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setSubmitting(false);
    }
  }

  const wo = detail?.workOrder;
  const progressPct = useMemo(() => {
    if (!wo || wo.order_qty === 0) return 0;
    return Math.min(100, Math.round((wo.produced_qty / wo.order_qty) * 100));
  }, [wo]);

  return (
    <div className="w-full px-4 sm:px-6 py-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-navy">POP 실적입력</h1>
        <p className="text-sm text-slate-500 mt-1">
          PROD-02 · 현장 단말(POP) 실적·불량·자재투입 등록
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
        {/* Work order scan / selection panel */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 h-fit">
          <p className="text-xs font-semibold text-slate-400 uppercase mb-3">
            작업지시 바코드 스캔
          </p>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto">
            {openOrders.length === 0 && (
              <p className="text-sm text-slate-400 py-6 text-center">
                발행된 작업지시가 없습니다.
              </p>
            )}
            {openOrders.map((o) => (
              <button
                key={o.wo_no}
                onClick={() => selectWorkOrder(o.wo_no)}
                className={`w-full text-left border rounded-md px-3 py-3 transition-colors ${
                  selectedWoNo === o.wo_no
                    ? "border-navy bg-navy/5 ring-1 ring-navy"
                    : "border-slate-200 hover:border-navy/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-navy text-sm">{o.wo_no}</span>
                  <StatusBadge status={o.status} />
                </div>
                <p className="text-sm text-slate-600 mt-1">{o.item_name}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {o.produced_qty}/{o.order_qty} · {o.line_id}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail + entry panel */}
        <div className="space-y-4">
          {!wo && (
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-16 text-center text-slate-400">
              왼쪽에서 작업지시를 스캔(선택)해 주세요.
            </div>
          )}

          {wo && (
            <>
              <div className="bg-navy text-white rounded-lg shadow-sm p-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-lg font-bold">{wo.wo_no}</p>
                    <p className="text-sm text-white/80">{wo.item_name}</p>
                  </div>
                  <StatusBadge status={wo.status} />
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-white/70 mb-1">
                    <span>
                      실적 {wo.produced_qty.toLocaleString()} / {wo.order_qty.toLocaleString()}
                    </span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gold transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="flex border-b border-slate-200">
                  {(["실적", "불량", "자재"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTab(t);
                        setError(null);
                      }}
                      className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                        tab === t
                          ? "text-navy border-b-2 border-navy bg-navy/5"
                          : "text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      {t === "실적" ? "생산수량 입력" : t === "불량" ? "불량 등록" : "자재 투입"}
                    </button>
                  ))}
                </div>

                <div className="p-5">
                  {error && (
                    <p className="text-sm text-red-600 mb-3 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                      {error}
                    </p>
                  )}

                  {tab === "실적" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <label className="text-xs font-medium text-slate-500">설비 선택</label>
                        <div className="grid grid-cols-1 gap-2 mt-2">
                          {equipments.map((eq) => (
                            <button
                              key={eq.equipment_id}
                              onClick={() => setEquipmentId(eq.equipment_id)}
                              className={`text-left px-3 py-2.5 rounded-md border text-sm ${
                                equipmentId === eq.equipment_id
                                  ? "border-navy bg-navy/5 text-navy font-semibold"
                                  : "border-slate-200 text-slate-600"
                              }`}
                            >
                              {eq.equipment_name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          생산수량 (숫자패드)
                        </label>
                        <div className="mt-2 mb-3 h-12 flex items-center justify-end px-4 border border-slate-300 rounded-md text-2xl font-bold text-navy bg-slate-50">
                          {qty || "0"}
                        </div>
                        <NumPad value={qty} onChange={setQty} />
                        <button
                          onClick={submitResult}
                          disabled={submitting}
                          className="w-full mt-3 bg-navy text-white font-semibold py-3 rounded-md hover:bg-navy-light disabled:opacity-50"
                        >
                          실적 등록
                        </button>
                      </div>
                    </div>
                  )}

                  {tab === "불량" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          불량유형 (터치 1회)
                        </label>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {DEFECT_TYPES.map((d) => (
                            <button
                              key={d}
                              onClick={() => setDefectType(d)}
                              className={`px-3 py-3 rounded-md border text-sm font-medium ${
                                defectType === d
                                  ? "border-red-500 bg-red-50 text-red-700"
                                  : "border-slate-200 text-slate-600"
                              }`}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          불량수량 (터치 1회)
                        </label>
                        <div className="grid grid-cols-4 gap-2 mt-2">
                          {[1, 5, 10, 20].map((n) => (
                            <button
                              key={n}
                              onClick={() => setDefectQty(String(n))}
                              className={`py-3 rounded-md border text-sm font-semibold ${
                                defectQty === String(n)
                                  ? "border-navy bg-navy/5 text-navy"
                                  : "border-slate-200 text-slate-600"
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          min={1}
                          placeholder="직접입력"
                          value={defectQty}
                          onChange={(e) => setDefectQty(e.target.value)}
                          className="w-full mt-2 border border-slate-300 rounded-md px-3 py-2 text-sm"
                        />
                        <button
                          onClick={submitDefect}
                          disabled={submitting}
                          className="w-full mt-3 bg-red-600 text-white font-semibold py-3 rounded-md hover:bg-red-700 disabled:opacity-50"
                        >
                          불량 등록
                        </button>
                      </div>
                    </div>
                  )}

                  {tab === "자재" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          원자재 LOT 스캔
                        </label>
                        <div className="space-y-2 mt-2 max-h-64 overflow-y-auto">
                          {materialLots.map((m) => (
                            <button
                              key={m.lot_no}
                              onClick={() => setMaterialLotNo(m.lot_no)}
                              className={`w-full text-left px-3 py-2.5 rounded-md border text-sm ${
                                materialLotNo === m.lot_no
                                  ? "border-navy bg-navy/5 text-navy font-semibold"
                                  : "border-slate-200 text-slate-600"
                              }`}
                            >
                              <div className="flex justify-between">
                                <span>{m.item_name}</span>
                                <span className="text-xs text-slate-400">
                                  {m.available_qty.toLocaleString()} {m.unit}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400">{m.lot_no}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          투입수량 (숫자패드)
                        </label>
                        <div className="mt-2 mb-3 h-12 flex items-center justify-end px-4 border border-slate-300 rounded-md text-2xl font-bold text-navy bg-slate-50">
                          {materialQty || "0"}
                        </div>
                        <NumPad value={materialQty} onChange={setMaterialQty} />
                        <button
                          onClick={submitMaterial}
                          disabled={submitting}
                          className="w-full mt-3 bg-navy text-white font-semibold py-3 rounded-md hover:bg-navy-light disabled:opacity-50"
                        >
                          자재투입 등록
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase mb-3">
                  최근 등록 이력
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto text-sm">
                  {[
                    ...(detail?.results.map((r) => ({
                      time: r.reg_time,
                      label: `실적 +${r.qty} (${r.equipment_name ?? "설비미지정"})`,
                      color: "text-emerald-600",
                    })) ?? []),
                    ...(detail?.defects.map((d) => ({
                      time: d.reg_time,
                      label: `불량 ${d.defect_type} ${d.qty}`,
                      color: "text-red-600",
                    })) ?? []),
                    ...(detail?.materialInputs.map((m) => ({
                      time: m.reg_time,
                      label: `자재투입 ${m.item_name} -${m.qty}`,
                      color: "text-amber-600",
                    })) ?? []),
                  ]
                    .sort((a, b) => (a.time < b.time ? 1 : -1))
                    .slice(0, 15)
                    .map((ev, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between border-b border-slate-100 py-1.5 last:border-0"
                      >
                        <span className={`font-medium ${ev.color}`}>{ev.label}</span>
                        <span className="text-xs text-slate-400">{ev.time}</span>
                      </div>
                    ))}
                  {detail &&
                    detail.results.length === 0 &&
                    detail.defects.length === 0 &&
                    detail.materialInputs.length === 0 && (
                      <p className="text-slate-400 text-center py-4">등록된 이력이 없습니다.</p>
                    )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
