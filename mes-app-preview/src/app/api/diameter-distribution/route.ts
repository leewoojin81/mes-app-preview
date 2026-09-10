import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDiameterDistributionWhere } from "@/lib/diameter-distribution-filters";

export const runtime = "nodejs";

const BIN = 0.05;
// 표마다 구간(bin) 칸 수를 항상 이 값으로 맞춘다(B.C 분포 분석/QC-02와 동일한 이유) —
// 실측 범위가 넓은 그룹은 규격 직경(있으면) 또는 데이터 중앙을 기준으로 잘라내고, 좁은
// 그룹은 양옆에 빈 칸을 더해 채운다. 모든 표의 열 폭이 같아 세로로 나열했을 때
// 그리드처럼 정렬된다.
const TARGET_BIN_COUNT = 11;

type Mode = "summary" | "hema";
function parseMode(v: string | null): Mode {
  return v === "hema" ? v : "summary";
}

// v를 0.05 폭 구간의 하한값으로 내림한다. v/BIN을 직접 나누면 부동소수 오차가 나므로
// (B.C 분포 분석/QC-02에서 발견된 것과 같은 문제) 정수(0.01 단위) 연산으로 우회한다.
function binFloor(v: number): number {
  const cents = Math.round(v * 100);
  const binCents = Math.round(BIN * 100);
  return (Math.floor(cents / binCents) * binCents) / 100;
}

// 구간(bin) 기준점은 항상 PROD-10(일일작업현황) 그리드의 "품목직경" 규격값이다 — 있으면
// 그 구간이 TARGET_BIN_COUNT개 창의 정중앙에 오도록 고정한다. 품목직경이 없는 그룹만
// 실측 데이터 범위를 기준으로 채운다(좁으면 양옆에 빈 구간, 넓으면 데이터 중앙 기준으로 자름).
function buildFixedBins(dataMin: number, dataMax: number, specBinStart: number | null): number[] {
  const half = Math.floor((TARGET_BIN_COUNT - 1) / 2);
  let startBin: number;
  if (specBinStart != null) {
    startBin = specBinStart - half * BIN;
  } else {
    const coreCount = Math.round((dataMax - dataMin) / BIN) + 1;
    if (coreCount >= TARGET_BIN_COUNT) {
      const centerBin = binFloor(dataMin + Math.round((dataMax - dataMin) / 2 / BIN) * BIN);
      startBin = centerBin - half * BIN;
    } else {
      const need = TARGET_BIN_COUNT - coreCount;
      const padLeft = Math.floor(need / 2);
      startBin = dataMin - padLeft * BIN;
    }
  }
  startBin = Math.round(startBin * 100) / 100;
  return Array.from(
    { length: TARGET_BIN_COUNT },
    (_, i) => Math.round((startBin + i * BIN) * 100) / 100
  );
}

interface RawRow {
  item_code: string;
  work_date: string;
  model: string | null;
  hema_no: string | null;
  dia1: number | string | null;
  dia2: number | string | null;
  dia3: number | string | null;
  spec_dia: number | string | null;
}

// 품질관리 "직경 분포 분석(QC-03)" — daily_work_status(일일작업현황) 원본 실적 로그를
// 그대로 재집계한다(별도 업로드 없음). B.C 분포 분석(QC-02)과 완전히 동일한 구조이며
// B.C1/2/3 대신 직경1/2/3(및 품목B.C 대신 품목직경)을 쓴다는 점만 다르다. 직경1/2/3을
// 각각 독립 샘플로 취급(행 1건 = 샘플 3개, null/빈값은 제외)하고, 형명+몰드코드
// 조합별로 그룹핑한다. mode로 그룹 안의 행 축을 고른다 — "summary"(기본)는 work_date를
// "YYYY-MM"로 잘라 월별 한 행씩(작업일자 기간이 한 달 안이면 자연히 한 행만 남는다 —
// 그래서 "이번 달만 볼 땐 한 줄, 여러 달을 고르면 자동으로 월별 추이"가 되고 별도
// "월별" 토글이 필요 없다, 2026-08-26 사용자 지적으로 원래 있던 명시적 월별 토글을
// 이 방식으로 흡수함), "hema"는 HEMA No별 상세다. summary는 model(형명)·mold(몰드코드)
// 를 둘 다 비워도 된다(전체 형명 × 몰드코드를 각각 표로). hema 모드만 형명+몰드 둘 다
// 필수다(형명이 없으면 서로 다른 제품의 직경 값이 섞이고, 몰드를 하나로 좁히지 않으면
// 표가 여러 개+HEMA No가 수십 개씩 나와 번거롭다). 몰드코드는 daily_work_status에 없는
// 값이라, item_code 단위로 dosu_change_status의 조립투입품목(조립투입품목명에 "몰드"가
// 들어간 행)을 매핑해서 붙인다(QC-01/QC-02와 같은 정의). 매핑이 없는 품목코드는 몰드
// 코드를 알 수 없어 제외한다. 그룹마다 실제 샘플값(+품목직경 규격값) 범위를 기준으로
// 0.05 간격 구간을 만들고, buildFixedBins()로 항상 TARGET_BIN_COUNT(11)개로 맞춘다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const model = params.get("model");
  const moldFilter = params.get("mold");
  const mode = parseMode(params.get("mode"));
  // HEMA No 상세 모드는 형명+몰드 둘 다 필수 — 요약(월별) 모드는 둘 다 비워도 된다.
  if (mode === "hema" && (!model || !moldFilter)) {
    return NextResponse.json({ groups: [] });
  }

  // 몰드코드는 SQL 컬럼이 아니라 item_code 단위 매핑이라 여기서는 형명(+기간)만 걸고,
  // 몰드코드 필터는 매핑한 뒤 JS에서 적용한다.
  const { where, args } = buildDiameterDistributionWhere(params, { skipParams: ["mold"] });
  const rows = db
    .prepare(
      `SELECT item_code, work_date,
         json_extract(detail, '$."형명"') as model,
         json_extract(detail, '$."HEMA No"') as hema_no,
         json_extract(detail, '$."직경1"') as dia1,
         json_extract(detail, '$."직경2"') as dia2,
         json_extract(detail, '$."직경3"') as dia3,
         json_extract(detail, '$."품목직경"') as spec_dia
       FROM daily_work_status ${where}`
    )
    .all(...args) as unknown as RawRow[];

  const itemCodes = [...new Set(rows.map((r) => r.item_code))];
  const moldByItem = new Map<string, string>();
  if (itemCodes.length > 0) {
    const placeholders = itemCodes.map(() => "?").join(",");
    const moldRows = db
      .prepare(
        `SELECT DISTINCT item_code, json_extract(detail, '$."조립투입품목"') as mold
         FROM dosu_change_status
         WHERE item_code IN (${placeholders})
           AND json_extract(detail, '$."조립투입품목명"') LIKE '%몰드%'`
      )
      .all(...itemCodes) as { item_code: string; mold: string | null }[];
    for (const r of moldRows) {
      if (r.mold) moldByItem.set(r.item_code, r.mold);
    }
  }

  // 그룹 키는 형명+몰드코드 조합이다(model이 비어 전체 형명을 조회할 때, 같은 몰드코드가
  // 다른 형명에서도 쓰일 수 있어 몰드코드만으로 묶으면 서로 다른 제품의 직경 값이 섞인다).
  const byGroup = new Map<
    string,
    { model: string; moldCode: string; specDia: number | null; rows: Map<string, number[]> }
  >();
  for (const r of rows) {
    if (!r.model) continue;
    const moldCode = moldByItem.get(r.item_code);
    if (!moldCode) continue;
    if (moldFilter && moldCode !== moldFilter) continue;
    // hema 모드는 HEMA No가 없는 행은 어느 줄에도 넣을 수 없어 제외하고, summary
    // 모드는 work_date(항상 있음)를 "YYYY-MM"로 잘라 쓴다.
    const rowKey = mode === "hema" ? r.hema_no : r.work_date.slice(0, 7);
    if (!rowKey) continue;

    const groupKey = `${r.model}::${moldCode}`;
    const g = byGroup.get(groupKey) ?? {
      model: r.model,
      moldCode,
      specDia: null,
      rows: new Map<string, number[]>(),
    };
    if (g.specDia == null && r.spec_dia != null && r.spec_dia !== "") {
      const n = Number(r.spec_dia);
      if (!Number.isNaN(n) && n > 0) g.specDia = n;
    }
    const samples = g.rows.get(rowKey) ?? [];
    for (const raw of [r.dia1, r.dia2, r.dia3]) {
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      // 직경은 항상 양수인 물리 측정값이라 0은 실측이 아니라 미측정을 0으로 채운 원본
      // 데이터 결함이다(B.C 분포 분석/QC-02에서 확인된 것과 같은 패턴) — null과 동일하게
      // 취급해 제외한다.
      if (!Number.isNaN(n) && n > 0) samples.push(n);
    }
    g.rows.set(rowKey, samples);
    byGroup.set(groupKey, g);
  }

  const groups = [...byGroup.values()]
    .filter((g) => [...g.rows.values()].some((s) => s.length > 0))
    .map((g) => {
      const allValues = [...g.rows.values()].flat();
      // Math.min(...allValues)처럼 배열을 그대로 펼쳐 넘기면(월별/전체 요약처럼 여러
      // 달치를 한 그룹으로 합쳐 샘플이 수만 개가 되는 경우) 함수 인자 개수 한도를 넘어
      // "Maximum call stack size exceeded"가 난다(2026-08-26 넓은 기간 조회에서 실제로
      // 발생) — 반복문으로 직접 계산해 배열 크기와 무관하게 안전하게 만든다.
      let min = Infinity;
      let max = -Infinity;
      for (const v of allValues) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (g.specDia != null) {
        min = Math.min(min, g.specDia);
        max = Math.max(max, g.specDia);
      }
      const bins = buildFixedBins(
        binFloor(min),
        binFloor(max),
        g.specDia != null ? binFloor(g.specDia) : null
      );

      const rows = [...g.rows.entries()]
        .filter(([, samples]) => samples.length > 0)
        .map(([rowKey, samples]) => {
          const counts = new Array(bins.length).fill(0);
          // 표시 범위(규격 직경 ± 0.25)를 벗어나는 실측값은 맨 앞/뒤 칸에 몰아 넣되, 그
          // 칸이 "실제로 그 구간의 값"인지 "범위 밖 값이 넘쳐 들어온 것"인지 구분해야
          // 하므로 넘침 여부를 별도로 기록한다("&" 표시, B.C 분포 분석/QC-02와 동일).
          let lowerOverflow = false;
          let upperOverflow = false;
          for (const v of samples) {
            const bStart = binFloor(v);
            let idx = bins.findIndex((b) => Math.abs(b - bStart) < 1e-9);
            if (idx === -1) {
              if (bStart < bins[0]) {
                idx = 0;
                lowerOverflow = true;
              } else {
                idx = bins.length - 1;
                upperOverflow = true;
              }
            }
            counts[idx]++;
          }
          const total = samples.length;
          const values = counts.map((c) => Math.round((c / total) * 1000) / 10);
          return { rowKey, sampleCount: total, values, counts, lowerOverflow, upperOverflow };
        })
        // "YYYY-MM"/"전체"/HEMA No 모두 문자열 정렬로 충분하다(월별은 자연히 시간순).
        .sort((a, b) => a.rowKey.localeCompare(b.rowKey));

      return { model: g.model, mold: g.moldCode, specDia: g.specDia, bins, rows };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.mold.localeCompare(b.mold, undefined, { numeric: true }));

  return NextResponse.json({ groups });
}
