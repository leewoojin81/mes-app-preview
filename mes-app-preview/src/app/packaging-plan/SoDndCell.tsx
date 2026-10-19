/* eslint-disable react-hooks/refs -- dnd-kit 훅이 돌려주는 setNodeRef/listeners를 펼쳐 쓰는 것을 규칙이 ref 접근으로 오탐한다 */
"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";

// 라인별 탭의 블록 드래그&드롭 — 수주번호 행의 칸이 "끌 수 있는 손잡이 + 놓는 자리"가 된다.
// 끌 수 있는 것: 수주번호가 있고 오늘 이전이 아닌 칸. 놓을 수 있는 자리: 같은 라인, 쉬는 날이 아니고 오늘 이전이 아닌 다른 날짜.

export interface BlockDragData {
  line: string;
  date: string;
  so: string;
}

export function dropAllowed(active: BlockDragData | undefined, line: string, date: string, off: boolean, past: boolean): boolean {
  return !!active && active.line === line && active.date !== date && !off && !past;
}

export default function SoDndCell({
  line,
  date,
  so,
  off,
  past,
  style,
  children,
}: {
  line: string;
  date: string;
  so: string;
  off: boolean;
  past: boolean;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const canDrag = so.trim() !== "" && !past;
  const drag = useDraggable({ id: `blk|${line}|${date}`, disabled: !canDrag, data: { line, date, so } satisfies BlockDragData });
  const drop = useDroppable({ id: `drop|${line}|${date}` });
  const active = drop.active?.data.current as BlockDragData | undefined;
  const dragging = !!active;
  const allowed = dropAllowed(active, line, date, off, past);
  // 드래그 중에는 같은 라인의 칸만 놓을 수 있는지 색으로 보여준다 — 놓을 수 있으면 초록(올려 놓으면 진하게), 없으면 빨간 점선
  const dropStyle: React.CSSProperties = dragging && active.line === line && active.date !== date
    ? allowed
      ? { boxShadow: `inset 0 0 0 2px ${drop.isOver ? "#16a34a" : "#86efac"}`, backgroundColor: drop.isOver ? "#bbf7d0" : style.backgroundColor }
      : { outline: "2px dashed #f87171", outlineOffset: "-2px", cursor: "not-allowed" }
    : dragging && active.date !== date
      ? { cursor: "not-allowed" }
      : {};
  return (
    <td ref={drop.setNodeRef} style={{ ...style, ...dropStyle, position: "relative", opacity: drag.isDragging ? 0.45 : 1 }} className="border border-slate-200 p-0">
      {canDrag && (
        <span
          ref={drag.setNodeRef}
          {...drag.listeners}
          {...drag.attributes}
          tabIndex={-1}
          title="끌어서 같은 라인의 다른 날짜로 옮기기 (삽입 후 뒤로 밀기)"
          className="absolute left-0 top-0 z-[5] w-4 h-full flex items-center justify-center cursor-grab active:cursor-grabbing text-slate-400 hover:text-navy select-none touch-none"
        >
          ⠿
        </span>
      )}
      {children}
    </td>
  );
}
