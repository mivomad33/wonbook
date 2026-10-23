// 데모 들어가기(4.5-1). 데모 데이터를 지금 기준으로 맞추고 데모 쿠키를 둔 뒤 자산 현황으로 간다.
// 로그인한 사람이 오면 자기 가계부로 보낸다.
import { cookies } from "next/headers";
import { ensureDemoUser } from "@/auth/demo";
import { DEMO_COOKIE, SESSION_COOKIE } from "@/auth/session";
import { getAppDb } from "@/db/client";

export async function GET(request: Request): Promise<Response> {
  const jar = await cookies();
  if (!jar.has(SESSION_COOKIE)) {
    await ensureDemoUser(getAppDb());
    jar.set(DEMO_COOKIE, "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 86_400 });
  }
  return Response.redirect(new URL("/home", request.url), 302);
}
