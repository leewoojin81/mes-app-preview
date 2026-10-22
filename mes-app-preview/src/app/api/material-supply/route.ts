import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchMaterialSupply, loadLoss, saveLoss, MATERIAL_KINDS, type MaterialKind } from "@/lib/material-supply";

export const runtime = "nodejs";

// 구매관리 자재수급(PUR-03)
//  GET /api/material-supply        → 수주×모델 줄별 실링지·단상자·라벨·설명서 소요/현재고/과부족/입고예정
//  PUT /api/material-supply        → { loss: { seal, box, label, manual } } 자재 종류별 Loss%(100~500) 저장
export async function GET() {
  return NextResponse.json(fetchMaterialSupply(getDb()));
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { loss?: Record<string, unknown> } | null;
  if (!body?.loss || typeof body.loss !== "object") return NextResponse.json({ error: "loss 값이 필요합니다." }, { status: 400 });
  const next: Partial<Record<MaterialKind, number>> = {};
  for (const k of MATERIAL_KINDS) {
    const v = body.loss[k.key];
    if (v !== undefined) next[k.key] = Number(v);
  }
  const db = getDb();
  try {
    saveLoss(db, next);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "저장하지 못했습니다." }, { status: 400 });
  }
  return NextResponse.json({ loss: loadLoss(db) });
}
