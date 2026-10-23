// 구글 로그인 시작. state와 PKCE 검증값을 쿠키에 두고 구글 동의 화면으로 보낸다.
import { cookies } from "next/headers";
import { authorizationUrl, generateCodeVerifier, generateState, STATE_COOKIE, VERIFIER_COOKIE } from "@/auth/google";

export async function GET(): Promise<Response> {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = authorizationUrl(state, verifier);
  const jar = await cookies();
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set(STATE_COOKIE, state, opts);
  jar.set(VERIFIER_COOKIE, verifier, opts);
  return Response.redirect(url, 302);
}
