/* eslint-disable react-hooks/refs -- dnd-kit 훅이 돌려주는 setNodeRef/listeners를 펼쳐 쓰는 것을 규칙이 ref 접근으로 오탐한다 */
"use client";

import { useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";

// 라인별 탭의 블록 드래그&드롭 — 수주번호 행의 칸이 그 블록(라인×일자, 고객사~팩수)을 끌어내는 시작점이다.
// 블록 안의 다른 칸(품목군·계획·납기일 등)에서 누른 것은 ScheduleTab이 register로 받은 함수로 넘겨 같은 드래그를 시작한다.
// 끌 수 있는 것: 수주번호가 있고 오늘 이전이 아닌 블록. 놓을 수 있는 자리: 같은 라인, 쉬는 날이 아니고 오늘 이전이 아닌 다른 날짜.

export interface BlockDragData {
  line: string;
  date: string;
  so: string;
}

export function dropAllowed(active: BlockDragData | undefined, line: string, date: string, off: boolean, past: boolean): boolean {
  return !!active && active.line === line && active.date !== date && !off && !past;
}

type Starter = (e: React.PointerEvent) => void;

export default function SoDndCell({
  line,
  date,
  so,
  past,
  style,
  register,
  children,
}: {
  line: string;
  date: string;
  so: string;
  past: boolean;
  style: React.CSSProperties;
  register: (key: string, starter: Starter | null) => void;
  children: React.ReactNode;
}) {
  const canDrag = so.trim() !== "" && !past;
  const drag = useDraggable({ id: `blk|${line}|${date}`, disabled: !canDrag, data: { line, date, so } satisfies BlockDragData });
  const onPointerDown = drag.listeners?.onPointerDown as Starter | undefined;
  useEffect(() => {
    register(`${line}|${date}`, canDrag && onPointerDown ? onPointerDown : null);
    return () => register(`${line}|${date}`, null);
  });
  return (
    <td
      ref={drag.setNodeRef}
      data-blk={`${line}|${date}`}
      {...(canDrag ? drag.listeners : {})}
      {...(canDrag ? drag.attributes : {})}
      tabIndex={undefined}
      style={{ ...style, position: "relative", touchAction: "none" }}
      className="border border-slate-200 p-0"
    >
      {children}
    </td>
  );
}
