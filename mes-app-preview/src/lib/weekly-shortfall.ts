import type { DatabaseSync } from "node:sqlite";
import { DEFECT_TYPE_STATUS_COLS } from "./defect-type-status-columns";
import { fetchPackagingSchedule, p410BySo, splitSoNos, PACKAGING_LINES } from "./packaging-schedule";
import { addDays, monthEndOf } from "./weekly-report";

// PROD-11 주간요약 "원인분석"(2026-10-23 사용자 요청) — 인쇄공정·출하공정이 계획대비 달성율에 못 미칠 때
// 어디서 모자랐는지를 데이터로 짚는다. 화면 전용이며 요약 다운로드(Word)에는 넣지 않는다.
//  - 인쇄공정: 계획 = PLAN-02 착색 라인 일CAPA × 근무일, 실적 = 착색 인쇄(P220) 양품. 일별 실적·가동대수,
//    설비별 전기간 대비 증감, 불량(불량종합현황 '착색 인쇄')으로 원인을 나눈다.
//  - 출하공정: 계획 = PLAN-03 포장 일정 칸 계획수량, 실적 = 출하포장(P410) 양품. 일별·라인별·수주별로 보고,
//    수주마다 마킹(P400) 공급·수주 잔량·기간 뒤 포장 여부로 원인을 붙인다.
// 비교 기간("전기간")은 분석 기간 바로 앞의 같은 일수 구간이다.

export type ShortfallProcess = "printing" | "shipping";
export type ShortfallPeriod = "week" | "month";
export interface ShortfallFinding {
  /** main = 핵심 원인, sub = 보조 원인, info = 참고 */
  level: "main" | "sub" | "info";
  text: string;
}
export interface ShortfallTable {
  title: string;
  note?: string;
  columns: string[];
  /** 오른쪽 정렬할 열 번호 */
  right: number[];
  /** 숫자는 화면에서 천 단위 구분, 문자열은 그대로 */
  rows: (string | number | null)[][];
  /** 빨간색으로 강조할 행 번호 */
  highlight: number[];
}
export interface ShortfallAnalysis {
  process: ShortfallProcess;
  period: ShortfallPeriod;
  label: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  plan: number;
  actual: number;
  rate: number | null;
  findings: ShortfallFinding[];
  tables: ShortfallTable[];
}

const n0 = (v: number) => Math.round(v).toLocaleString("ko-KR");
const pct = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(d)}%`);
const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const wd = (s: string) => WD[new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))).getDay()];

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
function workDateSet(db: DatabaseSync, from: string, to: string): Set<string> {
  return new Set(
    (
      db.prepare(`SELECT cal_date FROM production_calendar WHERE cal_date BETWEEN ? AND ? AND work_yn = 'Y'`).all(from, to) as {
        cal_date: string;
      }[]
    ).map((r) => r.cal_date)
  );
}

const DEFECT_KEYS = DEFECT_TYPE_STATUS_COLS.map((c) => c.key).slice(DEFECT_TYPE_STATUS_COLS.findIndex((c) => c.key === "불량율(%)") + 1);
/** 불량종합현황 한 공정의 기간 합계 — 설비별 양품·불량과 불량유형별 수량 */
function defectsOf(db: DatabaseSync, process: string, from: string, to: string) {
  const select = DEFECT_KEYS.map((k, i) => `SUM(CAST(json_extract(detail, '$."${k}"') AS REAL)) AS t${i}`).join(", ");
  const rows = db
    .prepare(
      `SELECT json_extract(detail, '$."설비명"') AS eq,
              SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) AS good,
              SUM(CAST(json_extract(detail, '$."불량수량"') AS REAL)) AS bad, ${select}
         FROM defect_type_status
        WHERE json_extract(detail, '$."공정명"') = ? AND order_date BETWEEN ? AND ?
        GROUP BY eq`
    )
    .all(process, from, to) as Record<string, number | string | null>[];
  let good = 0;
  let bad = 0;
  const byEq = new Map<string, { good: number; bad: number }>();
  const types = new Map<string, number>();
  for (const r of rows) {
    const g = Number(r.good ?? 0);
    const b = Number(r.bad ?? 0);
    good += g;
    bad += b;
    byEq.set(String(r.eq ?? ""), { good: g, bad: b });
    DEFECT_KEYS.forEach((k, i) => types.set(k, (types.get(k) ?? 0) + Number(r[`t${i}`] ?? 0)));
  }
  return { good, bad, rate: good + bad > 0 ? bad / (good + bad) : null, byEq, types };
}

// ── 인쇄공정 ──────────────────────────────────────────────────────────────────
function analyzePrinting(db: DatabaseSync, from: string, to: string, prevFrom: string, prevTo: string): Omit<ShortfallAnalysis, "period" | "label"> {
  const capaCache = new Map<string, number | null>();
  const capaOf = (ym: string): number | null => {
    if (!capaCache.has(ym)) {
      const row = db.prepare(`SELECT daily_capa FROM line_capa_plan WHERE year_month = ? AND line_key = 'coloring'`).get(ym) as
        | { daily_capa: number | null }
        | undefined;
      capaCache.set(ym, row?.daily_capa ?? null);
    }
    return capaCache.get(ym) ?? null;
  };
  const read = (a: string, b: string) =>
    db
      .prepare(
        `SELECT work_date AS d, json_extract(detail, '$."라인"') AS line,
                SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) AS q
           FROM daily_work_status WHERE process_code = 'P220' AND work_date BETWEEN ? AND ?
          GROUP BY d, line`
      )
      .all(a, b) as { d: string; line: string | null; q: number | null }[];
  const cur = read(from, to).filter((r) => (r.q ?? 0) > 0);
  const prev = read(prevFrom, prevTo).filter((r) => (r.q ?? 0) > 0);
  const work = workDateSet(db, prevFrom, to);
  const isAuto = (line: string) => line.startsWith("자동인쇄");

  // 기간 지표: 근무일 수, 근무일 가동대수 합, 근무일 생산량 합(휴일 생산은 따로)
  const stats = (rows: typeof cur, a: string, b: string) => {
    const days = datesBetween(a, b).filter((d) => work.has(d));
    let units = 0;
    let qtyWork = 0;
    let qtyHoliday = 0;
    for (const r of rows) {
      if (work.has(r.d)) {
        units += 1;
        qtyWork += r.q ?? 0;
      } else qtyHoliday += r.q ?? 0;
    }
    const n = days.length;
    return { n, units, qtyWork, qtyHoliday, avgUnits: n > 0 ? units / n : null, perUnit: units > 0 ? qtyWork / units : null };
  };
  const sc = stats(cur, from, to);
  const sp = stats(prev, prevFrom, prevTo);

  // 일별 표
  const dayRows: ShortfallTable["rows"] = [];
  const dayHi: number[] = [];
  let plan = 0;
  let actual = 0;
  const zeroDays: string[] = [];
  for (const d of datesBetween(from, to)) {
    const isWork = work.has(d);
    const p = isWork ? capaOf(d.slice(0, 7)) ?? 0 : 0;
    const rows = cur.filter((r) => r.d === d);
    const q = rows.reduce((s, r) => s + (r.q ?? 0), 0);
    const manual = rows.filter((r) => !isAuto(r.line ?? "")).length;
    const auto = rows.filter((r) => isAuto(r.line ?? "")).length;
    plan += p;
    actual += q;
    if (isWork && p > 0 && q < p * 0.1) zeroDays.push(d); // 계획의 10% 미만이면 사실상 실적 없음(미입력 의심)
    if (!isWork && q === 0) continue; // 쉬는 날(실적 없음)은 표에서 뺀다
    if (p > 0 && q < p) dayHi.push(dayRows.length);
    dayRows.push([`${md(d)}(${wd(d)})`, isWork ? "근무" : "휴일", p || null, q, q - p, p > 0 ? pct(q / p) : "-", manual, auto, manual + auto]);
  }

  // 설비별 표(전기간 대비)
  const curDef = defectsOf(db, "착색 인쇄", from, to);
  const prevDef = defectsOf(db, "착색 인쇄", prevFrom, prevTo);
  const lines = [...new Set([...cur, ...prev].map((r) => r.line ?? ""))].filter(Boolean);
  const eqRows = lines
    .map((line) => {
      const c = cur.filter((r) => r.line === line);
      const p = prev.filter((r) => r.line === line);
      const cq = c.reduce((s, r) => s + (r.q ?? 0), 0);
      const pq = p.reduce((s, r) => s + (r.q ?? 0), 0);
      const def = curDef.byEq.get(line);
      return { line, cDays: c.length, cq, pDays: p.length, pq, diff: cq - pq, badRate: def && def.good + def.bad > 0 ? def.bad / (def.good + def.bad) : null };
    })
    .sort((a, b) => a.diff - b.diff);
  const idle = eqRows.filter((e) => e.cDays === 0 && e.pDays > 0);
  const dropped = eqRows.filter((e) => e.cDays > 0 && e.diff < 0).slice(0, 3);

  // 원인 정리
  const findings: ShortfallFinding[] = [];
  const short = plan - actual;
  findings.push({
    level: "info",
    text: `계획 ${n0(plan)} 대비 실적 ${n0(actual)} — ${short > 0 ? `${n0(short)} 부족` : `${n0(-short)} 초과`} (달성율 ${pct(plan > 0 ? actual / plan : null)})`,
  });
  if (plan <= 0) findings.push({ level: "info", text: "이 기간 계획이 없습니다(계획정보 PLAN-02 착색 라인 일CAPA 또는 생산캘린더 근무일 확인)." });
  if (zeroDays.length > 0) {
    const lost = zeroDays.reduce((s, d) => s + (capaOf(d.slice(0, 7)) ?? 0), 0);
    findings.push({
      level: "main",
      text: `근무일인데 착색 인쇄 실적이 (거의) 없는 날 ${zeroDays.length}일(${zeroDays.map(md).join(", ")}) — 계획 ${n0(lost)}가 통째로 빠졌습니다. 실적 미입력(업로드 누락)인지 먼저 확인하세요.`,
    });
  }
  const lowDays = dayRows.filter((r) => typeof r[2] === "number" && (r[3] as number) < (r[2] as number) * 0.9);
  if (lowDays.length > 0)
    findings.push({ level: "sub", text: `달성율 90% 미만인 날: ${lowDays.map((r) => `${r[0]} ${r[5]}(가동 ${r[8]}대)`).join(", ")}` });
  if (sc.avgUnits != null && sp.avgUnits != null && sp.perUnit != null && sc.avgUnits < sp.avgUnits - 0.05) {
    const effect = (sp.avgUnits - sc.avgUnits) * sp.perUnit * sc.n;
    findings.push({
      level: "main",
      text: `평균 가동대수 ${sc.avgUnits.toFixed(1)}대 — 전기간 ${sp.avgUnits.toFixed(1)}대보다 ${(sp.avgUnits - sc.avgUnits).toFixed(1)}대 적습니다(약 ${n0(effect)} 감소 영향).`,
    });
  }
  if (sc.perUnit != null && sp.perUnit != null && sc.avgUnits != null && sc.perUnit < sp.perUnit * 0.98) {
    const effect = (sp.perUnit - sc.perUnit) * sc.avgUnits * sc.n;
    findings.push({
      level: "main",
      text: `대당 하루 생산량 ${n0(sc.perUnit)} — 전기간 ${n0(sp.perUnit)}보다 ${pct((sp.perUnit - sc.perUnit) / sp.perUnit)} 낮습니다(약 ${n0(effect)} 감소 영향). 소량 작업지시·모델 교체가 많았는지 확인하세요.`,
    });
  }
  const capaNow = capaOf(from.slice(0, 7));
  if (capaNow && sc.perUnit && sc.avgUnits != null) {
    const need = capaNow / sc.perUnit;
    if (need > sc.avgUnits + 0.05)
      findings.push({
        level: "sub",
        text: `일CAPA ${n0(capaNow)}를 맞추려면 지금 대당 생산량(${n0(sc.perUnit)}) 기준 하루 ${need.toFixed(1)}대가 돌아야 하는데 실제 평균은 ${sc.avgUnits.toFixed(1)}대입니다.`,
      });
  }
  if (curDef.good + curDef.bad > 0) {
    const worse = prevDef.rate != null && curDef.rate != null && curDef.rate > prevDef.rate * 1.1 && curDef.rate - prevDef.rate > 0.001;
    findings.push({
      level: worse ? "main" : "sub",
      text: `착색 인쇄 불량 ${n0(curDef.bad)}개(불량률 ${pct(curDef.rate, 2)}, 전기간 ${pct(prevDef.rate, 2)})${
        short > 0 && actual + curDef.bad >= plan ? " — 불량이 없었다면 계획을 달성했을 수량입니다" : ""
      }.`,
    });
  }
  if (idle.length > 0)
    findings.push({ level: "sub", text: `전기간에는 돌았는데 이번에 실적이 없는 설비: ${idle.map((e) => `${e.line}(전기간 ${n0(e.pq)})`).join(", ")}` });
  if (dropped.length > 0)
    findings.push({ level: "sub", text: `생산이 가장 많이 줄어든 설비: ${dropped.map((e) => `${e.line} ${n0(e.diff)}`).join(", ")}` });
  if (sc.qtyHoliday > 0) findings.push({ level: "info", text: `휴일 생산 ${n0(sc.qtyHoliday)}이 실적에 포함돼 있습니다(계획은 근무일만).` });
  if (short > 0 && findings.filter((f) => f.level === "main").length === 0)
    findings.push({ level: "info", text: "가동대수·대당 생산량·불량률이 전기간과 비슷합니다 — 일CAPA(계획)가 실제 생산 능력보다 높게 잡혀 있을 수 있습니다." });

  const topTypes = [...curDef.types.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const work0 = curDef.good + curDef.bad;
  return {
    process: "printing",
    from,
    to,
    prevFrom,
    prevTo,
    plan,
    actual,
    rate: plan > 0 ? actual / plan : null,
    findings,
    tables: [
      {
        title: "일별 계획·실적",
        note: "계획 = 근무일 일CAPA, 가동대수 = 그날 착색 인쇄 양품이 있는 설비 수",
        columns: ["일자", "구분", "계획", "실적", "차이", "달성율", "수동", "자동", "가동대수"],
        right: [2, 3, 4, 5, 6, 7, 8],
        rows: dayRows,
        highlight: dayHi,
      },
      {
        title: "설비별 실적(전기간 대비, 감소 큰 순)",
        note: `전기간 ${md(prevFrom)}~${md(prevTo)} · 불량률은 불량종합현황 기준`,
        columns: ["설비", "가동일", "생산량", "전기간 가동일", "전기간 생산량", "증감", "불량률"],
        right: [1, 2, 3, 4, 5, 6],
        rows: eqRows.map((e) => [e.line, e.cDays, e.cq, e.pDays, e.pq, e.diff, pct(e.badRate, 2)]),
        highlight: eqRows.map((e, i) => (e.diff < 0 ? i : -1)).filter((i) => i >= 0),
      },
      {
        title: "불량유형 상위",
        note: `작업량(양품+불량) ${n0(work0)} 기준`,
        columns: ["불량유형", "수량", "불량률", "전기간 수량"],
        right: [1, 2, 3],
        rows: topTypes.map(([k, v]) => [k, v, pct(work0 > 0 ? v / work0 : null, 2), prevDef.types.get(k) ?? 0]),
        highlight: [],
      },
    ],
  };
}

// ── 출하공정 ──────────────────────────────────────────────────────────────────
function analyzeShipping(db: DatabaseSync, from: string, to: string, prevFrom: string, prevTo: string, overrideNote: string | null): Omit<ShortfallAnalysis, "period" | "label"> {
  const days = datesBetween(from, to);
  const sched = fetchPackagingSchedule(db, from, days.length);
  const work = workDateSet(db, from, to);
  const lineLabel = new Map(PACKAGING_LINES.map((l) => [l.key, l.label]));

  // 전체 출하포장 실적(계획 외 수주 포함) — 일자별
  const totalByDate = new Map(
    (
      db
        .prepare(
          `SELECT work_date AS d, SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) AS q
             FROM daily_work_status WHERE process_code = 'P410' AND work_date BETWEEN ? AND ? GROUP BY d`
        )
        .all(from, to) as { d: string; q: number | null }[]
    ).map((r) => [r.d, r.q ?? 0])
  );
  const plannedActualOf = (d: string) =>
    Object.entries(sched.lineActuals)
      .filter(([k]) => k.endsWith(`|${d}`))
      .reduce((s, [, v]) => s + v.total, 0);

  // 그날 계획한 수주들의 포장 준비 물량 = 그날까지 마킹(P400) 누계 − 전날까지 포장 누계(칸 계획·수주 잔량 이내).
  // 10/20처럼 포장할 물량이 없어 인원이 다른 공정을 지원한 날을 "실적 미입력"으로 오해하지 않도록 날마다 따진다
  // (2026-10-23 사용자 설명: 그날 출하포장 준비된 제품이 없어 다른 공정 지원).
  const p410 = p410BySo(db);
  const markedBy = (so: string, d: string) =>
    (sched.soMarkPrior?.[so] ?? 0) + Object.entries(sched.soMarkDaily?.[so] ?? {}).reduce((t, [x, q]) => (x <= d ? t + q : t), 0);
  const packedBefore = (so: string, d: string) => (p410.get(so) ?? []).reduce((t, r) => (r.d < d ? t + r.q : t), 0);
  const readiness = (d: string) => {
    let ready = 0;
    let remain = 0;
    for (const c of sched.cells.filter((x) => x.plan_date === d)) {
      const sos = splitSoNos(c.so_no);
      const pb = sos.reduce((t, so) => t + packedBefore(so, d), 0);
      const mk = sos.reduce((t, so) => t + markedBy(so, d), 0);
      const rem = c.order_qty != null ? Math.max(0, c.order_qty - pb) : Infinity;
      const cp = c.plan_qty ?? 0;
      ready += Math.min(cp, Math.max(0, mk - pb), rem);
      remain += Math.min(cp, rem);
    }
    return { ready, remain };
  };
  type DayCause = "앞당겨 포장(잔량 없음)" | "포장 준비 물량 부족" | "물량 있었음";

  let plan = 0;
  let actual = 0;
  const dayRows: ShortfallTable["rows"] = [];
  const dayHi: number[] = [];
  const lowDays: { d: string; p: number; total: number; ready: number; cause: DayCause }[] = [];
  let unplannedTotal = 0;
  for (const d of days) {
    const p = sched.cells.filter((c) => c.plan_date === d).reduce((s, c) => s + (c.plan_qty ?? 0), 0);
    const total = totalByDate.get(d) ?? 0;
    const planned = plannedActualOf(d);
    plan += p;
    actual += total;
    unplannedTotal += Math.max(0, total - planned);
    if (p === 0 && total === 0) continue;
    let cause: DayCause | null = null;
    let ready: number | null = null;
    if (p > 0 && total < p * 0.9) {
      const rd = readiness(d);
      ready = rd.ready;
      cause = rd.remain < p * 0.5 ? "앞당겨 포장(잔량 없음)" : rd.ready < p * 0.9 ? "포장 준비 물량 부족" : "물량 있었음";
      lowDays.push({ d, p, total, ready: rd.ready, cause });
    }
    if (p > 0 && total < p) dayHi.push(dayRows.length);
    dayRows.push([`${md(d)}(${wd(d)})`, work.has(d) ? "근무" : "휴일", p || null, total, total - p, p > 0 ? pct(total / p) : "-", planned, Math.max(0, total - planned), ready, cause]);
  }

  // 라인별
  const lineRows: ShortfallTable["rows"] = [];
  const lineHi: number[] = [];
  for (const l of PACKAGING_LINES) {
    const p = sched.cells.filter((c) => c.line_key === l.key).reduce((s, c) => s + (c.plan_qty ?? 0), 0);
    const a = Object.entries(sched.lineActuals)
      .filter(([k]) => k.startsWith(`${l.key}|`))
      .reduce((s, [, v]) => s + v.total, 0);
    if (p === 0 && a === 0) continue;
    if (p > 0 && a < p) lineHi.push(lineRows.length);
    lineRows.push([l.label, p, a, a - p, p > 0 ? pct(a / p) : "-"]);
  }

  // 수주별(칸에 적힌 수주번호 묶음 단위) — 원인 태그
  const bySo = p410BySo(db);
  type Grp = { key: string; sos: string[]; product: string | null; lines: Set<string>; dates: string[]; plan: number; orderQty: number | null };
  const groups = new Map<string, Grp>();
  for (const c of sched.cells) {
    const sos = splitSoNos(c.so_no);
    const key = sos.join(",");
    const g = groups.get(key) ?? { key, sos, product: c.product_name, lines: new Set<string>(), dates: [], plan: 0, orderQty: c.order_qty ?? null };
    g.lines.add(lineLabel.get(c.line_key) ?? c.line_key);
    g.dates.push(c.plan_date);
    g.plan += c.plan_qty ?? 0;
    if (g.orderQty == null && c.order_qty != null) g.orderQty = c.order_qty;
    groups.set(key, g);
  }
  type Tag = "달성" | "수주 잔량 소진" | "마킹 공급 부족" | "기간 뒤 포장(지연)" | "포장 미진행" | "계획수량 없음";
  const soRows: { g: Grp; actual: number; markAvail: number; remain: number | null; later: number; tag: Tag }[] = [];
  for (const g of groups.values()) {
    let a = 0;
    let later = 0;
    for (const so of g.sos)
      for (const r of bySo.get(so) ?? []) {
        if (r.d >= from && r.d <= to) a += r.q;
        else if (r.d > to) later += r.q;
      }
    const packedBefore = g.sos.reduce((s, so) => s + (sched.soPriorActual[so] ?? 0), 0);
    const marked = g.sos.reduce(
      (s, so) => s + (sched.soMarkPrior?.[so] ?? 0) + Object.entries(sched.soMarkDaily?.[so] ?? {}).reduce((t, [d, q]) => (d <= to ? t + q : t), 0),
      0
    );
    const markAvail = Math.max(0, marked - packedBefore);
    const remain = g.orderQty != null ? Math.max(0, g.orderQty - packedBefore) : null;
    let tag: Tag;
    if (g.plan <= 0) tag = "계획수량 없음";
    else if (a >= g.plan * 0.98) tag = "달성";
    else if (remain != null && remain < g.plan && a >= remain * 0.98) tag = "수주 잔량 소진";
    else if (markAvail < g.plan * 0.98) tag = "마킹 공급 부족"; // 준비 물량을 다 포장해도 계획에 못 미침
    else if (later > 0) tag = "기간 뒤 포장(지연)";
    else tag = "포장 미진행";
    soRows.push({ g, actual: a, markAvail, remain, later, tag });
  }
  soRows.sort((x, y) => x.actual - x.g.plan - (y.actual - y.g.plan));

  const findings: ShortfallFinding[] = [];
  const short = plan - actual;
  findings.push({
    level: "info",
    text: `계획 ${n0(plan)} 대비 실적 ${n0(actual)} — ${short > 0 ? `${n0(short)} 부족` : `${n0(-short)} 초과`} (달성율 ${pct(plan > 0 ? actual / plan : null)})`,
  });
  if (overrideNote) findings.push({ level: "info", text: overrideNote });
  const byTag = new Map<Tag, { n: number; short: number }>();
  for (const r of soRows) {
    if (r.tag === "달성") continue;
    const v = byTag.get(r.tag) ?? { n: 0, short: 0 };
    v.n += 1;
    v.short += Math.max(0, r.g.plan - r.actual);
    byTag.set(r.tag, v);
  }
  const TAG_TEXT: Record<Tag, string> = {
    "마킹 공급 부족": "마킹(P400)까지 끝난 수량이 계획보다 적어 포장할 물량이 없었습니다 — 전공정(마킹·입고대기) 진도를 확인하세요",
    "포장 미진행": "포장할 물량(마킹 완료분)은 있었는데 포장하지 않았습니다 — 라인 가동·인원·우선순위 변경을 확인하세요",
    "기간 뒤 포장(지연)": "계획보다 늦게(분석 기간 뒤) 포장했습니다",
    "수주 잔량 소진": "남은 수주량이 계획보다 적어 다 포장하고 끝났습니다 — 계획이 수주 잔량보다 크게 잡혔습니다",
    "계획수량 없음": "칸에 계획수량이 없습니다(UPH·개입수 미등록)",
    달성: "",
  };
  for (const [tag, v] of [...byTag.entries()].sort((a, b) => b[1].short - a[1].short)) {
    findings.push({ level: tag === "마킹 공급 부족" || tag === "포장 미진행" ? "main" : "sub", text: `${tag} ${v.n}건(수주별 부족 합 ${n0(v.short)}): ${TAG_TEXT[tag]}.` });
  }
  const noStock = lowDays.filter((x) => x.cause !== "물량 있었음");
  if (noStock.length > 0)
    findings.push({
      level: "main",
      text: `포장할 물량이 없던 날: ${noStock.map((x) => `${md(x.d)}(준비 ${n0(x.ready)} / 계획 ${n0(x.p)}, ${x.cause})`).join(", ")} — 계획 수주를 앞서 포장해 잔량이 없거나 마킹(전공정) 물량이 오지 않아 계획만큼 포장할 수 없었습니다.`,
    });
  const hadStock = lowDays.filter((x) => x.cause === "물량 있었음");
  if (hadStock.length > 0)
    findings.push({
      level: "main",
      text: `포장 준비 물량은 있었는데 계획에 못 미친 날: ${hadStock.map((x) => `${md(x.d)} ${pct(x.total / x.p)}(준비 ${n0(x.ready)})`).join(", ")} — 라인 가동·인원을 확인하세요${hadStock.some((x) => x.total < x.p * 0.1) ? "(실적이 거의 없는 날은 업로드 누락인지도 확인)" : ""}.`,
    });
  const weakLines = lineRows.filter((_, i) => lineHi.includes(i)).map((r) => `${r[0]} ${r[4]}`);
  if (weakLines.length > 0) findings.push({ level: "sub", text: `계획 미달 라인: ${weakLines.join(", ")}` });
  const early = dayRows.filter((r) => r[2] == null && (r[3] as number) > 0);
  if (early.length > 0)
    findings.push({ level: "info", text: `계획이 없는 날(휴일 등)에 ${early.map((r) => `${r[0]} ${n0(r[3] as number)}`).join(", ")} 포장했습니다 — 뒤 날짜 계획을 앞당겨 한 것이면 그 날짜는 미달로 보입니다.` });
  if (unplannedTotal > 0) findings.push({ level: "info", text: `계획에 없는 수주를 ${n0(unplannedTotal)} 포장했습니다(실적에는 포함).` });
  const def = defectsOf(db, "출하포장", from, to);
  const prevDef = defectsOf(db, "출하포장", prevFrom, prevTo);
  if (def.bad > 0) findings.push({ level: "sub", text: `출하포장 불량 ${n0(def.bad)}개(불량률 ${pct(def.rate, 2)}, 전기간 ${pct(prevDef.rate, 2)}).` });

  return {
    process: "shipping",
    from,
    to,
    prevFrom,
    prevTo,
    plan,
    actual,
    rate: plan > 0 ? actual / plan : null,
    findings,
    tables: [
      {
        title: "일별 계획·실적",
        note: "계획 = PLAN-03 포장 일정 칸 계획수량, 실적 = 출하포장(P410) 양품 전체(계획 수주 + 계획 외 수주), 준비 물량(90% 미만인 날만) = 그날 계획 수주의 마킹 누계 − 전날까지 포장 누계",
        columns: ["일자", "구분", "계획", "실적", "차이", "달성율", "계획 수주", "계획 외", "준비 물량", "미달 원인"],
        right: [2, 3, 4, 5, 6, 7, 8],
        rows: dayRows,
        highlight: dayHi,
      },
      {
        title: "라인별 계획·실적",
        note: "실적 = 그 라인에 계획한 수주번호의 포장 수량",
        columns: ["라인", "계획", "실적", "차이", "달성율"],
        right: [1, 2, 3, 4],
        rows: lineRows,
        highlight: lineHi,
      },
      {
        title: "수주별 계획·실적(부족 큰 순)",
        note: "포장가능 = 기간 끝까지 마킹(P400) 누계 − 기간 전 포장 누계, 수주잔량 = 수주량 − 기간 전 포장 누계",
        columns: ["수주번호", "품목", "라인", "계획일", "계획", "실적", "차이", "포장가능", "수주잔량", "기간 뒤 포장", "원인"],
        right: [4, 5, 6, 7, 8, 9],
        rows: soRows.map((r) => [
          r.g.sos.join(", "),
          r.g.product,
          [...r.g.lines].join(", "),
          [...new Set(r.g.dates)].sort().map(md).join(", "),
          r.g.plan,
          r.actual,
          r.actual - r.g.plan,
          r.markAvail,
          r.remain,
          r.later || null,
          r.tag,
        ]),
        highlight: soRows.map((r, i) => (r.tag !== "달성" && r.tag !== "수주 잔량 소진" ? i : -1)).filter((i) => i >= 0),
      },
    ],
  };
}

/** weekStart(금요일)의 주차에서 당주(월말에서 자름) 또는 월 누계(1일~보고 주차 끝) 구간을 분석한다 */
export function analyzeShortfall(db: DatabaseSync, weekStart: string, process: ShortfallProcess, period: ShortfallPeriod): ShortfallAnalysis {
  const yearMonth = weekStart.slice(0, 7);
  const monthEnd = monthEndOf(yearMonth);
  const weekEnd = addDays(weekStart, 6);
  const to = weekEnd < monthEnd ? weekEnd : monthEnd;
  const from = period === "week" ? weekStart : `${yearMonth}-01`;
  const len = datesBetween(from, to).length;
  const prevFrom = addDays(from, -len);
  const prevTo = addDays(from, -1);
  const label = period === "week" ? `당주 ${md(from)}~${md(to)}` : `${Number(yearMonth.slice(5, 7))}월 누계 ${md(from)}~${md(to)}`;
  if (process === "printing") return { ...analyzePrinting(db, from, to, prevFrom, prevTo), period, label };

  let overrideNote: string | null = null;
  if (period === "week") {
    const ov = db
      .prepare("SELECT plan_qty FROM weekly_packaging_plan_override WHERE year_month = ? AND week_start = ?")
      .get(yearMonth, weekStart) as { plan_qty: number } | undefined;
    if (ov) overrideNote = `이 주차 기초계획을 ${n0(ov.plan_qty)}로 직접 수정해 두었습니다 — 원인분석은 PLAN-03 포장 일정 칸 계획으로 계산합니다.`;
  }
  return { ...analyzeShipping(db, from, to, prevFrom, prevTo, overrideNote), period, label };
}
