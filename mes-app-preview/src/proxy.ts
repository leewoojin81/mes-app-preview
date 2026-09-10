import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { getAllowedCodesForUser, isPathAllowed } from "@/lib/permissions";
import { NAV_GROUPS } from "@/lib/nav-groups";
import { getDb } from "@/lib/db";

// 이 Next.js 버전(16.3)은 middleware.ts가 폐지되고 proxy.ts로 이름이 바뀌었다
// (node_modules/next/dist/docs/.../proxy.md). 기본이 Node.js 런타임이라 여기서
// verifySession(node:crypto 사용)을 그대로 호출할 수 있다 — runtime 옵션은 proxy에서
// 지정하면 에러가 나므로(문서 명시) export하지 않는다.
//
// 모든 페이지/‌API 요청에 대해: 로그인 안 했으면 페이지는 /login으로 리다이렉트,
// API는 401. 로그인한 사용자의 허용 화면 목록(role 기본값 + 개별 예외, DB에서 매 요청
// 새로 계산 — src/lib/permissions.ts#getAllowedCodesForUser) 밖의 화면으로 나가면
// 페이지는 접근 가능한 첫 화면으로, API는 403으로 막는다 — 사이드바에서 메뉴를 숨기는
// 것과 별개로 URL 직접 입력/직접 API 호출도 막는 이중 방어.
// session.ac(로그인 시점 스냅샷)를 쓰지 않는 이유: 로그인 이후 새 화면이 추가되거나
// 사용자계정관리에서 권한이 바뀌어도 세션 쿠키(최대 12시간)엔 반영이 안 돼서, 재로그인
// 전까진 사이드바에 잠깐 보였다가 사라지는 것처럼 보이는 문제가 있었다(관리자 계정도 예외 아님).
const ALWAYS_ALLOWED = ["/login", "/api/auth"];

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isAlwaysAllowed(pathname)) {
    return NextResponse.next();
  }

  const session = verifySession(request.cookies.get(COOKIE_NAME)?.value);

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  const allowedCodes = getAllowedCodesForUser(getDb(), session.u, session.r);
  if (!isPathAllowed(pathname, allowedCodes)) {
    if (isApi) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }
    const fallbackHref =
      NAV_GROUPS.flatMap((g) => g.children).find((c) => allowedCodes.has(c.code))?.href ?? "/login";
    return NextResponse.redirect(new URL(fallbackHref, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 정적 자산(_next/static, _next/image, 파일 확장자 있는 것)과 favicon은 제외.
    "/((?!_next/static|_next/image|favicon.ico|medios-logo.png).*)",
  ],
};
