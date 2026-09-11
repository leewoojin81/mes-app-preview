"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import DateSegmentInput from "@/components/DateSegmentInput";
import { useTabState } from "@/lib/use-tab-state";
import { LEAVE_TYPE_OPTIONS, normalHoursFor } from "@/lib/work-hours-leave";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";
import type { Process, WorkHoursResponse, WorkHoursRow } from "@/lib/types";

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today(): string {
  return toLocalDateStr(new Date());
}

// 목록에 실제로 나타나는 값만 옵션으로 뽑는다(빈 값 제외, 가나다순) — 작업자등록(BASE-09)의
// 같은 헬퍼와 동일한 패턴.
function distinctOptions(rows: WorkHoursRow[], key: "work_group" | "contractor" | "team"): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v != null && v.trim() !== "") set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

// "정상"은 휴가구분별 기준시간(A안: 출근 8, 연차 0, 전반/후반 4, 공가 0, 휴무 0)에서 지각·조퇴·
// 외출·지원시간을 뺀 값이다(work-hours-leave.ts의 normalHoursFor). 지원시간은 다른
// 공정을 지원하며 실제로 일한 시간이라 합계(computeTotal)에서 다시 더해 상쇄되고,
// 지각/조퇴/외출만 총 근무시간을 실제로 줄인다. 휴가 드롭다운이나 지각/조퇴/외출/지원을
// 바꾸는 즉시(저장 전에도) 화면에 반영되어야 해서 r.normal_hours(마지막 조회 시점 값)를
// 쓰지 않고 지금 화면에 있는 값 기준으로 매번 다시 계산한다 — 서버(GET/PUT)도 같은
// work-hours-leave.ts의 normalHoursFor를 쓰므로 저장 후 값이 어긋나지 않는다.
function computeNormal(r: WorkHoursRow): number {
  return normalHoursFor(r.leave_type, {
    lateHours: r.late_hours,
    earlyLeaveHours: r.early_leave_hours,
    outingHours: r.outing_hours,
    supportHours: r.support_hours,
  });
}

// 잔업/조출/중교/지각/조퇴/외출/지원시간 입력칸에서 엔터를 치면 바로 아래 행의 같은
// 항목 칸으로 넘어간다(엑셀 그리드 입력 관례, 2026-09-09 사용자 요청) — 각 input에
// data-cell="필드키:visibleRows 인덱스"를 붙여두고 그 다음 인덱스의 같은 필드를 찾아
// focus한다. rowIdx는 filter를 통과한 visibleRows 기준 순서라 "화면에 보이는 바로
// 아래 행"으로 자연스럽게 이동한다.
function handleEnterMoveDown(e: KeyboardEvent<HTMLInputElement>, fieldKey: string, rowIdx: number) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const next = document.querySelector<HTMLInputElement>(`[data-cell="${fieldKey}:${rowIdx + 1}"]`);
  next?.focus();
  next?.select();
}

function computeTotal(r: WorkHoursRow): number {
  return (
    computeNormal(r) +
    r.overtime_hours +
    r.early_start_hours +
    r.lunch_shift_hours +
    r.support_hours
  );
}

// 근무시간 상한 — 12.01로 잡아서 "정확히 12"는 정상(경계값), 12를 조금이라도 넘긴
// 경우만 걸린다(2026-09-07 사용자 요청).
const MAX_TOTAL_HOURS = 12.01;

// 근무조(workers.team) — 1조/2조/주간고정 소속 표시. BASE-09(작업자등록)의 TEAM_OPTIONS와
// 동일한 목록(2026-09-10 사용자 요청 — 교대조(shift_group)는 BASE-09에서만 바꾸도록 PSN-01
// 에서는 편집을 없애고, 대신 근무조를 PSN-01에서도 즉시 바꿀 수 있게 함. 교대조(A조/B조/고정)
// 는 이제 이 화면에서 조회 전용으로만 표시된다).
// "주간고정"은 2026-09-10 사용자 요청으로 목록에서 제거(1조/2조/3조만 남김, workers/page.tsx
// 와 동일) — 기존에 이미 주간고정으로 배정된 작업자의 DB 값은 그대로 남아있지만, 이 목록에
// 없어 이 화면에서 근무조를 바꾸려 하면 미선택으로 보인다(재배정은 BASE-09에서 별도로).
const TEAM_OPTIONS = ["1조", "2조", "3조"] as const;

type HourField =
  | "overtime_hours"
  | "early_start_hours"
  | "lunch_shift_hours"
  | "late_hours"
  | "early_leave_hours"
  | "outing_hours";

// "정상"은 휴가구분 기준 계산값만 쓰고 사람이 고칠 수 없어(work-hours-leave.ts의
// normalHoursFor) 개별 입력·일괄수정 모두에서 제외된다 — 이 배열은 잔업부터 외출까지
// 6개만 담아 "선택 항목 일괄수정" 팝업과 개별 입력칸 양쪽에 그대로 쓰인다.
const HOUR_FIELDS: { key: HourField; label: string }[] = [
  { key: "overtime_hours", label: "잔업" },
  { key: "early_start_hours", label: "조출" },
  { key: "lunch_shift_hours", label: "중교" },
  { key: "late_hours", label: "지각" },
  { key: "early_leave_hours", label: "조퇴" },
  { key: "outing_hours", label: "외출" },
];

// 저장 실패 알림의 항목 라벨("잔업" 등)로 실제 입력칸(data-cell)을 다시 찾기 위한 역방향
// 매핑(2026-09-10 사용자 요청 — 검색/필터로 좁혀놓은 화면에서 안 보이는 다른 사람의
// 값 때문에 저장이 막히면 어디를 고쳐야 하는지 찾기 어려웠다). "지원시간"은 HOUR_FIELDS에
// 없는 별도 필드라 여기서만 추가로 채워 넣는다.
const HOUR_FIELD_KEY_BY_LABEL: Record<string, string> = {
  ...Object.fromEntries(HOUR_FIELDS.map((f) => [f.label, f.key])),
  지원시간: "support_hours",
};

// 시간 입력칸(잔업/조출/중교/지각/조퇴/외출/지원시간) 스피너 단위 — 30분(0.5)에서
// 10분(1/6시간) 단위로 변경(2026-09-10 사용자 요청). 스피너를 한 번 누를 때마다
// 0.17/0.34/0.5/0.67/0.83/1/1.17/1.34/1.5/1.67/1.83/2 …로 깔끔하게 떨어지도록, 2시간
// (=12칸) 주기로 이 표를 반복하고 정수 주기마다 정확히 2를 더한다(사용자가 지정한
// 값을 그대로 표로 사용 — 1/6의 수학적 반올림과 완전히 일치하진 않지만 요청값 그대로).
const HOUR_STEP = 1 / 6;
const TEN_MINUTE_TABLE = [0, 0.17, 0.34, 0.5, 0.67, 0.83, 1, 1.17, 1.34, 1.5, 1.67, 1.83];

function nearestTenMinuteHours(hours: number): number {
  const units = Math.round(hours / HOUR_STEP);
  const cycleIndex = ((units % 12) + 12) % 12;
  const fullCycles = Math.floor(units / 12);
  return fullCycles * 2 + TEN_MINUTE_TABLE[cycleIndex];
}

// oldValue(항상 위 표의 값 중 하나)를 표 안에서 정확히 ±1칸만 옮긴다. "브라우저가 계산해준
// raw 값을 표에 맞춰 재반올림"하는 방식(nearestTenMinuteHours(raw))은 실제로 걸림돌이 있었다
// (2026-09-10 브라우저 테스트로 재현) — 표의 0.83은 실제 그리드값 5/6(≈0.8333)보다 "작게"
// 반올림된 항목인데(0.17/0.34/0.67은 반대로 그리드보다 "크게" 반올림됨), HTML 스핀 버튼은
// 현재 값이 그리드와 어긋나 있으면(스텝 불일치) 그냥 "다음 그리드 지점까지만" 맞추고 한 스텝을
// 더 안 간다 — 그 결과 raw가 5/6이 되고, nearestTenMinuteHours(5/6)이 다시 0.83으로 반올림되어
// 버튼을 아무리 눌러도 0.83에서 멈춰버렸다. 그래서 raw의 절대값을 다시 보지 않고, 방향(위/
// 아래)만 raw와 oldValue의 대소로 판정한 뒤 표의 인덱스를 직접 ±1 이동시키는 방식으로 바꿨다.
function stepTenMinuteHours(oldValue: number, direction: 1 | -1): number {
  const oldUnits = Math.round(oldValue / HOUR_STEP);
  const newUnits = oldUnits + direction;
  const cycleIndex = ((newUnits % 12) + 12) % 12;
  const fullCycles = Math.floor(newUnits / 12);
  return fullCycles * 2 + TEN_MINUTE_TABLE[cycleIndex];
}

// 스피너(▲▼) 클릭이나 방향키로 값이 바뀌었을 때만 위 표에 맞춰 한 칸 이동하고, 사람이 직접
// 타이핑한 값은 그대로 존중한다(2026-09-10 확인 — 타이핑 중에도 매 글자마다 스냅하면 소수점을
// 입력하는 도중에 값이 지워지는 문제가 있었다, HourMinuteInput 시도 때 실사용으로 확인된
// 문제라 여기서는 스피너로 발생한 변화만 골라서 스냅한다). React의 number input onChange에서
// 스피너/방향키로 발생한 네이티브 "input" 이벤트는 `nativeEvent.inputType`이 없고(undefined),
// 사람이 타이핑/붙여넣기하면 "insertText" 등 값이 채워진다 — 이 신호로 스피너 여부를 판별한다.
function applyHourFieldStep(oldValue: number, raw: number, isSpinnerEvent: boolean): number {
  if (isSpinnerEvent && Number.isFinite(raw)) {
    if (raw > oldValue) return stepTenMinuteHours(oldValue, 1);
    if (raw < oldValue) return stepTenMinuteHours(oldValue, -1);
    return oldValue;
  }
  return raw;
}

// number input의 onChange에서 이 변화가 스피너 클릭/방향키로 발생했는지 판별한다 — 브라우저
// 테스트로 확인: 그 경우 nativeEvent.inputType이 undefined이고, 사람이 타이핑/붙여넣기하면
// "insertText"/"insertFromPaste" 등으로 채워진다.
function isSpinnerChangeEvent(e: ChangeEvent<HTMLInputElement>): boolean {
  return !(e.nativeEvent as InputEvent).inputType;
}

// 잔업/조출/중교/지각/조퇴/외출은 스피너가 아니라 직접 타이핑도 허용하지만(2026-09-10
// 사용자 요청 — 스피너 클릭으로 안 나오는 값을 수동 입력할 수도 있음), 10분 단위
// (0.17/0.34/0.5/…) 표에서 벗어난 값은 빨간색으로 표시하고 저장을 막는다. 지원시간은
// 이 검증 대상에서 뺀다(사용자가 이번 요청에서 6개만 지목함).
// 2.25(2시간15분)는 10분 단위 표에는 없지만 잔업에서만 실제로 수기 입력하는 값이라
// (2026-09-11 사용자 요청 — 처음엔 6개 항목 전체에 적용했다가, 같은 날 "잔업만 적용"
// 으로 범위를 좁힘) 잔업(overtime_hours)에 한해서만 예외로 허용한다 — 조출/중교/지각/
// 조퇴/외출은 여전히 10분 단위가 아니면 막는다. 예외가 더 필요해지면 이 맵에 필드별로
// 추가할 것.
const EXTRA_VALID_HOURS_BY_FIELD: Partial<Record<HourField, Set<number>>> = {
  overtime_hours: new Set([2.25]),
};
function isValidTenMinuteHours(hours: number, fieldKey: HourField): boolean {
  if (EXTRA_VALID_HOURS_BY_FIELD[fieldKey]?.has(hours)) return true;
  return Math.abs(nearestTenMinuteHours(hours) - hours) < 1e-6;
}

// "선택 항목 일괄수정" 팝업의 대상 항목 — 시간 6종(HOUR_FIELDS) 외에 휴가구분·근무조도
// 함께 일괄변경할 수 있다(정상은 휴가구분에 따라 자동 재계산되므로 더 이상 직접 일괄변경
// 대상이 아니다). 휴가구분/근무조를 고르면 값 입력란이 숫자 대신 해당 드롭다운으로
// 바뀐다. 근무조는 2026-09-11 사용자 요청으로 이 목록에 합쳐졌다 — 예전엔 "근무조
// 일괄변경"이 저장 버튼과 무관하게 즉시 반영되는 별도 버튼/팝업이라 다른 항목과 저장
// 시점이 달라 헷갈린다는 지적이 있었고, 근무조도 다른 항목과 똑같이 "저장" 버튼을
// 눌러야 확정되도록 통일했다(save()에서 rows의 team 변경분만 모아 /api/workers/team으로
// 반영한 뒤 work-hours 저장을 이어감).
type BulkFieldKey = HourField | "leave_type" | "team";
const BULK_FIELDS: { key: BulkFieldKey; label: string }[] = [
  { key: "leave_type", label: "휴가구분" },
  { key: "team", label: "근무조" },
  ...HOUR_FIELDS,
];

export default function WorkHoursPage() {
  const [date, setDate] = useTabState("workHoursDate", today);
  const [rows, setRows] = useState<WorkHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [workGroupFilter, setWorkGroupFilter] = useTabState("workHoursWorkGroupFilter", "");
  const [contractorFilter, setContractorFilter] = useTabState("workHoursContractorFilter", "");
  const [teamFilter, setTeamFilter] = useTabState("workHoursTeamFilter", "");
  // 저장상태 필터(2026-09-08 사용자 요청) — ""=전체, "saved"=저장됨, "unsaved"=미저장.
  const [statusFilter, setStatusFilter] = useTabState("workHoursStatusFilter", "");
  const [searchText, setSearchText] = useTabState("workHoursSearchText", "");
  const [showUpload, setShowUpload] = useState(false);
  const [processes, setProcesses] = useState<Process[]>([]);
  // 저장 실패 시 첫 번째 문제 행으로 스크롤·포커스하기 위한 대기 상태(2026-09-10 사용자
  // 요청) — 검색/필터에 걸려 화면에 안 보이는 사람 때문에 저장이 막히면, 필터를 비워
  // 다시 보이게 한 뒤 이 상태로 어디로 스크롤할지 넘긴다. fieldKey가 없으면(근무시간
  // 초과처럼 특정 입력칸이 아닌 행 전체 문제) 행만 스크롤하고 포커스는 안 한다.
  const [pendingHighlight, setPendingHighlight] = useState<{ employeeNo: string; fieldKey: string | null } | null>(
    null
  );

  // 선택 일괄수정(2026-09-08 사용자 요청) — 체크한 사번들을 모아뒀다가, 팝업에서 고른
  // 항목(정상/잔업/조출/중교/지각/조퇴/외출) 값을 한 번에 덮어쓴다. 날짜를 바꾸면 사람이
  // 완전히 달라 보일 수 있어 선택을 비운다(load()에서 함께 처리).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 근무조(workers.team)는 work_hours_daily가 아니라 작업자 마스터 필드라 별도
  // /api/workers/team 엔드포인트로 저장한다 — 화면에서 고친 값과 조회 당시 값이 다른
  // 사람만 save()에서 골라내 보낼 수 있도록, load()가 채운 rows를 그대로 기준선으로
  // 들고 있는다(리렌더와 무관해야 해서 상태가 아니라 ref).
  const teamBaselineRef = useRef<Map<string, string | null>>(new Map());

  // 지원공정 선택지 — BASE-04(공정등록)에 등록된 사용여부='Y' 공정 전체를, 소속(work_group)
  // 필터 없이 그대로 보여준다(2026-09-07 사용자 요청: 기존엔 work_group 9개로만 골랐는데
  // OEM창고/세정/디자인/연구소/생산기술/공정품질/기타 같은 "타부서지원" 성격의 공정은
  // work_group에 대응 항목이 없어 아예 선택할 수 없었음). processes.process_group(공정등록
  // 화면의 실제 분류값, 예: "Back.착색"/"조립군"/"외관검사"/"실링.멸균"/"마킹.포장"/"기타공정")
  // 기준으로 <optgroup>을 나눠서 목록이 길어도 찾기 쉽게 한다 — seq 순서를 그대로 따른다.
  useEffect(() => {
    fetch("/api/processes", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: Process[]) =>
        setProcesses(data.filter((p) => p.use_yn === "Y").sort((a, b) => a.seq - b.seq))
      );
  }, []);
  const processGroups = (() => {
    const groups = new Map<string, Process[]>();
    for (const p of processes) {
      const key = p.process_group ?? "기타";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return Array.from(groups.entries());
  })();

  const load = () => {
    setLoading(true);
    setMessage(null);
    setSelected(new Set());
    fetch(`/api/work-hours?date=${date}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: WorkHoursResponse) => {
        const rows = data.rows ?? [];
        setRows(rows);
        teamBaselineRef.current = new Map(rows.map((r) => [r.employee_no, r.team]));
        setLastSavedAt(data.lastSavedAt ?? null);
        setLoading(false);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [date]);

  // pendingHighlight가 채워지면(저장 실패로 필터를 막 비운 직후) 그 행으로 스크롤하고,
  // fieldKey가 있으면 그 입력칸에 포커스까지 준다 — data-row-employee로 행을 직접 찾으므로
  // 필터가 바뀌어 화면 순서(rowIdx)가 달라져도 항상 정확히 그 사람을 찾는다.
  useEffect(() => {
    if (!pendingHighlight) return;
    const rowEl = document.querySelector<HTMLElement>(
      `[data-row-employee="${CSS.escape(pendingHighlight.employeeNo)}"]`
    );
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      if (pendingHighlight.fieldKey) {
        rowEl.querySelector<HTMLInputElement>(`[data-cell^="${pendingHighlight.fieldKey}:"]`)?.focus();
      }
    }
    setPendingHighlight(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHighlight]);

  function updateRow(employeeNo: string, patch: Partial<WorkHoursRow>) {
    setRows((prev) => prev.map((r) => (r.employee_no === employeeNo ? { ...r, ...patch } : r)));
  }

  function toggleSelected(employeeNo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(employeeNo)) next.delete(employeeNo);
      else next.add(employeeNo);
      return next;
    });
  }

  // 선택된 사번들에 지정 항목(patch)을 한 번에 덮어쓴다 — 다른 사람이 저장해둔 값과
  // 마찬가지로 "저장" 버튼을 눌러야 실제 DB에 반영된다(그 전까지는 화면 미리보기일 뿐).
  // 휴가구분을 바꾸는 경우엔 patch가 leave_type만 담고, 정상은 화면에서 매번 다시
  // 계산되므로(computeNormal) 별도로 건드릴 필요가 없다.
  function applyBulkEdit(patch: Partial<WorkHoursRow>) {
    setRows((prev) => prev.map((r) => (selected.has(r.employee_no) ? { ...r, ...patch } : r)));
    setShowBulkEdit(false);
  }

  // 관리상 삭제(2026-09-08 사용자 요청) — 일괄수정과 달리 "저장" 버튼을 기다리지 않고
  // 확인 즉시 DB에서 지운다(값을 0으로 되돌리는 게 아니라 그 날짜 기록 자체를 없애
  // "미저장" 상태로 되돌리는 것이라 저장 개념이 없다). 삭제 뒤 화면을 다시 불러온다.
  async function deleteSelected() {
    if (selected.size === 0) return;
    const names = rows
      .filter((r) => selected.has(r.employee_no))
      .map((r) => r.worker_name)
      .slice(0, 5)
      .join(", ");
    const more = selected.size > 5 ? ` 외 ${selected.size - 5}명` : "";
    if (
      !window.confirm(
        `${date} 날짜의 ${names}${more} 저장 기록을 삭제할까요?\n삭제하면 되돌릴 수 없고, 해당 인원은 "미저장" 상태로 돌아갑니다.`
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await fetch("/api/work-hours", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, employeeNos: Array.from(selected) }),
    });
    const data = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      window.alert(data.error ?? "삭제에 실패했습니다.");
      return;
    }
    setMessage(`${new Date().toLocaleTimeString("ko-KR")} 기준 ${data.count}건 삭제되었습니다.`);
    load();
  }

  // 잔업/조출/중교/지각/조퇴/외출/지원시간은 음수가 들어갈 이유가 없다(입력 실수로 "-"
  // 부호를 잘못 눌렀을 때가 대부분) — 셀은 빨간색으로 표시하고, 저장 시점에 한 번 더
  // 막아서 잘못된 값이 그대로 DB에 들어가지 않게 한다(2026-09-07 사용자 요청).
  function findNegativeIssues(): { employeeNo: string; workerName: string; label: string }[] {
    const issues: { employeeNo: string; workerName: string; label: string }[] = [];
    for (const r of rows) {
      for (const f of HOUR_FIELDS) {
        if (r[f.key] < 0) issues.push({ employeeNo: r.employee_no, workerName: r.worker_name, label: f.label });
      }
      if (r.support_hours < 0) {
        issues.push({ employeeNo: r.employee_no, workerName: r.worker_name, label: "지원시간" });
      }
    }
    return issues;
  }

  // 잔업/조출/중교/지각/조퇴/외출은 10분 단위(0.17/0.34/0.5/0.67/0.83/1/1.17/1.34/1.5/
  // 1.67/1.83/2 …) 값만 인정한다(2026-09-10 사용자 요청) — 음수는 findNegativeIssues가
  // 이미 따로 잡으므로 여기서는 다시 걸지 않는다(같은 셀이 두 오류로 중복 표시되는 것
  // 방지).
  function findInvalidStepIssues(): { employeeNo: string; workerName: string; label: string; value: number }[] {
    const issues: { employeeNo: string; workerName: string; label: string; value: number }[] = [];
    for (const r of rows) {
      for (const f of HOUR_FIELDS) {
        if (r[f.key] >= 0 && !isValidTenMinuteHours(r[f.key], f.key)) {
          issues.push({ employeeNo: r.employee_no, workerName: r.worker_name, label: f.label, value: r[f.key] });
        }
      }
    }
    return issues;
  }

  // 근무시간(합계)이 12시간을 넘으면 셀을 빨간색으로 표시하고, 저장 시점에도 막는다
  // (2026-09-07 사용자 요청) — 정확히 12는 통과, 12를 조금이라도 넘긴 값만 걸리도록
  // MAX_TOTAL_HOURS를 12.01로 잡았다.
  function findOvertimeIssues(): { employeeNo: string; workerName: string; total: number }[] {
    const issues: { employeeNo: string; workerName: string; total: number }[] = [];
    for (const r of rows) {
      const total = computeTotal(r);
      if (total > MAX_TOTAL_HOURS) {
        issues.push({ employeeNo: r.employee_no, workerName: r.worker_name, total });
      }
    }
    return issues;
  }

  // 근무조(workers.team)는 work_hours_daily가 아니라 작업자 마스터 필드라 /api/work-hours
  // PUT과 별도로 /api/workers/team에 보내야 한다. save()가 조회 당시 값(teamBaselineRef)과
  // 지금 화면 값이 달라진 사람만 골라, 바뀐 값이 같은 사람끼리 묶어 값 그룹당 한 번씩
  // 호출한다(2026-09-11 사용자 요청 — 예전엔 근무조만 저장 버튼과 무관하게 즉시 반영되는
  // 별도 버튼이라 다른 항목과 저장 시점이 달라 헷갈린다는 지적이 있었음). 실패하면 에러
  // 메시지만 돌려주고, 호출부(save)가 이를 보고 work-hours 저장 자체를 진행하지 않는다 —
  // 근무조 반영이 실패했는데 나머지만 저장되는 반쪽짜리 상태를 막기 위해서다.
  async function saveTeamChanges(): Promise<string | null> {
    const groups = new Map<string | null, string[]>();
    for (const r of rows) {
      const baseline = teamBaselineRef.current.get(r.employee_no) ?? null;
      if (baseline === r.team) continue;
      const list = groups.get(r.team) ?? [];
      list.push(r.employee_no);
      groups.set(r.team, list);
    }
    for (const [team, employeeNos] of groups) {
      const res = await fetch("/api/workers/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeNos, team, date }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.error ?? "근무조 변경에 실패했습니다.";
      }
    }
    return null;
  }

  async function save() {
    const negativeIssues = findNegativeIssues();
    const stepIssues = findInvalidStepIssues();
    const overtimeIssues = findOvertimeIssues();
    if (negativeIssues.length > 0 || stepIssues.length > 0 || overtimeIssues.length > 0) {
      const parts: string[] = [];
      if (negativeIssues.length > 0) {
        const preview = negativeIssues
          .slice(0, 5)
          .map((i) => `${i.workerName}(${i.employeeNo}) - ${i.label}`)
          .join("\n");
        parts.push(
          `음수 값 ${negativeIssues.length}건\n${preview}${negativeIssues.length > 5 ? "\n..." : ""}`
        );
      }
      if (stepIssues.length > 0) {
        const preview = stepIssues
          .slice(0, 5)
          .map((i) => `${i.workerName}(${i.employeeNo}) - ${i.label} ${i.value}`)
          .join("\n");
        parts.push(
          `10분 단위가 아닌 값 ${stepIssues.length}건\n${preview}${stepIssues.length > 5 ? "\n..." : ""}`
        );
      }
      if (overtimeIssues.length > 0) {
        const preview = overtimeIssues
          .slice(0, 5)
          .map((i) => `${i.workerName}(${i.employeeNo}) - ${i.total}시간`)
          .join("\n");
        parts.push(
          `근무시간 12시간 초과 ${overtimeIssues.length}건\n${preview}${overtimeIssues.length > 5 ? "\n..." : ""}`
        );
      }
      // 저장은 화면에 지금 보이는 행뿐 아니라 그 날짜의 전체 행을 대상으로 하므로
      // (필터는 "보이는 행만 좁히는" 용도), 검색·필터에 걸려 화면에 없는 다른 사람의
      // 값 때문에 막히는 경우가 있다(2026-09-10 실사례 — 김세은을 검색해놓고 저장했는데
      // 화면에 없는 박진석·김선경의 기존 값이 10분 단위가 아니라서 저장이 막힘, 그런데
      // 정작 그 두 사람이 안 보여서 어디를 고쳐야 할지 알 수 없었음). 첫 번째 문제 행으로
      // 필터를 비우고 스크롤·포커스해 바로 찾아 고칠 수 있게 한다.
      const firstIssue: { employeeNo: string; fieldKey: string | null } | null =
        negativeIssues.length > 0
          ? { employeeNo: negativeIssues[0].employeeNo, fieldKey: HOUR_FIELD_KEY_BY_LABEL[negativeIssues[0].label] ?? null }
          : stepIssues.length > 0
            ? { employeeNo: stepIssues[0].employeeNo, fieldKey: HOUR_FIELD_KEY_BY_LABEL[stepIssues[0].label] ?? null }
            : overtimeIssues.length > 0
              ? { employeeNo: overtimeIssues[0].employeeNo, fieldKey: null }
              : null;
      if (firstIssue) {
        setWorkGroupFilter("");
        setContractorFilter("");
        setTeamFilter("");
        setStatusFilter("");
        setSearchText("");
        setPendingHighlight(firstIssue);
      }
      window.alert(`저장할 수 없습니다.\n\n${parts.join("\n\n")}`);
      setMessage(
        `저장 실패 — 음수 값 ${negativeIssues.length}건, 10분 단위 오류 ${stepIssues.length}건, 근무시간 초과 ${overtimeIssues.length}건을 먼저 고쳐주세요.`
      );
      return;
    }

    setSaving(true);
    setMessage(null);

    const teamError = await saveTeamChanges();
    if (teamError) {
      setSaving(false);
      window.alert(teamError);
      setMessage(teamError);
      return;
    }

    const res = await fetch("/api/work-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, rows }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      window.alert(data.error ?? "저장에 실패했습니다.");
      setMessage(data.error ?? "저장에 실패했습니다.");
      return;
    }
    teamBaselineRef.current = new Map(rows.map((r) => [r.employee_no, r.team]));
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    setLastSavedAt(now);
    setMessage(`${new Date().toLocaleTimeString("ko-KR")} 기준 ${data.count}건 저장되었습니다.`);
  }

  // 소속(work_group) 필터 목록은 가나다순 대신 WORK_GROUP_OPTIONS의 공정코드 정렬
  // 순서를 그대로 따른다(2026-09-08 사용자 요청).
  const workGroupOptions = distinctOptions(rows, "work_group").sort(
    (a, b) => WORK_GROUP_OPTIONS.indexOf(a) - WORK_GROUP_OPTIONS.indexOf(b)
  );
  const contractorOptions = distinctOptions(rows, "contractor");
  const teamOptions = distinctOptions(rows, "team");

  const search = searchText.trim().toLowerCase();
  const visibleRows = rows.filter((r) => {
    if (workGroupFilter && r.work_group !== workGroupFilter) return false;
    if (contractorFilter && r.contractor !== contractorFilter) return false;
    if (teamFilter && r.team !== teamFilter) return false;
    if (statusFilter === "saved" && !r.has_record) return false;
    if (statusFilter === "unsaved" && r.has_record) return false;
    if (
      search &&
      !r.employee_no.toLowerCase().includes(search) &&
      !(r.erp_code ?? "").toLowerCase().includes(search) &&
      !r.worker_name.toLowerCase().includes(search)
    )
      return false;
    return true;
  });

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.employee_no));
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of visibleRows) next.delete(r.employee_no);
      } else {
        for (const r of visibleRows) next.add(r.employee_no);
      }
      return next;
    });
  }

  const numCls = "border border-slate-300 rounded px-1.5 py-1 text-xs w-full text-right";
  const thCls =
    "text-center px-2 py-2 font-semibold sticky top-0 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]";
  // 근무조·근무시간·휴가·자공정 7항목·지원공정 2항목까지 폭을 전부 맞춘다(2026-09-07
  // 사용자 요청) — 짧은 드롭다운 텍스트("주간고정" 등)와 2~3자리 숫자가 둘 다 들어가도
  // 여유 있는 5rem으로 통일.
  const wCls = "w-20";

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">일일근태입력</h1>
          <p className="text-sm text-slate-500 mt-1">
            PSN-01 · 근무조·휴가구분과 자공정(정상/잔업/조출/중교/지각/조퇴/외출)·지원공정
            (소속/시간)을 입력하면 근무시간이 자동 합산됩니다. 그리드에서 바로 고치거나,
            왼쪽 체크박스로 여러 명을 선택해 &quot;선택 항목 일괄수정&quot;으로 한 항목을
            한 번에 바꿀 수 있습니다 — 어느 쪽이든 &quot;저장&quot;을 눌러야 확정됩니다.
            &quot;선택 삭제&quot;는 그 날짜 저장 기록 자체를 지우는 것이라 저장 버튼과
            무관하게 즉시 반영됩니다. 잘못 입력했다면 같은 날짜를 다시 열어 값을 고치고
            저장하면 그대로 덮어써집니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              window.location.href = `/api/work-hours/export?date=${date}`;
            }}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            엑셀 다운로드
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy transition-colors"
          >
            엑셀 업로드
          </button>
          <button
            onClick={() => setShowBulkEdit(true)}
            disabled={selected.size === 0}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:border-navy disabled:opacity-40 disabled:hover:border-slate-300 transition-colors"
          >
            선택 항목 일괄수정{selected.size > 0 ? ` (${selected.size}명)` : ""}
          </button>
          <button
            onClick={deleteSelected}
            disabled={selected.size === 0 || deleting}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-white border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
          >
            {deleting ? "삭제 중..." : `선택 삭제${selected.size > 0 ? ` (${selected.size}명)` : ""}`}
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs font-medium text-slate-500 shrink-0">날짜</label>
        <DateSegmentInput value={date} onChange={setDate} />
        <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden />
        <select
          value={workGroupFilter}
          onChange={(e) => setWorkGroupFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">공정 전체</option>
          {workGroupOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={contractorFilter}
          onChange={(e) => setContractorFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">도급사 전체</option>
          {contractorOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">근무조 전체</option>
          {teamOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm bg-white text-slate-600"
        >
          <option value="">저장상태 전체</option>
          <option value="saved">저장됨</option>
          <option value="unsaved">미저장</option>
        </select>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="이름 · 사번 · ERP코드 검색"
          className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-52"
        />
        {(workGroupFilter || contractorFilter || teamFilter || statusFilter || searchText) && (
          <button
            onClick={() => {
              setWorkGroupFilter("");
              setContractorFilter("");
              setTeamFilter("");
              setStatusFilter("");
              setSearchText("");
            }}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            필터 초기화
          </button>
        )}
        {!message && !loading && (
          <span className="text-xs text-slate-400 ml-2">
            {lastSavedAt ? `이 날짜 최근 저장: ${lastSavedAt}` : "이 날짜는 아직 저장된 적이 없습니다(기본값 표시 중)"}
          </span>
        )}
        {message && <span className="text-xs text-slate-500 ml-2">{message}</span>}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-14rem)]">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500">
              <tr>
                <th rowSpan={2} className={thCls}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="전체 선택"
                  />
                </th>
                <th rowSpan={2} className={thCls}>
                  No
                </th>
                <th rowSpan={2} className={thCls}>
                  사번
                </th>
                <th rowSpan={2} className={thCls}>
                  소속공정
                </th>
                <th rowSpan={2} className={thCls}>
                  직무
                </th>
                <th rowSpan={2} className={thCls}>
                  성명
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  근무조
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  교대조
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  근무시간
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  저장상태
                </th>
                <th rowSpan={2} className={`${thCls} ${wCls}`}>
                  휴가
                </th>
                <th colSpan={1 + HOUR_FIELDS.length} className={thCls}>
                  자공정
                </th>
                <th colSpan={2} className={thCls}>
                  지원공정
                </th>
              </tr>
              <tr>
                <th className={`${thCls} ${wCls}`}>정상</th>
                {HOUR_FIELDS.map((f) => (
                  <th key={f.key} className={`${thCls} ${wCls}`}>
                    {f.label}
                  </th>
                ))}
                <th className={`${thCls} ${wCls}`}>지원공정</th>
                <th className={`${thCls} ${wCls}`}>지원시간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={12 + HOUR_FIELDS.length + 2} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={12 + HOUR_FIELDS.length + 2} className="text-center py-10 text-slate-400">
                    표시할 조원이 없습니다. (필터를 확인하거나 작업자등록에서 먼저 등록하세요)
                  </td>
                </tr>
              )}
              {!loading &&
                visibleRows.map((r, idx) => (
                  <tr
                    key={r.employee_no}
                    data-row-employee={r.employee_no}
                    className={selected.has(r.employee_no) ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50"}
                  >
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(r.employee_no)}
                        onChange={() => toggleSelected(r.employee_no)}
                        aria-label={`${r.worker_name} 선택`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-400">{idx + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500">{r.employee_no}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.work_group ?? "-"}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.duty ?? "-"}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-700">{r.worker_name}</td>
                    <td className={`px-2 py-1.5 ${wCls}`}>
                      <select
                        value={r.team ?? ""}
                        onChange={(e) => updateRow(r.employee_no, { team: e.target.value || null })}
                        className="border border-slate-300 rounded px-1.5 py-1 text-xs w-full bg-white"
                      >
                        <option value="">미지정</option>
                        {TEAM_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`px-2 py-1.5 text-slate-500 ${wCls}`}>{r.shift_group ?? "-"}</td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono font-semibold ${wCls} ${
                        computeTotal(r) > MAX_TOTAL_HOURS ? "bg-rose-50 text-rose-700" : "text-navy"
                      }`}
                    >
                      {computeTotal(r).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className={`px-2 py-1.5 text-center ${wCls}`}>
                      {r.has_record ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                          저장됨
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-400">
                          미저장
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-1.5 ${wCls}`}>
                      <select
                        value={r.leave_type ?? ""}
                        onChange={(e) => updateRow(r.employee_no, { leave_type: e.target.value || null })}
                        className="border border-slate-300 rounded px-1.5 py-1 text-xs w-full bg-white"
                      >
                        <option value="">출근</option>
                        {LEAVE_TYPE_OPTIONS.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono font-semibold text-navy ${wCls}`}>
                      {computeNormal(r).toLocaleString()}
                    </td>
                    {HOUR_FIELDS.map((f) => (
                      <td key={f.key} className={`px-2 py-1.5 ${wCls}`}>
                        <input
                          type="number"
                          step={HOUR_STEP}
                          min={0}
                          data-cell={`${f.key}:${idx}`}
                          onKeyDown={(e) => handleEnterMoveDown(e, f.key, idx)}
                          // 값이 0이면 빈칸으로 보여준다(입력 안 한 항목이 0으로 채워져
                          // 있어 화면이 지저분해 보이는 걸 방지) — 값 자체는 그대로 0이라
                          // 저장/계산에는 영향 없다.
                          value={r[f.key] === 0 ? "" : r[f.key]}
                          onChange={(e) =>
                            updateRow(r.employee_no, {
                              [f.key]: applyHourFieldStep(r[f.key], Number(e.target.value), isSpinnerChangeEvent(e)),
                            } as Partial<WorkHoursRow>)
                          }
                          className={
                            r[f.key] < 0 || !isValidTenMinuteHours(r[f.key], f.key)
                              ? `${numCls} border-rose-500 bg-rose-50 text-rose-700 font-semibold`
                              : numCls
                          }
                        />
                      </td>
                    ))}
                    <td className={`px-2 py-1.5 ${wCls}`}>
                      <select
                        value={r.support_work_group ?? ""}
                        onChange={(e) =>
                          updateRow(r.employee_no, { support_work_group: e.target.value || null })
                        }
                        className="border border-slate-300 rounded px-1.5 py-1 text-xs w-full bg-white"
                      >
                        <option value="">-</option>
                        {processGroups.map(([group, procs]) => (
                          <optgroup key={group} label={`— ${group} —`}>
                            {procs.map((p) => (
                              <option key={p.process_code} value={p.process_name}>
                                {p.process_name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className={`px-2 py-1.5 ${wCls}`}>
                      <input
                        type="number"
                        step={HOUR_STEP}
                        min={0}
                        data-cell={`support_hours:${idx}`}
                        onKeyDown={(e) => handleEnterMoveDown(e, "support_hours", idx)}
                        value={r.support_hours === 0 ? "" : r.support_hours}
                        onChange={(e) =>
                          updateRow(r.employee_no, {
                            support_hours: applyHourFieldStep(r.support_hours, Number(e.target.value), isSpinnerChangeEvent(e)),
                          })
                        }
                        disabled={!r.support_work_group}
                        className={
                          r.support_hours < 0
                            ? `${numCls} border-rose-500 bg-rose-50 text-rose-700 font-semibold`
                            : `${numCls} disabled:bg-slate-50 disabled:text-slate-300`
                        }
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showUpload && (
        <WorkHoursUploadModal date={date} onClose={() => setShowUpload(false)} onImported={load} />
      )}

      {showBulkEdit && (
        <BulkEditModal
          count={selected.size}
          onApply={applyBulkEdit}
          onClose={() => setShowBulkEdit(false)}
        />
      )}
    </div>
  );
}

function BulkEditModal({
  count,
  onApply,
  onClose,
}: {
  count: number;
  onApply: (patch: Partial<WorkHoursRow>) => void;
  onClose: () => void;
}) {
  const [field, setField] = useState<BulkFieldKey>("leave_type");
  const [leaveValue, setLeaveValue] = useState(""); // "" = 출근
  const [teamValue, setTeamValue] = useState(""); // "" = 미지정
  const [valueText, setValueText] = useState("");

  const isLeaveField = field === "leave_type";
  const isTeamField = field === "team";
  const value = Number(valueText);
  const canApply = isLeaveField || isTeamField || (valueText.trim() !== "" && Number.isFinite(value));

  function handleApply() {
    if (isLeaveField) {
      onApply({ leave_type: leaveValue || null });
    } else if (isTeamField) {
      onApply({ team: teamValue || null });
    } else {
      onApply({ [field]: value } as Partial<WorkHoursRow>);
    }
  }

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-navy">선택 항목 일괄수정</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600">
            선택한 <span className="font-semibold text-navy">{count}명</span>의 값을 한 번에
            바꿉니다. 저장 버튼을 눌러야 실제로 반영됩니다.
          </p>
          <label className="block text-sm">
            <span className="text-slate-600">항목</span>
            <select
              value={field}
              onChange={(e) => setField(e.target.value as BulkFieldKey)}
              className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white"
            >
              {BULK_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {isLeaveField ? (
            <label className="block text-sm">
              <span className="text-slate-600">휴가구분</span>
              <select
                value={leaveValue}
                onChange={(e) => setLeaveValue(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white"
                autoFocus
              >
                <option value="">출근</option>
                {LEAVE_TYPE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ) : isTeamField ? (
            <label className="block text-sm">
              <span className="text-slate-600">근무조</span>
              <select
                value={teamValue}
                onChange={(e) => setTeamValue(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white"
                autoFocus
              >
                <option value="">미지정</option>
                {TEAM_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-sm">
              <span className="text-slate-600">값(시간)</span>
              <input
                type="number"
                step={HOUR_STEP}
                min={0}
                value={valueText}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  const prev = Number(valueText) || 0;
                  const stepped = applyHourFieldStep(prev, raw, isSpinnerChangeEvent(e));
                  setValueText(stepped === raw ? e.target.value : String(stepped));
                }}
                placeholder="예: 8"
                className="mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm text-right"
                autoFocus
              />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
          >
            취소
          </button>
          <button
            onClick={() => canApply && handleApply()}
            disabled={!canApply}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkHoursUploadModal({
  date,
  onClose,
  onImported,
}: {
  date: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; skippedNoKey: number } | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("date", date);
    const res = await fetch("/api/work-hours/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "업로드에 실패했습니다.");
      return;
    }
    setResult(data);
    onImported();
  };

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-navy">엑셀 업로드</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          {result ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                {date} 날짜로 업로드 완료 — {result.updated.toLocaleString()}건 반영
                {result.skippedNoKey > 0 && `, 건너뜀(사번 없음/미등록) ${result.skippedNoKey.toLocaleString()}건`}
              </p>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white"
                >
                  닫기
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                &quot;엑셀 다운로드&quot;로 받은 것과 같은 컬럼 구성의 .xlsx 첫 시트를
                읽어 현재 선택된 날짜(<span className="font-mono">{date}</span>)로
                저장합니다. &quot;사번&quot; 컬럼은 필수이며, 이미 등록된 작업자만
                반영됩니다.
              </p>
              <label className="block text-sm">
                <span className="text-slate-600">엑셀 파일</span>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-sm"
                />
              </label>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
                >
                  취소
                </button>
                <button
                  onClick={submit}
                  disabled={!file || busy}
                  className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
                >
                  {busy ? "업로드 중..." : "업로드"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
