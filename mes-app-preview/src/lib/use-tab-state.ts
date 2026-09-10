"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";

// SSR에서는 useLayoutEffect가 아무 것도 하지 않고 콘솔에 경고만 남기므로,
// 서버에서는 useEffect로 대체한다("use client" 컴포넌트라도 최초 응답은
// 서버에서 렌더링되기 때문에 필요).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// useState와 같은 사용법이지만, 값이 바뀔 때마다 현재 경로(탭) 기준으로
// sessionStorage에 저장해둔다. 탭 전환은 실제 라우트 이동(페이지 컴포넌트
// 언마운트)이라 일반 useState는 다른 탭을 봤다 돌아오면 초기화되는데, 이
// 훅으로 선언한 값(현재 페이지 번호, 필터, 입력 중이던 텍스트 등)은 같은
// 탭으로 돌아왔을 때 마지막 값이 복원된다. 조회 결과(rows/total/loading)처럼
// 서버에서 항상 다시 받아오는 값에는 쓰지 않는다.
//
// 최초 렌더(서버 렌더 + 클라이언트 첫 렌더)는 항상 initialValue를 그대로
// 쓰고, sessionStorage에 저장된 값은 마운트 직후 useLayoutEffect에서
// 한 번만 읽어 반영한다 — 초기 렌더에서 곧바로 sessionStorage를 읽으면
// 서버가 그린 HTML(항상 initialValue 기준)과 클라이언트의 첫 렌더 결과가
// 달라져 하이드레이션 불일치가 난다. useLayoutEffect라 화면에 실제로
// 페인트되기 전에 값이 바뀌므로 "기본값이 잠깐 보였다가 바뀌는" 깜빡임도 없다.
//
// **중요(2026-09-10 실사례로 발견·수정)**: 예전엔 "값이 바뀔 때마다 저장"을
// 별도의 `useEffect(() => sessionStorage.setItem(...), [state])`로 구현했는데,
// React(Next.js dev의 기본 Strict Mode)가 마운트 시 effect를 한 번 더 재실행하는
// 과정에서 이 저장용 effect가 "복원 전 초기값(예: 빈 문자열)"을 들고 있는 오래된
// 클로저로 다시 실행되며 방금 복원해 둔 값을 되돌려 sessionStorage에 다시 덮어쓰는
// 경우가 있었다 — 실제로 PSN-01(일일근태입력)에서 공정 필터를 선택하고 다른 탭에
// 갔다 돌아오면 필터가 매번 초기화되는 것으로 발견됨(다른 화면도 전부 같은 문제).
// 그래서 "값이 바뀌면 자동으로 저장"하는 별도 effect를 완전히 없애고, 반환하는
// setter 자체가 다음 값을 계산함과 동시에 sessionStorage에 쓰도록 바꿨다 — 저장은
// 오직 이 setter가 실제로 호출될 때만(즉 사람이 값을 바꿀 때만) 일어나고, 마운트 시
// 복원 로직(아래 useLayoutEffect)은 내부용 setState만 쓰고 저장은 건드리지 않으므로
// 어떤 순서로 effect가 몇 번 재실행되어도 복원된 값을 덮어쓸 방법이 없다.
export function useTabState<T>(
  key: string,
  initialValue: T | (() => T)
): [T, (v: T | ((prev: T) => T)) => void] {
  const pathname = usePathname();
  const storageKey = `tabstate:${pathname}:${key}`;

  const [state, setStateInternal] = useState<T>(initialValue);

  const setState = useCallback(
    (v: T | ((prev: T) => T)) => {
      setStateInternal((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [storageKey]
  );

  useIsomorphicLayoutEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw != null) setStateInternal(JSON.parse(raw) as T);
    } catch {}
    // 마운트 시 1회만 복원 — key/pathname은 이 훅을 쓰는 컴포넌트 생애 동안
    // 바뀌지 않는다(경로가 바뀌면 컴포넌트 자체가 언마운트/재마운트된다). 여기서는
    // setState(위의 저장용 래퍼)가 아니라 setStateInternal을 직접 써서, 복원 자체가
    // sessionStorage에 다시 쓰기를 유발하지 않게 한다(이미 있던 값을 그대로 읽은
    // 것뿐이라 다시 쓸 이유가 없고, 불필요한 쓰기를 없애야 위에서 설명한 재실행
    // 레이스 자체가 발생할 여지가 없어진다).
  }, []);

  return [state, setState];
}
