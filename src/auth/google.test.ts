// 구글 로그인 직접 구현 단위 테스트(4.1-1): 인증 주소, PKCE, 토큰 교환, id_token 확인.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizationUrl, codeChallenge, exchangeCode, generateCodeVerifier, generateState, GoogleAuthError, readIdToken } from "./google";

process.env.GOOGLE_CLIENT_ID = "client-123";
process.env.GOOGLE_CLIENT_SECRET = "secret-456";

const NOW = new Date("2026-10-23T12:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (claims: Record<string, unknown>) => `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
const good = { iss: "https://accounts.google.com", aud: "client-123", exp: sec(NOW) + 3600, sub: "g-1", email: "a@test.local", email_verified: true };

afterEach(() => vi.restoreAllMocks());

describe("구글 로그인", () => {
  it("인증 주소에 필요한 값이 모두 있고 code_challenge는 검증값의 S256이다", () => {
    const state = generateState();
    const verifier = generateCodeVerifier();
    const url = authorizationUrl(state, verifier);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("client-123");
    expect(p.get("redirect_uri")).toBe("https://wonbook.vercel.app/api/auth/callback/google");
    expect(p.get("scope")).toBe("openid email profile");
    expect(p.get("state")).toBe(state);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(codeChallenge(verifier)).toBe(p.get("code_challenge"));
  });

  it("토큰 교환은 Basic 인증과 PKCE 검증값을 보내고 id_token을 돌려준다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id_token: "x.y.z" }));
    expect(await exchangeCode("code-1", "ver-1")).toBe("x.y.z");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("client-123:secret-456").toString("base64")}`);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("code_verifier")).toBe("ver-1");
  });

  it("토큰 요청이 실패하거나 id_token이 없으면 오류다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(exchangeCode("c", "v")).rejects.toThrow(GoogleAuthError);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ access_token: "at" }));
    await expect(exchangeCode("c", "v")).rejects.toThrow(GoogleAuthError);
  });

  it("id_token: 발급자·대상이 다르거나 만료됐거나 형식이 틀리면 거절한다", () => {
    expect(readIdToken(token(good), NOW).sub).toBe("g-1");
    const bad = [token({ ...good, iss: "https://evil.example" }), token({ ...good, aud: "other" }), token({ ...good, exp: sec(NOW) - 1 }), token({ ...good, sub: undefined }), "not-a-jwt"];
    for (const t of bad) expect(() => readIdToken(t, NOW), t).toThrow(GoogleAuthError);
  });
});
