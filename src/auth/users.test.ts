import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, categories, sessions, transactions, users } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { seed } from "@/db/seed";
import { setSetting } from "@/lib/settings";
import { reserve } from "@/lib/categorize/quota";
import { createSession, validateSession } from "./session";
import { countUsers, deleteUser, findOrCreateGoogleUser, isAdmin } from "./users";

const profile = (sub: string, email: string) => ({ sub, email, emailVerified: true, name: "이름", picture: null });

describe("구글 계정과 사용자", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAIL = "admin@test.local";
  });

  it("처음 로그인하면 계정과 기본 카테고리 25개가 생기고, 다시 로그인하면 같은 계정이다", async () => {
    const db = await createTestDb();
    const u = await findOrCreateGoogleUser(db, profile("g-1", "A@Test.Local"));
    expect(u.email).toBe("a@test.local");
    expect(await db.select().from(categories).where(eq(categories.userId, u.id))).toHaveLength(25);
    const again = await findOrCreateGoogleUser(db, profile("g-1", "a@test.local"));
    expect(again.id).toBe(u.id);
    expect(await countUsers(db)).toBe(1);
  });

  it("미리 만든 관리자 계정은 같은 이메일로 처음 로그인하면 새로 만들지 않고 연결한다(4.1-7)", async () => {
    const db = await createTestDb();
    const [pre] = await db.insert(users).values({ email: "admin@test.local" }).returning();
    const u = await findOrCreateGoogleUser(db, profile("g-admin", "admin@test.local"));
    expect(u.id).toBe(pre.id);
    expect(u.googleSub).toBe("g-admin");
    expect(isAdmin(u)).toBe(true);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("관리자가 아닌 이메일은 다른 구글 계정에 연결하지 않는다", async () => {
    const db = await createTestDb();
    await findOrCreateGoogleUser(db, profile("g-1", "b@test.local"));
    await expect(findOrCreateGoogleUser(db, profile("g-2", "b@test.local"))).rejects.toThrow("이미 다른 구글 계정");
  });

  it("이메일이 확인되지 않은 구글 계정은 받지 않는다", async () => {
    const db = await createTestDb();
    await expect(findOrCreateGoogleUser(db, { ...profile("g-1", "c@test.local"), emailVerified: false })).rejects.toThrow();
  });

  it("탈퇴하면 그 사용자 id로 남은 행이 없고, 다른 사용자 데이터와 전체 분류 횟수는 그대로다(4.1-6)", async () => {
    process.env.ACCOUNT_HASH_KEY ??= "test-account-hash-key";
    const db = await createTestDb();
    const a = await findOrCreateGoogleUser(db, profile("g-a", "a@test.local"));
    const b = await findOrCreateGoogleUser(db, profile("g-b", "b@test.local"));
    await seed(db, a.id);
    await seed(db, b.id);
    await setSetting(db, a.id, "adjustment_notice_dismissed_at", "2026-10-01T00:00:00Z");
    await createSession(db, a.id);
    await reserve(db, { userId: a.id, isAdmin: false, want: 3 });
    const bTx = (await db.select().from(transactions).where(eq(transactions.userId, b.id))).length;

    await deleteUser(db, a.id);

    const tables = await db.execute(
      sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`,
    );
    for (const { table_name } of (tables as { rows: { table_name: string }[] }).rows) {
      const left = await db.execute(sql`select count(*)::int as n from ${sql.identifier(table_name)} where user_id = ${a.id}`);
      expect((left as { rows: { n: number }[] }).rows[0].n, table_name).toBe(0);
    }
    expect(await db.select().from(users).where(eq(users.id, a.id))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.userId, b.id))).toHaveLength(bTx);
    expect((await db.select().from(accounts).where(eq(accounts.userId, b.id))).length).toBeGreaterThan(0);
    const total = await db.execute(sql`select count from classify_usage_total`);
    expect((total as { rows: { count: number }[] }).rows[0].count).toBe(3);
  });
});

describe("세션", () => {
  it("만료된 세션과 데모 사용자 세션은 받지 않는다", async () => {
    const db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "s@test.local" }).returning();
    const now = new Date("2026-10-23T00:00:00Z");
    const s = await createSession(db, u.id, now);
    expect((await validateSession(db, s.token, now))?.user.id).toBe(u.id);
    expect(await validateSession(db, s.token, new Date("2026-12-01T00:00:00Z"))).toBeNull();
    expect(await db.select().from(sessions)).toHaveLength(0);
    const [demo] = await db.insert(users).values({ email: "d@test.local", isDemo: true }).returning();
    const ds = await createSession(db, demo.id, now);
    expect(await validateSession(db, ds.token, now)).toBeNull();
  });
});
