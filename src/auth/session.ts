// 로그인 세션. 쿠키에는 무작위 토큰을 두고 DB에는 그 해시(SHA-256)만 둔다. DB가 새어도 쿠키를 만들 수 없다.
// 세션은 30일 동안 유효하고, 절반이 지나면 쓸 때마다 다시 30일로 늘린다.
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "wonbook_session";
// 데모 쿠키(4.5). 로그인하지 않은 방문자가 데모 사용자의 가계부를 읽기 전용으로 본다. 값은 없고 있고 없음만 본다.
export const DEMO_COOKIE = "wonbook_demo";
const DAY_MS = 86_400_000;
export const SESSION_DAYS = 30;

export type User = typeof users.$inferSelect;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: DbOrTx, userId: number, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
  await db.insert(sessions).values({ id: hash(token), userId, expiresAt });
  return { token, expiresAt };
}

/** 토큰이 가리키는 사용자. 없거나 만료됐으면 null이다. 만료가 가까우면 늘린다. 데모 사용자는 로그인할 수 없다. */
export async function validateSession(db: DbOrTx, token: string, now = new Date()): Promise<{ user: User; expiresAt: Date } | null> {
  const id = hash(token);
  const [row] = await db.select({ user: users, expiresAt: sessions.expiresAt }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, id));
  if (!row || row.user.isDemo) return null;
  if (row.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (row.expiresAt.getTime() - now.getTime() < (SESSION_DAYS / 2) * DAY_MS) {
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    return { user: row.user, expiresAt };
  }
  return { user: row.user, expiresAt: row.expiresAt };
}

export async function deleteSession(db: DbOrTx, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hash(token)));
}

export const cookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires: expiresAt,
});
