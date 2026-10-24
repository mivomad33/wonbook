// 읽기 전용 데모(4.5). 데모 전용 사용자 한 명의 가짜 가계부를 로그인하지 않은 방문자에게 보여 준다.
// 데이터는 시드(db/seed.ts)와 같고 날짜가 "지금" 기준이라, 달이 바뀌면 다시 만들어 언제 열어도 이번 달과 앞 다섯 달이 보인다.
// 시드 내용이 바뀌어도(SEED_VERSION) 다시 만든다. 배포 직후 데모가 새 시드로 보이게 하기 위해서다(design-refresh 명세서 4.7-2).
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createDefaultCategories } from "@/db/default-categories";
import { accounts, categories, categoryRules, settings, users } from "@/db/schema";
import { SEED_VERSION, seed } from "@/db/seed";
import { currentMonth } from "@/lib/format";
import type { User } from "./session";

export const DEMO_EMAIL = "demo@wonbook.invalid";
const SEEDED_MONTH_KEY = "demo_seeded_month";
// 데모 다시 만들기가 동시에 두 번 돌지 않게 하는 잠금 번호
const DEMO_LOCK = 4_242_001;

async function findDemoUser(db: Db): Promise<User | undefined> {
  const [u] = await db.select().from(users).where(and(eq(users.email, DEMO_EMAIL), eq(users.isDemo, true)));
  return u;
}

async function seededMonth(db: Db, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, SEEDED_MONTH_KEY)));
  return (row?.value as string | undefined) ?? null;
}

// 저장 값은 "만든 달#v시드 버전"이다. 예전 값("2026-10")은 버전이 달라 다시 만든다.
const seededKey = (now: Date) => `${currentMonth(now)}#v${SEED_VERSION}`;

/** 데모 사용자를 돌려준다. 없거나 데이터가 지난달 것이거나 시드 버전이 다르면 지금 기준으로 다시 만든다. */
export async function ensureDemoUser(db: Db, now = new Date()): Promise<User> {
  const month = seededKey(now);
  const existing = await findDemoUser(db);
  if (existing && (await seededMonth(db, existing.id)) === month) return existing;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_LOCK})`);
    let [user] = await tx.select().from(users).where(and(eq(users.email, DEMO_EMAIL), eq(users.isDemo, true)));
    if (user && (await seededMonth(tx as unknown as Db, user.id)) === month) return user;
    if (!user) [user] = await tx.insert(users).values({ email: DEMO_EMAIL, name: "데모", isDemo: true }).returning();
    // 데모 사용자의 가짜 데이터만 지우고 다시 만든다(7장 사전 승인). 다른 사용자의 행은 user_id로 건드리지 않는다.
    await tx.delete(accounts).where(eq(accounts.userId, user.id));
    await tx.delete(categoryRules).where(eq(categoryRules.userId, user.id));
    await tx.delete(categories).where(eq(categories.userId, user.id));
    await tx.delete(settings).where(eq(settings.userId, user.id));
    await createDefaultCategories(tx, user.id);
    await seed(tx as unknown as Db, user.id, { now });
    await tx.insert(settings).values({ userId: user.id, key: SEEDED_MONTH_KEY, value: month });
    return user;
  });
}
