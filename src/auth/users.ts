// 구글 계정으로 사용자를 찾거나 만들고(4.1-1), 탈퇴(4.1-6)와 관리자 판별(4.1-4)을 한다.
import { and, eq, isNull } from "drizzle-orm";
import { adminEmail } from "@/config";
import type { Db } from "@/db/client";
import { createDefaultCategories } from "@/db/default-categories";
import { users } from "@/db/schema";
import type { User } from "./session";

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  picture?: string | null;
}

export class LoginError extends Error {}

export function isAdmin(user: Pick<User, "email" | "isDemo">): boolean {
  const admin = adminEmail();
  return !user.isDemo && admin !== null && user.email.toLowerCase() === admin;
}

/**
 * 구글 계정 id(sub)로 사용자를 찾고, 없으면 처음 로그인한 것으로 보고 계정과 기본 카테고리를 만든다.
 * 이전 때 관리자 이메일로 미리 만든 계정(구글 id 없음)은 같은 이메일로 처음 로그인하면 새로 만들지 않고 그 계정에 연결한다(4.1-7).
 * 같은 이메일 계정 연결은 관리자 이메일에만 허용한다.
 */
export async function findOrCreateGoogleUser(db: Db, p: GoogleProfile): Promise<User> {
  if (!p.emailVerified) throw new LoginError("이메일이 확인되지 않은 구글 계정입니다.");
  const email = p.email.trim().toLowerCase();
  const profile = { name: p.name ?? null, picture: p.picture ?? null };
  const [bySub] = await db.update(users).set(profile).where(and(eq(users.googleSub, p.sub), eq(users.isDemo, false))).returning();
  if (bySub) return bySub;

  if (isAdmin({ email, isDemo: false })) {
    const [linked] = await db
      .update(users)
      .set({ googleSub: p.sub, ...profile })
      .where(and(eq(users.email, email), isNull(users.googleSub), eq(users.isDemo, false)))
      .returning();
    if (linked) return linked;
  }

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(users).values({ googleSub: p.sub, email, ...profile }).onConflictDoNothing().returning();
    if (!created) throw new LoginError("이미 다른 구글 계정과 연결된 이메일입니다.");
    await createDefaultCategories(tx, created.id);
    return created;
  });
}

/** 탈퇴(4.1-6). 사용자 행을 지우면 가계부 데이터와 세션이 외래 키(cascade)로 함께 지워진다. 전체 분류 횟수는 남는다. */
export async function deleteUser(db: Db, userId: number): Promise<void> {
  await db.delete(users).where(and(eq(users.id, userId), eq(users.isDemo, false)));
}

/** 관리자 화면의 가입자 수(4.6-5). 데모 사용자는 세지 않는다. */
export async function countUsers(db: Db): Promise<number> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isDemo, false));
  return rows.length;
}
