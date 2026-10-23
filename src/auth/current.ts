// 요청을 보낸 사람. 화면과 서버 동작은 여기서 로그인·데모·권한을 확인한다.
// 요청마다 한 번만 DB를 보도록 React cache로 묶는다.
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getAppDb } from "@/db/client";
import { UserError } from "@/lib/user-error";
import { ensureDemoUser } from "./demo";
import { DEMO_COOKIE, SESSION_COOKIE, validateSession, type User } from "./session";
import { isAdmin } from "./users";

// isDemo: 로그인하지 않은 방문자가 데모를 보는 중(4.5). 읽기만 할 수 있다.
export type CurrentUser = User & { isAdmin: boolean; isDemo: boolean };

export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  await connection(); // 요청마다 다른 값(세션, 지금 시각)을 쓰므로 미리 그리지 않는다
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const db = getAppDb();
  if (token) {
    const s = await validateSession(db, token);
    if (s) return { ...s.user, isAdmin: isAdmin(s.user), isDemo: false };
  }
  if (jar.has(DEMO_COOKIE)) {
    const demo = await ensureDemoUser(db);
    return { ...demo, isAdmin: false, isDemo: true };
  }
  return null;
});

/** 화면용. 로그인(또는 데모)이 아니면 소개 화면으로 보낸다. 쿠키는 있는데 세션이 없으면 쿠키를 지우고 보낸다. */
export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (u) return u;
  const stale = (await cookies()).has(SESSION_COOKIE);
  redirect(stale ? "/api/auth/clear" : "/");
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!u.isAdmin) redirect("/home");
  return u;
}

export class AuthError extends UserError {}

export const DEMO_READONLY_MESSAGE = "데모에서는 바꿀 수 없습니다. 로그인하면 할 수 있습니다.";

/**
 * 서버 동작용(쓰기). 로그인하지 않았거나 데모면 예외를 던진다.
 * 서버 동작은 주소로 직접 부를 수 있어 동작마다 확인한다(4.1-2, 4.5-3).
 */
export async function actionUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) throw new AuthError("로그인이 필요합니다.");
  if (u.isDemo) throw new AuthError(DEMO_READONLY_MESSAGE);
  return u;
}

export async function actionAdmin(): Promise<CurrentUser> {
  const u = await actionUser();
  if (!u.isAdmin) throw new AuthError("관리자만 할 수 있습니다.");
  return u;
}
