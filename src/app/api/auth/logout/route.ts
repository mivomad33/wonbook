// 로그아웃(4.1-3). 세션을 지우고 쿠키(로그인·데모)를 지운 뒤 소개 화면으로 간다. 데모의 "나가기"도 여기를 쓴다.
import { cookies } from "next/headers";
import { deleteSession, DEMO_COOKIE, SESSION_COOKIE } from "@/auth/session";
import { getAppDb } from "@/db/client";

export async function POST(request: Request): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getAppDb(), token);
  jar.delete(SESSION_COOKIE);
  jar.delete(DEMO_COOKIE);
  return Response.redirect(new URL("/", request.url), 303);
}
