// 구글 로그인 콜백. 인가 코드를 토큰으로 바꾸고 사용자를 찾거나 만든 뒤 세션을 만든다.
// 로그인하면 데모 쿠키는 지운다(로그인한 사람의 가계부를 보여 준다).
import { cookies } from "next/headers";
import { exchangeCode, ORIGIN, readIdToken, STATE_COOKIE, VERIFIER_COOKIE } from "@/auth/google";
import { cookieOptions, createSession, DEMO_COOKIE, SESSION_COOKIE } from "@/auth/session";
import { findOrCreateGoogleUser } from "@/auth/users";
import { getAppDb } from "@/db/client";

const fail = () => Response.redirect(`${ORIGIN}/?error=login`, 302);

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const saved = jar.get(STATE_COOKIE)?.value;
  const verifier = jar.get(VERIFIER_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);
  if (!code || !state || !saved || !verifier || state !== saved) return fail();
  try {
    const db = getAppDb();
    const c = readIdToken(await exchangeCode(code, verifier));
    const user = await findOrCreateGoogleUser(db, { sub: c.sub, email: c.email, emailVerified: c.email_verified === true, name: c.name, picture: c.picture });
    const s = await createSession(db, user.id);
    jar.set(SESSION_COOKIE, s.token, cookieOptions(s.expiresAt));
    jar.delete(DEMO_COOKIE);
    return Response.redirect(`${ORIGIN}/home`, 302);
  } catch (e) {
    console.error(`[로그인] 실패: ${(e as Error).name}`);
    return fail();
  }
}
