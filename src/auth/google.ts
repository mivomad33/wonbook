// 구글 로그인(OAuth 2.0 + PKCE). 콜백 경로는 Google에 등록한 /api/auth/callback/google이다.
// 라이브러리 없이 직접 구현한다. 쓰는 것은 인증 주소 만들기, 인가 코드 교환, id_token 읽기뿐이다.
import { createHash, randomBytes } from "node:crypto";
import { isDev, SITE_URL } from "@/config";

/** 개발 서버는 Google에 등록한 http://localhost:3000, 그 밖에는 운영 주소로 돌아온다. */
export const ORIGIN = isDev ? "http://localhost:3000" : SITE_URL;
export const STATE_COOKIE = "wonbook_oauth_state";
export const VERIFIER_COOKIE = "wonbook_oauth_verifier";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Google id_token의 발급자. 두 형태가 모두 온다(Google OIDC 문서). */
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const SCOPES = ["openid", "email", "profile"];

export class GoogleAuthError extends Error {
  override name = "GoogleAuthError";
}

export interface GoogleClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface Client {
  id: string;
  secret: string;
  redirectUri: string;
}

function client(): Client {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET이 없습니다");
  return { id, secret, redirectUri: `${ORIGIN}/api/auth/callback/google` };
}

const random = () => randomBytes(32).toString("base64url");
export const generateState = random;
export const generateCodeVerifier = random;

/** PKCE S256: 검증값의 SHA-256을 base64url(패딩 없음)로 */
export const codeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function authorizationUrl(state: string, verifier: string): URL {
  const c = client();
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", c.id);
  url.searchParams.set("redirect_uri", c.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("scope", SCOPES.join(" "));
  return url;
}

/** 인가 코드를 토큰으로 바꾸고 id_token을 돌려준다. 클라이언트 인증은 HTTP Basic이다. */
export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const c = client();
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: c.redirectUri, code_verifier: verifier });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}`,
    },
    body,
  });
  if (!res.ok) throw new GoogleAuthError(`토큰 요청 실패(${res.status})`);
  const data: unknown = await res.json().catch(() => null);
  const idToken = (data as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== "string") throw new GoogleAuthError("id_token이 없습니다");
  return idToken;
}

/**
 * id_token의 내용을 읽고 발급자·대상·만료를 확인한다.
 * 토큰 엔드포인트에서 TLS로 직접 받은 토큰이라 서명은 검증하지 않는다(OIDC Core 3.1.3.7).
 */
export function readIdToken(idToken: string, now = new Date()): GoogleClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new GoogleAuthError("id_token 형식이 아닙니다");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new GoogleAuthError("id_token을 읽지 못했습니다");
  }
  if (!ISSUERS.includes(claims.iss as string)) throw new GoogleAuthError("발급자가 Google이 아닙니다");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(client().id)) throw new GoogleAuthError("이 앱의 토큰이 아닙니다");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now.getTime()) throw new GoogleAuthError("만료된 토큰입니다");
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") throw new GoogleAuthError("계정 정보가 없습니다");
  return claims as unknown as GoogleClaims;
}
