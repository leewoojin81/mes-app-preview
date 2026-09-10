import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildBcDistributionWhere } from "@/lib/bc-distribution-filters";

export const runtime = "nodejs";

const BIN = 0.05;
// 표마다 구간(bin) 칸 수를 항상 이 값으로 맞춘다(2026-08-25 사용자 요청) — 실측 범위가
// 넓은 그룹은 규격 B.C(있으면) 또는 데이터 중앙을 기준으로 잘라내고, 좁은 그룹은 양옆에
// 빈 칸을 더해 채운다. 모든 표의 열 폭이 같아 세로로 나열했을 때 그리드처럼 정렬된다.
const TARGET_BIN_COUNT = 11;

type Mode = "summary" | "hema";
function parseMode(v: string | null): Mode {
  return v === "hema" ? v : "summary";
}

// v를 0.05 폭 구간의 하한값으로 내림한다. v/BIN을 직접 나누면 부동소수 오차로
// 8.6/0.05가 171.99999999999997이 되는 식의 오차가 나서(Math.floor가 172가 아니라 171을
// 돌려줘 binFloor(8.6)이 8.55로 잘못 나옴 — 2026-08-25 규격 B.C 중앙 정렬이 한 칸씩
// 밀리는 버그로 발견) 정수(0.01 단위) 연산으로 우회한다.
function binFloor(v: number): number {
  const cents = Math.round(v * 100);
  const binCents = Math.round(BIN * 100);
  return (Math.floor(cents / binCents) * binCents) / 100;
}

// 구간(bin) 기준점은 항상 PROD-10(일일작업현황) 그리드의 "품목B.C" 규격값이다 — 있으면
// 그 구간이 TARGET_BIN_COUNT개 창의 정중앙에 오도록 고정한다(실측 데이터가 어느 쪽으로
// 치우쳐 있든 규격 대비 좌/우 편차를 표마다 같은 위치에서 비교할 수 있게). 품목B.C가
// 없는 그룹(드묾)만 실측 데이터 범위를 기준으로 채운다(좁으면 양옆에 빈 구간, 넓으면
// 데이터 중앙 기준으로 자름).
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
  bc1: number | string | null;
  bc2: number | string | null;
  bc3: number | string | null;
  spec_bc: number | string | null;
}

// 품질관리 "형명별/몰드별/원료LOT별 B.C 분포 분석(QC-02)" — daily_work_status(일일작업현황)
// 원본 실적 로그를 그대로 재집계한다(별도 업로드 없음). B.C1/B.C2/B.C3을 각각 독립 샘플로
// 취급(행 1건 = 샘플 3개, null/빈값은 제외)하고, 형명+몰드코드 조합별로 그룹핑한다.
// mode로 그룹 안의 행 축을 고른다 — "summary"(기본)는 work_date를 "YYYY-MM"로 잘라
// 월별 한 행씩(작업일자 기간이 한 달 안이면 자연히 한 행만 남는다 — 그래서 "이번 달만
// 볼 땐 한 줄, 여러 달을 고르면 자동으로 월별 추이"가 되고 별도 "월별" 토글이 필요
// 없다, 직경 분포 분석/QC-03과 함께 2026-08-26 이 방식으로 통일함), "hema"는 HEMA
// No별 상세다. summary는 model(형명)·mold(몰드코드)를 둘 다 비워도 된다(전체 형명 ×
// 그 형명의 모든 몰드코드를 각각 한 줄짜리 표로). HEMA No 상세 모드는 형명+몰드 둘 다
// 필수다(형명이 없으면 서로 다른 제품의 B.C 값이 뒤섞여 구간 자체가 무의미해지고,
// 몰드를 하나로 좁히지 않으면 한 형명 안에서도 표가 여러 개+각각 HEMA No가 수십 개씩
// 나와 번거롭다). 몰드코드(예: "3860D")는 daily_work_status에 없는 값이라, item_code
// 단위로 dosu_change_status의 조립투입품목(조립투입품목명에 "몰드"가 들어간 행 —
// QC-01/도수변경현황과 같은 정의)을 매핑해서 붙인다. 매핑이 없는 품목코드(전체의 약
// 20%, 도수변경등록 실적이 아예 없던 품목)는 몰드코드를 알 수 없어 제외한다. 그룹마다
// 실제 샘플값(+품목B.C 규격값) 범위를 기준으로 0.05 간격 구간을 만드는데, 표마다 칸
// 수가 들쭉날쭉하면 세로로 나열했을 때 정렬이 안 맞아 buildFixedBins()로 항상
// TARGET_BIN_COUNT(11)개로 맞춘다(좁으면 양옆에 빈 칸 추가, 넓으면 규격 B.C 중심으로
// 자름). 행별 샘플이 각 구간에 몇 % 분포하는지 계산한다.
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
  const { where, args } = buildBcDistributionWhere(params, { skipParams: ["mold"] });
  const rows = db
    .prepare(
      `SELECT item_code, work_date,
         json_extract(detail, '$."형명"') as model,
         json_extract(detail, '$."HEMA No"') as hema_no,
         json_extract(detail, '$."B.C1"') as bc1,
         json_extract(detail, '$."B.C2"') as bc2,
         json_extract(detail, '$."B.C3"') as bc3,
         json_extract(detail, '$."품목B.C"') as spec_bc
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
  // 다른 형명에서도 쓰일 수 있어 몰드코드만으로 묶으면 서로 다른 제품의 B.C 값이 섞인다).
  const byGroup = new Map<
    string,
    { model: string; moldCode: string; specBc: number | null; rows: Map<string, number[]> }
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
      specBc: null,
      rows: new Map<string, number[]>(),
    };
    if (g.specBc == null && r.spec_bc != null && r.spec_bc !== "") {
      const n = Number(r.spec_bc);
      if (!Number.isNaN(n) && n > 0) g.specBc = n;
    }
    const samples = g.rows.get(rowKey) ?? [];
    for (const raw of [r.bc1, r.bc2, r.bc3]) {
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      // B.C(베이스커브)는 항상 양수인 물리 측정값이라 0은 실측이 아니라 미측정을 0으로
      // 채운 원본 데이터 결함이다(HEMA No도 같이 비어 있는 행에서 확인됨) — null과
      // 동일하게 취급해 제외한다. 안 걸러내면 구간 범위가 0 근처까지 늘어나 실제 분포가
      // 표 오른쪽 끝 밖으로 밀려나 사실상 텅 비어 보인다(2026-08-24 실측 발견).
      if (!Number.isNaN(n) && n > 0) samples.push(n);
    }
    g.rows.set(rowKey, samples);
    byGroup.set(groupKey, g);
  }

  const groups = [...byGroup.values()]
    .filter((g) => [...g.rows.values()].some((s) => s.length > 0))
    .map((g) => {
      const allValues = [...g.rows.values()].flat();
      // Math.min(...allValues)처럼 배열을 그대로 펼쳐 넘기면(넓은 기간 조회로 한 그룹의
      // 샘플이 수만 개가 되는 경우) 함수 인자 개수 한도를 넘어 "Maximum call stack size
      // exceeded"가 난다(직경 분포 분석/QC-03에서 실제 발견돼 같이 고침) — 반복문으로
      // 직접 계산해 배열 크기와 무관하게 안전하게 만든다.
      let min = Infinity;
      let max = -Infinity;
      for (const v of allValues) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (g.specBc != null) {
        min = Math.min(min, g.specBc);
        max = Math.max(max, g.specBc);
      }
      const bins = buildFixedBins(binFloor(min), binFloor(max), g.specBc != null ? binFloor(g.specBc) : null);

      const rows = [...g.rows.entries()]
        .filter(([, samples]) => samples.length > 0)
        .map(([rowKey, samples]) => {
          const counts = new Array(bins.length).fill(0);
          // 표시 범위(규격 B.C ± 0.25)를 벗어나는 실측값은 맨 앞/뒤 칸에 몰아 넣되,
          // 그 칸이 "실제로 그 구간의 값"인지 "범위 밖 값이 넘쳐 들어온 것"인지 구분해야
          // 하므로 넘침 여부를 별도로 기록한다(2026-08-25 사용자 요청 — 넘치면 "&" 표시).
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
        // "YYYY-MM"/HEMA No 모두 문자열 정렬로 충분하다(월별은 자연히 시간순).
        .sort((a, b) => a.rowKey.localeCompare(b.rowKey));

      return { model: g.model, mold: g.moldCode, specBc: g.specBc, bins, rows };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.mold.localeCompare(b.mold, undefined, { numeric: true }));

  return NextResponse.json({ groups });
}
