// 통합 테스트 도우미: 테스트 사용자, 로그인 상태 바꾸기, DB 상태 지문.
import { eq, sql } from "drizzle-orm";
import { DEMO_COOKIE, SESSION_COOKIE, createSession } from "@/auth/session";
import { getAppDb } from "@/db/client";
import { users } from "@/db/schema";
import { createTestUser } from "@/db/test-db";
import type { Classifier } from "@/lib/categorize";

type TestGlobals = { testCookies: Map<string, string>; fakeClassifier: Classifier & { calls: number } };
const g = globalThis as unknown as TestGlobals;

export const db = () => getAppDb();
export const fakeClassifier = () => g.fakeClassifier;

let seq = 0;
/** 테스트 사용자(기본 카테고리 포함). 이메일이 겹치지 않게 실행마다 다른 값을 쓴다. */
export async function newUser(name = "user"): Promise<number> {
  seq += 1;
  return createTestUser(db(), `${name}-${Date.now().toString(36)}-${seq}@test.local`);
}
/** 관리자(ADMIN_EMAIL과 같은 이메일). 한 실행에서 여러 파일이 같이 쓴다. */
export async function newAdmin(): Promise<number> {
  const [found] = await db().select({ id: users.id }).from(users).where(eq(users.email, ADMIN));
  return found?.id ?? createTestUser(db(), ADMIN);
}
const ADMIN = "admin@test.local";

/** 이후 서버 동작을 이 사용자로 부른다 */
export async function loginAs(userId: number): Promise<void> {
  const { token } = await createSession(db(), userId);
  g.testCookies.clear();
  g.testCookies.set(SESSION_COOKIE, token);
}
export function asGuest(): void {
  g.testCookies.clear();
}
export function asDemo(): void {
  g.testCookies.clear();
  g.testCookies.set(DEMO_COOKIE, "1");
}

const TABLES = [
  "users",
  "accounts",
  "imports",
  "import_undo",
  "categories",
  "transactions",
  "category_rules",
  "settings",
  "upload_staging",
  "classify_usage",
  "classify_usage_total",
] as const;

/** 가계부 테이블 전체의 지문. 요청 전후로 견줘 DB가 바뀌지 않았는지 본다. 세션 표는 로그인 때문에 바뀌므로 뺀다. */
export async function dbFingerprint(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TABLES) {
    const r = (await db().execute(sql.raw(`select count(*)::text || ':' || coalesce(md5(string_agg(t::text, ',' order by t::text)), '') as f from ${t} t`))) as unknown as {
      rows: { f: string }[];
    };
    out[t] = r.rows[0].f;
  }
  return out;
}

/** 서버 동작 결과가 거부인지. 예외를 던졌거나, 돌려준 값에 오류 문구가 있다. */
export async function rejected(call: () => Promise<unknown>, message?: string | RegExp): Promise<boolean> {
  let text: string;
  try {
    const r = await call();
    if (r === undefined || (typeof r === "object" && r !== null && ("ok" in r ? r.ok === true : false))) return false;
    text = typeof r === "string" ? r : JSON.stringify(r);
    if (typeof r === "object" && r !== null && !("error" in r) && !("fieldErrors" in r) && !("message" in r)) return false;
  } catch (e) {
    text = (e as Error).message;
  }
  if (message === undefined) return true;
  return typeof message === "string" ? text.includes(message) : message.test(text);
}
