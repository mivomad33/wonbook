import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestContext, createTestUser } from "@/db/test-db";
import { accounts, transactions } from "@/db/schema";
import { dismissAdjustmentNotice, listAdjustmentNotice } from "@/lib/balance/notice";

const addAccount = async (db: Db, userId: number, name: string, sortOrder = 0) =>
  (await db.insert(accounts).values({ userId, name, kind: "asset", sortOrder }).returning({ id: accounts.id }))[0].id;

async function addAdjustment(db: Db, userId: number, accountId: number, date: string, amount: number, createdAt: string) {
  await db
    .insert(transactions)
    .values({ userId, accountId, kind: "adjustment", source: "system", date, amount, description: "잔액 보정", createdAt });
}

describe("잔액 보정 알림(4단계 파일 6장)", () => {
  it("닫은 시각 뒤에 생긴 보정만 계정별로 건수·합계·마지막 보정 달을 센다", async () => {
    const { db, userId } = await createTestContext();
    const a = await addAccount(db, userId, "하나", 2);
    const b = await addAccount(db, userId, "카카오", 1);
    await addAdjustment(db, userId, a, "2026-08-03", 500, "2026-10-01T00:00:00.000Z");
    await addAdjustment(db, userId, a, "2026-09-10", -200, "2026-10-01T00:00:00.000Z");
    await addAdjustment(db, userId, b, "2026-09-01", 1_000, "2026-10-01T00:00:00.000Z");
    // 보정이 아닌 거래는 세지 않는다.
    await db.insert(transactions).values({ userId, accountId: a, kind: "normal", source: "manual", date: "2026-09-11", amount: 7 });

    expect(await listAdjustmentNotice(db, userId)).toEqual([
      { accountId: b, accountName: "카카오", count: 1, total: 1_000, lastMonth: "2026-09" },
      { accountId: a, accountName: "하나", count: 2, total: 300, lastMonth: "2026-09" },
    ]);

    await dismissAdjustmentNotice(db, userId, "2026-10-02T00:00:00.000Z");
    expect(await listAdjustmentNotice(db, userId)).toEqual([]);

    await addAdjustment(db, userId, a, "2026-10-05", 50, "2026-10-03T00:00:00.000Z");
    expect(await listAdjustmentNotice(db, userId)).toEqual([{ accountId: a, accountName: "하나", count: 1, total: 50, lastMonth: "2026-10" }]);

    // 다시 닫으면 닫은 시각을 고친다.
    await dismissAdjustmentNotice(db, userId, "2026-10-04T00:00:00.000Z");
    expect(await listAdjustmentNotice(db, userId)).toEqual([]);
  });
});

describe("설정은 사용자별이다(4.2-4)", () => {
  it("A가 보정 알림을 닫아도 B의 알림은 그대로다", async () => {
    const { db, userId: a } = await createTestContext();
    const b = await createTestUser(db);
    await addAdjustment(db, a, await addAccount(db, a, "A 계좌"), "2026-09-01", 100, "2026-10-01T00:00:00.000Z");
    await addAdjustment(db, b, await addAccount(db, b, "B 계좌"), "2026-09-01", 200, "2026-10-01T00:00:00.000Z");

    await dismissAdjustmentNotice(db, a, "2026-10-02T00:00:00.000Z");
    expect(await listAdjustmentNotice(db, a)).toEqual([]);
    expect((await listAdjustmentNotice(db, b)).map((n) => [n.accountName, n.total])).toEqual([["B 계좌", 200]]);
  });
});
