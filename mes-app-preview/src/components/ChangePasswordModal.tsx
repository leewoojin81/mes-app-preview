"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.03 10.03 0 0 0 3.3-4.38 1.65 1.65 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.374l1.091 1.092a4 4 0 0 0-5.557-5.557Z" />
      <path d="M10.748 13.93l2.523 2.523a9.956 9.956 0 0 1-3.27.547 10.004 10.004 0 0 1-9.106-5.836 1.65 1.65 0 0 1 0-1.184 10.03 10.03 0 0 1 2.435-3.35l2.617 2.617a4 4 0 0 0 4.802 4.683Z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path
        fillRule="evenodd"
        d="M.664 10.59a1.65 1.65 0 0 1 0-1.184C1.994 5.938 5.674 3.5 10 3.5s8.006 2.438 9.336 5.907a1.65 1.65 0 0 1 0 1.184C18.006 14.062 14.326 16.5 10 16.5s-8.006-2.438-9.336-5.91ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  inputCls,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  inputCls: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={`${inputCls} pr-9`}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}
          tabIndex={-1}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </label>
  );
}

// 로그인한 본인이 스스로 비밀번호를 바꾸는 모달 — 사이드바 하단(로그아웃 옆)에서 연다.
// 관리자가 다른 계정 비밀번호를 초기화하는 사용자계정관리(SYS-01)와는 별개 기능.
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // 창을 헤더(제목 표시줄)를 드래그해 화면 어디로든 옮길 수 있게 한다.
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  );

  function handleDragStart(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
  }
  function handleDragMove(e: MouseEvent) {
    if (!dragRef.current) return;
    setPosition({
      x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
    });
  }
  function handleDragEnd() {
    dragRef.current = null;
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("mouseup", handleDragEnd);
  }

  const submit = async () => {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "변경에 실패했습니다.");
      return;
    }
    setDone(true);
  };

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  // 사이드바(<aside>)가 position:sticky라 자체 stacking context를 만드는데, 이 모달을
  // 그 안에 그대로 두면 fixed+z-50이어도 사이드바의 stacking context 안에 갇혀서 main
  // 영역의 position:relative 요소(차트 wrapper 등)에 DOM 순서상 밀려 뒤로 그려진다
  // (2026-09-07 실사례: 월별수주현황분석의 인라인 SVG 차트가 이 모달 위로 뚫고 보임 —
  // z-index를 아무리 올려도 소용없었던 이유). document.body에 포트로 그려서 사이드바의
  // stacking context에서 완전히 빼내야 root 기준으로 z-index:50이 제대로 먹는다.
  return createPortal(
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        className="bg-white rounded-lg shadow-xl w-full max-w-sm"
      >
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between px-5 py-4 border-b border-slate-200 cursor-move select-none"
        >
          <h2 className="text-base font-bold text-navy">비밀번호 변경</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {done ? (
          <div className="px-5 py-5 space-y-3">
            <p className="text-sm text-slate-700">비밀번호가 변경되었습니다.</p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white"
              >
                확인
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            <PasswordField
              label="현재 비밀번호"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              autoFocus
              inputCls={inputCls}
            />
            <PasswordField
              label="새 비밀번호"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              inputCls={inputCls}
            />
            <PasswordField
              label="새 비밀번호 확인"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              inputCls={inputCls}
            />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600"
              >
                취소
              </button>
              <button
                onClick={submit}
                disabled={saving || !currentPassword || !newPassword || !confirmPassword}
                className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
              >
                {saving ? "변경 중..." : "변경"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
