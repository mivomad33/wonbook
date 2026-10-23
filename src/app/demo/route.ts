// 데모 들어가기(4.5-1). 데모 쿠키를 둔 뒤 자산 현황으로 간다. 로그인한 사람이 오면 자기 가계부로 보낸다.
// 데모 데이터는 화면이 데모 사용자를 읽을 때 맞춘다(currentUser → ensureDemoUser). 여기서는 DB를 부르지 않아,
// DB에 닿지 못할 때도 빈 오류 응답 대신 앱의 오류 화면(다시 시도)이 보인다(4.10-6).
import { cookies } from "next/headers";
import { DEMO_COOKIE, SESSION_COOKIE } from "@/auth/session";

export async function GET(request: Request): Promise<Response> {
  const jar = await cookies();
  if (!jar.has(SESSION_COOKIE)) {
    jar.set(DEMO_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 86_400 });
  }
  return Response.redirect(new URL("/home", request.url), 302);
}
