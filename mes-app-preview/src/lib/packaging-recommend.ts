import type { DatabaseSync } from "node:sqlite";
import {
  addDays,
  fetchPackagingCandidates,
  PACKAGING_LINES,
  type PackagingCandidate,
} from "@/lib/packaging-schedule";

// 계획정보(PLAN-03) "신규 수주 추천" — 아직 일정에 계획이 다 잡히지 않은 수주에 라인과 시작일을 추천한다(2026-10-05 사용자 요청).
// 일정(수기) 파일(담당자가 만든 월별 계획)을 분석해 얻은 계획 수립 방법을 그대로 따른다:
//  ① 수주 한 건이 계획 단위 — 수주량 전체를 한 번에 계획한다.
//  ② 설비는 품목이 아니라 개입수(포장 형태)로 정한다 — 원데이 10·20·30P는 2 Line, 1·2·6P는 1·3 Line 중 먼저 끝나는 쪽
//     (같을 때는 1P → 1 Line, 2P → 3 Line), 특수·소량은 5 Line, 바이알은 바이알 라인. 실제로는 PROD-10 출하포장 작업 설비 이력과
//     포장방법·개입수 기준(팝업의 후보 목록과 같은 기준)에서 그 라인이 가능한 수주만 대상으로 한다.
//  ③ 순서는 납기일이 빠른 순으로, 라인 안에서 빈 날 없이 이어 붙인다.
//  ④ 소요일 = 잔량 ÷ 그 라인·개입수·물량대의 하루 처리량(팝업의 예상 소요와 같은 값, 주간 실적 기준). 작은 수주는 같은 날
//     남는 시간에 이어서 넣는다.
//  ⑤ 휴일(생산캘린더)과 주말은 쓰지 않고, 이미 일정에 수주가 있는 날은 건너뛴다.

export interface RecommendRow {
  so_no: string;
  customer: string | null;
  product_group: string | null;
  pack_size: number | null;
  order_qty: number;
  remaining: number;
  due_date: string | null;
  line_key: string;
  line_label: string;
  start_date: string;
  end_date: string;
  /** 일정에 걸리는 근무일 수 */
  work_days: number;
  daily_capa: number;
  /** 납기일 − 끝나는 날(음수면 납기 지연) */
  slack_days: number | null;
  late: boolean;
  /** 이 수주를 올릴 수 있는 라인들(후보 기준) */
  eligible_lines: string[];
  reason: string;
}

/**
 * 일정(수기) 분석으로 얻은 라인 규칙 — 개입수로 정한다: 10·20·30P는 2 Line만, 1·2·6P는 1·3 Line, 원데이(보석)은 5 Line, 바이알은 바이알 라인.
 * 이 규칙에 없는 개입수는 null(후보 목록 기준을 그대로 쓴다).
 */
function ruleLines(pm: string | null, pk: number | null): string[] | null {
  const m = (pm ?? "").trim();
  if (m === "바이알") return ["vial"];
  if (m === "원데이(보석)") return ["line5"];
  if (pk != null && [10, 20, 30].includes(pk)) return ["line2"];
  if (pk != null && [1, 2, 6].includes(pk)) return ["line1", "line3"];
  return null;
}

interface LineState {
  day: string;
  used: number;
}

// 계산에 몇 초 걸리므로 60초 동안 재사용하고, 일정을 바꾸는 저장이 있으면 바로 비운다
const recCache = new WeakMap<DatabaseSync, { at: number; today: string; rows: RecommendRow[] }>();
export function invalidateRecommendCache(db: DatabaseSync): void {
  recCache.delete(db);
}
export function recommendSchedule(db: DatabaseSync, today: string): RecommendRow[] {
  const hit = recCache.get(db);
  if (hit && hit.today === today && Date.now() - hit.at < 60_000) return hit.rows;
  const rows = computeRecommend(db, today);
  recCache.set(db, { at: Date.now(), today, rows });
  return rows;
}

function computeRecommend(db: DatabaseSync, today: string): RecommendRow[] {
  // 휴일·근무일(생산캘린더) — 오늘부터 1년
  const calEnd = addDays(today, 400);
  const cal = db
    .prepare("SELECT cal_date, day_type FROM production_calendar WHERE cal_date BETWEEN ? AND ?")
    .all(today, calEnd) as { cal_date: string; day_type: string }[];
  const holidays = new Set(cal.filter((r) => r.day_type === "휴일").map((r) => r.cal_date));
  const workDays = new Set(cal.filter((r) => r.day_type === "평일").map((r) => r.cal_date));
  const isOff = (d: string): boolean => {
    if (holidays.has(d)) return true;
    if (workDays.has(d)) return false;
    const [y, m, dd] = d.split("-").map(Number);
    const wd = new Date(y, m - 1, dd).getDay();
    return wd === 0 || wd === 6;
  };

  // 이미 일정(계획)에 수주가 들어 있는 날 — 라인별
  const occupied = new Map<string, Set<string>>();
  for (const r of db
    .prepare("SELECT plan_date, line_key FROM packaging_schedule WHERE so_no IS NOT NULL AND TRIM(so_no) <> '' AND plan_date >= ?")
    .all(today) as { plan_date: string; line_key: string }[]) {
    (occupied.get(r.line_key) ?? occupied.set(r.line_key, new Set()).get(r.line_key)!).add(r.plan_date);
  }
  const nextFree = (line: string, from: string): string => {
    let d = from;
    for (let i = 0; i < 800; i++) {
      if (!isOff(d) && !occupied.get(line)?.has(d)) return d;
      d = addDays(d, 1);
    }
    return d;
  };

  // 후보: 라인마다 그 라인에서 포장할 수 있는 수주(납기 한 달 지난 오래된 건 제외, 이미 다 계획된 건 제외)
  const since = addDays(today, -30);
  const perLine = new Map<string, Map<string, PackagingCandidate>>();
  for (const l of PACKAGING_LINES) {
    perLine.set(l.key, new Map(fetchPackagingCandidates(db, l.key, since).map((c) => [c.so_no, c])));
  }
  const all = new Map<string, PackagingCandidate>();
  for (const m of perLine.values()) for (const c of m.values()) if (!all.has(c.so_no)) all.set(c.so_no, c);

  const sos = [...all.values()]
    .filter((c) => c.order_qty - c.packed_qty > 0)
    .sort((a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31") || a.so_no.localeCompare(b.so_no));

  const state = new Map<string, LineState>();
  for (const l of PACKAGING_LINES) state.set(l.key, { day: nextFree(l.key, today), used: 0 });

  // 한 수주를 그 라인에 올렸을 때의 시작·끝·일수 — 상태를 바꾸지 않고 계산한다
  function simulate(lineKey: string, remaining: number, daily: number) {
    const st = state.get(lineKey)!;
    let day = st.day;
    let used = st.used;
    if (isOff(day) || occupied.get(lineKey)?.has(day)) {
      day = nextFree(lineKey, day);
      used = 0;
    }
    const start = day;
    let left = remaining / daily;
    let days = 1;
    for (let guard = 0; guard < 800; guard++) {
      const take = Math.min(left, 1 - used);
      used += take;
      left -= take;
      if (left <= 1e-9) break;
      day = nextFree(lineKey, addDays(day, 1));
      used = 0;
      days++;
    }
    return { start, end: day, days, next: used >= 1 - 1e-9 ? { day: nextFree(lineKey, addDays(day, 1)), used: 0 } : { day, used } };
  }

  const out: RecommendRow[] = [];
  for (const so of sos) {
    const remaining = so.order_qty - so.packed_qty;
    const candLines = PACKAGING_LINES.map((l) => l.key).filter((k) => perLine.get(k)?.has(so.so_no));
    const rule = ruleLines(so.pack_method, so.pack_size);
    const ruled = rule ? candLines.filter((k) => rule.includes(k)) : [];
    const lines = ruled.length > 0 ? ruled : candLines;
    let best: { line: string; sim: ReturnType<typeof simulate>; daily: number } | null = null;
    for (const lk of lines) {
      const c = perLine.get(lk)!.get(so.so_no)!;
      const daily = c.forecast?.daily_capa ?? 0;
      if (daily <= 0) continue; // 하루 처리량을 구할 수 없는 라인(UPH 없음·이력 없음)은 추천하지 않는다
      const sim = simulate(lk, remaining, daily);
      const pk = so.pack_size;
      const prefer = pk === 1 ? "line1" : pk === 2 ? "line3" : "";
      const better =
        !best ||
        sim.end < best.sim.end ||
        (sim.end === best.sim.end && sim.start < best.sim.start) ||
        (sim.end === best.sim.end && sim.start === best.sim.start && lk === prefer);
      if (better) best = { line: lk, sim, daily };
    }
    if (!best) continue;
    const c = perLine.get(best.line)!.get(so.so_no)!;
    state.set(best.line, best.sim.next);
    const due = so.due_date;
    const slack = due ? Math.round((Date.parse(due) - Date.parse(best.sim.end)) / 86400000) : null;
    const lineLabel = PACKAGING_LINES.find((l) => l.key === best!.line)?.label ?? best.line;
    const pk = so.pack_size;
    const reasonParts: string[] = [];
    reasonParts.push(pk ? `개입수 ${pk}` : "개입수 정보 없음");
    reasonParts.push(
      lines.length > 1
        ? `${lines.map((k) => PACKAGING_LINES.find((l) => l.key === k)?.label).join("·")} 중 가장 빨리 끝나는 ${lineLabel}`
        : `${lineLabel}만 가능`
    );
    out.push({
      so_no: so.so_no,
      customer: so.customer,
      product_group: so.product_group,
      pack_size: pk,
      order_qty: so.order_qty,
      remaining,
      due_date: due,
      line_key: best.line,
      line_label: lineLabel,
      start_date: best.sim.start,
      end_date: best.sim.end,
      work_days: best.sim.days,
      daily_capa: best.daily,
      slack_days: slack,
      late: slack != null && slack < 0,
      eligible_lines: lines,
      reason: reasonParts.join(" · "),
    });
  }
  return out;
}

