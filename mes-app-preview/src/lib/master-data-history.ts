import type { DatabaseSync } from "node:sqlite";

// "기준정보 변경이력"(BASE-10) — 품목/자재/BOM/설비/거래처/창고/작업자 등 모든 기준정보의
// 필드 변경을 하나의 master_data_change_history 테이블에 entity_type(대상유형)+entity_id
// (대상ID)로 구분해 쌓는 범용 로거. 지금은 작업자(workers)만 실제로 연결돼 있고, 다른
// 기준정보를 추가로 연결할 땐 그 화면의 API에서 logFieldChanges를 똑같이 호출하고
// TRACKED_FIELDS만 새로 정의하면 된다(스키마·조회 화면 변경 불필요).

// 대상유형은 화면(대상유형 필터 드롭다운)에도 그대로 노출되는 한글 라벨을 값으로 쓴다
// (entity_type 컬럼 자체에 이 문자열이 저장됨) — 지금 실제로 로깅되는 건 "작업자"뿐이고
// 나머지는 향후 연결 예정을 위해 미리 적어둔 것.
export const MASTER_DATA_ENTITY_TYPES = ["작업자", "품목", "자재", "BOM", "설비", "거래처", "창고"] as const;
export const ENTITY_TYPE_WORKER = "작업자";

// 작업자등록(BASE-09)에서 추적하는 6개 필드 — team("근무조", 급여형태 구분)과
// shift_group("교대조", A조/B조/고정)은 서로 다른 개념이라 둘 다 별도로 추적한다.
export const WORKER_TRACKED_FIELDS: { key: string; label: string }[] = [
  { key: "work_group", label: "공정" },
  { key: "team", label: "근무조" },
  { key: "shift_group", label: "교대조" },
  { key: "duty", label: "직무" },
  { key: "contractor", label: "도급사" },
  { key: "use_yn", label: "사용여부" },
];

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// trackedFields 중 실제로 값이 바뀐 것만 골라 master_data_change_history에 한 행씩
// 쌓는다. before/after는 trackedFields.key를 키로 하는 얕은 객체 — 호출부가 그 필드만
// 뽑아 넘기면 되고, 나머지(연락처/버스 등)는 이 함수가 아예 모르므로 자동으로 추적
// 대상에서 빠진다.
export function logFieldChanges(
  db: DatabaseSync,
  params: {
    entityType: string;
    entityId: string;
    trackedFields: { key: string; label: string }[];
    before: Record<string, string | null | undefined>;
    after: Record<string, string | null | undefined>;
    changedBy: string | null;
    // 기본은 오늘(실제로 고친 시각)이지만, "그 날짜 화면을 보면서 고친" 경우(PSN-01
    // 일일근태입력 그리드에서 근무조를 바로 바꿀 때 등, 2026-09-10 사용자 요청)에는 호출부가
    // 그 조회 중이던 날짜를 넘겨 그 날짜부터 새 값이 적용되게 할 수 있다 — resolveFieldAsOf가
    // change_date 이전은 old_value, 이후는 new_value로 보여주므로, "오늘 실제로 바뀐 것"과
    // "예전부터 그랬는데 잘못 기록된 걸 그 날짜 기준으로 바로잡는 것"을 change_date만으로
    // 구분할 수 있다(전자는 오늘 날짜, 후자는 보고 있던 과거 날짜를 넘기면 됨).
    changeDate?: string;
  }
): void {
  const changeDate = params.changeDate ?? toLocalDateStr(new Date());
  const insert = db.prepare(
    `INSERT INTO master_data_change_history (entity_type, entity_id, field, field_label, old_value, new_value, change_date, changed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const f of params.trackedFields) {
    const oldV = params.before[f.key] ?? null;
    const newV = params.after[f.key] ?? null;
    if (oldV !== newV) {
      insert.run(params.entityType, params.entityId, f.key, f.label, oldV, newV, changeDate, params.changedBy);
    }
  }
}

interface HistoryEntry {
  change_date: string;
  old_value: string | null;
  new_value: string | null;
}

// 근무시간조회(PSN-05)·근태대사(PSN-06)가 특정 날짜 기준 "그 당시 값"을 재구성할 때 쓴다.
// entityIds 전체의 (entityType, field) 이력을 한 번에 읽어와 entity_id별로 change_date
// 오름차순 정렬한 배열을 돌려준다 — 호출부가 여러 날짜를 조회해도 이 함수 자체는 한 번만
// 부르면 된다(N+1 쿼리 방지).
export function fetchFieldHistoryMap(
  db: DatabaseSync,
  entityType: string,
  field: string,
  entityIds: string[]
): Map<string, HistoryEntry[]> {
  const map = new Map<string, HistoryEntry[]>();
  if (entityIds.length === 0) return map;
  const placeholders = entityIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT entity_id, change_date, old_value, new_value FROM master_data_change_history
       WHERE entity_type = ? AND field = ? AND entity_id IN (${placeholders})
       ORDER BY entity_id, change_date ASC, id ASC`
    )
    .all(entityType, field, ...entityIds) as unknown as (HistoryEntry & { entity_id: string })[];
  for (const r of rows) {
    if (!map.has(r.entity_id)) map.set(r.entity_id, []);
    map.get(r.entity_id)!.push({ change_date: r.change_date, old_value: r.old_value, new_value: r.new_value });
  }
  return map;
}

// asOfDate 기준 "그 당시 값"을 계산한다:
//  - 이력이 아예 없으면(추적 시작 전부터 지금까지 한 번도 안 바뀜) currentFallback을 그대로 씀.
//  - asOfDate가 첫 기록된 변경보다 이르면(그 변경 이전 상태를 묻는 경우) 그 첫 변경의 old_value.
//  - 그 외엔 change_date <= asOfDate인 것 중 가장 최근 것의 new_value.
export function resolveFieldAsOf(
  historyMap: Map<string, HistoryEntry[]>,
  entityId: string,
  asOfDate: string,
  currentFallback: string | null
): string | null {
  const list = historyMap.get(entityId);
  if (!list || list.length === 0) return currentFallback;
  let result: string | null | undefined;
  for (const h of list) {
    if (h.change_date <= asOfDate) result = h.new_value;
    else break; // change_date 오름차순 정렬이라 여기서부터는 전부 asOfDate 이후
  }
  if (result !== undefined) return result;
  return list[0].old_value;
}
