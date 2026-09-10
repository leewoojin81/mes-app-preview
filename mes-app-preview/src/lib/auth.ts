import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

// 비밀번호 해시 — bcrypt 등 별도 의존성 없이 Node 내장 scrypt를 쓴다(프로젝트가 지금까지
// dependency를 최소로 유지해온 방침과 일치). salt는 계정마다 랜덤.
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export type Role = "leader" | "admin";

export type SessionPayload = {
  u: string; // username
  r: Role;
  p: string; // 소속공정 코드 CSV (조장만 사용, 복수 가능 — 관리자는 빈 문자열)
  n: string; // display_name
  exp: number; // epoch seconds
};

export const COOKIE_NAME = "mes_session";
export const SESSION_TTL_SEC = 12 * 60 * 60; // 12시간(근무 교대 단위)

// 프로토타입 성격상 고정 fallback을 두되, 운영 배포 시 AUTH_SECRET 환경변수로 덮어쓸 것.
const SECRET = process.env.AUTH_SECRET || "mes-app-prototype-dev-secret-change-me";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payloadB64: string): string {
  return b64url(createHmac("sha256", SECRET).update(payloadB64).digest());
}

export function signSession(payload: SessionPayload): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySession(cookieValue: string | undefined | null): SessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function newSessionPayload(user: {
  username: string;
  role: Role;
  process_codes: Iterable<string>;
  display_name: string | null;
}): SessionPayload {
  return {
    u: user.username,
    r: user.role,
    p: Array.from(user.process_codes).sort().join(","),
    n: user.display_name || user.username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
}

export function processCodesFromSession(session: SessionPayload): string[] {
  return session.p ? session.p.split(",") : [];
}
