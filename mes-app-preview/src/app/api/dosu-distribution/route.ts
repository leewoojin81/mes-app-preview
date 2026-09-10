import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDosuDistributionWhere, extractTargetDosu } from "@/lib/dosu-distribution-filters";

export const runtime = "nodejs";

// 도수는 1/8(0.125) 다이옵터 그리드다(2026-08-26 실측 검증: daily_work_status의
// 도수1/2/3 값 103만여 샘플의 소수부를 집계하면 0/.12/.25/.37/.5/.62/.75/.87 8종이
// 전체의 약 93%를 차지 — 안경 도수 주문 단위인 1/8D를 소수 둘째자리까지 "내림"해서
// 저장한 것으로 확인됨, 예: 0.125→0.12, 0.375→0.37, 0.625→0.62, 0.875→0.87). 그래서
// 0.01(cents) 단위 정수 연산 대신 1/8 정수 인덱스(eighths)로 계산한 뒤 같은 내림
// 규칙으로 되돌린다 — 그래야 구간 경계값 표기가 원본 데이터에 실제로 찍히는 값
// (0.12 등)과 정확히 일치한다.
const BIN_DENOM = 8;
// 지시도수(목표) 좌우로 5칸씩, 목표를 정중앙(6번째 칸)에 두고 총 11칸 — 참고 엑셀
// (도수분포분석.xlsx)의 표 구조 그대로(2026-08-26 사용자 요청).
const HALF = 5;
const TARGET_BIN_COUNT = HALF * 2 + 1;

function eighthIndex(v: number): number {
  return Math.round(v * BIN_DENOM);
}
// idx*12.5(단위: 센트)를 0으로 향해 내림한다(원본 데이터가 실제로 그렇게 저장돼 있음,
// 2026-08-26 확인). Math.floor만 쓰면 음수 idx에서 -무한대 방향으로 내림돼(예:
// idx=-1 → floor(-12.5)=-13 → -0.13) 원본의 "0 방향 절삭" 표기(-0.12)와 어긋나므로
// 부호를 분리해 절대값 기준으로 절삭한 뒤 부호를 되붙인다.
function indexToValue(idx: number): number {
  const sign = idx < 0 ? -1 : 1;
  return (sign * Math.floor(Math.abs(idx) * 12.5)) / 100;
}

type Mode = "summary" | "hema";
function parseMode(v: string | null): Mode {
  return v === "hema" ? v : "summary";
}

interface RawRow {
  item_code: string;
  work_date: string;
  model: string | null;
  hema_no: string | null;
  do1: number | string | null;
  do2: number | string | null;
  do3: number | string | null;
}

// 품질관리 "도수 분포 분석(QC-04)" — daily_work_status(일일작업현황) 원본 실적 로그를
// 그대로 재집계한다(별도 업로드 없음). B.C 분포 분석(QC-02)/직경 분포 분석(QC-03)과
// 달리 "형명+몰드코드" 두 축이 아니라 **"형명+몰드코드+지시도수" 세 축**으로 그룹핑해
// 조합마다 별도의 작은 표를 만든다(2026-08-26 사용자 요청, 참고 엑셀 도수분포분석.xlsx
// 구조) — 같은 형명·몰드코드 안에도 실제로는 서로 다른 목표 파워(item_code)가 섞여
// 있어, B.C/직경처럼 형명+몰드만으로 묶으면 구간 창(11칸)보다 훨씬 넓게 흩어져 버리기
// 때문이다. 표마다 구간(bins)은 그 표의 지시도수를 정중앙(6번째 칸)에 두고 좌우 5칸씩
// (1/8D 간격) 고정한다 — 그룹 실측 범위에 따라 창을 옮기던 B.C/직경 분포 분석과
// 다르다. mode로 그룹 안의 행 축을 고른다 — "summary"(기본)는 work_date를 "YYYY-MM"로
// 잘라 월별 한 행씩, "hema"는 HEMA No별 상세다. 몰드코드는 daily_work_status에 없는
// 값이라, item_code 단위로 dosu_change_status의 조립투입품목(조립투입품목명에 "몰드"가
// 들어간 행)을 매핑해서 붙인다(QC-01/02/03과 같은 정의). 매핑이 없거나 지시도수를
// 알 수 없는(item_code 끝이 4자리 숫자가 아닌) 품목코드는 제외한다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const model = params.get("model");
  const moldFilter = params.get("mold");
  // 지시도수 필터 — item_code에서 추출한 값이라(SQL 컬럼이 아님) WHERE절이 아니라
  // 아래 집계 루프에서 target 계산 직후 걸러낸다. 부동소수 비교 오차를 피하려고
  // 센트(0.01) 단위 정수로 반올림해 비교한다.
  const dosuFilterRaw = params.get("dosu");
  const dosuFilterCents = dosuFilterRaw !== null && dosuFilterRaw !== "" ? Math.round(Number(dosuFilterRaw) * 100) : null;
  const mode = parseMode(params.get("mode"));
  if (mode === "hema" && (!model || !moldFilter)) {
    return NextResponse.json({ groups: [] });
  }

  const { where, args } = buildDosuDistributionWhere(params, { skipParams: ["mold"] });
  const rows = db
    .prepare(
      `SELECT item_code, work_date,
         json_extract(detail, '$."형명"') as model,
         json_extract(detail, '$."HEMA No"') as hema_no,
         json_extract(detail, '$."도수1"') as do1,
         json_extract(detail, '$."도수2"') as do2,
         json_extract(detail, '$."도수3"') as do3
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

  const byGroup = new Map<
    string,
    { model: string; moldCode: string; target: number; rows: Map<string, number[]> }
  >();
  for (const r of rows) {
    if (!r.model) continue;
    const moldCode = moldByItem.get(r.item_code);
    if (!moldCode) continue;
    if (moldFilter && moldCode !== moldFilter) continue;
    const target = extractTargetDosu(r.item_code);
    if (target == null) continue;
    if (dosuFilterCents != null && Math.round(target * 100) !== dosuFilterCents) continue;
    const rowKey = mode === "hema" ? r.hema_no : r.work_date.slice(0, 7);
    if (!rowKey) continue;

    const groupKey = `${r.model}::${moldCode}::${target}`;
    const g = byGroup.get(groupKey) ?? {
      model: r.model,
      moldCode,
      target,
      rows: new Map<string, number[]>(),
    };
    const samples = g.rows.get(rowKey) ?? [];
    for (const raw of [r.do1, r.do2, r.do3]) {
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      // 0은 같은 품목코드 안에서 정상 도수값과 섞여 나타나는 "미측정을 0으로 채운
      // 결함" 패턴이 확인돼(B.C/직경 분포 분석과 동일한 기준, 2026-08-26 검증) 제외한다.
      // 원본은 부호 없는 절대값이지만 지시도수와 같은 부호 관례(음수)로 맞추기 위해
      // 부호를 뒤집는다(extractTargetDosu와 동일한 이유).
      if (!Number.isNaN(n) && n !== 0) samples.push(-n);
    }
    g.rows.set(rowKey, samples);
    byGroup.set(groupKey, g);
  }

  const groups = [...byGroup.values()]
    .filter((g) => [...g.rows.values()].some((s) => s.length > 0))
    .map((g) => {
      const idx0 = eighthIndex(g.target);
      // 참고 엑셀과 같은 표기 순서 — 왼쪽이 큰 값, 오른쪽이 작은 값(내림차순), 지시도수가
      // 정중앙(인덱스 HALF)에 온다.
      const bins = Array.from({ length: TARGET_BIN_COUNT }, (_, i) => indexToValue(idx0 + HALF - i));
      const highIdx = idx0 + HALF; // bins[0](가장 왼쪽=가장 큰 값)에 대응하는 인덱스

      const rowsArr = [...g.rows.entries()]
        .filter(([, samples]) => samples.length > 0)
        .map(([rowKey, samples]) => {
          const counts = new Array(TARGET_BIN_COUNT).fill(0);
          // upperOverflow=지시도수+0.625D보다 높은 실측값(맨 왼쪽 칸에 몰아 넣음),
          // lowerOverflow=지시도수-0.625D보다 낮은 실측값(맨 오른쪽 칸) — B.C/직경
          // 분포 분석과 같은 방식으로 "&" 표시를 붙이기 위한 플래그.
          let lowerOverflow = false;
          let upperOverflow = false;
          for (const v of samples) {
            const pos = highIdx - eighthIndex(v);
            let ci = pos;
            if (pos < 0) {
              ci = 0;
              upperOverflow = true;
            } else if (pos > TARGET_BIN_COUNT - 1) {
              ci = TARGET_BIN_COUNT - 1;
              lowerOverflow = true;
            }
            counts[ci]++;
          }
          const total = samples.length;
          const values = counts.map((c) => Math.round((c / total) * 1000) / 10);
          return { rowKey, sampleCount: total, values, counts, lowerOverflow, upperOverflow };
        })
        .sort((a, b) => a.rowKey.localeCompare(b.rowKey));

      return { model: g.model, mold: g.moldCode, targetDosu: g.target, bins, rows: rowsArr };
    })
    .sort(
      (a, b) =>
        a.model.localeCompare(b.model) ||
        a.mold.localeCompare(b.mold, undefined, { numeric: true }) ||
        // 지시도수 내림차순으로 세로 나열(참고 엑셀과 같은 순서, 2026-08-26 사용자 요청).
        b.targetDosu - a.targetDosu
    );

  return NextResponse.json({ groups });
}
