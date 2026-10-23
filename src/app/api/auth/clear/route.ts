// 쿠키는 있는데 세션이 없을 때(만료, 탈퇴, 다른 기기에서 로그아웃) 쿠키를 지우고 소개 화면으로 보낸다.
// 쿠키가 남아 있으면 proxy가 소개 화면에서 자산 현황으로 보내므로, 지우지 않으면 둘 사이를 오간다.
import { cookies } from "next/headers";
import { DEMO_COOKIE, SESSION_COOKIE } from "@/auth/session";

export async function GET(request: Request): Promise<Response> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(DEMO_COOKIE);
  return Response.redirect(new URL("/", request.url), 302);
}
