import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, transactions, users } from "@/db/schema";
import { createTestDb, createTestUser } from "@/db/test-db";
import { getMonthlyReport } from "@/lib/reports";
import { currentMonth } from "@/lib/format";
import { DEMO_EMAIL, ensureDemoUser } from "./demo";

describe("데모 사용자(4.5)", () => {
  it("처음 열면 가짜 데이터로 만들고, 같은 달에는 다시 만들지 않는다", async () => {
    const db = await createTestDb();
    const now = new Date("2026-10-23T03:00:00Z");
    const u = await ensureDemoUser(db, now);
    expect(u.isDemo).toBe(true);
    const ids1 = (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, u.id))).map((r) => r.id);
    expect(ids1.length).toBeGreaterThan(0);
    await ensureDemoUser(db, new Date("2026-10-30T03:00:00Z"));
    const ids2 = (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, u.id))).map((r) => r.id);
    expect(ids2).toEqual(ids1);
    expect(await db.select().from(users).where(eq(users.email, DEMO_EMAIL))).toHaveLength(1);
  });

  it("몇 달 뒤에 열어도 이번 달 거래가 있다(날짜가 지나 빈 화면이 되지 않는다)", async () => {
    const db = await createTestDb();
    const other = await createTestUser(db);
    await ensureDemoUser(db, new Date("2026-10-23T03:00:00Z"));
    const later = new Date("2027-03-05T03:00:00Z");
    const u = await ensureDemoUser(db, later);
    const month = currentMonth(later);
    const rows = await db.select({ date: transactions.date }).from(transactions).where(and(eq(transactions.userId, u.id)));
    expect(rows.filter((r) => r.date.startsWith(month)).length).toBeGreaterThan(0);
    const report = await getMonthlyReport(db, u.id, month);
    expect(JSON.stringify(report)).not.toBe(JSON.stringify(await getMonthlyReport(db, other, month)));
    // 다른 사용자의 데이터는 건드리지 않는다
    expect(await db.select().from(accounts).where(eq(accounts.userId, other))).toHaveLength(0);
  });
});
