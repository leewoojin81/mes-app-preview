"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";

// 모든 팝업창(모달)을 마우스로 옮길 수 있게 하는 공용 훅(2026-09-24 사용자 요청) —
// 팝업 상단 헤더(제목 줄)를 누른 채 끌면 팝업 전체가 그 이동량만큼 따라온다. 화면
// 중앙에 뜨는 기존 레이아웃(오버레이 div가 flex items-center justify-center로 패널을
// 가운데 고정)은 그대로 두고, 패널에 transform: translate(dx, dy)만 얹어서 옮긴다 —
// 모달은 열릴 때마다 새로 마운트되는 컴포넌트라 위치가 항상 중앙에서 다시 시작한다
// (별도 초기화 로직 불필요). 사용법: 패널 div에 style={style}, 헤더 div에
// onMouseDown={onMouseDown}과 cursor-move 클래스를 얹는다.
export function useDraggableModal() {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  function onMouseDown(e: ReactMouseEvent<HTMLElement>) {
    // 왼쪽 버튼 드래그만 처리한다. 헤더 안의 닫기(×) 버튼 등을 눌러도 같이 걸리지만,
    // 움직임 없이 바로 떼면(=클릭) 위치가 안 바뀌므로 버튼 클릭과 충돌하지 않는다.
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = pos.x;
    const origY = pos.y;
    document.body.style.userSelect = "none";

    function handleMove(ev: MouseEvent) {
      setPos({ x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) });
    }
    function handleUp() {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }

  return {
    style: { transform: `translate(${pos.x}px, ${pos.y}px)` },
    onMouseDown,
  };
}
