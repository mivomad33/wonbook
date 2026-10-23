// 개발 서버 전용 테스트 로그인(4.1-5). next.config가 next dev에서만 .dev.ts 파일을 경로로 쓰므로 빌드 결과물에는 없다.
// 사용: /api/auth/dev-login?as=admin | user1 | user2 (user3 이상도 된다). 구글 없이 그 테스트 사용자로 로그인하고 자산 현황으로 간다.
// 관리자는 ADMIN_EMAIL 계정이다(개발 DB에 없으면 만든다).
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cookieOptions, createSession, DEMO_COOKIE, SESSION_COOKIE } from "@/auth/session";
import { adminEmail } from "@/config";
import { getAppDb } from "@/db/client";
import { createDefaultCategories } from "@/db/default-categories";
import { users } from "@/db/schema";

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return new Response("Not Found", { status: 404 });
  const as = new URL(request.url).searchParams.get("as") ?? "user1";
  const email = as === "admin" ? adminEmail() : /^user\d+$/.test(as) ? `${as}@test.local` : null;
  if (!email) return new Response("as=admin | userN", { status: 400 });
  const db = getAppDb();
  let [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    [user] = await db.insert(users).values({ email, name: `테스트 ${as}` }).returning();
    await createDefaultCategories(db, user.id);
  }
  const s = await createSession(db, user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, s.token, cookieOptions(s.expiresAt));
  jar.delete(DEMO_COOKIE);
  return Response.redirect(new URL("/home", request.url), 302);
}
