"use client";

import { useEffect, useState } from "react";
import type { AppUser, ScreenPermissionGroup } from "@/lib/types";
import { EMPLOYMENT_TYPES, POSITIONS_BY_EMPLOYMENT_TYPE, TEAMS, type EmploymentType } from "@/lib/org";
import { WORK_GROUP_OPTIONS } from "@/lib/work-groups";

const ROLE_LABEL: Record<AppUser["role"], string> = { leader: "조장", admin: "관리자" };

type FormState = {
  username: string;
  password: string;
  display_name: string;
  process_codes: string[];
  role: AppUser["role"];
  use_yn: "Y" | "N";
  team: string;
  employment_type: string;
  position: string;
};

const EMPTY_FORM: FormState = {
  username: "",
  password: "",
  display_name: "",
  process_codes: [],
  role: "leader",
  use_yn: "Y",
  team: "",
  employment_type: "",
  position: "",
};

export default function UsersPage() {
  const [rows, setRows] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [permTarget, setPermTarget] = useState<AppUser | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/users", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: AppUser[]) => {
        setRows(data);
        setLoading(false);
      });
  };

  useEffect(load, []);

  return (
    <div className="w-full px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">사용자계정관리</h1>
          <p className="text-sm text-slate-500 mt-1">
            SYS-01 · 로그인 계정 관리 — 조장은 소속공정, 관리자는 전체 메뉴/공정에
            접근합니다.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white hover:opacity-90 transition-opacity"
        >
          계정 추가
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-13.5rem)]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#D9D9D9] text-slate-500 text-xs">
              <tr>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  순번
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  계정명
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  이름
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  소속팀
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  구분·직급
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  소속공정
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  권한레벨
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  사용여부
                </th>
                <th className="text-center px-4 py-3 font-semibold sticky top-0 z-10 bg-[#D9D9D9] shadow-[inset_0_-1px_0_#e2e8f0]">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    등록된 계정이 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, idx) => (
                  <tr key={r.username} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.username}</td>
                    <td className="px-4 py-3 font-medium">{r.display_name || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.team || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {r.employment_type ? `${r.employment_type}${r.position ? " · " + r.position : ""}` : "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {r.process_codes.length > 0 ? r.process_codes.join(", ") : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          r.role === "admin"
                            ? "bg-gold/15 text-gold border-gold/40"
                            : "bg-slate-100 text-slate-600 border-slate-300"
                        }`}
                      >
                        {ROLE_LABEL[r.role]}
                      </span>
                      {r.override_count > 0 && (
                        <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-50 text-sky-700 border-sky-200">
                          예외 {r.override_count}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                          r.use_yn === "Y"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}
                      >
                        {r.use_yn === "Y" ? "사용" : "중단"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPermTarget(r)}
                          className="text-xs font-medium text-sky-700 hover:underline"
                        >
                          권한
                        </button>
                        <button
                          onClick={() => {
                            setEditing(r);
                            setShowForm(true);
                          }}
                          className="text-xs font-medium text-navy hover:underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(r);
                          }}
                          className="text-xs font-medium text-rose-600 hover:underline"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
          전체 {rows.length.toLocaleString()}건
        </div>
      </div>

      {showForm && (
        <UserFormModal
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {permTarget && (
        <PermissionsModal user={permTarget} onClose={() => setPermTarget(null)} onSaved={load} />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-navy">계정 삭제</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-500 mr-1">
                  {deleteTarget.username}
                </span>
                <span className="font-medium">{deleteTarget.display_name}</span>
                을(를) 정말 삭제하시겠습니까?
              </p>
              <p className="text-xs text-slate-400">이 작업은 되돌릴 수 없습니다.</p>
              {deleteError && <p className="text-sm text-rose-600">{deleteError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (!deleteTarget) return;
                  setDeleting(true);
                  const res = await fetch(
                    `/api/users/${encodeURIComponent(deleteTarget.username)}`,
                    { method: "DELETE" }
                  );
                  const data = await res.json().catch(() => ({}));
                  setDeleting(false);
                  if (!res.ok) {
                    setDeleteError(data.error ?? "삭제에 실패했습니다.");
                    return;
                  }
                  setDeleteTarget(null);
                  load();
                }}
                disabled={deleting}
                className="px-3.5 py-2 rounded-md text-sm font-medium bg-rose-600 text-white disabled:opacity-40"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: AppUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    editing
      ? {
          username: editing.username,
          password: "",
          display_name: editing.display_name ?? "",
          process_codes: editing.process_codes,
          role: editing.role,
          use_yn: editing.use_yn,
          team: editing.team ?? "",
          employment_type: editing.employment_type ?? "",
          position: editing.position ?? "",
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 수정 모드에서는 비밀번호 입력란을 기본적으로 DOM에서 아예 빼뒀다가, 체크박스를
  // 눌러야만 나타나게 한다 — 브라우저 자동완성이 "비어 보이지만 실제로는 저장된
  // 값이 채워진" 비밀번호 칸을 만들어 의도치 않게 계정 비밀번호가 바뀌는 사고를
  // 겪은 뒤 추가한 안전장치(2026-08-30, 실제로 admin 계정 비밀번호가 이렇게 바뀐 적 있음).
  const [resetPassword, setResetPassword] = useState(!editing);
  const [showPassword, setShowPassword] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleProcess = (code: string) =>
    setForm((prev) => ({
      ...prev,
      process_codes: prev.process_codes.includes(code)
        ? prev.process_codes.filter((c) => c !== code)
        : [...prev.process_codes, code],
    }));

  // 구분(관리직/현장직)이 바뀌면 직급 목록 자체가 달라지므로, 이전에 고른 직급은
  // 새 구분과 짝이 안 맞을 수 있어 함께 초기화한다.
  const setEmploymentType = (value: string) =>
    setForm((prev) => ({ ...prev, employment_type: value, position: "" }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    const body = {
      username: form.username.trim(),
      password: form.password, // 수정 시 빈칸이면 서버가 기존 비밀번호를 유지
      display_name: form.display_name.trim(),
      process_codes: form.process_codes,
      role: form.role,
      use_yn: form.use_yn,
      team: form.team,
      employment_type: form.employment_type,
      position: form.position,
    };
    const url = editing ? `/api/users/${encodeURIComponent(editing.username)}` : "/api/users";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    onSaved();
  };

  const inputCls = "mt-1 w-full border border-slate-300 rounded-md px-2.5 py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">{editing ? "계정 수정" : "계정 추가"}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">
                계정명 <span className="text-rose-600">*</span>
              </span>
              <input
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                disabled={!!editing}
                autoComplete="off"
                className={`${inputCls} font-mono disabled:bg-slate-100 disabled:text-slate-400`}
                placeholder="예: leader1"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">
                비밀번호 {!editing && <span className="text-rose-600">*</span>}
              </span>
              {editing && !resetPassword ? (
                <button
                  type="button"
                  onClick={() => setResetPassword(true)}
                  className={`${inputCls} text-left text-slate-500 hover:border-navy`}
                >
                  변경하지 않음 (클릭해서 재설정)
                </button>
              ) : (
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    autoComplete="new-password"
                    className={`${inputCls} pr-9`}
                    autoFocus={!!editing}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                    tabIndex={-1}
                  >
                    {showPassword ? (
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
                    )}
                  </button>
                </div>
              )}
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-600">이름</span>
            <input
              value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              className={inputCls}
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">소속팀</span>
              <select
                value={form.team}
                onChange={(e) => set("team", e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {TEAMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">구분</span>
              <select
                value={form.employment_type}
                onChange={(e) => setEmploymentType(e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">선택 안 함</option>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">직급</span>
              <select
                value={form.position}
                onChange={(e) => set("position", e.target.value)}
                disabled={!form.employment_type}
                className={`${inputCls} bg-white disabled:bg-slate-100 disabled:text-slate-400`}
              >
                <option value="">
                  {form.employment_type ? "선택 안 함" : "구분을 먼저 선택하세요"}
                </option>
                {form.employment_type &&
                  POSITIONS_BY_EMPLOYMENT_TYPE[form.employment_type as EmploymentType].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="block text-sm">
            <span className="text-slate-600">소속공정 (복수 선택 가능)</span>
            <div className="mt-1 border border-slate-300 rounded-md px-3 py-2 max-h-36 overflow-y-auto grid grid-cols-2 gap-x-3 gap-y-1">
              {WORK_GROUP_OPTIONS.map((g) => (
                <label
                  key={g}
                  className="flex items-center gap-1.5 text-sm cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={form.process_codes.includes(g)}
                    onChange={() => toggleProcess(g)}
                    className="accent-navy"
                  />
                  <span className="truncate">{g}</span>
                </label>
              ))}
            </div>
          </div>
          {form.role === "leader" && form.process_codes.length === 0 && (
            <p className="text-xs text-amber-600">
              조장은 소속공정을 하나 이상 지정해야 작업자등록/일일근태입력에서 데이터가 보입니다.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">권한레벨</span>
              <select
                value={form.role}
                onChange={(e) => set("role", e.target.value as AppUser["role"])}
                className={`${inputCls} bg-white`}
              >
                <option value="leader">조장</option>
                <option value="admin">관리자</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">사용여부</span>
              <select
                value={form.use_yn}
                onChange={(e) => set("use_yn", e.target.value as "Y" | "N")}
                className={`${inputCls} bg-white`}
              >
                <option value="Y">Y (사용)</option>
                <option value="N">N (중단)</option>
              </select>
            </label>
          </div>
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
              disabled={
                saving || !form.username.trim() || (!editing && !form.password.trim())
              }
              className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PermissionsModal({
  user,
  onClose,
  onSaved,
}: {
  user: AppUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [groups, setGroups] = useState<ScreenPermissionGroup[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(user.username)}/permissions`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { groups: ScreenPermissionGroup[] }) => {
        setGroups(data.groups);
        setChecked(
          new Set(
            data.groups.flatMap((g) => g.screens.filter((s) => s.allowed).map((s) => s.code))
          )
        );
      });
  }, [user.username]);

  const toggle = (code: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const submit = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/users/${encodeURIComponent(user.username)}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: Array.from(checked) }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "저장에 실패했습니다.");
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 modal-overlay-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-navy">
            화면권한 설정 —{" "}
            <span className="font-mono text-sm text-slate-500">{user.username}</span>{" "}
            {user.display_name}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            역할({ROLE_LABEL[user.role]})의 기본 접근 화면이 미리 체크되어 있습니다. 이
            사용자만 예외로 추가/제외하려면 체크박스를 바꾸고 저장하세요. 저장 후
            재로그인해야 반영됩니다.
          </p>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {!groups && <p className="text-sm text-slate-400 py-6 text-center">불러오는 중...</p>}
          {groups &&
            groups.map((g) => (
              <div key={g.label}>
                <p className="text-xs font-semibold text-slate-500 mb-1.5">{g.label}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {g.screens.map((s) => (
                    <label
                      key={s.code}
                      className="flex items-center gap-2 text-sm cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(s.code)}
                        onChange={() => toggle(s.code)}
                        className="accent-navy"
                      />
                      <span>{s.label}</span>
                      <span className="text-[10px] text-slate-400">{s.code}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3.5 py-2 rounded-md text-sm border border-slate-300 bg-white text-slate-600 disabled:opacity-40"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={saving || !groups}
            className="px-3.5 py-2 rounded-md text-sm font-medium bg-navy text-white disabled:opacity-40"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
