// 로그인·데모 쿠키만 보고 빠르게 길을 나눈다(DB는 보지 않는다). 실제 세션 확인은 각 화면과 서버 동작이 한다.
// - 소개 화면(/)에 로그인 쿠키가 있으면 자산 현황으로 보낸다. 소개 화면은 정적 페이지로 두고 여기서만 갈라 준다(4.6-1, 4.6-11).
// - 앱 화면에 로그인·데모 쿠키가 둘 다 없으면 소개 화면으로 보낸다.
// - API(로그인 경로 제외)에 쿠키가 없으면 401이다.
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "wonbook_session";
const DEMO_COOKIE = "wonbook_demo";
/** auth/session.ts의 SESSION_DAYS와 같다 */
const SESSION_DAYS = 30;
export const APP_PATHS = ["/home", "/monthly", "/transactions", "/upload", "/accounts", "/categories", "/settings", "/admin"];

export function proxy(req: NextRequest) {
  const session = req.cookies.has(SESSION_COOKIE);
  const demo = req.cookies.has(DEMO_COOKIE);
  const { pathname } = req.nextUrl;
  if (pathname === "/") return session ? NextResponse.redirect(new URL("/home", req.url)) : NextResponse.next();
  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/auth/") || session || demo) return NextResponse.next();
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const appPath = APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!appPath) return NextResponse.next();
  if (session) {
    // DB 세션은 쓸 때마다 늘어나므로(auth/session.ts) 쿠키 만료도 같이 늘린다. 세션이 없으면 화면이 쿠키를 지운다.
    const res = NextResponse.next();
    const value = req.cookies.get(SESSION_COOKIE)!.value;
    res.cookies.set(SESSION_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
    return res;
  }
  if (demo) return NextResponse.next();
  const res = NextResponse.redirect(new URL("/", req.url));
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export const config = {
  matcher: ["/", "/api/:path*", "/home/:path*", "/monthly/:path*", "/transactions/:path*", "/upload/:path*", "/accounts/:path*", "/categories/:path*", "/settings/:path*", "/admin/:path*"],
};
